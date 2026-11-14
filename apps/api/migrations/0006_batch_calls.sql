-- Model calls a Batch Debate sent through the Batch API, keyed per Debate by the request's hash and its occurrence
-- within the step, so re-running a step finds its calls instead of submitting them again.
--   submitting: claimed by one run, which is submitting it (batch_id not known yet)
--   pending:    submitted; waiting for the result
--   completed:  result stored in response_json
--   failed:     the last batch failed; submitted again until `failures` reaches the attempt limit
CREATE TABLE batch_calls (
  debate_id TEXT NOT NULL,
  call_key TEXT NOT NULL,
  model TEXT NOT NULL,
  batch_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('submitting', 'pending', 'completed', 'failed')),
  failures INTEGER NOT NULL DEFAULT 0,
  response_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT,
  PRIMARY KEY (debate_id, call_key)
);
