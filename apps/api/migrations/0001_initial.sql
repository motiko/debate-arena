-- Debate Arena schema. Timestamps are ISO-8601 UTC strings; JSON columns hold engine types.

CREATE TABLE debates (
  id TEXT PRIMARY KEY,
  member_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('running', 'complete', 'failed')),
  setup_json TEXT NOT NULL,
  ai_voters_json TEXT NOT NULL,
  self_judging INTEGER NOT NULL,
  quota_points INTEGER NOT NULL,
  budget_reserved_micro_usd INTEGER NOT NULL,
  cost_micro_usd INTEGER NOT NULL DEFAULT 0,
  verdict_json TEXT,
  ai_audience_json TEXT,
  created_at TEXT NOT NULL,
  completed_at TEXT,
  failure_reason TEXT
);

CREATE INDEX debates_status_completed_at ON debates (status, completed_at);

CREATE TABLE turns (
  debate_id TEXT NOT NULL REFERENCES debates (id),
  slot_index INTEGER NOT NULL,
  phase_index INTEGER NOT NULL,
  side TEXT NOT NULL CHECK (side IN ('for', 'against')),
  text TEXT NOT NULL,
  truncated INTEGER NOT NULL,
  PRIMARY KEY (debate_id, slot_index)
);

-- Quota points spent per Member per UTC day ('YYYY-MM-DD').
CREATE TABLE quota_usage (
  member_id TEXT NOT NULL,
  day TEXT NOT NULL,
  points INTEGER NOT NULL CHECK (points >= 0),
  PRIMARY KEY (member_id, day)
);
