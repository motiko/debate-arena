-- The catalog built from OpenRouter's model list, kept for an hour (and as a fallback when OpenRouter is down).
CREATE TABLE model_catalog (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  catalog_json TEXT NOT NULL,
  fetched_at TEXT NOT NULL
);
