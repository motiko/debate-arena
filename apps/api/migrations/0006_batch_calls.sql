-- Model calls a Batch Debate sent through the Batch API, keyed per Debate by the request's hash and its occurrence
-- within the step, so re-running a step finds its calls instead of submitting them again.
CREATE TABLE batch_calls (
  debate_id TEXT NOT NULL,
  call_key TEXT NOT NULL,
  model TEXT NOT NULL,
  batch_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'completed')),
  response_json TEXT,
  created_at TEXT NOT NULL,
  completed_at TEXT,
  PRIMARY KEY (debate_id, call_key)
);
