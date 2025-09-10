-- 014_decode_bootstrap
-- Adds foundational decode & lookup tables. Additive & idempotent.

CREATE TABLE IF NOT EXISTS topic_map (
  abi_hash TEXT PRIMARY KEY,
  json TEXT NOT NULL,
  inserted_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS record_latest (
  table_id TEXT NOT NULL,
  key_hash TEXT NOT NULL,
  value_hex TEXT NULL,
  value_json TEXT NULL,
  updated_block INTEGER NOT NULL,
  updated_log_index INTEGER NOT NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (table_id, key_hash)
);
CREATE INDEX IF NOT EXISTS idx_record_latest_block ON record_latest(updated_block);

CREATE TABLE IF NOT EXISTS decoded_cursor (
  id INTEGER PRIMARY KEY CHECK (id=1),
  last_block INTEGER NOT NULL DEFAULT 0,
  last_log_index INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO decoded_cursor (id, last_block, last_log_index) SELECT 1,0,0 WHERE NOT EXISTS (SELECT 1 FROM decoded_cursor WHERE id=1);

-- Future: decoded_metrics (aggregate counters) if needed.