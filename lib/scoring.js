// Scoring engine. Pure functions; used by the API and (via /api/roles) by the
// dashboard for display. Everything is driven by the role config.

export function wordCount(s) {
  return String(s || "").trim().split(/\s+/).filter(Boolean).length;
}

// ---- Knockouts -----------------------------------------------------------

export function evaluateKnockouts(role, answers) {
  const flags = [];
  for (const f of role.stages.application.fields) {
    const k = f.knockout;
    if (!k) continue;
    const v = answers[f.id];
    const num = typeof v === "number" ? v : parseFloat(v);
    if (k.lt !== undefined && !(Number.isFinite(num) && num >= k.lt)) flags.push(k.reason);
    if (k.gt !== undefined && Number.isFinite(num) && num > k.gt) flags.push(k.reason);
    if (k.in && k.in.includes(v)) flags.push(k.reason);
    if (k.notIn && !k.notIn.includes(v)) flags.push(k.reason);
  }
  return flags;
}

// ---- Validation ----------------------------------------------------------

export function validateFields(fields, answers) {
  const errors = {};
  for (const f of fields) {
    const v = answers[f.id];
    const empty = v === undefined || v === null || v === "" || (typeof v === "object" && v && v.amount === "");
    if (f.required && empty) { errors[f.id] = "Required"; continue; }
    if (empty) continue;
    if (f.type === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) errors[f.id] = "Enter a valid email";
    if (f.type === "url" && !/^https?:\/\/\S+$/i.test(v)) errors[f.id] = "Enter a full link starting with http";
    if (f.type === "number" || f.type === "rating") {
      const n = Number(v);
      if (!Number.isFinite(n)) errors[f.id] = "Enter a number";
      else if (f.min !== undefined && n < f.min) errors[f.id] = `Minimum ${f.min}`;
      else if (f.max !== undefined && n > f.max) errors[f.id] = `Maximum ${f.max}`;
    }
    if (f.type === "select" && f.options && !f.options.includes(v)) errors[f.id] = "Choose an option";
    if (f.type === "currency") {
      if (!v || !Number.isFinite(Number(v.amount)) || Number(v.amount) <= 0) errors[f.id] = "Enter an amount";
      else if (!f.currencies.includes(v.currency)) errors[f.id] = "Choose a currency";
    }
    if (f.maxWords && wordCount(v) > f.maxWords) errors[f.id] = `Keep it under ${f.maxWords} words`;
    if (typeof v === "string" && v.length > 5000) errors[f.id] = "Too long";
  }
  return errors;
}

export function validateQuestions(questions, answers) {
  const errors = {};
  for (const q of questions) {
    const v = answers[q.id];
    if (!v || !String(v).trim()) { errors[q.id] = "Required"; continue; }
    if (q.maxWords && wordCount(v) > q.maxWords) errors[q.id] = `Keep it under ${q.maxWords} words`;
  }
  return errors;
}

// ---- Auto scores from objective fields ----------------------------------

export function autoScoresFromApplication(role, answers) {
  const out = {};
  for (const f of role.stages.application.fields) {
    if (!f.autoScore) continue;
    const v = answers[f.id];
    const s = f.autoScore.map?.[v];
    if (s !== undefined) out[f.autoScore.skill] = { score: s, note: f.autoScore.note || "auto" };
  }
  return out;
}

// ---- Totals --------------------------------------------------------------

function weightedAverage(criteria, scores) {
  let num = 0, den = 0, filled = 0;
  for (const c of criteria) {
    const s = scores?.[c.id];
    if (s === undefined || s === null || s === "") continue;
    num += Number(s) * (c.weight || 1);
    den += (c.weight || 1);
    filled++;
  }
  return den ? { score: +(num / den).toFixed(2), filled, total: criteria.length } : { score: null, filled: 0, total: criteria.length };
}

function plainAverage(keys, scores) {
  let sum = 0, n = 0;
  for (const k of keys) {
    const s = scores?.[k];
    if (s === undefined || s === null || s === "") continue;
    sum += Number(s); n++;
  }
  return n ? { score: +(sum / n).toFixed(2), filled: n, total: keys.length } : { score: null, filled: 0, total: keys.length };
}

/**
 * Compute the candidate's live score card.
 * manual = {skill:{id:score}, values:{key:score}} (Cameron's), ai = AI output.
 * Manual overrides AI; AI fills gaps for values where available.
 */
export function computeScorecard(role, candidate) {
  const manual = safeJson(candidate.manual_scores) || {};
  const ai = safeJson(candidate.ai_scores) || {};
  const application = safeJson(candidate.application) || {};
  const auto = autoScoresFromApplication(role, application);

  const skillCriteria = role.scoring.skill.criteria;
  const valueKeys = role.values.map((v) => v.key);

  // Skill: manual only (test edit is Cameron's call). Auto self-ratings shown as hints.
  const skillScores = {};
  for (const c of skillCriteria) if (manual.skill?.[c.id] !== undefined && manual.skill[c.id] !== "") skillScores[c.id] = Number(manual.skill[c.id]);
  const skill = weightedAverage(skillCriteria, skillScores);

  // Values: manual overrides AI's suggested value scores.
  const valueScores = {};
  const valueSource = {};
  for (const k of valueKeys) {
    if (manual.values?.[k] !== undefined && manual.values[k] !== "") { valueScores[k] = Number(manual.values[k]); valueSource[k] = "manual"; }
    else if (ai.values?.[k]?.score !== undefined) { valueScores[k] = Number(ai.values[k].score); valueSource[k] = "ai"; }
  }
  const values = plainAverage(valueKeys, valueScores);

  // Floors
  const reasons = [];
  const floors = role.scoring;
  let skillFloorOk = null, valuesFloorOk = null;
  if (skill.filled === skill.total) {
    skillFloorOk = true;
    if (skill.score < floors.skill.floor) { skillFloorOk = false; reasons.push(`Skill ${skill.score} below ${floors.skill.floor}`); }
    for (const c of skillCriteria) {
      if (skillScores[c.id] === 1) { skillFloorOk = false; reasons.push(`${c.name} scored 1`); }
      if (c.floor && skillScores[c.id] < c.floor) { skillFloorOk = false; reasons.push(`${c.name} below ${c.floor}`); }
    }
  }
  if (values.filled === values.total) {
    valuesFloorOk = true;
    for (const v of role.values) {
      if (valueScores[v.key] < floors.values.floor) { valuesFloorOk = false; reasons.push(`${v.name} below ${floors.values.floor}`); }
    }
  }

  let recommendation = "incomplete";
  if (skillFloorOk !== null && valuesFloorOk !== null) {
    if (skillFloorOk && valuesFloorOk) recommendation = skill.score >= 4 && values.score >= 4 ? "strong" : "advance";
    else recommendation = "no";
  } else if (skillFloorOk === false || valuesFloorOk === false) recommendation = "no";

  // Written-assessment average (AI) for the pipeline view
  const written = ai.questions ? plainAverage(Object.keys(ai.questions), Object.fromEntries(Object.entries(ai.questions).map(([k, v]) => [k, v.score]))) : { score: null, filled: 0, total: 0 };

  return { skill: { ...skill, scores: skillScores, auto }, values: { ...values, scores: valueScores, source: valueSource }, written, floors: { skill: skillFloorOk, values: valuesFloorOk, reasons }, recommendation };
}

export function safeJson(s) {
  if (!s) return null;
  if (typeof s === "object") return s;
  try { return JSON.parse(s); } catch { return null; }
}
