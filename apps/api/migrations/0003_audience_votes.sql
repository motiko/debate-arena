-- Oxford Audience Votes: one row per Member per Debate; each stance is cast once and never changed.

CREATE TABLE audience_votes (
  debate_id TEXT NOT NULL REFERENCES debates (id),
  member_id TEXT NOT NULL,
  before_stance TEXT NOT NULL CHECK (before_stance IN ('for', 'against', 'undecided')),
  before_at TEXT NOT NULL,
  after_stance TEXT CHECK (after_stance IN ('for', 'against', 'undecided')),
  after_at TEXT,
  PRIMARY KEY (debate_id, member_id)
);

CREATE INDEX audience_votes_member ON audience_votes (member_id);
