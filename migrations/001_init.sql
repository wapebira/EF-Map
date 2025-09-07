-- Migration 001_init.sql (v1 schema freeze)
-- Applies initial D1 schema for dynamic structures & smart gates.
-- Idempotent: uses IF NOT EXISTS on all CREATE statements.

.mode = "" -- (ignored by D1, present for clarity)

-- === BEGIN SCHEMA ===

-- World Versioning
CREATE TABLE IF NOT EXISTS world_version (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  version_number INTEGER NOT NULL UNIQUE,
  world_address TEXT NOT NULL,
  contracts_version TEXT DEFAULT '',
  cycle_start TIMESTAMP NULL,
  started_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  archived_at TIMESTAMP NULL
);
CREATE INDEX IF NOT EXISTS idx_world_version_active ON world_version(archived_at);

-- Smart Assemblies
CREATE TABLE IF NOT EXISTS smart_assembly (
  id TEXT PRIMARY KEY,
  world_version INTEGER NOT NULL REFERENCES world_version(id) ON DELETE RESTRICT,
  type TEXT NOT NULL,
  state TEXT NOT NULL,
  name TEXT DEFAULT '',
  system_id INTEGER NOT NULL,
  owner_address TEXT NOT NULL,
  owner_name TEXT DEFAULT '',
  type_id INTEGER,
  energy_usage INTEGER DEFAULT 0,
  hash TEXT NOT NULL,
  last_seen_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NULL
);
CREATE INDEX IF NOT EXISTS idx_smart_assembly_world ON smart_assembly(world_version);
CREATE INDEX IF NOT EXISTS idx_smart_assembly_type_state ON smart_assembly(type, state);
CREATE INDEX IF NOT EXISTS idx_smart_assembly_system ON smart_assembly(system_id);

-- Smart Gate Directionality
CREATE TABLE IF NOT EXISTS smart_gate_direction (
  gate_id TEXT NOT NULL REFERENCES smart_assembly(id) ON DELETE CASCADE,
  world_version INTEGER NOT NULL REFERENCES world_version(id) ON DELETE RESTRICT,
  origin_system_id INTEGER NOT NULL,
  destination_system_id INTEGER NOT NULL,
  linked BOOLEAN NOT NULL DEFAULT 0,
  online BOOLEAN NOT NULL DEFAULT 0,
  traversal_cost INTEGER NOT NULL DEFAULT 0,
  last_change_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (gate_id, origin_system_id, destination_system_id)
);
CREATE INDEX IF NOT EXISTS idx_gate_direction_world ON smart_gate_direction(world_version);
CREATE INDEX IF NOT EXISTS idx_gate_direction_origin ON smart_gate_direction(origin_system_id);
CREATE INDEX IF NOT EXISTS idx_gate_direction_dest ON smart_gate_direction(destination_system_id);

-- Gate ACL (placeholder)
CREATE TABLE IF NOT EXISTS gate_acl (
  gate_id TEXT NOT NULL REFERENCES smart_assembly(id) ON DELETE CASCADE,
  world_version INTEGER NOT NULL REFERENCES world_version(id) ON DELETE RESTRICT,
  wallet_address TEXT NOT NULL,
  access_level TEXT NOT NULL DEFAULT 'allow',
  expires_at TIMESTAMP NULL,
  added_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (gate_id, wallet_address)
);
CREATE INDEX IF NOT EXISTS idx_gate_acl_world ON gate_acl(world_version);

-- Gate Access Cache
CREATE TABLE IF NOT EXISTS gate_access_cache (
  gate_id TEXT NOT NULL REFERENCES smart_assembly(id) ON DELETE CASCADE,
  world_version INTEGER NOT NULL REFERENCES world_version(id) ON DELETE RESTRICT,
  visibility_class TEXT NOT NULL,
  tribe_id TEXT NOT NULL DEFAULT '',
  direction_origin_system_id INTEGER NOT NULL DEFAULT 0,
  direction_destination_system_id INTEGER NOT NULL DEFAULT 0,
  snapshot_version INTEGER NOT NULL,
  computed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (gate_id, visibility_class, tribe_id, direction_origin_system_id, direction_destination_system_id)
);
CREATE INDEX IF NOT EXISTS idx_gate_access_cache_world ON gate_access_cache(world_version);
CREATE INDEX IF NOT EXISTS idx_gate_access_cache_tribe ON gate_access_cache(tribe_id);

-- Generic Structures
CREATE TABLE IF NOT EXISTS structure_generic (
  id TEXT PRIMARY KEY REFERENCES smart_assembly(id) ON DELETE CASCADE,
  world_version INTEGER NOT NULL REFERENCES world_version(id) ON DELETE RESTRICT,
  visibility TEXT NOT NULL DEFAULT 'public',
  org_id TEXT NULL,
  meta_json TEXT NULL
);

-- Adjacency Snapshot Metadata
CREATE TABLE IF NOT EXISTS adjacency_snapshot_meta (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  world_version INTEGER NOT NULL REFERENCES world_version(id) ON DELETE RESTRICT,
  snapshot_version INTEGER NOT NULL,
  gate_edge_count INTEGER NOT NULL,
  published_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  build_duration_ms INTEGER NOT NULL,
  coalesced_events INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_adj_snapshot_world ON adjacency_snapshot_meta(world_version);
CREATE UNIQUE INDEX IF NOT EXISTS u_adj_snapshot_world_version ON adjacency_snapshot_meta(world_version, snapshot_version);

-- Indexer Runs
CREATE TABLE IF NOT EXISTS indexer_run (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  world_version INTEGER NOT NULL REFERENCES world_version(id) ON DELETE RESTRICT,
  run_started_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  run_finished_at TIMESTAMP NULL,
  mode TEXT NOT NULL,
  assemblies_scanned INTEGER DEFAULT 0,
  rows_added INTEGER DEFAULT 0,
  rows_updated INTEGER DEFAULT 0,
  rows_removed INTEGER DEFAULT 0,
  gate_edges_rebuilt INTEGER DEFAULT 0,
  snapshot_version INTEGER NULL,
  error_count INTEGER DEFAULT 0,
  notes TEXT NULL
);
CREATE INDEX IF NOT EXISTS idx_indexer_run_world ON indexer_run(world_version);
CREATE INDEX IF NOT EXISTS idx_indexer_run_mode ON indexer_run(mode);

-- === END SCHEMA ===
