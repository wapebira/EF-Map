-- 006_store_registry
-- Tables for organic tableId discovery & raw store event persistence.
-- table_registry: tracks first/last seen blocks, finalized flag once beyond confirmation depth.
-- store_events: raw store logs (subset fields) enabling later decode into domain tables.
-- decode_progress: per-table checkpoint for decoded highest (block, log_index).

CREATE TABLE IF NOT EXISTS table_registry (
  table_id TEXT PRIMARY KEY,
  first_block INTEGER NOT NULL,
  last_block INTEGER NOT NULL,
  appearances INTEGER NOT NULL DEFAULT 1,
  finalized INTEGER NOT NULL DEFAULT 0,
  namespace_guess TEXT,
  name_guess TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_table_registry_finalized ON table_registry(finalized);

CREATE TABLE IF NOT EXISTS store_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  block_number INTEGER NOT NULL,
  log_index INTEGER NOT NULL,
  tx_hash TEXT NOT NULL,
  topic0 TEXT NOT NULL,
  table_id TEXT NOT NULL,
  key_hex TEXT, -- optional later if extracted (SetRecord DeleteRecord)
  field_index INTEGER, -- SetField / EphemeralValue
  value_hex TEXT, -- raw value bytes hex (truncated optional later)
  ephemeral INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_store_events_block ON store_events(block_number, log_index);
CREATE INDEX IF NOT EXISTS idx_store_events_table ON store_events(table_id, block_number);

CREATE TABLE IF NOT EXISTS decode_progress (
  table_id TEXT PRIMARY KEY,
  last_decoded_block INTEGER NOT NULL DEFAULT 0,
  last_decoded_log_index INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
