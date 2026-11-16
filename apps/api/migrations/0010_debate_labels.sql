-- A Debate's Category and Tags, assigned by the labeller when its Motion is screened (null: not labelled yet).
ALTER TABLE debates ADD COLUMN category TEXT;
-- JSON array of the Debate's Tags.
ALTER TABLE debates ADD COLUMN tags_json TEXT;
CREATE INDEX debates_category_completed_at ON debates (category, completed_at);
