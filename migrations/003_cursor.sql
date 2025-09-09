-- 003_cursor: event cursor table for incremental ingestion
-- Tracks last processed block/log to enable idempotent polling
CREATE TABLE IF NOT EXISTS event_cursor (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  last_block_number INTEGER NOT NULL DEFAULT 0,
  last_log_index INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Ensure single-row invariant by inserting row 1 if absent
INSERT INTO event_cursor (id, last_block_number, last_log_index)
  SELECT 1, 0, 0
  WHERE NOT EXISTS (SELECT 1 FROM event_cursor WHERE id=1);
