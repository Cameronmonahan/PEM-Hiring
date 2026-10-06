# PEM Hiring

A custom hiring platform for Peak Exposure Media: branded candidate portal,
automatic knockouts and scoring, and a private dashboard — one config file per
role. Runs on Cloudflare Pages (static front end + Functions + D1). Free at this
scale, and a fork + one brand file replicates it for a client.

**Live:** `https://careers.peakexposuremedia.com` (Cloudflare project: `pem-hiring.pages.dev`) · dashboard at `/admin/`

## How it works

```
Candidate                          Backend (Pages Functions + D1)         You (/admin/)
─────────                          ──────────────────────────────         ─────────────
/?role=senior-video-editor  ──►    knockouts → reject or unlock stage 2   pipeline view
/c/?t=<token>  (assessment) ──►    word limits, optional AI scoring   ──► read + override
/c/?t=<token>  (test edit)  ──►    72h window, late flag              ──► score rubric → floors → verdict
```

- **Stage 1 Application** — knockout rules reject instantly (years, NLE, AE,
  log color, hours, English). Passing applicants are auto-advanced to stage 2
  (set `flow.autoAdvanceToAssessment` in the role file).
- **Stage 2 Written assessment** — six questions, 150-word cap each. If
  `ANTHROPIC_API_KEY` is set, each answer and each core value gets an AI score
  with a rationale. You can override every score with one click.
- **Stage 3 Test edit** — you unlock it from the dashboard (or set
  `flow.autoAdvanceToTest: true`). The candidate gets the brief, a 72-hour
  countdown, and a submission form (links, start/finish times, hours, Loom).
- **Scoring** — skill criteria (weighted) and values are scored separately.
  Floors from the role file decide the verdict: *Strong*, *Advance to call*,
  *Below bar*, or *Scoring incomplete*.

## Deploy (first time, ~15 minutes)

1. **Push this repo to GitHub** (already done if you're reading it there).
2. **Create the database**
   ```bash
   npm install
   npx wrangler login
   npx wrangler d1 create pem-hiring
   ```
   Paste the `database_id` it prints into `wrangler.toml`, commit, push.
3. **Apply the schema**
   ```bash
   npm run db:remote
   ```
4. **Create the Pages project** — Cloudflare dashboard → Workers & Pages →
   Create → Pages → Connect to Git → pick this repo. Build command: *(none)*.
   Build output directory: `public`. Deploy.
5. **Bind the database** — Pages project → Settings → Bindings → D1 →
   variable name `DB`, database `pem-hiring`. (Wrangler usually picks this up
   from `wrangler.toml`; add it manually if the dashboard shows no binding.)
6. **Set secrets** — Settings → Variables and Secrets (Production):
   | Name | Required | What it does |
   | --- | --- | --- |
   | `ADMIN_PASSWORD` | yes | Dashboard login |
   | `SESSION_SECRET` | yes | Any long random string (signs the login cookie) |
   | `ANTHROPIC_API_KEY` | no | Turns on AI scoring of written answers |
   | `RESEND_API_KEY` | no | Turns on automatic candidate emails (Resend.com; verify `peakexposuremedia.com` there first) |
   | `NOTIFY_EMAIL` | no | Where new-submission alerts go (needs Resend) |
   Redeploy after adding secrets.
7. **Custom domain** — Pages project → Custom domains → `careers.peakexposuremedia.com`.
   Then in Squarespace DNS add a CNAME: host `careers` → `pem-hiring.pages.dev`
   (same as you did for `shoots`). Update `careersUrl` in `config/brand.js` if
   you use a different subdomain — it's what candidate links are built from.

Without `RESEND_API_KEY` everything still works: the dashboard copies the
candidate's personal link to your clipboard whenever you unlock a stage, and
you email it yourself. Without `ANTHROPIC_API_KEY`, written answers show with
the "strong answer looks like" hints and you score values by hand.

## Day to day

- Share `https://careers.peakexposuremedia.com/?role=senior-video-editor`
  (the dashboard has a *Copy apply link* button) — put it on the website, in
  the agency brief, anywhere.
- Open `/admin/`. New applications land at the top; auto-rejects go straight
  to *Rejected* with the reason shown.
- When a written assessment comes in, read it (with AI scores if enabled) and
  hit **Unlock test edit (72h)**.
- When a test edit comes in, open the links, score the eight skill criteria and
  four values, and the verdict updates live. **Advance to call** or **Reject**.
- Notes and a timeline live on each candidate.

## Adding a role

1. Copy `config/roles/senior-video-editor.json` to a new file and edit:
   title, intro, values, application fields (with `knockout` rules), assessment
   questions (with `strong` hints and which value each `tests`), the test brief
   and deliverables, and the scoring rubric with weights and floors.
2. Register it in `config/roles/index.js` (one import, one array entry).
3. Push. The role appears on the careers page when `"status": "open"`.

Field types available: `text`, `email`, `url`, `number`, `date`, `datetime`,
`select`, `currency`, `rating`, `textarea` (with `maxWords`). Knockouts:
`lt`, `gt`, `in`, `notIn`. `autoScore` maps a select answer to a self-rated
skill hint; `aiScore` sends a textarea to AI scoring.

## Replicating for a client

Fork the repo, then change:
- `config/brand.js` — company, colors, fonts, logos, `careersUrl`, from-email
- `public/assets/` — their logo files
- `config/roles/` — their roles
- Cloudflare: new Pages project, new D1 database, their subdomain

## Local development

```bash
npm install
npm run db:local
echo "ADMIN_PASSWORD=test1234\nSESSION_SECRET=dev" > .dev.vars
npm run dev     # http://localhost:8788
```

## Files

```
config/brand.js            company + visual identity
config/roles/*.json        one file per role (questions, knockouts, rubric, brief)
config/roles/index.js      role registry
functions/api/[[path]].js  all API routes (public + admin)
lib/scoring.js             knockouts, validation, weighted scores, floors, verdict
lib/ai.js                  optional AI scoring (Anthropic API)
lib/email.js               optional candidate emails (Resend)
public/index.html          careers page + application form
public/c/index.html        candidate's personal portal (assessment, test edit)
public/admin/index.html    your dashboard
public/styles.css, shared.js
schema.sql, wrangler.toml
```

## Data and privacy

Candidate data lives in your D1 database only. Candidate links are random
32-character tokens; the dashboard never exposes them except via the copy
button. Deleting a candidate removes their record and timeline permanently.
