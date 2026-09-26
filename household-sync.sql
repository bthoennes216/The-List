CREATE TABLE IF NOT EXISTS households (
  id TEXT PRIMARY KEY,
  version INTEGER NOT NULL,
  iv TEXT NOT NULL,
  chunk_count INTEGER NOT NULL,
  write_token TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS snapshot_chunks (
  household_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  data TEXT NOT NULL,
  PRIMARY KEY (household_id, seq)
);
