-- The price and reasoning setting of every model a Debate calls, frozen when it starts (JSON; null for older Debates).
ALTER TABLE debates ADD COLUMN models_json TEXT;
-- While a Debate waits for an API Debater's Turn: "<slot index>@<ISO deadline>".
ALTER TABLE debates ADD COLUMN turn_deadline TEXT;
