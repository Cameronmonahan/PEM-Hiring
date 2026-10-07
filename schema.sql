-- PEM Hiring — D1 schema. Apply with:
--   npx wrangler d1 execute pem-hiring --remote --file=schema.sql
-- (and --local for local dev)

CREATE TABLE IF NOT EXISTS candidates (
  id TEXT PRIMARY KEY,
  token TEXT UNIQUE NOT NULL,
  role_slug TEXT NOT NULL,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  -- applied | assessment | assessment_done | test | test_done | call | hired | rejected
  status TEXT NOT NULL DEFAULT 'applied',
  rejected_reason TEXT,
  auto_flags TEXT,          -- JSON array of knockout reasons (empty = passed)
  application TEXT NOT NULL,-- JSON of application answers
  assessment TEXT,          -- JSON of assessment answers
  test TEXT,                -- JSON of test deliverables
  ai_scores TEXT,           -- JSON: AI scoring of written answers
  manual_scores TEXT,       -- JSON: Cameron's scores {skill:{}, values:{}}
  notes TEXT,               -- JSON array of {at, text}
  test_unlocked_at TEXT,
  test_due_at TEXT,
  assessment_submitted_at TEXT,
  test_submitted_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_candidates_role ON candidates(role_slug, status);
CREATE INDEX IF NOT EXISTS idx_candidates_email ON candidates(role_slug, email);

CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  candidate_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  detail TEXT,
  at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_events_candidate ON events(candidate_id, at);

-- Per-role live/paused override set from the dashboard (created automatically on first use).
CREATE TABLE IF NOT EXISTS role_settings (
  slug TEXT PRIMARY KEY,
  status TEXT NOT NULL,     -- open | paused
  updated_at TEXT NOT NULL
);
