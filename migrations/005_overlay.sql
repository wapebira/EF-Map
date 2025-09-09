-- 005_overlay.sql
-- Formalize gate_tombstone table (previously created lazily in code) and add supporting indexes.
-- Also add index on smart_gate_direction.last_change_at for /api/indexer-overlay query efficiency.

BEGIN TRANSACTION;

CREATE TABLE IF NOT EXISTS gate_tombstone (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  gate_id TEXT NOT NULL,
  world_version INTEGER NOT NULL REFERENCES world_version(id) ON DELETE RESTRICT,
  deleted_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_gate_tombstone_deleted_at ON gate_tombstone(deleted_at);
CREATE INDEX IF NOT EXISTS idx_gate_tombstone_world ON gate_tombstone(world_version);

-- Add index for overlay direction change lookups
CREATE INDEX IF NOT EXISTS idx_gate_direction_last_change ON smart_gate_direction(last_change_at);

COMMIT;
