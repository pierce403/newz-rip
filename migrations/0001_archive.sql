CREATE TABLE IF NOT EXISTS snapshots (
  id TEXT PRIMARY KEY,
  url TEXT NOT NULL,
  canonical_url TEXT NOT NULL,
  title TEXT NOT NULL,
  site_name TEXT NOT NULL,
  byline TEXT,
  captured_at TEXT NOT NULL,
  published_at TEXT,
  content_hash TEXT NOT NULL,
  word_count INTEGER NOT NULL,
  quality TEXT NOT NULL CHECK (quality IN ('full', 'partial')),
  extraction_method TEXT NOT NULL,
  object_key TEXT NOT NULL,
  UNIQUE(canonical_url, content_hash)
);
CREATE INDEX IF NOT EXISTS snapshots_url ON snapshots(canonical_url, captured_at DESC);
CREATE INDEX IF NOT EXISTS snapshots_recent ON snapshots(captured_at DESC);
CREATE VIRTUAL TABLE IF NOT EXISTS snapshots_fts USING fts5(title, site_name, excerpt, content='');
CREATE TABLE IF NOT EXISTS rate_limits (
  key TEXT PRIMARY KEY,
  window_start INTEGER NOT NULL,
  count INTEGER NOT NULL
);
