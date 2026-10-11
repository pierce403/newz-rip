ALTER TABLE snapshots ADD COLUMN source TEXT NOT NULL DEFAULT 'fetch' CHECK (source IN ('fetch','import'));
CREATE INDEX snapshots_source_url ON snapshots(source,url,captured_at DESC);
CREATE TABLE pending_deletions (
  id TEXT PRIMARY KEY,
  object_keys TEXT NOT NULL,
  created_at TEXT NOT NULL
);
