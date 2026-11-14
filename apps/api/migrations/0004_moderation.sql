-- Moderation (GLOSSARY: Flag, Unlisted, Report, Block). A Flag or 5 Member Reports Unlist a Debate (absent
-- from feeds, reachable by link); a Moderator relists or Blocks it, with a DSA Art. 17 statement of reasons.

ALTER TABLE debates ADD COLUMN visibility TEXT NOT NULL DEFAULT 'listed' CHECK (visibility IN ('listed', 'unlisted', 'blocked'));
ALTER TABLE debates ADD COLUMN screen_json TEXT;
ALTER TABLE debates ADD COLUMN screened_at TEXT;
ALTER TABLE debates ADD COLUMN flagged INTEGER NOT NULL DEFAULT 0;
-- When a Moderator last decided on this Debate; Reports before it no longer count toward Unlisting.
ALTER TABLE debates ADD COLUMN reviewed_at TEXT;

CREATE INDEX debates_visibility_status_completed_at ON debates (visibility, status, completed_at);

-- Reports from anyone (DSA Art. 16). A Member reports a Debate at most once; anonymous Reports
-- (reporter_member_id NULL) are not deduplicated, and do not count toward Unlisting.
CREATE TABLE reports (
  id TEXT PRIMARY KEY,
  debate_id TEXT NOT NULL REFERENCES debates (id),
  reporter_member_id TEXT,
  reporter_name TEXT,
  reporter_email TEXT,
  reason TEXT NOT NULL,
  explanation TEXT NOT NULL,
  -- Keyed hash of the reporter's IP, for rate limiting only.
  ip_hash TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (debate_id, reporter_member_id)
);

CREATE INDEX reports_debate_created_at ON reports (debate_id, created_at);
CREATE INDEX reports_ip_created_at ON reports (ip_hash, created_at);

-- Every Moderator decision, with the statement of reasons for Blocks (DSA Art. 17).
CREATE TABLE moderation_decisions (
  id TEXT PRIMARY KEY,
  debate_id TEXT NOT NULL REFERENCES debates (id),
  action TEXT NOT NULL CHECK (action IN ('relist', 'block')),
  source TEXT NOT NULL CHECK (source IN ('ai_flag', 'reports', 'moderator')),
  automated_detection INTEGER NOT NULL,
  ground TEXT CHECK (ground IN ('illegal', 'terms')),
  ground_ref TEXT,
  explanation TEXT,
  moderator_id TEXT NOT NULL,
  decided_at TEXT NOT NULL
);

CREATE INDEX moderation_decisions_debate ON moderation_decisions (debate_id, decided_at);
