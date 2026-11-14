-- Batch Debates (GLOSSARY: Batch Debate): generated through batch processing, published only when complete.
ALTER TABLE debates ADD COLUMN kind TEXT NOT NULL DEFAULT 'live' CHECK (kind IN ('live', 'batch'));
