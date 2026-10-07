// Single API router for Cloudflare Pages Functions.
//
// Public (candidate):
//   GET  /api/roles                      open roles (public fields only)
//   GET  /api/roles/:slug                one role (public fields only)
//   POST /api/apply/:slug                submit application → {token, status}
//   GET  /api/c/:token                   candidate's own view (stage state, role)
//   POST /api/c/:token/assessment        submit written answers
//   POST /api/c/:token/test              submit test deliverables
// Admin (cookie session):
//   POST /api/admin/login  {password}
//   POST /api/admin/logout
//   GET  /api/admin/me
//   GET  /api/admin/roles                full role configs incl. rubric
//   GET  /api/admin/candidates?role=     list with scorecards
//   GET  /api/admin/candidates/:id       full record + scorecard
//   POST /api/admin/candidates/:id/scores   {skill:{}, values:{}}
//   POST /api/admin/candidates/:id/notes    {text}
//   POST /api/admin/candidates/:id/status   {status, send:true|false}
//   POST /api/admin/candidates/:id/rescore  run AI scoring again
//   DELETE /api/admin/candidates/:id

import { roles, getRole } from "../../config/roles/index.js";
import { brand } from "../../config/brand.js";
import { evaluateKnockouts, validateFields, validateQuestions, computeScorecard, safeJson } from "../../lib/scoring.js";
import { scoreWrittenAnswers } from "../../lib/ai.js";
import { sendEmail, templates, notifyOwner } from "../../lib/email.js";

const STATUSES = ["applied", "assessment", "assessment_done", "test", "test_done", "call", "hired", "rejected"];

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const path = url.pathname.replace(/^\/api\/?/, "").replace(/\/$/, "");
  const parts = path.split("/").filter(Boolean);
  try {
    if (request.method === "OPTIONS") return new Response(null, { status: 204 });
    if (parts[0] === "roles") return handleRoles(env, parts);
    if (parts[0] === "apply" && request.method === "POST") return handleApply(request, env, parts[1], url);
    if (parts[0] === "c" && parts[1]) return handleCandidate(request, env, parts, url);
    if (parts[0] === "admin") return handleAdmin(request, env, parts, url);
    return json({ error: "Not found" }, 404);
  } catch (e) {
    console.error(e);
    return json({ error: e.message || "Server error" }, 500);
  }
}

// ---------------------------------------------------------------- helpers

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers } });
}
async function readJson(request) { try { return await request.json(); } catch { return {}; } }
function now() { return new Date().toISOString(); }
function id() { return crypto.randomUUID(); }
function token() {
  const b = new Uint8Array(24); crypto.getRandomValues(b);
  return btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function publicRole(r) {
  // Strip the rubric and the "strong answer" hints from what candidates see.
  const { scoring, ...rest } = r;
  const clone = JSON.parse(JSON.stringify(rest));
  clone.stages.application.fields = clone.stages.application.fields.map(({ knockout, autoScore, aiScore, ...f }) => f);
  clone.stages.assessment.questions = clone.stages.assessment.questions.map(({ strong, tests, skill, ...q }) => q);
  return clone;
}
function candidateLink(url, tok) { return `${brand.careersUrl || url.origin}/c/?t=${tok}`; }
async function logEvent(env, candidateId, kind, detail) {
  await env.DB.prepare("INSERT INTO events (candidate_id, kind, detail, at) VALUES (?,?,?,?)").bind(candidateId, kind, detail || null, now()).run();
}
function fmtDue(iso) { return new Date(iso).toUTCString().replace(" GMT", " UTC"); }

// ---------------------------------------------------------------- public

// ---- Role status overrides (live / paused), stored in D1 so the dashboard can toggle without a deploy ----
async function roleStatusOverrides(env) {
  await env.DB.prepare("CREATE TABLE IF NOT EXISTS role_settings (slug TEXT PRIMARY KEY, status TEXT NOT NULL, updated_at TEXT NOT NULL)").run();
  const { results } = await env.DB.prepare("SELECT slug, status FROM role_settings").all();
  return Object.fromEntries((results || []).map((r) => [r.slug, r.status]));
}
async function effectiveRoles(env) {
  const o = await roleStatusOverrides(env);
  return roles.map((r) => ({ ...r, status: o[r.slug] || r.status }));
}
async function effectiveRole(env, slug) {
  const r = getRole(slug);
  if (!r) return null;
  const o = await roleStatusOverrides(env);
  return { ...r, status: o[slug] || r.status };
}

async function handleRoles(env, parts) {
  if (parts[1]) {
    const r = await effectiveRole(env, parts[1]);
    if (!r) return json({ error: "Role not found" }, 404);
    return json({ brand: publicBrand(), role: publicRole(r) });
  }
  const all = await effectiveRoles(env);
  return json({ brand: publicBrand(), roles: all.filter((r) => r.status === "open").map((r) => ({ slug: r.slug, title: r.title, location: r.location, type: r.type, summary: r.summary })) });
}
function publicBrand() { return { company: brand.company, shortName: brand.shortName, tagline: brand.tagline, website: brand.website, logoLight: brand.logoLight, logoGold: brand.logoGold, icon: brand.icon, colors: brand.colors, fonts: brand.fonts, fromEmail: brand.fromEmail }; }

async function handleApply(request, env, slug, url) {
  const role = await effectiveRole(env, slug);
  if (!role || role.status !== "open") return json({ error: "This role is not open" }, 404);
  const body = await readJson(request);
  const answers = body.answers || {};
  if (body.website) return json({ ok: true, token: null, status: "applied" }); // honeypot

  const errors = validateFields(role.stages.application.fields, answers);
  if (Object.keys(errors).length) return json({ error: "Please fix the highlighted fields", errors }, 400);

  const email = String(answers.email).trim().toLowerCase();
  const existing = await env.DB.prepare("SELECT token, status FROM candidates WHERE role_slug=? AND email=?").bind(slug, email).first();
  if (existing) return json({ ok: true, token: existing.token, status: existing.status, duplicate: true });

  const flags = evaluateKnockouts(role, answers);
  const cid = id(), tok = token(), t = now();
  let status = "applied";
  if (flags.length) status = "rejected";
  else if (role.flow.autoAdvanceToAssessment) status = "assessment";

  await env.DB.prepare(`INSERT INTO candidates (id, token, role_slug, name, email, status, rejected_reason, auto_flags, application, notes, created_at, updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).bind(cid, tok, slug, String(answers.name).trim(), email, status, flags.length ? "Auto: " + flags.join("; ") : null, JSON.stringify(flags), JSON.stringify(answers), "[]", t, t).run();
  await logEvent(env, cid, "applied", flags.length ? `Knocked out: ${flags.join("; ")}` : "Passed knockouts");

  const link = candidateLink(url, tok);
  // Emails (skipped when Resend isn't configured)
  if (status === "rejected") await sendEmail(env, { to: email, ...templates.rejected(role) });
  else if (status === "assessment") await sendEmail(env, { to: email, ...templates.applied(role, link) });
  else await sendEmail(env, { to: email, ...templates.appliedHold(role) });
  await notifyOwner(env, `[${brand.shortName} Hiring] New application: ${answers.name} — ${role.title}${flags.length ? " (auto-rejected)" : ""}`, `${answers.name} <${email}>\nStatus: ${status}\n${flags.length ? "Knockouts: " + flags.join("; ") + "\n" : ""}\nDashboard: ${brand.careersUrl}/admin/`);

  // Kick off AI scoring of the "proudest" answer in the background.
  if (status !== "rejected" && env.ANTHROPIC_API_KEY) {
    const row = await env.DB.prepare("SELECT * FROM candidates WHERE id=?").bind(cid).first();
    try { const ai = await scoreWrittenAnswers(env, role, row); if (ai) await env.DB.prepare("UPDATE candidates SET ai_scores=?, updated_at=? WHERE id=?").bind(JSON.stringify(ai), now(), cid).run(); } catch (e) { console.error("AI scoring", e); }
  }
  return json({ ok: true, token: tok, status });
}

async function handleCandidate(request, env, parts, url) {
  const tok = parts[1];
  const row = await env.DB.prepare("SELECT * FROM candidates WHERE token=?").bind(tok).first();
  if (!row) return json({ error: "Link not found" }, 404);
  const role = getRole(row.role_slug);
  if (!role) return json({ error: "Role not found" }, 404);

  if (request.method === "GET" && !parts[2]) {
    return json({ brand: publicBrand(), role: publicRole(role), candidate: { name: row.name, status: row.status, test_due_at: row.test_due_at, test_unlocked_at: row.test_unlocked_at, assessment_submitted_at: row.assessment_submitted_at, test_submitted_at: row.test_submitted_at, hasAssessment: !!row.assessment, hasTest: !!row.test } });
  }

  if (request.method === "POST" && parts[2] === "assessment") {
    if (row.status !== "assessment") return json({ error: "The assessment isn't open for this link" }, 403);
    const body = await readJson(request);
    const answers = body.answers || {};
    const errors = validateQuestions(role.stages.assessment.questions, answers);
    if (Object.keys(errors).length) return json({ error: "Please fix the highlighted answers", errors }, 400);
    const t = now();
    let status = role.flow.autoAdvanceToTest ? "test" : "assessment_done";
    const due = status === "test" ? new Date(Date.now() + role.flow.testDeadlineHours * 3600e3).toISOString() : null;
    await env.DB.prepare("UPDATE candidates SET assessment=?, status=?, assessment_submitted_at=?, test_unlocked_at=?, test_due_at=?, updated_at=? WHERE id=?")
      .bind(JSON.stringify(answers), status, t, due ? t : null, due, t, row.id).run();
    await logEvent(env, row.id, "assessment_submitted");
    await notifyOwner(env, `[${brand.shortName} Hiring] Assessment submitted: ${row.name} — ${role.title}`, `Review: ${brand.careersUrl}/admin/#c=${row.id}`);
    if (status === "test") await sendEmail(env, { to: row.email, ...templates.testUnlocked(role, candidateLink(url, tok), fmtDue(due)) });
    if (env.ANTHROPIC_API_KEY) {
      const fresh = await env.DB.prepare("SELECT * FROM candidates WHERE id=?").bind(row.id).first();
      try { const ai = await scoreWrittenAnswers(env, role, fresh); if (ai) await env.DB.prepare("UPDATE candidates SET ai_scores=?, updated_at=? WHERE id=?").bind(JSON.stringify(ai), now(), row.id).run(); } catch (e) { console.error("AI scoring", e); }
    }
    return json({ ok: true, status });
  }

  if (request.method === "POST" && parts[2] === "test") {
    if (!role.stages.test) return json({ error: "This role has no test stage" }, 404);
    if (row.status !== "test") return json({ error: "The test edit isn't open for this link" }, 403);
    const body = await readJson(request);
    const answers = body.answers || {};
    const errors = validateFields(role.stages.test.deliverables, answers);
    if (Object.keys(errors).length) return json({ error: "Please fix the highlighted fields", errors }, 400);
    const t = now();
    const late = row.test_due_at && t > row.test_due_at;
    await env.DB.prepare("UPDATE candidates SET test=?, status='test_done', test_submitted_at=?, updated_at=? WHERE id=?").bind(JSON.stringify(answers), t, t, row.id).run();
    await logEvent(env, row.id, "test_submitted", late ? "Late" : "On time");
    await sendEmail(env, { to: row.email, ...templates.testReceived(role) });
    await notifyOwner(env, `[${brand.shortName} Hiring] Test edit submitted: ${row.name} — ${role.title}${late ? " (LATE)" : ""}`, `Review: ${brand.careersUrl}/admin/#c=${row.id}`);
    if (env.ANTHROPIC_API_KEY) {
      const fresh = await env.DB.prepare("SELECT * FROM candidates WHERE id=?").bind(row.id).first();
      try { const ai = await scoreWrittenAnswers(env, role, fresh); if (ai) await env.DB.prepare("UPDATE candidates SET ai_scores=?, updated_at=? WHERE id=?").bind(JSON.stringify(ai), now(), row.id).run(); } catch (e) { console.error("AI scoring", e); }
    }
    return json({ ok: true, status: "test_done", late });
  }
  return json({ error: "Not found" }, 404);
}

// ---------------------------------------------------------------- admin auth

async function hmac(secret, msg) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(msg));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
function secret(env) { return env.SESSION_SECRET || env.ADMIN_PASSWORD || "dev"; }
async function makeSession(env) { const exp = Date.now() + 14 * 86400e3; return `${exp}.${await hmac(secret(env), String(exp))}`; }
async function checkSession(request, env) {
  const cookie = request.headers.get("cookie") || "";
  const m = cookie.match(/(?:^|;\s*)pem_admin=([^;]+)/);
  if (!m) return false;
  const [exp, sig] = m[1].split(".");
  if (!exp || !sig || Number(exp) < Date.now()) return false;
  return sig === (await hmac(secret(env), exp));
}
function safeEqual(a, b) { if (a.length !== b.length) return false; let r = 0; for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i); return r === 0; }

async function handleAdmin(request, env, parts, url) {
  const sub = parts[1];
  if (sub === "login" && request.method === "POST") {
    if (!env.ADMIN_PASSWORD) return json({ error: "ADMIN_PASSWORD is not configured" }, 500);
    const body = await readJson(request);
    if (!body.password || !safeEqual(String(body.password), env.ADMIN_PASSWORD)) return json({ error: "Wrong password" }, 401);
    const s = await makeSession(env);
    return json({ ok: true }, 200, { "set-cookie": `pem_admin=${s}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${14 * 86400}` });
  }
  if (sub === "logout") return json({ ok: true }, 200, { "set-cookie": "pem_admin=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0" });
  if (!(await checkSession(request, env))) return json({ error: "Unauthorized" }, 401);
  if (sub === "me") return json({ ok: true, ai: !!env.ANTHROPIC_API_KEY, email: !!env.RESEND_API_KEY, notify: env.NOTIFY_EMAIL || null, careersUrl: brand.careersUrl });

  // Setup checks: verify each upgrade actually works before a real candidate hits it.
  if (sub === "check" && request.method === "POST") {
    const body = await readJson(request);
    if (body.what === "email") {
      const to = body.to || env.NOTIFY_EMAIL || brand.fromEmail;
      if (!env.RESEND_API_KEY) return json({ ok: false, error: "RESEND_API_KEY is not set in Cloudflare" });
      const r = await sendEmail(env, { to, subject: `${brand.shortName} Hiring — test email`, html: templates.testReceived(getRole(roles[0].slug)).html.replace(/Your test \w+ is in\./, "This is a test email from your hiring dashboard. If you can read this, candidate emails are working.") });
      return json(r.ok ? { ok: true, message: `Sent to ${to}` } : { ok: false, error: r.error || "Send failed" });
    }
    if (body.what === "ai") {
      if (!env.ANTHROPIC_API_KEY) return json({ ok: false, error: "ANTHROPIC_API_KEY is not set in Cloudflare" });
      const res = await fetch("https://api.anthropic.com/v1/messages", { method: "POST", headers: { "content-type": "application/json", "x-api-key": env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" }, body: JSON.stringify({ model: "claude-sonnet-4-5", max_tokens: 20, messages: [{ role: "user", content: "Reply with the single word OK." }] }) });
      if (!res.ok) return json({ ok: false, error: `Anthropic API returned ${res.status}: ${(await res.text()).slice(0, 200)}` });
      return json({ ok: true, message: "AI scoring is live" });
    }
    return json({ error: "Unknown check" }, 400);
  }
  if (sub === "roles" && parts[2] && parts[3] === "status" && request.method === "POST") {
    const r = getRole(parts[2]);
    if (!r) return json({ error: "Role not found" }, 404);
    const body = await readJson(request);
    const status = body.status === "open" ? "open" : "paused";
    await roleStatusOverrides(env);
    await env.DB.prepare("INSERT INTO role_settings (slug, status, updated_at) VALUES (?, ?, ?) ON CONFLICT(slug) DO UPDATE SET status=excluded.status, updated_at=excluded.updated_at").bind(parts[2], status, now()).run();
    return json({ ok: true, status });
  }
  if (sub === "roles") return json({ roles: await effectiveRoles(env), brand });

  if (sub === "candidates") {
    const cid = parts[2];

    // Manually add a candidate you've already met and drop them in at a later stage.
    if (cid === "create" && request.method === "POST") {
      const body = await readJson(request);
      const role = getRole(body.role_slug);
      if (!role) return json({ error: "Role not found" }, 404);
      const name = String(body.name || "").trim(), email = String(body.email || "").trim().toLowerCase();
      if (!name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: "Name and a valid email are required" }, 400);
      const startAt = ["assessment", "test", "applied"].includes(body.startAt) ? body.startAt : "assessment";
      const dup = await env.DB.prepare("SELECT id FROM candidates WHERE role_slug=? AND email=?").bind(role.slug, email).first();
      if (dup) return json({ error: "A candidate with this email already exists for this role" }, 409);
      const application = { name, email, ...(body.application || {}), _addedManually: true };
      const nid = id(), tok = token(), t = now();
      const due = startAt === "test" ? new Date(Date.now() + role.flow.testDeadlineHours * 3600e3).toISOString() : null;
      await env.DB.prepare(`INSERT INTO candidates (id, token, role_slug, name, email, status, auto_flags, application, notes, test_unlocked_at, test_due_at, created_at, updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(nid, tok, role.slug, name, email, startAt, "[]", JSON.stringify(application), JSON.stringify(body.note ? [{ at: t, text: String(body.note).slice(0, 4000) }] : []), due ? t : null, due, t, t).run();
      await logEvent(env, nid, "added_manually", `Started at: ${startAt}`);
      const link = candidateLink(url, tok);
      let emailResult = { skipped: true };
      if (body.send) {
        const tpl = startAt === "test" ? templates.testUnlocked(role, link, fmtDue(due)) : startAt === "assessment" ? templates.assessmentUnlocked(role, link) : null;
        if (tpl) emailResult = await sendEmail(env, { to: email, ...tpl });
      }
      return json({ ok: true, id: nid, link, email: emailResult });
    }

    if (!cid) {
      const roleSlug = url.searchParams.get("role");
      const rows = roleSlug
        ? (await env.DB.prepare("SELECT * FROM candidates WHERE role_slug=? ORDER BY created_at DESC").bind(roleSlug).all()).results
        : (await env.DB.prepare("SELECT * FROM candidates ORDER BY created_at DESC").all()).results;
      return json({ candidates: rows.map((r) => summarize(r)) });
    }
    const row = await env.DB.prepare("SELECT * FROM candidates WHERE id=?").bind(cid).first();
    if (!row) return json({ error: "Not found" }, 404);
    const role = getRole(row.role_slug);
    const action = parts[3];

    if (request.method === "GET" && !action) {
      const events = (await env.DB.prepare("SELECT kind, detail, at FROM events WHERE candidate_id=? ORDER BY at ASC").bind(cid).all()).results;
      return json({ candidate: expand(row), scorecard: computeScorecard(role, row), events, link: candidateLink(url, row.token) });
    }
    if (request.method === "DELETE" && !action) {
      await env.DB.prepare("DELETE FROM candidates WHERE id=?").bind(cid).run();
      await env.DB.prepare("DELETE FROM events WHERE candidate_id=?").bind(cid).run();
      return json({ ok: true });
    }
    if (request.method === "POST" && action === "scores") {
      const body = await readJson(request);
      const manual = safeJson(row.manual_scores) || {};
      manual.skill = { ...(manual.skill || {}), ...(body.skill || {}) };
      manual.values = { ...(manual.values || {}), ...(body.values || {}) };
      await env.DB.prepare("UPDATE candidates SET manual_scores=?, updated_at=? WHERE id=?").bind(JSON.stringify(manual), now(), cid).run();
      const fresh = await env.DB.prepare("SELECT * FROM candidates WHERE id=?").bind(cid).first();
      return json({ ok: true, scorecard: computeScorecard(role, fresh) });
    }
    if (request.method === "POST" && action === "notes") {
      const body = await readJson(request);
      const notes = safeJson(row.notes) || [];
      if (body.text) notes.push({ at: now(), text: String(body.text).slice(0, 4000) });
      await env.DB.prepare("UPDATE candidates SET notes=?, updated_at=? WHERE id=?").bind(JSON.stringify(notes), now(), cid).run();
      return json({ ok: true, notes });
    }
    if (request.method === "POST" && action === "status") {
      const body = await readJson(request);
      const status = body.status;
      if (!STATUSES.includes(status)) return json({ error: "Bad status" }, 400);
      const t = now();
      let due = row.test_due_at, unlocked = row.test_unlocked_at;
      if (status === "test" && !role.stages.test) return json({ error: "This role has no test stage" }, 400);
      if (status === "test" && row.status !== "test") { unlocked = t; due = new Date(Date.now() + role.flow.testDeadlineHours * 3600e3).toISOString(); }
      await env.DB.prepare("UPDATE candidates SET status=?, test_unlocked_at=?, test_due_at=?, rejected_reason=?, updated_at=? WHERE id=?")
        .bind(status, unlocked, due, status === "rejected" ? (body.reason || "Manual") : row.rejected_reason, t, cid).run();
      await logEvent(env, cid, "status", `${row.status} → ${status}`);
      let emailResult = { skipped: true };
      if (body.send) {
        const link = candidateLink(url, row.token);
        const tpl = status === "assessment" ? templates.assessmentUnlocked(role, link)
          : status === "test" ? templates.testUnlocked(role, link, fmtDue(due))
          : status === "call" ? templates.call(role)
          : status === "rejected" ? templates.rejected(role) : null;
        if (tpl) emailResult = await sendEmail(env, { to: row.email, ...tpl });
      }
      return json({ ok: true, status, email: emailResult, link: candidateLink(url, row.token) });
    }
    if (request.method === "POST" && action === "rescore") {
      if (!env.ANTHROPIC_API_KEY) return json({ error: "AI scoring isn't configured (set ANTHROPIC_API_KEY)" }, 400);
      const ai = await scoreWrittenAnswers(env, role, row);
      await env.DB.prepare("UPDATE candidates SET ai_scores=?, updated_at=? WHERE id=?").bind(JSON.stringify(ai), now(), cid).run();
      const fresh = await env.DB.prepare("SELECT * FROM candidates WHERE id=?").bind(cid).first();
      return json({ ok: true, ai, scorecard: computeScorecard(role, fresh) });
    }
  }
  return json({ error: "Not found" }, 404);
}

function expand(r) {
  return { ...r, application: safeJson(r.application), assessment: safeJson(r.assessment), test: safeJson(r.test), ai_scores: safeJson(r.ai_scores), manual_scores: safeJson(r.manual_scores), notes: safeJson(r.notes) || [], auto_flags: safeJson(r.auto_flags) || [], token: undefined };
}
function summarize(r) {
  const role = getRole(r.role_slug);
  const sc = role ? computeScorecard(role, r) : null;
  const app = safeJson(r.application) || {};
  return { id: r.id, role_slug: r.role_slug, name: r.name, email: r.email, status: r.status, country: app.country || app.city, years: app.years, hours: app.hours, salary: app.salary, auto_flags: safeJson(r.auto_flags) || [], created_at: r.created_at, updated_at: r.updated_at, test_due_at: r.test_due_at, test_submitted_at: r.test_submitted_at, scorecard: sc && { skill: sc.skill.score, values: sc.values.score, written: sc.written.score, recommendation: sc.recommendation } };
}
