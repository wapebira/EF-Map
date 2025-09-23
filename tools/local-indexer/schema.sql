-- Local Indexer SQLite Schema (raw logs + cursors)
PRAGMA journal_mode=WAL;
PRAGMA synchronous=NORMAL;
PRAGMA temp_store=MEMORY;
PRAGMA mmap_size=30000000000; -- 30GB if available (noop if unsupported)
PRAGMA cache_size=-200000;    -- ~200MB page cache

-- Stores chain identification to prevent cross-chain DB reuse accidentally
CREATE TABLE IF NOT EXISTS chain_info (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  chain_id TEXT NOT NULL,
  world_address TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO chain_info (id, chain_id, world_address)
  SELECT 1, '', '' WHERE NOT EXISTS (SELECT 1 FROM chain_info WHERE id=1);

-- Cursor for raw ingest progress
CREATE TABLE IF NOT EXISTS event_cursor (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  last_block_number INTEGER NOT NULL DEFAULT 0,
  last_log_index INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO event_cursor (id, last_block_number, last_log_index)
  SELECT 1, 0, 0 WHERE NOT EXISTS (SELECT 1 FROM event_cursor WHERE id=1);

-- Raw logs identical to worker schema for portability
CREATE TABLE IF NOT EXISTS raw_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  block_number INTEGER NOT NULL,
  log_index INTEGER NOT NULL,
  tx_hash TEXT NOT NULL,
  address TEXT NOT NULL,
  topic0 TEXT NULL,
  topic1 TEXT NULL,
  topic2 TEXT NULL,
  topic3 TEXT NULL,
  data TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS u_raw_logs_block_logindex ON raw_logs(block_number, log_index);
CREATE INDEX IF NOT EXISTS idx_raw_logs_block ON raw_logs(block_number);
CREATE INDEX IF NOT EXISTS idx_raw_logs_address ON raw_logs(address);
CREATE INDEX IF NOT EXISTS idx_raw_logs_topic0 ON raw_logs(topic0);
