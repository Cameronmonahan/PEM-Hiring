// Email via Resend (optional). If RESEND_API_KEY is missing, sends are
// skipped silently and the dashboard shows "copy link" instead.
import { brand } from "../config/brand.js";

export async function sendEmail(env, { to, subject, html, text }) {
  if (!env.RESEND_API_KEY) return { skipped: true };
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${env.RESEND_API_KEY}` },
    body: JSON.stringify({ from: `${brand.fromName} <${brand.fromEmail}>`, to: [to], subject, html, text }),
  });
  if (!res.ok) return { error: `${res.status} ${await res.text()}` };
  return { ok: true };
}

export function layout(title, bodyHtml) {
  const c = brand.colors;
  return `<!doctype html><html><body style="margin:0;background:${c.navyDeep};font-family:Montserrat,Helvetica,Arial,sans-serif;color:${c.white}">
  <div style="max-width:560px;margin:0 auto;padding:40px 24px">
    <img src="${brand.careersUrl}${brand.logoGold}" alt="${brand.company}" style="height:28px;margin-bottom:28px">
    <h1 style="font-family:'Bebas Neue',Impact,sans-serif;font-weight:400;font-size:32px;letter-spacing:.04em;margin:0 0 16px;color:${c.white}">${title}</h1>
    <div style="font-size:15px;line-height:1.6;color:${c.muted}">${bodyHtml}</div>
    <p style="margin-top:36px;font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:${c.muted2}">${brand.company}</p>
  </div></body></html>`;
}

export function button(href, label) {
  const c = brand.colors;
  return `<p style="margin:24px 0"><a href="${href}" style="display:inline-block;background:${c.gold};color:${c.navyDeep};text-decoration:none;font-weight:700;padding:14px 22px;border-radius:10px;letter-spacing:.04em">${label}</a></p><p style="font-size:12px;color:${c.muted2}">Or copy this link: ${href}</p>`;
}

export const templates = {
  applied(role, link) {
    return { subject: `${brand.company} — your ${role.title} application`, html: layout("Application received", `<p>Thanks for applying for the ${role.title} role. Your application cleared our first screen, so the written assessment is open for you now. It takes about 25 minutes.</p>${button(link, "Open the written assessment")}<p>This is your personal link. Keep it — it's how you'll move through every step.</p>`) };
  },
  appliedHold(role) {
    return { subject: `${brand.company} — your ${role.title} application`, html: layout("Application received", `<p>Thanks for applying for the ${role.title} role. We review every application personally and will reply within 24 hours.</p>`) };
  },
  rejected(role) {
    return { subject: `${brand.company} — your ${role.title} application`, html: layout("Thank you", `<p>Thanks for applying for the ${role.title} role. We won't be moving forward this time, but we appreciate the time you put in and wish you the best.</p>`) };
  },
  assessmentUnlocked(role, link) {
    return { subject: `${brand.company} — written assessment`, html: layout("Next step: written assessment", `<p>We'd like you to continue. The written assessment is a few short questions about how you think — ${role.stages.assessment.blurb}</p>${button(link, "Open the written assessment")}`) };
  },
  testUnlocked(role, link, dueAt) {
    const noun = role.stages.test?.noun || "test edit";
    const blurb = role.stages.test?.emailBlurb || "The last step before a call is a scoped test edit: a real brief, real footage, 4–6 hours of work.";
    return { subject: `${brand.company} — ${noun}`, html: layout(`Next step: the ${noun}`, `<p>Your written answers stood out. ${blurb}</p><p>Your 72-hour window is open now and closes <strong>${dueAt}</strong>.</p>${button(link, "Open the brief")}`) };
  },
  testReceived(role) {
    const noun = role.stages.test?.noun || "test edit";
    return { subject: `${brand.company} — ${noun} received`, html: layout("Got it", `<p>Your ${noun} is in. We review every submission against the same rubric and will be in touch within 24 hours.</p>`) };
  },
  call(role) {
    const what = role.stages.test ? `Your ${role.stages.test.noun || "test edit"}` : "Your application and written answers";
    return { subject: `${brand.company} — let's talk`, html: layout("Let's talk", `<p>${what} cleared our bar and we'd like to book a 30-minute call. Reply to this email with a few times that work for you this week.</p>`) };
  },
};

export async function notifyOwner(env, subject, text) {
  if (!env.NOTIFY_EMAIL) return;
  await sendEmail(env, { to: env.NOTIFY_EMAIL, subject, html: `<pre style="font-family:monospace">${escapeHtml(text)}</pre>`, text });
}

function escapeHtml(s) { return String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c])); }
