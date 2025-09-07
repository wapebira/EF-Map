-- Dynamic Structures & Smart Gates – D1 Schema Draft (INITIAL)
-- Status: Draft – not yet applied. Adjust after confirming MUD event fields & ACL mechanics.

-- 1. World Versioning -------------------------------------------------------
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

-- 2. Smart Assemblies (generic base) ---------------------------------------
CREATE TABLE IF NOT EXISTS smart_assembly (
  id TEXT PRIMARY KEY,               -- raw id string from API / chain
  world_version INTEGER NOT NULL REFERENCES world_version(id) ON DELETE RESTRICT,
  type TEXT NOT NULL,                -- SmartGate / SmartStorageUnit / etc.
  state TEXT NOT NULL,               -- unanchored|anchored|online|offline|destroyed
  name TEXT DEFAULT '',
  system_id INTEGER NOT NULL,        -- world API system id (maps to static DB)
  owner_address TEXT NOT NULL,
  owner_name TEXT DEFAULT '',
  type_id INTEGER,
  energy_usage INTEGER DEFAULT 0,
  hash TEXT NOT NULL,                -- content hash for change detection
  last_seen_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NULL          -- if source exposes a change timestamp
);
CREATE INDEX IF NOT EXISTS idx_smart_assembly_world ON smart_assembly(world_version);
CREATE INDEX IF NOT EXISTS idx_smart_assembly_type_state ON smart_assembly(type, state);
CREATE INDEX IF NOT EXISTS idx_smart_assembly_system ON smart_assembly(system_id);

-- 3. Smart Gate Directionality ---------------------------------------------
-- Because access & linkage can differ by direction, represent each direction explicitly.
CREATE TABLE IF NOT EXISTS smart_gate_direction (
  gate_id TEXT NOT NULL REFERENCES smart_assembly(id) ON DELETE CASCADE,
  world_version INTEGER NOT NULL REFERENCES world_version(id) ON DELETE RESTRICT,
  -- Direction: origin system -> destination system
  origin_system_id INTEGER NOT NULL,
  destination_system_id INTEGER NOT NULL,
  linked BOOLEAN NOT NULL DEFAULT 0,       -- gate.linked (operational link established)
  online BOOLEAN NOT NULL DEFAULT 0,       -- derived from gate state & parent node online flags
  traversal_cost INTEGER NOT NULL DEFAULT 0, -- reserved for future (fuel fee, etc.)
  last_change_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (gate_id, origin_system_id, destination_system_id)
);
CREATE INDEX IF NOT EXISTS idx_gate_direction_world ON smart_gate_direction(world_version);
CREATE INDEX IF NOT EXISTS idx_gate_direction_origin ON smart_gate_direction(origin_system_id);
CREATE INDEX IF NOT EXISTS idx_gate_direction_dest ON smart_gate_direction(destination_system_id);

-- 4. Gate ACL (optional; may be replaced / augmented by org / tribe rules) --
CREATE TABLE IF NOT EXISTS gate_acl (
  gate_id TEXT NOT NULL REFERENCES smart_assembly(id) ON DELETE CASCADE,
  world_version INTEGER NOT NULL REFERENCES world_version(id) ON DELETE RESTRICT,
  wallet_address TEXT NOT NULL,
  access_level TEXT NOT NULL DEFAULT 'allow', -- future: deny / conditional
  expires_at TIMESTAMP NULL,
  added_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (gate_id, wallet_address)
);
CREATE INDEX IF NOT EXISTS idx_gate_acl_world ON gate_acl(world_version);

-- 4a. Gate Access Cache (tribe / public segmentation)
-- Materialized visibility to avoid per-request contract predicate evaluation.
-- Early strategy: store gate_id with classification buckets; rebuild when contract logic or ownership changes.
CREATE TABLE IF NOT EXISTS gate_access_cache (
  gate_id TEXT NOT NULL REFERENCES smart_assembly(id) ON DELETE CASCADE,
  world_version INTEGER NOT NULL REFERENCES world_version(id) ON DELETE RESTRICT,
  visibility_class TEXT NOT NULL, -- public|tribe|owner_private|restricted (future granular types)
  tribe_id TEXT NULL,             -- set when visibility_class='tribe'
  direction_origin_system_id INTEGER NULL, -- optional if direction-specific access emerges
  direction_destination_system_id INTEGER NULL,
  snapshot_version INTEGER NOT NULL, -- ties to adjacency snapshot for coherence
  computed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (gate_id, visibility_class, COALESCE(tribe_id,''), COALESCE(direction_origin_system_id,0), COALESCE(direction_destination_system_id,0))
);
CREATE INDEX IF NOT EXISTS idx_gate_access_cache_world ON gate_access_cache(world_version);
CREATE INDEX IF NOT EXISTS idx_gate_access_cache_tribe ON gate_access_cache(tribe_id);

-- 5. Structures (non-gate specific optional extended info) -----------------
-- Could be deferred until we ingest non-gate types beyond just assemblies table.
CREATE TABLE IF NOT EXISTS structure_generic (
  id TEXT PRIMARY KEY REFERENCES smart_assembly(id) ON DELETE CASCADE,
  world_version INTEGER NOT NULL REFERENCES world_version(id) ON DELETE RESTRICT,
  visibility TEXT NOT NULL DEFAULT 'public', -- public|restricted|private
  org_id TEXT NULL,
  meta_json TEXT NULL                      -- raw source fragment (compressed or plain JSON)
);

-- 6. Adjacency Snapshot Metadata -------------------------------------------
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

-- 7. Indexer Runs (observability) ------------------------------------------
CREATE TABLE IF NOT EXISTS indexer_run (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  world_version INTEGER NOT NULL REFERENCES world_version(id) ON DELETE RESTRICT,
  run_started_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  run_finished_at TIMESTAMP NULL,
  mode TEXT NOT NULL,         -- poll|event|reconcile
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

-- 8. Future: Uptime History (if required) ----------------------------------
-- OPTIONAL table to record state transitions for gates (for historical analytics).
-- Defer actual creation until requirement confirmed to avoid write amplification.
-- Example skeleton (commented out):
-- CREATE TABLE gate_state_history (
--   id INTEGER PRIMARY KEY AUTOINCREMENT,
--   gate_id TEXT NOT NULL REFERENCES smart_assembly(id) ON DELETE CASCADE,
--   world_version INTEGER NOT NULL REFERENCES world_version(id) ON DELETE RESTRICT,
--   from_state TEXT,
--   to_state TEXT NOT NULL,
--   changed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
-- );
-- CREATE INDEX idx_gate_state_history_gate ON gate_state_history(gate_id);

-- Notes / Open Items -------------------------------------------------------
-- * Need confirmation of source for directional access. If access is stored per gate with independent flags, may need extra columns (allow_forward, allow_reverse) instead of per-direction rows.
-- * If whitelist/ACL is large and frequently queried, consider secondary KV cache of hashed membership sets keyed by (gate_id,snapshot_version) or per-user gate visibility bitset.
-- * Consider partial indexes / filtered indexes (not available in SQLite) simulated via covering indices when volume grows.
-- * Ensure world_version insert occurs BEFORE any assembly upserts (enforce via application transaction ordering).
-- * Add pragma recommendations (foreign_keys=ON, journal_mode=WAL) when D1 supports toggles (document in ops notes).
-- * Tribe-centric gating clarified (2025-09-07): anticipate majority of non-public gates keyed to tribe membership; gate_access_cache enables shipping tribe-scoped adjacency snapshots without enumerating individual wallets.
-- * Fuel level explicitly ignored for routing inclusion; ONLINE state alone governs traversability in snapshot derivation.

-- END OF DRAFT
