// Optional AI scoring of written answers via the Anthropic API.
// Enabled only when ANTHROPIC_API_KEY is set. Scores are suggestions: the
// dashboard shows them with rationale and Cameron can override every one.

const MODEL = "claude-sonnet-4-5";

export async function scoreWrittenAnswers(env, role, candidate) {
  if (!env.ANTHROPIC_API_KEY) return null;
  const application = JSON.parse(candidate.application || "{}");
  const assessment = JSON.parse(candidate.assessment || "{}");
  const test = JSON.parse(candidate.test || "{}");

  const valuesBlock = role.values.map((v) => {
    const a = role.scoring.values.anchors[v.key] || {};
    return `- ${v.key} — ${v.name}: ${v.desc}\n    1 = ${a["1"]}\n    3 = ${a["3"]}\n    5 = ${a["5"]}`;
  }).join("\n");

  const items = [];
  for (const f of role.stages.application.fields) {
    if (f.aiScore && application[f.id]) items.push({ id: f.id, prompt: f.label, tests: f.aiScore.tests, strong: f.aiScore.strong, answer: application[f.id] });
  }
  for (const q of role.stages.assessment.questions) {
    if (assessment[q.id]) items.push({ id: q.id, prompt: q.prompt, tests: q.tests, strong: q.strong, answer: assessment[q.id] });
  }
  if (test.notes) items.push({ id: "test_notes", prompt: "Notes on their test-edit choices", tests: ["ownership", "excellence"], strong: "Explains trade-offs like a partner would; owns weaknesses.", answer: test.notes });
  if (test.questions) items.push({ id: "test_questions", prompt: "Questions they had about the brief", tests: ["ownership", "client"], strong: "Smart, specific questions and sensible assumptions.", answer: test.questions });
  if (!items.length) return null;

  const itemsBlock = items.map((it, i) => `### Item ${i + 1} (id: ${it.id})\nQuestion: ${it.prompt}\nTests values: ${it.tests.join(", ")}\nWhat a strong answer looks like: ${it.strong}\nCandidate's answer:\n"""\n${it.answer}\n"""`).join("\n\n");

  const system = `You are a hiring assessor for ${role.title} at a premium video content agency. Score candidate answers strictly against the rubric. Be specific and unsentimental. Mediocre, generic or flattering answers score 2–3; only concrete, specific, self-aware answers score 4–5. Return JSON only.`;

  const user = `Core values and anchors:\n${valuesBlock}\n\nAnswers to score:\n\n${itemsBlock}\n\nReturn JSON with exactly this shape:\n{\n  "questions": { "<id>": { "score": 1-5, "rationale": "one or two sentences" } },\n  "values": { "<valueKey>": { "score": 1-5, "rationale": "one or two sentences citing which answers" } },\n  "english": { "score": 1-5, "rationale": "clarity and fluency of written English" },\n  "summary": "two sentences: overall read on this candidate"\n}\nEvery value key (${role.values.map((v) => v.key).join(", ")}) must be present. Score a value only from the answers that test it.`;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model: MODEL, max_tokens: 2000, system, messages: [{ role: "user", content: user }] }),
  });
  if (!res.ok) throw new Error(`AI scoring failed: ${res.status} ${await res.text()}`);
  const data = await res.json();
  const text = (data.content || []).map((c) => c.text || "").join("");
  const json = text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
  const parsed = JSON.parse(json);
  parsed.model = MODEL;
  parsed.scoredAt = new Date().toISOString();
  return parsed;
}
