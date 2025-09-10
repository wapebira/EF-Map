// Cloudflare Pages _worker.js – integrates sandbox API endpoints with static assets
// Mirrors root worker.js logic; keeps Netlify path compatibility.

const SCHEMA_VERSION = 2;
// Inline migration SQL payloads (removes dependency on static asset fetch)
const MIGRATION_SQL = {
  '001_init': `-- Migration 001_init.sql (v1 schema freeze)
CREATE TABLE IF NOT EXISTS world_version (id INTEGER PRIMARY KEY AUTOINCREMENT, version_number INTEGER NOT NULL UNIQUE, world_address TEXT NOT NULL, contracts_version TEXT DEFAULT '', cycle_start TIMESTAMP NULL, started_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, archived_at TIMESTAMP NULL);
CREATE INDEX IF NOT EXISTS idx_world_version_active ON world_version(archived_at);
CREATE TABLE IF NOT EXISTS smart_assembly (id TEXT PRIMARY KEY, world_version INTEGER NOT NULL REFERENCES world_version(id) ON DELETE RESTRICT, type TEXT NOT NULL, state TEXT NOT NULL, name TEXT DEFAULT '', system_id INTEGER NOT NULL, owner_address TEXT NOT NULL, owner_name TEXT DEFAULT '', type_id INTEGER, energy_usage INTEGER DEFAULT 0, hash TEXT NOT NULL, last_seen_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP NULL);
CREATE INDEX IF NOT EXISTS idx_smart_assembly_world ON smart_assembly(world_version);
CREATE INDEX IF NOT EXISTS idx_smart_assembly_type_state ON smart_assembly(type, state);
CREATE INDEX IF NOT EXISTS idx_smart_assembly_system ON smart_assembly(system_id);
CREATE TABLE IF NOT EXISTS smart_gate_direction (gate_id TEXT NOT NULL REFERENCES smart_assembly(id) ON DELETE CASCADE, world_version INTEGER NOT NULL REFERENCES world_version(id) ON DELETE RESTRICT, origin_system_id INTEGER NOT NULL, destination_system_id INTEGER NOT NULL, linked BOOLEAN NOT NULL DEFAULT 0, online BOOLEAN NOT NULL DEFAULT 0, traversal_cost INTEGER NOT NULL DEFAULT 0, last_change_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY (gate_id, origin_system_id, destination_system_id));
CREATE INDEX IF NOT EXISTS idx_gate_direction_world ON smart_gate_direction(world_version);
CREATE INDEX IF NOT EXISTS idx_gate_direction_origin ON smart_gate_direction(origin_system_id);
CREATE INDEX IF NOT EXISTS idx_gate_direction_dest ON smart_gate_direction(destination_system_id);
CREATE TABLE IF NOT EXISTS gate_acl (gate_id TEXT NOT NULL REFERENCES smart_assembly(id) ON DELETE CASCADE, world_version INTEGER NOT NULL REFERENCES world_version(id) ON DELETE RESTRICT, wallet_address TEXT NOT NULL, access_level TEXT NOT NULL DEFAULT 'allow', expires_at TIMESTAMP NULL, added_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY (gate_id, wallet_address));
CREATE INDEX IF NOT EXISTS idx_gate_acl_world ON gate_acl(world_version);
CREATE TABLE IF NOT EXISTS gate_access_cache (gate_id TEXT NOT NULL REFERENCES smart_assembly(id) ON DELETE CASCADE, world_version INTEGER NOT NULL REFERENCES world_version(id) ON DELETE RESTRICT, visibility_class TEXT NOT NULL, tribe_id TEXT NOT NULL DEFAULT '', direction_origin_system_id INTEGER NOT NULL DEFAULT 0, direction_destination_system_id INTEGER NOT NULL DEFAULT 0, snapshot_version INTEGER NOT NULL, computed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY (gate_id, visibility_class, tribe_id, direction_origin_system_id, direction_destination_system_id));
CREATE INDEX IF NOT EXISTS idx_gate_access_cache_world ON gate_access_cache(world_version);
CREATE INDEX IF NOT EXISTS idx_gate_access_cache_tribe ON gate_access_cache(tribe_id);
CREATE TABLE IF NOT EXISTS structure_generic (id TEXT PRIMARY KEY REFERENCES smart_assembly(id) ON DELETE CASCADE, world_version INTEGER NOT NULL REFERENCES world_version(id) ON DELETE RESTRICT, visibility TEXT NOT NULL DEFAULT 'public', org_id TEXT NULL, meta_json TEXT NULL);
CREATE TABLE IF NOT EXISTS adjacency_snapshot_meta (id INTEGER PRIMARY KEY AUTOINCREMENT, world_version INTEGER NOT NULL REFERENCES world_version(id) ON DELETE RESTRICT, snapshot_version INTEGER NOT NULL, gate_edge_count INTEGER NOT NULL, published_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, build_duration_ms INTEGER NOT NULL, coalesced_events INTEGER NOT NULL DEFAULT 0);
CREATE INDEX IF NOT EXISTS idx_adj_snapshot_world ON adjacency_snapshot_meta(world_version);
CREATE UNIQUE INDEX IF NOT EXISTS u_adj_snapshot_world_version ON adjacency_snapshot_meta(world_version, snapshot_version);
CREATE TABLE IF NOT EXISTS indexer_run (id INTEGER PRIMARY KEY AUTOINCREMENT, world_version INTEGER NOT NULL REFERENCES world_version(id) ON DELETE RESTRICT, run_started_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, run_finished_at TIMESTAMP NULL, mode TEXT NOT NULL, assemblies_scanned INTEGER DEFAULT 0, rows_added INTEGER DEFAULT 0, rows_updated INTEGER DEFAULT 0, rows_removed INTEGER DEFAULT 0, gate_edges_rebuilt INTEGER DEFAULT 0, snapshot_version INTEGER NULL, error_count INTEGER DEFAULT 0, notes TEXT NULL);
CREATE INDEX IF NOT EXISTS idx_indexer_run_world ON indexer_run(world_version);
CREATE INDEX IF NOT EXISTS idx_indexer_run_mode ON indexer_run(mode);`,
  '002_enrichment': `CREATE TABLE IF NOT EXISTS assembly_metadata (id TEXT PRIMARY KEY REFERENCES smart_assembly(id) ON DELETE CASCADE, world_version INTEGER NOT NULL REFERENCES world_version(id) ON DELETE RESTRICT, source_priority TEXT NOT NULL DEFAULT 'api', name_api TEXT NULL, description_api TEXT NULL, extra_json TEXT NULL, metadata_hash TEXT NULL, last_api_update_at TIMESTAMP NULL, last_chain_ref_at TIMESTAMP NULL);CREATE INDEX IF NOT EXISTS idx_assembly_metadata_world ON assembly_metadata(world_version);CREATE INDEX IF NOT EXISTS idx_assembly_metadata_api_update ON assembly_metadata(last_api_update_at);ALTER TABLE indexer_run ADD COLUMN api_enrichments INTEGER DEFAULT 0;`,
  '003_cursor': `CREATE TABLE IF NOT EXISTS event_cursor (id INTEGER PRIMARY KEY CHECK (id = 1), last_block_number INTEGER NOT NULL DEFAULT 0, last_log_index INTEGER NOT NULL DEFAULT 0, updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP);INSERT INTO event_cursor (id, last_block_number, last_log_index) SELECT 1, 0, 0 WHERE NOT EXISTS (SELECT 1 FROM event_cursor WHERE id=1);`,
  '004_run_duration': `ALTER TABLE indexer_run ADD COLUMN run_duration_ms INTEGER DEFAULT NULL;`,
  '005_overlay': `CREATE TABLE IF NOT EXISTS gate_tombstone (id INTEGER PRIMARY KEY AUTOINCREMENT, gate_id TEXT NOT NULL, world_version INTEGER NOT NULL REFERENCES world_version(id) ON DELETE RESTRICT, deleted_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP);CREATE INDEX IF NOT EXISTS idx_gate_tombstone_deleted_at ON gate_tombstone(deleted_at);CREATE INDEX IF NOT EXISTS idx_gate_tombstone_world ON gate_tombstone(world_version);CREATE INDEX IF NOT EXISTS idx_gate_direction_last_change ON smart_gate_direction(last_change_at);`
  , '006_store_registry': `CREATE TABLE IF NOT EXISTS table_registry (table_id TEXT PRIMARY KEY, namespace_guess TEXT NULL, name_guess TEXT NULL, first_block INTEGER NOT NULL, last_block INTEGER NOT NULL, appearances INTEGER NOT NULL DEFAULT 1, finalized INTEGER NOT NULL DEFAULT 0, decode_status TEXT NULL, decode_last_block INTEGER NULL, decode_error TEXT NULL, created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP);CREATE INDEX IF NOT EXISTS idx_table_registry_finalized ON table_registry(finalized);CREATE TABLE IF NOT EXISTS store_events (id INTEGER PRIMARY KEY AUTOINCREMENT, block_number INTEGER NOT NULL, log_index INTEGER NOT NULL DEFAULT 0, tx_hash TEXT NOT NULL, topic0 TEXT NOT NULL, table_id TEXT NOT NULL, key_hex TEXT NULL, field_index INTEGER NULL, value_hex TEXT NULL, ephemeral INTEGER NOT NULL DEFAULT 0, created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP);CREATE INDEX IF NOT EXISTS idx_store_events_block ON store_events(block_number);CREATE INDEX IF NOT EXISTS idx_store_events_table ON store_events(table_id);CREATE TABLE IF NOT EXISTS decode_progress (table_id TEXT PRIMARY KEY, last_decoded_event_id INTEGER NOT NULL DEFAULT 0, last_decoded_block INTEGER NOT NULL DEFAULT 0, updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP);`
  , '007_raw_logs': `CREATE TABLE IF NOT EXISTS raw_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, block_number INTEGER NOT NULL, log_index INTEGER NOT NULL, tx_hash TEXT NOT NULL, address TEXT NOT NULL, topic0 TEXT NULL, topic1 TEXT NULL, topic2 TEXT NULL, topic3 TEXT NULL, data TEXT NOT NULL, created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP);CREATE UNIQUE INDEX IF NOT EXISTS u_raw_logs_block_logindex ON raw_logs(block_number, log_index);CREATE INDEX IF NOT EXISTS idx_raw_logs_block ON raw_logs(block_number);CREATE INDEX IF NOT EXISTS idx_raw_logs_address ON raw_logs(address);CREATE INDEX IF NOT EXISTS idx_raw_logs_topic0 ON raw_logs(topic0);`
  , '008_progress': `ALTER TABLE indexer_run ADD COLUMN last_progress_at TIMESTAMP NULL;ALTER TABLE indexer_run ADD COLUMN rows_so_far INTEGER DEFAULT 0;ALTER TABLE indexer_run ADD COLUMN stall_restarts INTEGER DEFAULT 0;`
  , '009_run_metrics': `ALTER TABLE indexer_run ADD COLUMN seg_requests_so_far INTEGER DEFAULT 0;ALTER TABLE indexer_run ADD COLUMN batch_flushes INTEGER DEFAULT 0;ALTER TABLE indexer_run ADD COLUMN adaptive_batch_current INTEGER DEFAULT 0;`
  , '010_raw_logs_shadow': `CREATE TABLE IF NOT EXISTS raw_logs_new (id INTEGER PRIMARY KEY AUTOINCREMENT, block_number INTEGER NOT NULL, log_index INTEGER NOT NULL, tx_hash TEXT NOT NULL, address TEXT NOT NULL, topic0 TEXT NULL, topic1 TEXT NULL, topic2 TEXT NULL, topic3 TEXT NULL, data TEXT NOT NULL, created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP);CREATE UNIQUE INDEX IF NOT EXISTS u_raw_logs_new_block_logindex ON raw_logs_new(block_number, log_index);CREATE INDEX IF NOT EXISTS idx_raw_logs_new_block ON raw_logs_new(block_number);CREATE INDEX IF NOT EXISTS idx_raw_logs_new_address ON raw_logs_new(address);CREATE INDEX IF NOT EXISTS idx_raw_logs_new_topic0 ON raw_logs_new(topic0);`
  , '011_decode_schema': `CREATE TABLE IF NOT EXISTS field_layout (table_id TEXT NOT NULL, field_index INTEGER NOT NULL, field_name TEXT NULL, field_type TEXT NULL, created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY (table_id, field_index));CREATE INDEX IF NOT EXISTS idx_field_layout_table ON field_layout(table_id);CREATE TABLE IF NOT EXISTS apply_cursor (id INTEGER PRIMARY KEY CHECK(id=1), last_block_number INTEGER NOT NULL DEFAULT 0, last_log_index INTEGER NOT NULL DEFAULT 0, updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP);INSERT INTO apply_cursor (id, last_block_number, last_log_index) SELECT 1,0,0 WHERE NOT EXISTS (SELECT 1 FROM apply_cursor WHERE id=1);`
  , '012_latest_state': `CREATE TABLE IF NOT EXISTS record_latest (table_id TEXT NOT NULL, key_hex TEXT NOT NULL, value_hex TEXT NULL, last_block_number INTEGER NOT NULL, last_log_index INTEGER NOT NULL DEFAULT 0, updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY (table_id, key_hex));CREATE INDEX IF NOT EXISTS idx_record_latest_table ON record_latest(table_id);`
  , '013_gap_scan_results': `CREATE TABLE IF NOT EXISTS gap_scan_result (id INTEGER PRIMARY KEY AUTOINCREMENT, scanned_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, from_block INTEGER NOT NULL, to_block INTEGER NOT NULL, expected_logs INTEGER NOT NULL, found_logs INTEGER NOT NULL, missing_logs INTEGER NOT NULL, sample_count INTEGER NULL, notes TEXT NULL);CREATE INDEX IF NOT EXISTS idx_gap_scan_range ON gap_scan_result(from_block, to_block);`
  , '014_decode_bootstrap': `-- Decode bootstrap (schema compatible upgrade)
CREATE TABLE IF NOT EXISTS topic_map (abi_hash TEXT PRIMARY KEY, json TEXT NOT NULL, inserted_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP);
-- record_latest existed from migration 012 with (table_id,key_hex,value_hex,last_block_number,last_log_index,updated_at)
-- We extend it instead of recreating to avoid column mismatch errors.
ALTER TABLE record_latest ADD COLUMN value_json TEXT NULL;
ALTER TABLE record_latest ADD COLUMN last_block INTEGER;
-- Backfill new last_block column from legacy last_block_number if present.
UPDATE record_latest SET last_block = COALESCE(last_block, last_block_number) WHERE last_block IS NULL;
-- Index on new unified last_block (will be mostly NULL until backfill above executes once).
CREATE INDEX IF NOT EXISTS idx_record_latest_block ON record_latest(last_block);
CREATE TABLE IF NOT EXISTS decoded_cursor (id INTEGER PRIMARY KEY CHECK (id=1), last_block INTEGER NOT NULL DEFAULT 0, last_log_index INTEGER NOT NULL DEFAULT 0, updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP);
INSERT INTO decoded_cursor (id, last_block, last_log_index) SELECT 1,0,0 WHERE NOT EXISTS (SELECT 1 FROM decoded_cursor WHERE id=1);`
  , '015_run_attempted': `ALTER TABLE indexer_run ADD COLUMN attempted_logs INTEGER DEFAULT 0;`
};
// Table Allowlist (MUD Store tableIds) – introduced 2025-09-09
// Rationale: Reduce ingestion volume & accelerate backfill by ignoring World contract logs
// for tables outside the Eve Frontier namespace set we care about. Source list derived from
// provided explorer URLs (mudtableurl.txt). Some table names truncated in URL queries; they are
// retained as-is until store__Tables decoding confirms canonical names.
// Gate via env INDEXER_TABLE_ALLOWLIST=1 to permit easy rollback / A/B.
const TABLE_ALLOWLIST_META = {
  // evefrontier namespace (partial + core gameplay)
  '0x746265766566726f6e74696572000000576f726c6456657273696f6e00000000': { ns:'evefrontier', name:'WorldVersion' },
  '0x746265766566726f6e7469657200000054656e616e7400000000000000000000': { ns:'evefrontier', name:'Tenant' },
  '0x746265766566726f6e74696572000000536d617274547572726574436f6e6669': { ns:'evefrontier', name:'SmartTurretConfi', truncated:true },
  '0x746265766566726f6e74696572000000536d617274476174654c696e6b000000': { ns:'evefrontier', name:'SmartGateLink' },
  '0x746265766566726f6e74696572000000536d61727447617465436f6e66696700': { ns:'evefrontier', name:'SmartGateConfig' },
  '0x746265766566726f6e74696572000000536d617274417373656d626c79000000': { ns:'evefrontier', name:'SmartAssembly' },
  '0x746265766566726f6e74696572000000526f6c65000000000000000000000000': { ns:'evefrontier', name:'Role' },
  '0x746265766566726f6e746965720000004f776e65727368697042794f626a6563': { ns:'evefrontier', name:'OwnershipByObjec', truncated:true },
  '0x746265766566726f6e746965720000004e6574776f726b4e6f6465456e657267': { ns:'evefrontier', name:'NetworkNodeEnerg', truncated:true },
  '0x746265766566726f6e746965720000004e6574776f726b4e6f64654279417373': { ns:'evefrontier', name:'NetworkNodeByAss', truncated:true },
  '0x746265766566726f6e746965720000004e6574776f726b4e6f6465417373656d': { ns:'evefrontier', name:'NetworkNodeAssem', truncated:true },
  '0x746265766566726f6e746965720000004e6574776f726b4e6f64650000000000': { ns:'evefrontier', name:'NetworkNode' },
  '0x746265766566726f6e746965720000004c6f636174696f6e0000000000000000': { ns:'evefrontier', name:'Location' },
  '0x746265766566726f6e746965720000004b696c6c4d61696c0000000000000000': { ns:'evefrontier', name:'KillMail' },
  '0x746265766566726f6e74696572000000496e76656e746f72794974656d547261': { ns:'evefrontier', name:'InventoryItemTra', truncated:true },
  '0x746265766566726f6e74696572000000496e76656e746f72794974656d000000': { ns:'evefrontier', name:'InventoryItem' },
  '0x746265766566726f6e74696572000000496e76656e746f727942794974656d00': { ns:'evefrontier', name:'InventoryByItem' },
  '0x746265766566726f6e74696572000000496e76656e746f72794279457068656d': { ns:'evefrontier', name:'InventoryByEphem', truncated:true },
  '0x746265766566726f6e74696572000000496e76656e746f727900000000000000': { ns:'evefrontier', name:'Inventory' },
  '0x746265766566726f6e74696572000000496e697469616c697a65640000000000': { ns:'evefrontier', name:'Initialized' },
  '0x746265766566726f6e74696572000000496e697469616c697a65000000000000': { ns:'evefrontier', name:'Initialize' },
  '0x746265766566726f6e74696572000000486173526f6c65000000000000000000': { ns:'evefrontier', name:'HasRole' },
  '0x746265766566726f6e74696572000000476c6f62616c53746174696344617461': { ns:'evefrontier', name:'GlobalStaticData' },
  '0x746265766566726f6e746965720000004675656c456666696369656e6379436f': { ns:'evefrontier', name:'FuelEfficiencyCo', truncated:true },
  '0x746265766566726f6e746965720000004675656c436f6e73756d7074696f6e53': { ns:'evefrontier', name:'FuelConsumptionS', truncated:true },
  '0x746265766566726f6e746965720000004675656c000000000000000000000000': { ns:'evefrontier', name:'Fuel' },
  '0x746265766566726f6e74696572000000457068656d6572616c4974656d547261': { ns:'evefrontier', name:'EphemeralItemTra', truncated:true },
  '0x746265766566726f6e74696572000000457068656d6572616c496e76656e746f': { ns:'evefrontier', name:'EphemeralInvento', truncated:true },
  '0x746265766566726f6e74696572000000457068656d6572616c496e764974656d': { ns:'evefrontier', name:'EphemeralInvItem', truncated:true },
  '0x746265766566726f6e74696572000000457068656d6572616c496e7643617061': { ns:'evefrontier', name:'EphemeralInvCapa', truncated:true },
  '0x746265766566726f6e74696572000000456e746974795461674d617000000000': { ns:'evefrontier', name:'EntityTagMap' },
  '0x746265766566726f6e74696572000000456e746974795265636f72644d657461': { ns:'evefrontier', name:'EntityRecordMeta' },
  '0x746265766566726f6e74696572000000456e746974795265636f726400000000': { ns:'evefrontier', name:'EntityRecord' },
  '0x746265766566726f6e74696572000000456e7469747900000000000000000000': { ns:'evefrontier', name:'Entity' },
  '0x746265766566726f6e746965720000004465706c6f7961626c65537461746500': { ns:'evefrontier', name:'DeployableState' },
  '0x746265766566726f6e746965720000004368617261637465727342794163636f': { ns:'evefrontier', name:'CharactersByAcco', truncated:true },
  '0x746265766566726f6e7469657200000043686172616374657273000000000000': { ns:'evefrontier', name:'Characters' },
  '0x746265766566726f6e7469657200000043616c6c416363657373000000000000': { ns:'evefrontier', name:'CallAccess' },
  '0x746265766566726f6e74696572000000417373656d626c79456e65726779436f': { ns:'evefrontier', name:'AssemblyEnergyCo', truncated:true },
  '0x746265766566726f6e74696572000000416363657373436f6e66696700000000': { ns:'evefrontier', name:'AccessConfig' },
  // world namespace
  '0x7462776f726c640000000000000000005573657244656c65676174696f6e436f': { ns:'world', name:'UserDelegationCo', truncated:true },
  '0x7462776f726c6400000000000000000053797374656d73000000000000000000': { ns:'world', name:'Systems' },
  '0x7462776f726c6400000000000000000053797374656d52656769737472790000': { ns:'world', name:'SystemRegistry' },
  '0x7462776f726c6400000000000000000053797374656d486f6f6b730000000000': { ns:'world', name:'SystemHooks' },
  '0x7462776f726c640000000000000000005265736f757263654163636573730000': { ns:'world', name:'ResourceAccess' },
  '0x7462776f726c640000000000000000004e616d6573706163654f776e65720000': { ns:'world', name:'NamespaceOwner' },
  '0x7462776f726c640000000000000000004e616d65737061636544656c65676174': { ns:'world', name:'NamespaceDelegat', truncated:true },
  '0x7462776f726c64000000000000000000496e7374616c6c65644d6f64756c6573': { ns:'world', name:'InstalledModules' },
  '0x7462776f726c64000000000000000000496e69744d6f64756c65416464726573': { ns:'world', name:'InitModuleAddres', truncated:true },
  '0x7462776f726c6400000000000000000046756e6374696f6e53656c6563746f72': { ns:'world', name:'FunctionSelector' },
  '0x7462776f726c6400000000000000000042616c616e6365730000000000000000': { ns:'world', name:'Balances' },
  '0x6f74776f726c6400000000000000000046756e6374696f6e5369676e61747572': { ns:'world', name:'FunctionSignatur', truncated:true },
  // store / puppet / metadata / erc20-puppet namespaces
  '0x746273746f72650000000000000000005461626c657300000000000000000000': { ns:'store', name:'Tables' },
  '0x746273746f726500000000000000000053746f7265486f6f6b73000000000000': { ns:'store', name:'StoreHooks' },
  '0x746273746f72650000000000000000005265736f757263654964730000000000': { ns:'store', name:'ResourceIds' },
  '0x7462707570706574000000000000000050757070657452656769737472790000': { ns:'puppet', name:'PuppetRegistry' },
  '0x74626d657461646174610000000000005265736f757263655461670000000000': { ns:'metadata', name:'ResourceTag' },
  '0x746265726332302d707570706574000045524332305265676973747279000000': { ns:'erc20-puppet', name:'ERC20Registry' }
};
const TABLE_ALLOWLIST_SET = new Set(Object.keys(TABLE_ALLOWLIST_META));
// Full EVENT_MAP parity with Netlify usage-event.js for migration consistency.
const EVENT_MAP = new Map(Object.entries({
  p2p_route: { counters: ['p2p_routes'] },
  scout_baseline: { counters: ['scout_baselines'], sum: { key: 'scout_collected_systems_sum', countKey: 'scout_collected_systems_count', valueField: 'collectedSystems' }, extraCounters: (b)=> b.planetFilterOn ? ['planet_filter_baselines'] : [] },
  scout_opt_start: { counters: ['scout_optimizations'] },
  scout_abandoned: { counters: ['scout_abandoned'] },
  share_created: { counters: ['routes_shared'] },
  share_resolved: { counters: ['shared_resolved'] },
  referral_click: { counters: ['referral_clicks'] },
  theme_blue: { counters: ['theme_blue'] },
  theme_orange: { counters: ['theme_orange'] },
  theme_switch: { counters: ['theme_switches'] },
  baseline_error: { counters: ['baseline_errors'] },
  stall_restart: { counters: ['stall_restarts'] },
  p2p_route_time: { sum: { key: 'p2p_route_time_ms_sum', countKey: 'p2p_route_time_count', valueField: 'ms' } },
  scout_baseline_time: { sum: { key: 'scout_baseline_time_ms_sum', countKey: 'scout_baseline_time_count', valueField: 'ms' } },
  scout_opt_session_time: { sum: { key: 'scout_opt_session_time_ms_sum', countKey: 'scout_opt_session_time_count', valueField: 'ms' } },
  scout_opt_savings: { sum: { key: 'scout_opt_savings_ly_sum', countKey: 'scout_opt_savings_count', valueField: 'saved' } },
  scout_opt_savings_bucket: { countersDynamic: (b)=> { const v=b.bucket; const allowed=['save_0_50','save_50_100','save_100_200','save_gt_200']; return allowed.includes(v)? [v]:[]; } },
  ui_hide: { counters: ['ui_hide'] },
  show_distance: { counters: ['show_distance'] },
  show_stations: { counters: ['show_stations'] },
  help_open: { counters: ['help_opens'] },
  route_copy: { counters: ['route_copies'], extraCounters: (b)=> { const arr=[]; if(b.source==='p2p') arr.push('route_copy_p2p'); else if(b.source==='scout') arr.push('route_copy_scout'); return arr; } },
  ui_scale: { countersDynamic: (b)=> { const allowed=[50,60,70,80,90,100,110,120,130]; const s=Number(b.scale); return allowed.includes(s)? ['ui_scale_'+s]: []; } },
  page_load: { counters: ['page_loads'] },
  db_load_time: { sum: { key: 'db_load_time_ms_sum', countKey: 'db_load_time_count', valueField: 'ms' } },
  first_route_delay: { sum: { key: 'first_route_delay_ms_sum', countKey: 'first_route_delay_count', valueField: 'ms' } },
  first_action: { counters: ['first_actions'] },
  session_time: { sum: { key: 'session_time_ms_sum', countKey: 'session_time_count', valueField: 'ms' } },
  active_session_time: { sum: { key: 'active_session_time_ms_sum', countKey: 'active_session_time_count', valueField: 'ms' } },
  cinematic_enter: { counters: ['cinematic_enters'] },
  cinematic_first: { counters: ['cinematic_sessions'] },
  cinematic_time: { sum: { key: 'cinematic_time_ms_sum', countKey: 'cinematic_time_count', valueField: 'ms' } },
  session_bucket: { countersDynamic: (b)=> { const valid=['sess_lt_1m','sess_1_5m','sess_5_15m','sess_15_60m','sess_gt_60m']; return valid.includes(b.bucket)? [b.bucket]: []; } },
  p2p_algo: { countersDynamic: (b)=> { const a=b.algo; return (a==='astar'||a==='dijkstra')? ['p2p_algo_'+a]: []; } },
  p2p_opt_mode: { countersDynamic: (b)=> { const m=b.mode; return (m==='fuel'||m==='jumps'||m==='explore')? ['p2p_mode_'+m]: []; } },
  p2p_hops_bucket: { countersDynamic: (b)=> { const v=b.bucket; const allowed=['hops_lt_10','hops_10_30','hops_30_60','hops_gt_60']; return allowed.includes(v)? [v]: []; } },
  waypoint_count_bucket: { countersDynamic: (b)=> { const v=b.bucket; const allowed=['wp_0','wp_1_2','wp_3_5','wp_6_plus']; return allowed.includes(v)? [v]: []; } },
  scout_hops_bucket: { countersDynamic: (b)=> { const v=b.bucket; const allowed=['scout_hops_lt_10','scout_hops_10_30','scout_hops_30_60','scout_hops_gt_60']; return allowed.includes(v)? [v]: []; } },
  p2p_cancelled: { counters: ['p2p_cancelled'] },
  planet_bins_active_bucket: { countersDynamic: (b)=> { const v=b.bucket; const allowed=['bins_5','bins_3_4','bins_1_2','bins_0']; return allowed.includes(v)? [v]: []; } },
  opt_workers_used: { countersDynamic: (b)=> { const n=Number(b.count); if(!isFinite(n)||n<1||n>16) return []; return ['opt_workers_used_'+n]; } },
  donate_modal_open: { counters: ['donate_modal_open'] },
  donate_stripe_click: { counters: ['donate_stripe_clicks'] },
  donate_crypto_click: { counters: ['donate_crypto_clicks'] },
  feature_flags: { countersDynamic: (b)=> { const arr=[]; if(b.waypoints) arr.push('waypoints_used'); if(b.avoid) arr.push('avoid_used'); if(b.waypointOpt) arr.push('waypoint_opt_used'); if(b.returnToStart) arr.push('return_to_start'); if(b.gateReachable) arr.push('gate_reachable'); return arr; } },
  reachability_enable: { counters: ['reachability_enable'] },
  reachability_disable: { counters: ['reachability_disable'] },
  reachability_compute: { counters: ['reachability_computes'] },
  rangebubble_show: { counters: ['rangebubble_show'] },
  rangebubble_hide: { counters: ['rangebubble_hide'] },
  reachability_auto_on: { counters: ['reachability_auto_on'] },
  reachability_auto_off: { counters: ['reachability_auto_off'] },
  reachability_tab_open: { counters: ['reachability_tab_open'] },
  reachability_inrange_on: { counters: ['reachability_inrange_on'] },
  reachability_inrange_off: { counters: ['reachability_inrange_off'] },
  reachability_range_bucket: { countersDynamic: (b)=> { const v=b.bucket; const allowed=['rng_lt_10','rng_10_25','rng_25_50','rng_50_100','rng_gt_100']; return allowed.includes(v)? [v]: []; } },
  region_stats_view: { counters: ['region_stats_views'] },
  compare_regions_open: { counters: ['compare_regions_opens'] },
  overlay_open: { counters: ['overlay_opens'] },
  overlay_open_first: { counters: ['overlay_sessions'] },
  overlay_add_mark: { counters: ['overlay_add_marks'] },
  overlay_add_first: { counters: ['overlay_add_sessions'] },
  overlay_export: { counters: ['overlay_exports'] },
  overlay_import: { counters: ['overlay_imports'] },
  overlay_panel_time: { sum: { key:'overlay_panel_time_ms_sum', countKey:'overlay_panel_time_count', valueField:'ms' } },
  overlay_marks_count_bucket: { countersDynamic: (b)=> { const v=b.bucket; const allowed=['marks_0','marks_1_5','marks_6_15','marks_16_30','marks_31_60','marks_61_plus']; return allowed.includes(v)? [v]: []; } },
  transmission_show: { counters: ['transmission_shows'] },
  transmission_complete: { counters: ['transmission_completes'] },
  transmission_skip: { counters: ['transmission_skips'] },
  transmission_dismiss: { counters: ['transmission_dismisses'] },
  transmission_link_click: { counters: ['transmission_link_clicks'] },
  transmission_route_click: { counters: ['transmission_route_clicks'] },
  transmission_replay: { counters: ['transmission_replays'] },
  transmission_replay_first: { counters: ['transmission_replay_sessions'] },
  transmission_fastforward: { counters: ['transmission_fastforwards'] },
  transmission_fastforward_first: { counters: ['transmission_fastforward_sessions'] },
  transmission_audio_play: { counters: ['transmission_audio_plays'] },
  transmission_audio_mute: { counters: ['transmission_audio_mutes'] },
  transmission_audio_unmute: { counters: ['transmission_audio_unmutes'] },
  transmission_major_glitch: { counters: ['transmission_major_glitches'] },
  transmission_close: { counters: ['transmission_closes'] },
  transmission_close_early: { counters: ['transmission_close_earlies'] },
  transmission_echo_msg: { counters: ['transmission_echo_msgs'] },
  transmission_open_time: { sum: { key:'transmission_open_time_ms_sum', countKey:'transmission_open_time_count', valueField:'ms' } },
  transmission_echo_time: { sum: { key:'transmission_echo_time_ms_sum', countKey:'transmission_echo_time_count', valueField:'ms' } },
  transmission_echo_msgs_bucket: { countersDynamic: (b)=> { const v=b.bucket; const allowed=['echo_0','echo_1_5','echo_6_15','echo_16_30','echo_gt_30']; return allowed.includes(v)? [v]: []; } },
  transmission_open_share_bucket: { countersDynamic: (b)=> { const v=b.bucket; const allowed=['tx_share_0','tx_share_lt_10','tx_share_10_30','tx_share_30_60','tx_share_gt_60']; return allowed.includes(v)? [v]: []; } },
  screen_res_bucket: { countersDynamic: (b)=> { const v=b.bucket; const allowed=['res_720p','res_1080p','res_1440p','res_4k_plus']; return allowed.includes(v)? [v]: []; } },
  cpu_cores_bucket: { countersDynamic: (b)=> { const v=b.bucket; const allowed=['cores_1_2','cores_3_4','cores_5_8','cores_9_12','cores_13_16','cores_17_plus']; return allowed.includes(v)? [v]: []; } }
}));

// ---- Indexer (D1) Endpoints (feature/indexer) ----
// Mirrors logic in root worker.js so Pages deployment has the same API.
// Requires D1 binding INDEX_DB and secret INDEXER_ADMIN_TOKEN.
const WORLD_API_BASE = 'https://world-api-stillness.live.tech.evefrontier.com';
// Pending changes probe cache (5s TTL) – per worker isolate
let _pendingProbeCache = { ts:0, fromBlock:0, value:null };
let _pendingProbeStats = { hits:0, misses:0, lastMs:0 };

async function handleIndexerHealth(env, url){
  if(!env.INDEX_DB){
    return json({ status:'disabled', reason:'INDEX_DB binding missing' });
  }
  // Attempt to load worlds.json (chain deployments) from static assets.
  let chainDeploy=null; let chainId=null;
  try {
    if(env.ASSETS && typeof env.ASSETS.fetch === 'function'){
      const assetResp = await env.ASSETS.fetch(new Request(new URL('/worlds.json', url).toString()));
      if(assetResp.ok){
        const mapping = await assetResp.json();
        const provided = url.searchParams.get('chainId');
        if(provided && mapping[provided]){ chainDeploy = mapping[provided]; chainId = provided; }
        else {
          const keys = Object.keys(mapping);
          if(keys.length>0){ chainId = keys[0]; chainDeploy = mapping[chainId]; }
        }
      }
    }
  } catch(_e){ /* ignore worlds.json errors */ }
  try {
    const probe = await env.INDEX_DB.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='world_version'").all();
    if(!probe.results || probe.results.length === 0){
      return json({ status:'uninitialized', world:null, chain:{ chainId, ...chainDeploy } });
    }
  const { results } = await env.INDEX_DB.prepare("SELECT version_number, world_address, contracts_version FROM world_version WHERE archived_at IS NULL ORDER BY version_number DESC LIMIT 1").all();
    const world = results?.[0] || null;
    const details = url.searchParams.get('details')==='1';
  let counts=null;
  let lastRun=null;
    if(details){
      try {
        const countQueries = [
          { k:'smart_assembly', q:"SELECT COUNT(1) as c FROM smart_assembly" },
          { k:'smart_gate_direction', q:"SELECT COUNT(1) as c FROM smart_gate_direction" },
          { k:'structure_generic', q:"SELECT COUNT(1) as c FROM structure_generic" },
          { k:'assembly_metadata', q:"SELECT COUNT(1) as c FROM assembly_metadata" },
          { k:'table_registry', q:"SELECT COUNT(1) as c FROM table_registry" },
          { k:'table_registry_finalized', q:"SELECT COUNT(1) as c FROM table_registry WHERE finalized=1" },
          { k:'store_events', q:"SELECT COUNT(1) as c FROM store_events" },
          { k:'raw_logs', q:"SELECT COUNT(1) as c FROM raw_logs" }
        ];
        counts={};
        for(const cq of countQueries){
          try { const r = await env.INDEX_DB.prepare(cq.q).all(); counts[cq.k]= r.results?.[0]?.c ?? 0; } catch { counts[cq.k]='err'; }
        }
        try {
          const lr = await env.INDEX_DB.prepare("SELECT id, mode, run_started_at, run_finished_at, run_duration_ms, assemblies_scanned, rows_added, rows_updated, rows_removed, gate_edges_rebuilt, error_count, last_progress_at, rows_so_far, stall_restarts, seg_requests_so_far, batch_flushes, adaptive_batch_current, attempted_logs FROM indexer_run ORDER BY id DESC LIMIT 1").all();
          lastRun = lr.results?.[0] || null;
        } catch { /* ignore */ }
      } catch { /* swallow */ }
    }
  // Cursor snapshot + ingestion lag
    let cursor=null; let ingestionLagMs=null;
    try {
      const cur = await env.INDEX_DB.prepare("SELECT id, last_block_number, last_log_index, updated_at FROM event_cursor WHERE id=1").all();
      cursor = cur.results?.[0] || null;
      if(cursor?.updated_at){
        const updatedTs = Date.parse(cursor.updated_at + (cursor.updated_at.endsWith('Z')?'':'Z'));
        if(!isNaN(updatedTs)) ingestionLagMs = Date.now() - updatedTs;
      }
    } catch { /* ignore */ }
    // Pending changes probe with 5s cache keyed by fromBlock
    let pendingChanges=null;
    if(cursor){
      const fromBlock = (cursor.last_block_number||0)+1;
      const now = Date.now();
      if(_pendingProbeCache.value && now - _pendingProbeCache.ts < 5000 && _pendingProbeCache.fromBlock === fromBlock){
        _pendingProbeStats.hits++;
        pendingChanges = _pendingProbeCache.value;
      } else {
        const t0 = Date.now();
        try {
          const evResp = await fetch(`${WORLD_API_BASE}/events?fromBlock=${fromBlock}&limit=20`);
          if(evResp.ok){
            const data = await evResp.json();
            if(Array.isArray(data?.events)){
              const assemblyEvents = data.events.filter(e=> (e?.type==='assembly_upsert' || e?.type==='assembly_delete') && (e?.blockNumber||0) >= fromBlock);
              const ids = Array.from(new Set(assemblyEvents.filter(e=> e.type==='assembly_upsert').map(e=> e.id).filter(id=> typeof id === 'string' && id.length>0))).slice(0,50);
              let existing=new Set();
              if(ids.length){
                const placeholders = ids.map(()=>'?').join(',');
                try {
                  const res = await env.INDEX_DB.prepare(`SELECT id FROM smart_assembly WHERE id IN (${placeholders})`).bind(...ids).all();
                  existing = new Set((res.results||[]).map(r=> r.id));
                } catch { /* ignore existence errors */ }
              }
              let assembliesToInsert=0, assembliesToUpdate=0, assembliesToDelete=0, gateEdgesPotential=0;
              for(const ev of assemblyEvents){
                if(ev.type==='assembly_delete' || ev.subtype==='delete'){ assembliesToDelete++; continue; }
                if(existing.has(ev.id)) assembliesToUpdate++; else assembliesToInsert++;
                if(ev.gate && Array.isArray(ev.gate.directions)) gateEdgesPotential += ev.gate.directions.length;
              }
              pendingChanges = {
                eventsAhead: assemblyEvents.length,
                fromBlock,
                sampleType: data.events[0]?.type || null,
                assembliesToInsert,
                assembliesToUpdate,
                assembliesToDelete,
                gateEdgesPotential,
                sampleSize: data.events.length,
                classified: true
              };
        _pendingProbeCache = { ts: now, fromBlock, value: pendingChanges };
            }
          }
        } catch { /* ignore network errors */ }
    _pendingProbeStats.misses++;
    _pendingProbeStats.lastMs = Date.now() - t0;
      }
    }
  const includeProbeStats = url.searchParams.get('probeStats')==='1';
  // DB metrics helper (page_count/page_size + raw_logs stats)
  async function dbMetrics(db){
    if(!db) return null;
    const pickFirstVal = (row)=>{ if(!row) return 0; const k = Object.keys(row)[0]; return Number(row[k]||0); };
  let page_count = 0, page_size = 0, approx_size_bytes = 0;
  let size_method = 'unknown';
    try {
      const pc = await db.prepare('PRAGMA page_count').all();
      page_count = pickFirstVal((pc.results||[])[0]);
    } catch { /* ignore */ }
    try {
      const pz = await db.prepare('PRAGMA page_size').all();
      page_size = pickFirstVal((pz.results||[])[0]);
    } catch { /* ignore */ }
    // Fallbacks for D1 environments where PRAGMA may not return values via prepare('PRAGMA ...')
    if(!(page_count>0)){
      try {
        const pc2 = await db.prepare('SELECT page_count FROM pragma_page_count').all();
        page_count = Number(pc2.results?.[0]?.page_count||0);
      } catch { /* ignore */ }
    }
    if(!(page_size>0)){
      try {
        const pz2 = await db.prepare('SELECT page_size FROM pragma_page_size').all();
        page_size = Number(pz2.results?.[0]?.page_size||0);
      } catch { /* ignore */ }
    }
    if(page_count>0 && page_size>0){ approx_size_bytes = page_count * page_size; size_method='pragma_pages'; }
    let raw_logs = null;
    try {
      const rl = await db.prepare('SELECT MIN(block_number) AS min_block, MAX(block_number) AS max_block, COUNT(1) AS count FROM raw_logs').all();
      const r0 = (rl.results||[])[0] || {};
      raw_logs = { count: Number(r0.count||0), min_block: r0.min_block ?? null, max_block: r0.max_block ?? null };
    } catch { /* table may not exist */ }
    // Optional dbstat fallback for size if still missing (may be unavailable on D1)
    if(!(approx_size_bytes>0)){
      try {
        const ds = await db.prepare('SELECT SUM(pgsize) AS s FROM dbstat').all();
        const s = Number(ds.results?.[0]?.s||0);
        if(s>0){ approx_size_bytes = s; size_method='dbstat_sum'; }
      } catch { /* ignore */ }
    }
    // Final fallback: do not guess size to avoid heavy scans; expose only counts and method
    if(!(approx_size_bytes>0)){
      size_method = 'unavailable';
    }
    return { page_count, page_size, approx_size_bytes, raw_logs, diag:{ size_method } };
  }
  // Collect metrics for primary and archives if bound
  let db = { primary: null, a1: null, a2: null };
  try { db.primary = await dbMetrics(env.INDEX_DB); } catch { db.primary = null; }
  try { if(env.INDEX_DB_A1) db.a1 = await dbMetrics(env.INDEX_DB_A1); } catch { db.a1 = null; }
  try { if(env.INDEX_DB_A2) db.a2 = await dbMetrics(env.INDEX_DB_A2); } catch { db.a2 = null; }
  // Archiver summary (fill pct relative to 10GB soft cap)
  const capBytes = 10 * 1024 * 1024 * 1024;
  const archiver = {
    primaryCount: db.primary?.raw_logs?.count ?? null,
    archivedCount: (db.a1?.raw_logs?.count||0) + (db.a2?.raw_logs?.count||0),
    a1FillPct_10g: db.a1?.approx_size_bytes!=null? Math.round((db.a1.approx_size_bytes/capBytes)*1000)/10 : null,
    a2FillPct_10g: db.a2?.approx_size_bytes!=null? Math.round((db.a2.approx_size_bytes/capBytes)*1000)/10 : null
  };
  // Snapshot advisory (no side effects). Compute only when classification performed.
  let snapshotRecommended=false; let snapshotReason=null; let changeSummary=null;
  if(pendingChanges && pendingChanges.classified){
    const totalAssemblyChanges = (pendingChanges.assembliesToInsert||0) + (pendingChanges.assembliesToUpdate||0) + (pendingChanges.assembliesToDelete||0);
    const gEdges = pendingChanges.gateEdgesPotential||0;
    const del = pendingChanges.assembliesToDelete||0;
    if(gEdges >= 25){ snapshotRecommended=true; snapshotReason='gate_edges>=25'; }
    else if(del >= 5){ snapshotRecommended=true; snapshotReason='deletes>=5'; }
    else if(totalAssemblyChanges >= 50){ snapshotRecommended=true; snapshotReason='assembly_changes>=50'; }
    else if(gEdges >= 12 && totalAssemblyChanges >= 25){ snapshotRecommended=true; snapshotReason='gate_edges>=12_and_changes>=25'; }
    changeSummary = { totalAssemblyChanges, gateEdgesPotential: gEdges, assembliesToDelete: del };
  }
  let hasAdminToken = !!(env.INDEXER_ADMIN_TOKEN && env.INDEXER_ADMIN_TOKEN.trim().length);
  let migrationsApplied = null;
  try {
    const migProbe = await env.INDEX_DB.prepare("SELECT id FROM _migrations ORDER BY id").all();
    migrationsApplied = (migProbe.results||[]).map(r=>r.id);
  } catch { /* ignore if table absent */ }
  // Derived active run timing metrics (if lastRun still active)
  let activeRunAgeMs=null, lastProgressAgoMs=null;
  if(lastRun && !lastRun.run_finished_at){
    try { const started = new Date((lastRun.run_started_at||'') + (lastRun.run_started_at?.endsWith('Z')?'':'Z')); if(!isNaN(started.getTime())) activeRunAgeMs = Date.now() - started.getTime(); } catch{}
    if(lastRun.last_progress_at){
      try { const lp = new Date(lastRun.last_progress_at + (lastRun.last_progress_at.endsWith('Z')?'':'Z')); if(!isNaN(lp.getTime())) lastProgressAgoMs = Date.now() - lp.getTime(); } catch{}
    }
  }
  // Expose threshold/env configuration for UI introspection
  const stallNoProgressMs = parseInt(env.INDEXER_STALL_NO_PROGRESS_MS||'120000',10);
  const staleAgeMs = parseInt(env.INDEXER_STALE_AGE_MS||'1500000',10); // 25m default
  const rpcTimeoutMs = parseInt(env.INDEXER_RPC_TIMEOUT_MS||'15000',10);
  return json({ status:'ok', world, chain: chainDeploy? { chainId, ...chainDeploy }: null, counts, lastRun, cursor, ingestionLagMs, pendingChanges, snapshotRecommended, snapshotReason, changeSummary, hasAdminToken, migrationsApplied, probeStats: includeProbeStats? _pendingProbeStats : undefined, activeRunAgeMs, lastProgressAgoMs, thresholds:{ stallNoProgressMs, staleAgeMs, rpcTimeoutMs }, db, archiver });
  } catch(e){
    return json({ status:'error', error:String(e), chain: chainDeploy? { chainId, ...chainDeploy }: null, counts, lastRun });
  }
}

// List recent indexer runs (read-only). No auth required (non-sensitive operational metadata).
// Query params: ?limit=25 (default 25, max 100)
async function handleIndexerRuns(env, url){
  if(!env.INDEX_DB){
    return json({ status:'disabled', reason:'INDEX_DB binding missing' });
  }
  const limRaw = Number(url.searchParams.get('limit')||25);
  const limit = (!isFinite(limRaw) || limRaw<=0) ? 25 : Math.min(100, Math.floor(limRaw));
  try {
  const active = await env.INDEX_DB.prepare("SELECT id, mode, run_started_at, rows_added, error_count, notes, rows_so_far, last_progress_at, seg_requests_so_far, batch_flushes, adaptive_batch_current, stall_restarts, attempted_logs FROM indexer_run WHERE run_finished_at IS NULL ORDER BY id DESC LIMIT 5").all();
  const recent = await env.INDEX_DB.prepare("SELECT id, mode, run_started_at, run_finished_at, run_duration_ms, rows_added, rows_updated, rows_removed, error_count, notes, rows_so_far, seg_requests_so_far, batch_flushes, adaptive_batch_current, stall_restarts, attempted_logs FROM indexer_run ORDER BY id DESC LIMIT ?").bind(limit).all();
    return json({ status:'ok', active: active.results||[], runs: recent.results||[] });
  } catch(e){
    return json({ status:'error', error:String(e) });
  }
}

async function handleIndexerMigrate(req, env){
  if(req.method !== 'POST') return json({ error:'Method Not Allowed' },405);
  const token = req.headers.get('X-Indexer-Admin');
  const authDisabled = env.INDEXER_AUTH_DISABLED === '1';
  const host = req.headers.get('host')||'';
  const isPreviewHost = host.endsWith('.pages.dev');
  const urlObj = new URL(req.url);
  const openPreview = urlObj.searchParams.get('openPreview') === '1';
  const tokenValid = !!token && token === (env.INDEXER_ADMIN_TOKEN||'');
  const bypassAuth = !tokenValid && isPreviewHost && openPreview;
  if(!authDisabled && !tokenValid && !bypassAuth) return json({ error:'Unauthorized' },401);
  if(!env.INDEX_DB) return json({ error:'INDEX_DB binding missing' },500);
  await env.INDEX_DB.exec("CREATE TABLE IF NOT EXISTS _migrations (id TEXT PRIMARY KEY, applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP)");
  const migrationList = ['001_init','002_enrichment','003_cursor','004_run_duration','005_overlay','006_store_registry','007_raw_logs','008_progress','009_run_metrics','010_raw_logs_shadow','011_decode_schema','012_latest_state','013_gap_scan_results','014_decode_bootstrap','015_run_attempted'];
  
  // (Table allowlist constants defined globally for shared use.)
  const appliedRes = await env.INDEX_DB.prepare("SELECT id FROM _migrations").all();
  const applied = new Set((appliedRes?.results||[]).map(r=>r.id));
  const executed=[]; const skipped=[];
  for(const m of migrationList){
    if(applied.has(m)){ skipped.push(m); continue; }
    try {
      const sqlText = MIGRATION_SQL[m];
      if(!sqlText) return json({ error:'Missing inline SQL for migration', migration:m },500);
      await env.INDEX_DB.exec(sqlText);
      await env.INDEX_DB.prepare("INSERT INTO _migrations (id) VALUES (?)").bind(m).run();
      executed.push(m);
    } catch(e){
      return json({ error:'Migration failed', migration:m, message:String(e), executed, skipped });
    }
  }
  return json({ status:'migrated', executed, skipped, bypassAuth });
}

async function handleIndexerBootstrap(req, env){
  if(req.method !== 'POST') return json({ error:'Method Not Allowed' },405);
  const token = req.headers.get('X-Indexer-Admin');
  const host = req.headers.get('host')||'';
  const isPreviewHost = host.endsWith('.pages.dev');
  let bypassAuth=false;
  try { const urlObj = new URL(req.url); bypassAuth = isPreviewHost && urlObj.searchParams.get('openPreview')==='1' && (!env.INDEXER_ADMIN_TOKEN || token !== env.INDEXER_ADMIN_TOKEN); } catch { /* ignore */ }
  if(!bypassAuth && (!token || token !== (env.INDEXER_ADMIN_TOKEN||''))) return json({ error:'Unauthorized' },401);
  if(!env.INDEX_DB) return json({ error:'INDEX_DB binding missing' },500);
  let cfg; try {
    const resp = await fetch(WORLD_API_BASE + '/config');
    if(!resp.ok) return json({ error:'config_fetch_failed', status: resp.status },502);
    cfg = await resp.json();
  } catch(e){ return json({ error:'config_fetch_error', message:String(e) },502); }
  const worldAddress = cfg?.contracts?.world?.address || '';
  const contractsVersion = cfg?.contractsVersion || '';
  if(!worldAddress) return json({ error:'missing_world_address' },500);
  try {
    const currentRes = await env.INDEX_DB.prepare("SELECT id, version_number, world_address, contracts_version FROM world_version WHERE archived_at IS NULL ORDER BY version_number DESC LIMIT 1").all();
    const current = currentRes.results?.[0] || null;
    if(!current){
      await env.INDEX_DB.prepare("INSERT INTO world_version (version_number, world_address, contracts_version) VALUES (1, ?, ?)").bind(worldAddress, contractsVersion).run();
      const inserted = await env.INDEX_DB.prepare("SELECT id, version_number, world_address, contracts_version FROM world_version WHERE archived_at IS NULL ORDER BY version_number DESC LIMIT 1").all();
      return json({ action:'initialized', world: inserted.results?.[0]||null });
    }
    if(current.world_address.toLowerCase() === worldAddress.toLowerCase()){
      if(current.contracts_version !== contractsVersion){
        await env.INDEX_DB.prepare("UPDATE world_version SET contracts_version=? WHERE id=?").bind(contractsVersion, current.id).run();
        return json({ action:'version_updated', world: { ...current, contracts_version: contractsVersion } });
      }
      return json({ action:'no_change', world: current });
    }
    const newVersion = (current.version_number||0)+1;
    await env.INDEX_DB.prepare("UPDATE world_version SET archived_at=CURRENT_TIMESTAMP WHERE archived_at IS NULL").run();
    await env.INDEX_DB.prepare("INSERT INTO world_version (version_number, world_address, contracts_version) VALUES (?, ?, ?)").bind(newVersion, worldAddress, contractsVersion).run();
    const latest = await env.INDEX_DB.prepare("SELECT id, version_number, world_address, contracts_version FROM world_version WHERE archived_at IS NULL ORDER BY version_number DESC LIMIT 1").all();
    return json({ action:'version_bumped', world: latest.results?.[0]||null });
  } catch(e){
    return json({ error:'bootstrap_failed', message:String(e) });
  }
}

// Unified ingestion endpoint supporting stub or raw store log modes
async function handleIndexerIngest(req, env){
  if(req.method !== 'POST') return json({ error:'Method Not Allowed' },405);
  if(!env.INDEX_DB) return json({ error:'INDEX_DB binding missing' },500);
  // Auth: allow same preview bypass pattern as /api/indexer-migrate to unblock ingestion when admin token not configured.
  const token = req.headers.get('X-Indexer-Admin');
  const authDisabled = env.INDEXER_AUTH_DISABLED === '1';
  const expected = (env.INDEXER_ADMIN_TOKEN||'').trim();
  const host = req.headers.get('host')||'';
  const isPreviewHost = host.endsWith('.pages.dev');
  let bypassAuth=false;
  try { const urlObj = new URL(req.url); bypassAuth = isPreviewHost && urlObj.searchParams.get('openPreview')==='1' && (!!expected ? token?.trim() !== expected : !token); } catch{ /* ignore URL parse */ }
  if(!authDisabled && expected && token?.trim() !== expected && !bypassAuth) return json({ error:'Unauthorized' },401);
  let body={}; try { if(req.headers.get('content-type')?.includes('application/json')) body = await req.json(); } catch { body={}; }
  // Mode parsing: allow mode via body or query param; support case-insensitive values.
  let modeInput = body.mode;
  try { const u = new URL(req.url); if(!modeInput && u.searchParams.get('mode')) modeInput = u.searchParams.get('mode'); } catch { /* ignore */ }
  if(typeof modeInput === 'string') modeInput = modeInput.toLowerCase();
  let extendedMode;
  if(modeInput === 'store_all') extendedMode = 'store_all';
  else if(modeInput === 'store') extendedMode = 'store';
  else extendedMode = 'stub';
  // Ensure base tables
  await env.INDEX_DB.exec("CREATE TABLE IF NOT EXISTS gate_tombstone (id INTEGER PRIMARY KEY AUTOINCREMENT, gate_id TEXT NOT NULL, world_version INTEGER NOT NULL, deleted_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP);");
  await env.INDEX_DB.exec("CREATE TABLE IF NOT EXISTS event_cursor (id INTEGER PRIMARY KEY CHECK (id = 1), last_block_number INTEGER NOT NULL DEFAULT 0, last_log_index INTEGER NOT NULL DEFAULT 0, updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP);");
  await env.INDEX_DB.exec("INSERT INTO event_cursor (id, last_block_number, last_log_index) SELECT 1,0,0 WHERE NOT EXISTS (SELECT 1 FROM event_cursor WHERE id=1);");
  const curRes = await env.INDEX_DB.prepare("SELECT id, last_block_number, last_log_index, updated_at FROM event_cursor WHERE id=1").all();
  let cursor = curRes.results?.[0] || null;
  const w = await env.INDEX_DB.prepare("SELECT id FROM world_version WHERE archived_at IS NULL ORDER BY version_number DESC LIMIT 1").all();
  const worldId = w.results?.[0]?.id || null;
  if(!worldId) return json({ error:'no_active_world_version' },500);
  await env.INDEX_DB.prepare("INSERT INTO indexer_run (world_version, mode, assemblies_scanned, rows_added, rows_updated, rows_removed, gate_edges_rebuilt, snapshot_version, notes) VALUES (?, ?, 0,0,0,0,0,NULL,?)").bind(worldId, extendedMode, extendedMode==='store' ? 'store ingest start' : (extendedMode==='store_all'?'store_all raw capture start':'stub start')).run();
  const started = await env.INDEX_DB.prepare("SELECT id, run_started_at FROM indexer_run WHERE world_version=? ORDER BY id DESC LIMIT 1").bind(worldId).all();
  const runId = started.results?.[0]?.id;
  // Initialize heartbeat fields on start (best-effort; ignore errors if migration not applied yet)
  if(runId){ try { await env.INDEX_DB.prepare("UPDATE indexer_run SET last_progress_at=CURRENT_TIMESTAMP, rows_so_far=0 WHERE id=?").bind(runId).run(); } catch { /* ignore if column missing (migration not run) */ } }
  if(extendedMode === 'store_all'){
    // Broad address-only capture with batched inserts to mitigate per-row overhead (reduces Worker 1101 exceptions).
    try {
  // Reset allowlist skip counter for this invocation
  globalThis.__skippedAllowlist = 0;
  const RPC = env.PYROPE_RPC || body.rpc || '';
  const RPC_LIST = RPC.split(',').map(s=>s.trim()).filter(Boolean);
  const WORLD = (env.WORLD_ADDRESS || body.world || '').toLowerCase();
  const reindexMode = env.INDEXER_REINDEX_MODE === '1';
  const dualRaw = env.INDEXER_DUAL_RAW === '1';
      if(!RPC || !WORLD){
        // Finalize the run record so UI does not show a perpetual active run with zero progress.
        if(runId){
          try {
            await env.INDEX_DB.prepare("UPDATE indexer_run SET run_finished_at=CURRENT_TIMESTAMP, notes=COALESCE(notes,'finalized_missing_config'), run_duration_ms=COALESCE(run_duration_ms, (julianday(CURRENT_TIMESTAMP)-julianday(run_started_at))*86400000) WHERE id=? AND run_finished_at IS NULL").bind(runId).run();
          } catch { /* ignore finalize errors */ }
        }
        return json({ error:'missing_rpc_or_world' },400);
      }
      const CONFIRM_DEPTH = BigInt(env.CONFIRM_DEPTH || body.confirmDepth || 8);
      const deployBlock = BigInt(env.DEPLOY_BLOCK || body.deployBlock || 0);
  const maxBlocks = Math.min(Number(body.maxBlocks||2000),20000);
  const segmentBlocks = Math.min(Number(body.segmentBlocks||0)||0, maxBlocks);
  // Throttle: optional sleep between segment RPC calls (ms). Accept body.throttleMs or env.INDEXER_THROTTLE_MS (default 0)
  const throttleMs = Math.min(60000, Math.max(0, parseInt(body.throttleMs || env.INDEXER_THROTTLE_MS || '0',10)||0));
  // Limit number of segments processed in a single invocation (body.maxSegments or env.INDEXER_MAX_SEGMENTS) to reduce provider pressure.
  const maxSegments = Math.min( Math.max(1, parseInt(body.maxSegments || env.INDEXER_MAX_SEGMENTS || '0',10)||0) , 500); // 0 => unlimited (bounded by MAX_SEG_REQ)
      const rowCap = Math.min(Number(body.rowCap||50000),200000);
      // Ensure schema
      try {
        await env.INDEX_DB.exec("CREATE TABLE IF NOT EXISTS raw_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, block_number INTEGER NOT NULL, log_index INTEGER NOT NULL, tx_hash TEXT NOT NULL, address TEXT NOT NULL, topic0 TEXT NULL, topic1 TEXT NULL, topic2 TEXT NULL, topic3 TEXT NULL, data TEXT NOT NULL, created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP);");
        await env.INDEX_DB.exec("CREATE UNIQUE INDEX IF NOT EXISTS u_raw_logs_block_logindex ON raw_logs(block_number, log_index);");
        await env.INDEX_DB.exec("CREATE INDEX IF NOT EXISTS idx_raw_logs_block ON raw_logs(block_number);");
        await env.INDEX_DB.exec("CREATE INDEX IF NOT EXISTS idx_raw_logs_address ON raw_logs(address);");
        await env.INDEX_DB.exec("CREATE INDEX IF NOT EXISTS idx_raw_logs_topic0 ON raw_logs(topic0);");
      } catch(e){ return json({ error:'raw_logs_ddl_failed', message:String(e) },500); }
      const RPC_TIMEOUT_MS = parseInt(env.INDEXER_RPC_TIMEOUT_MS||'15000',10);
      async function rpc(method, params){
        const maxAttempts = 3 * (RPC_LIST.length||1); // allow attempts across providers
        let attempt=0; let lastErr=null; let providerIndex=0; let failuresOnProvider=0;
        while(attempt < maxAttempts){
          attempt++;
            const currentRpc = RPC_LIST[providerIndex] || RPC; // fallback to single RPC string
          const ac = new AbortController();
          const t = setTimeout(()=> ac.abort('rpc_timeout'), RPC_TIMEOUT_MS);
          try {
            const r = await fetch(currentRpc,{ method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ jsonrpc:'2.0', id:attempt, method, params }), signal: ac.signal });
            if(!r.ok) throw new Error('rpc_http_'+r.status);
            const j = await r.json(); if(j.error) throw new Error('rpc_'+j.error.message);
            return j.result;
          } catch(e){
            lastErr = e;
            const msg = String(e);
            const retriable = (msg.includes('rpc_http_5') || msg.includes('rpc_timeout') || msg.includes('fetch failed'));
            globalThis.__rpcFailures = (globalThis.__rpcFailures||0)+1;
            failuresOnProvider++;
            if(retriable){
              // rotate provider if multiple available & failure count >0 on this provider
              if(RPC_LIST.length>1 && failuresOnProvider>=1){
                providerIndex = (providerIndex + 1) % RPC_LIST.length;
                failuresOnProvider=0;
              }
              const backoffMs = 200 * Math.pow(2, attempt%3); // 200,400,800 repeating
              await new Promise(res=> setTimeout(res, backoffMs));
              continue;
            }
            if(msg.includes('rpc_timeout')) throw new Error('rpc_timeout_'+method);
            throw e;
          } finally { clearTimeout(t); }
        }
        throw lastErr || new Error('rpc_failed_'+method);
      }
      // Helper: finalize run safely (idempotent-ish). Persist metrics & inserted count best-effort.
    async function finalizeRun(insertedVal, segReq, flushes, adaptiveBatch, note){
        if(!runId) return;
        try {
          const durRes = await env.INDEX_DB.prepare("SELECT (julianday(CURRENT_TIMESTAMP)-julianday(run_started_at))*86400000 AS ms FROM indexer_run WHERE id=?").bind(runId).all();
          const ms = Math.max(0, Math.round(durRes.results?.[0]?.ms||0));
          // Only overwrite notes if still the start note or a blank note.
      let finalNote = note;
      const extraMetrics = [];
      if(typeof globalThis.__rpcFailures === 'number') extraMetrics.push('rpcFail:'+globalThis.__rpcFailures);
      if(typeof globalThis.__segmentRetries === 'number') extraMetrics.push('segRetry:'+globalThis.__segmentRetries);
      if(!finalNote) finalNote = 'store_all raw '+insertedVal;
      if(extraMetrics.length) finalNote += ' '+extraMetrics.join(' ');
          try {
            await env.INDEX_DB.prepare("UPDATE indexer_run SET run_finished_at=CURRENT_TIMESTAMP, run_duration_ms=?, rows_added=?, seg_requests_so_far=?, batch_flushes=?, adaptive_batch_current=?, attempted_logs=COALESCE(?,attempted_logs), notes=? WHERE id=? AND run_finished_at IS NULL")
              .bind(ms, insertedVal||0, segReq||0, flushes||0, adaptiveBatch||0, (typeof attempted==='number'? attempted: null), finalNote, runId).run();
          } catch(_e){
            await env.INDEX_DB.prepare("UPDATE indexer_run SET run_finished_at=CURRENT_TIMESTAMP, run_duration_ms=?, rows_added=?, seg_requests_so_far=?, batch_flushes=?, adaptive_batch_current=?, notes=? WHERE id=? AND run_finished_at IS NULL")
              .bind(ms, insertedVal||0, segReq||0, flushes||0, adaptiveBatch||0, finalNote, runId).run();
          }
        } catch {/* ignore finalize errors */ }
      }
      let latestHex; try { latestHex = await rpc('eth_blockNumber', []); } catch(e){ return json({ error:'head_fetch_failed', message:String(e) },502); }
      const latest = BigInt(latestHex);
      if(latest < deployBlock + CONFIRM_DEPTH){
        await finalizeRun(0,0,0,0,(reindexMode?'reindex_freeze ':'')+'store_all head_too_low latest:'+Number(latest));
        return json({ status:'head_too_low', latest:Number(latest), reindexMode });
      }
      const finalizedHead = latest - CONFIRM_DEPTH;
      let startBlock = BigInt(cursor?.last_block_number||0) + 1n;
      if(startBlock < deployBlock) startBlock = deployBlock;
      if(startBlock > finalizedHead){
        await finalizeRun(0,0,0,0,(reindexMode?'reindex_freeze ':'')+'store_all up_to_date');
        return json({ status:'up_to_date', cursor, reindexMode });
      }
      const endBlock = startBlock + BigInt(maxBlocks);
      const toBlock = endBlock > finalizedHead ? finalizedHead : endBlock;
  let inserted=0; // logical processed rows (used for rowCap & advancement semantics)
  let actualInserted=0; // true rows written (meta.changes sum) for diagnostics
  let uniqueTopics=new Set(); let firstBlock=null; let lastBlock=null; let attempted=0; const insertErrors=[];
      const REQUESTED_BATCH = Math.min(Math.max(Number(body.batchSize||150), 25), 500); // clamp 25..500
  const VARS_PER_ROW = 9; // placeholders per row (block_number, log_index, tx_hash, address, topic0..topic3, data)
  // D1 bound parameter limit is 100 (Docs: D1 Limits – "Maximum bound parameters per query | 100").
  // Keep a small safety margin (<=100) by using 100 exactly and ensuring we never exceed.
  const D1_PARAM_LIMIT = 100;
  // Compute safe initial batch rows so rows * VARS_PER_ROW <= D1_PARAM_LIMIT.
  const SAFE_ROWS = Math.max(1, Math.floor(D1_PARAM_LIMIT / VARS_PER_ROW)); // floor(100/9)=11
  let adaptiveBatch = Math.min(REQUESTED_BATCH, SAFE_ROWS);
  let pending=[]; let batchFlushes=0; let batchShrinks=0;
  const writeLegacy = !reindexMode; // freeze prevents advancing or mutating legacy raw_logs
  const writeShadow = reindexMode || dualRaw;
  async function flush(){
        if(!pending.length) return;
        // We may need to split pending into sub-batches that fit the variable limit.
        let local = pending; pending=[];
        let idx=0;
        while(idx < local.length){
          let sliceSize = Math.min(adaptiveBatch, local.length - idx);
          const slice = local.slice(idx, idx+sliceSize);
          const flat=[]; for(const p of slice){ flat.push(...p); }
          const placeholders = slice.map(()=> '(?,?,?,?,?,?,?,?,?)').join(',');
          const sqlLegacy = `INSERT OR IGNORE INTO raw_logs (block_number, log_index, tx_hash, address, topic0, topic1, topic2, topic3, data) VALUES ${placeholders}`;
          const sqlShadow = `INSERT OR IGNORE INTO raw_logs_new (block_number, log_index, tx_hash, address, topic0, topic1, topic2, topic3, data) VALUES ${placeholders}`;
          try {
            if(sliceSize * VARS_PER_ROW > D1_PARAM_LIMIT){ throw new Error('synthetic_var_limit'); }
            if(writeLegacy){
              const r = await env.INDEX_DB.prepare(sqlLegacy).bind(...flat).run();
              // Only count rows actually inserted to avoid masking duplicate-only batches
              const changes = (r && r.meta && typeof r.meta.changes === 'number') ? r.meta.changes : 0;
              inserted += changes;
              actualInserted += changes;
            }
            if(writeShadow){
              try { await env.INDEX_DB.prepare(sqlShadow).bind(...flat).run(); } catch { /* ignore shadow errors */ }
              if(!writeLegacy){ inserted += slice.length; }
            }
            idx += sliceSize; batchFlushes++;
            // Heartbeat: update rows_so_far & last_progress_at (throttled to >=5s) so UI can reflect mid-run progress
            if(runId){
              try {
                if(!globalThis.__lastHeartbeatTs) globalThis.__lastHeartbeatTs = 0;
                const nowTs = Date.now();
                if(nowTs - globalThis.__lastHeartbeatTs >= 5000){
                  globalThis.__lastHeartbeatTs = nowTs;
                  await env.INDEX_DB.prepare("UPDATE indexer_run SET rows_so_far=?, last_progress_at=CURRENT_TIMESTAMP WHERE id=?").bind(inserted, runId).run();
                }
              } catch { /* ignore heartbeat errors */ }
            }
          } catch(e){
            const msg = String(e);
            if((msg.includes('too many SQL variables') || msg.includes('synthetic_var_limit')) && sliceSize > 1){
              // shrink and retry without advancing idx
              const newSize = Math.max(1, Math.floor(sliceSize/2));
              if(newSize < adaptiveBatch) adaptiveBatch = newSize; // global adaptive reduction
              batchShrinks++;
              continue; // retry with smaller sliceSize (loop recalculates)
            } else {
              insertErrors.push(msg.slice(0,160));
              idx += sliceSize; batchFlushes++;
            }
          }
        }
      }
  async function handleLogs(logs){
        for(const log of logs){
          if(inserted + pending.length >= rowCap) break;
          const bn = Number(BigInt(log.blockNumber)); if(firstBlock===null) firstBlock=bn; lastBlock=bn;
          const t0 = (log.topics&&log.topics[0])? log.topics[0] : null; uniqueTopics.add((t0||'').toLowerCase());
          // Optional table allowlist filtering (skip non-whitelisted tableId logs)
          if(env.INDEXER_TABLE_ALLOWLIST === '1'){
            const tableId = (log.topics && log.topics[1]) ? log.topics[1].toLowerCase() : null;
            if(tableId && !TABLE_ALLOWLIST_SET.has(tableId)){
              globalThis.__skippedAllowlist = (globalThis.__skippedAllowlist||0)+1;
              continue;
            }
          }
          attempted++;
          pending.push([bn, Number(log.logIndex||0), log.transactionHash||'', (log.address||'').toLowerCase(), t0, log.topics?.[1]||null, log.topics?.[2]||null, log.topics?.[3]||null, log.data||'0x']);
          if(pending.length >= adaptiveBatch) await flush();
        }
      }
      // Guard: limit total RPC subrequests per invocation to reduce risk of 1101 (Too many API requests) errors.
      const MAX_SEG_REQ = 40; // soft cap for eth_getLogs calls in one invocation
  let segRequests=0; let segmentsProcessed=0; let truncated=false; let segmentBlocksUsed=segmentBlocks||0;
      try {
        if(segmentBlocks && segmentBlocks > 0){
          let segFrom = startBlock;
          let dynamicSeg = BigInt(segmentBlocks);
          const MIN_SEG_BLOCKS = 25n; // lowest fallback segment size
          const SEG_SHRINK_FACTOR = 2n; // divide by 2 on failures
          const MAX_SEGMENT_RETRIES = 5; // per failing segment range
          let segmentRetries=0; // total retry attempts across run
          let rpcFailures=0; // count of RPC failures (5xx/timeouts) encountered
          while(segFrom <= toBlock && (inserted + pending.length) < rowCap){
            if(maxSegments && segmentsProcessed >= maxSegments){ truncated=true; break; }
            if(segRequests >= MAX_SEG_REQ){ truncated=true; break; }
            const remainingBlocks = (toBlock - segFrom) + 1n;
            if(dynamicSeg > remainingBlocks) dynamicSeg = remainingBlocks;
            if(dynamicSeg <= 0) break;
            let segTo = segFrom + dynamicSeg - 1n;
            let fetched=false; let segLogs=null; let attempt=0; let localSegSize=dynamicSeg;
            while(!fetched && attempt <= MAX_SEGMENT_RETRIES){
              attempt++;
              try {
                segLogs = await rpc('eth_getLogs',[{ address: WORLD, fromBlock:'0x'+segFrom.toString(16), toBlock:'0x'+segTo.toString(16) }]);
                segRequests++; fetched=true;
              } catch(segErr){
                rpcFailures++;
                const msg = String(segErr);
                // Shrink segment and retry if possible
                if(localSegSize > MIN_SEG_BLOCKS){
                  localSegSize = localSegSize / SEG_SHRINK_FACTOR;
                  if(localSegSize < MIN_SEG_BLOCKS) localSegSize = MIN_SEG_BLOCKS;
                  segTo = segFrom + localSegSize - 1n;
                  dynamicSeg = localSegSize; // propagate smaller size for subsequent segments
                  segmentRetries++;
                  continue; // retry
                }
                // If already at minimum size, abort this run with partial progress finalize later
                await flush();
                const advanceTo = (inserted < rowCap) ? Number(segFrom-1n) : Number(segTo);
                if(inserted){ try { await env.INDEX_DB.prepare("UPDATE event_cursor SET last_block_number=?, updated_at=CURRENT_TIMESTAMP WHERE id=1").bind(advanceTo).run(); } catch { /* ignore */ } }
                return json({ error:'log_fetch_failed', message:'segment_error:'+msg, inserted, attempted, batchFlushes, segment:{ from:Number(segFrom), to:Number(segTo) }, segRequests, segmentsProcessed, truncated, segmentRetries, rpcFailures });
              }
            }
            if(!fetched){
              await flush();
              return json({ error:'log_fetch_failed', message:'segment_retry_exhausted', inserted, attempted, batchFlushes, segment:{ from:Number(segFrom), to:Number(segTo) }, segRequests, segmentsProcessed, truncated, segmentRetries, rpcFailures });
            }
            await handleLogs(segLogs);
            segmentsProcessed++;
            if(throttleMs > 0){ await new Promise(r=> setTimeout(r, throttleMs)); }
            segFrom = segTo + 1n;
            if((inserted + pending.length) >= rowCap) break;
          }
          // attach retry metrics to outer scope for finalizeRun usage (store on globalThis temp)
          globalThis.__segmentRetries = (globalThis.__segmentRetries||0) + (typeof segmentRetries==='number'? segmentRetries:0);
          globalThis.__rpcFailures = (globalThis.__rpcFailures||0) + (typeof rpcFailures==='number'? rpcFailures:0);
        } else {
          const logs = await rpc('eth_getLogs',[{ address: WORLD, fromBlock:'0x'+startBlock.toString(16), toBlock:'0x'+toBlock.toString(16) }]);
          segRequests=1; segmentsProcessed=1; await handleLogs(logs);
        }
      } catch(e){
        await flush();
        await finalizeRun(inserted, segRequests, batchFlushes, adaptiveBatch, 'store_all log_fetch_failed '+String(e).slice(0,80));
        return json({ error:'log_fetch_failed', message:String(e), inserted, attempted, batchFlushes, segRequests, segmentsProcessed, truncated });
      }
      await flush();
      // Persist live metrics (seg_requests_so_far, batch_flushes, adaptive_batch_current) mid-run best-effort
  if(runId){ try { await env.INDEX_DB.prepare("UPDATE indexer_run SET seg_requests_so_far=?, batch_flushes=?, adaptive_batch_current=?, attempted_logs=COALESCE(?,attempted_logs) WHERE id=?").bind(segRequests, batchFlushes, adaptiveBatch, attempted, runId).run(); } catch {/* ignore */} }
      // Duplicate-only segment handling: if we attempted logs and inserted none, probe coverage.
      if(attempted>0 && actualInserted===0 && writeLegacy){
        let coverageCount=null; let coverageOk=false; let probeErr=null;
        try {
          const cov = await env.INDEX_DB.prepare("SELECT COUNT(1) AS c FROM raw_logs WHERE block_number BETWEEN ? AND ?")
            .bind(Number(startBlock), Number(toBlock)).all();
          coverageCount = cov.results?.[0]?.c ?? 0;
          if(coverageCount >= attempted * 0.98){ // allow 2% tolerance
            coverageOk = true;
          }
        } catch(e){ probeErr = String(e).slice(0,120); }
        if(coverageOk){
          try {
            await env.INDEX_DB.prepare("UPDATE event_cursor SET last_block_number=?, updated_at=CURRENT_TIMESTAMP WHERE id=1")
              .bind(Number(toBlock)).run();
            const c2 = await env.INDEX_DB.prepare("SELECT id, last_block_number, last_log_index, updated_at FROM event_cursor WHERE id=1").all();
            cursor = c2.results?.[0] || cursor;
          } catch { /* ignore cursor advance errors */ }
          await finalizeRun(0, segRequests, batchFlushes, adaptiveBatch, 'store_all ok_duplicate '+Number(startBlock)+'-'+Number(toBlock)+' cov:'+coverageCount);
          return json({ status:'ok_duplicate', cursor, range:{ from:Number(startBlock), to:Number(toBlock) }, attempted, coverageCount, coverageTolerance:0.98, adaptiveBatch, batchShrinks, batchFlushes, segRequests, segmentsProcessed, truncated, uniqueTopics: Array.from(uniqueTopics), topicCount: uniqueTopics.size, bypassAuth, segmentBlocksRequested: segmentBlocks||0, rpcFailures: globalThis.__rpcFailures||0, segmentRetries: globalThis.__segmentRetries||0, skippedAllowlist: globalThis.__skippedAllowlist||0, allowlistEnabled: env.INDEXER_TABLE_ALLOWLIST === '1' });
        }
        await finalizeRun(0, segRequests, batchFlushes, adaptiveBatch, 'store_all batch_insert_failed shrinks:'+batchShrinks+' errs:'+insertErrors.length+' cov:'+(coverageCount??'null')+' probeErr:'+(probeErr||'')+' firstErr:'+(insertErrors[0]||''));
        return json({ status:'batch_insert_failed', retry:true, cursor, range:{ from:Number(startBlock), to:Number(toBlock) }, inserted, actualInserted, attempted, adaptiveBatch, batchShrinks, batchFlushes, coverageCount, probeErr, insertErrorCount: insertErrors.length, firstInsertError: insertErrors[0]||null, uniqueTopics: Array.from(uniqueTopics), topicCount: uniqueTopics.size, rowCapApplied: rowCap, bypassAuth, segRequests, segmentsProcessed, truncated, segmentBlocksRequested: segmentBlocks||0, rpcFailures: globalThis.__rpcFailures||0, segmentRetries: globalThis.__segmentRetries||0 });
      }
      if(!reindexMode){
        const advanceTo = (inserted < rowCap) ? Number(toBlock) : (lastBlock!==null? lastBlock: Number(toBlock));
        if(inserted>0){
          await env.INDEX_DB.prepare("UPDATE event_cursor SET last_block_number=?, updated_at=CURRENT_TIMESTAMP WHERE id=1").bind(advanceTo).run();
          const c2 = await env.INDEX_DB.prepare("SELECT id, last_block_number, last_log_index, updated_at FROM event_cursor WHERE id=1").all();
          cursor = c2.results?.[0] || cursor;
        }
      }
    await finalizeRun(inserted, segRequests, batchFlushes, adaptiveBatch, 'store_all raw '+inserted+' batches:'+batchFlushes+' shrinks:'+batchShrinks+' segReq:'+segRequests);
  return json({ status:'ok', mode:'store_all', cursor, range:{ from:Number(startBlock), to:Number(toBlock) }, inserted, actualInserted, attempted, adaptiveBatchInitial:REQUESTED_BATCH, adaptiveBatchFinal:adaptiveBatch, batchShrinks, batchFlushes, insertErrorCount: insertErrors.length, firstInsertError: insertErrors[0]||null, uniqueTopics: Array.from(uniqueTopics), topicCount: uniqueTopics.size, rowCapApplied: rowCap, blocks:{ first:firstBlock, last:lastBlock }, bypassAuth, segRequests, segmentsProcessed, truncated, segmentBlocksRequested: segmentBlocks||0, reindexMode, dualRaw, rpcFailures: globalThis.__rpcFailures||0, segmentRetries: globalThis.__segmentRetries||0, skippedAllowlist: globalThis.__skippedAllowlist||0, allowlistEnabled: env.INDEXER_TABLE_ALLOWLIST === '1' });
    } catch(e){
      // Attempt to finalize with whatever progress we tracked (heartbeat may have updated rows_so_far already)
      try { await finalizeRun(null, null, null, null, 'store_all unhandled '+String(e).slice(0,80)); } catch{/* ignore */}
      return json({ error:'store_all_unhandled', message:String(e) },500);
    }
  }
  if(extendedMode === 'store'){
    const RPC = env.PYROPE_RPC || body.rpc || '';
    const WORLD = (env.WORLD_ADDRESS || body.world || '').toLowerCase();
    if(!RPC || !WORLD) return json({ error:'missing_rpc_or_world' },400);
    const CONFIRM_DEPTH = BigInt(env.CONFIRM_DEPTH || body.confirmDepth || 8);
    const deployBlock = BigInt(env.DEPLOY_BLOCK || body.deployBlock || 0);
    const maxBlocks = Math.min(Number(body.maxBlocks||3000),10000);
    const providedTopics = Array.isArray(body.topics)? body.topics : null;
    if(!providedTopics) return json({ error:'missing_topics_prehashed' },400);
    async function rpc(method, params){
      const r = await fetch(RPC,{ method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ jsonrpc:'2.0', id:1, method, params }) });
      if(!r.ok) throw new Error('rpc_http_'+r.status);
      const j = await r.json(); if(j.error) throw new Error('rpc_'+j.error.message);
      return j.result;
    }
    let latestHex; try { latestHex = await rpc('eth_blockNumber', []); } catch(e){ return json({ error:'head_fetch_failed', message:String(e) },502); }
    const latest = BigInt(latestHex);
    if(latest < deployBlock + CONFIRM_DEPTH) return json({ status:'head_too_low', latest:Number(latest) });
    const finalizedHead = latest - CONFIRM_DEPTH;
    let startBlock = BigInt(cursor?.last_block_number||0) + 1n;
    if(startBlock < deployBlock) startBlock = deployBlock;
    if(startBlock > finalizedHead) return json({ status:'up_to_date', cursor });
    const endBlock = startBlock + BigInt(maxBlocks);
    const toBlock = endBlock > finalizedHead ? finalizedHead : endBlock;
    let rawEvents=0, newTables=0, existingTables=0;
    for(const topic of providedTopics){
      try {
        const logs = await rpc('eth_getLogs',[{ address: WORLD, topics:[topic], fromBlock:'0x'+startBlock.toString(16), toBlock:'0x'+toBlock.toString(16) }]);
        for(const log of logs){
          rawEvents++;
          const tableId = (log.topics && log.topics[1])? log.topics[1].toLowerCase():null; if(!tableId) continue;
          try { await env.INDEX_DB.prepare("INSERT INTO store_events (block_number, log_index, tx_hash, topic0, table_id, key_hex, field_index, value_hex, ephemeral) VALUES (?,?,?,?,?,?,?,?,?)")
            .bind(Number(BigInt(log.blockNumber)), log.logIndex||0, log.transactionHash||'', log.topics[0]||'', tableId, (log.topics?.[2]||''), null, log.data||'', topic.includes('ephemeral')?1:0).run(); } catch{}
          const existing = await env.INDEX_DB.prepare("SELECT table_id FROM table_registry WHERE table_id=?").bind(tableId).all();
          if(existing.results?.length){
            existingTables++; await env.INDEX_DB.prepare("UPDATE table_registry SET last_block=?, appearances=appearances+1 WHERE table_id=?").bind(Number(BigInt(log.blockNumber)), tableId).run();
          } else {
            newTables++; await env.INDEX_DB.prepare("INSERT INTO table_registry (table_id, first_block, last_block, appearances, finalized) VALUES (?,?,?,?,0)")
              .bind(tableId, Number(BigInt(log.blockNumber)), Number(BigInt(log.blockNumber)), 1).run();
          }
        }
      } catch{ /* ignore per-topic errors */ }
    }
    await env.INDEX_DB.prepare("UPDATE table_registry SET finalized=1 WHERE finalized=0 AND last_block <= ?").bind(Number(finalizedHead)).run();
    await env.INDEX_DB.prepare("UPDATE event_cursor SET last_block_number=?, updated_at=CURRENT_TIMESTAMP WHERE id=1").bind(Number(toBlock)).run();
    const c2 = await env.INDEX_DB.prepare("SELECT id, last_block_number, last_log_index, updated_at FROM event_cursor WHERE id=1").all();
    cursor = c2.results?.[0] || cursor;
    if(runId){ const durRes = await env.INDEX_DB.prepare("SELECT (julianday(CURRENT_TIMESTAMP)-julianday(run_started_at))*86400000 AS ms FROM indexer_run WHERE id=?").bind(runId).all(); const ms = Math.max(0, Math.round(durRes.results?.[0]?.ms||0)); await env.INDEX_DB.prepare("UPDATE indexer_run SET run_finished_at=CURRENT_TIMESTAMP, run_duration_ms=?, rows_added=?, rows_updated=? , notes=? WHERE id=?").bind(ms, rawEvents, newTables, 'store events '+rawEvents, runId).run(); }
  return json({ status:'ok', mode:'store', cursor, range:{ from:Number(startBlock), to:Number(toBlock) }, rawEvents, newTables, existingTables, topics: providedTopics.length, bypassAuth });
  }
  // Stub simulation branch
  const fromBlock = (cursor?.last_block_number||0)+1;
  let highestBlock = cursor?.last_block_number||0;
  const simCount = Math.min(3, Math.max(1, Number(body.simEvents)||2));
  const events=[];
  for(let i=0;i<simCount;i++){ const blk = fromBlock + i; highestBlock=Math.max(highestBlock, blk); const gate=(i%2===0); events.push({ type:'assembly_upsert', id:`sim_${blk}_${i}`, systemId:1000+i, owner:'0xowner', state:'online', name:`Sim Assembly ${i}`, hash:`h${blk}_${i}`, blockNumber:blk, gate: gate? { directions:[{ origin_system_id:1000+i, destination_system_id:2000+i, linked:1, online:1, traversal_cost:0 }] }: null }); }
  let assemblies_scanned=0, rows_added=0, rows_updated=0, rows_removed=0, gate_edges_rebuilt=0, error_count=0; const errors=[];
  for(const ev of events){
    if(ev.type==='assembly_upsert'){
      assemblies_scanned++;
      try {
        const existing = await env.INDEX_DB.prepare("SELECT id, hash FROM smart_assembly WHERE id=?").bind(ev.id).all();
        if(existing.results?.length){ const ex=existing.results[0]; if(ex.hash!==ev.hash){ await env.INDEX_DB.prepare("UPDATE smart_assembly SET state=?, name=?, system_id=?, owner_address=?, last_seen_at=CURRENT_TIMESTAMP, hash=? WHERE id=?").bind(ev.state||'online', ev.name||'', ev.systemId||0, ev.owner||'', ev.hash, ev.id).run(); rows_updated++; } else { await env.INDEX_DB.prepare("UPDATE smart_assembly SET last_seen_at=CURRENT_TIMESTAMP WHERE id=?").bind(ev.id).run(); } }
        else { await env.INDEX_DB.prepare("INSERT INTO smart_assembly (id, world_version, type, state, name, system_id, owner_address, owner_name, type_id, energy_usage, hash, last_seen_at) VALUES (?, ?, ?, ?, ?, ?, ?, '', NULL, 0, ?, CURRENT_TIMESTAMP)").bind(ev.id, worldId, 'generic', ev.state||'online', ev.name||'', ev.systemId||0, ev.owner||'', ev.hash).run(); rows_added++; }
        if(ev.gate && Array.isArray(ev.gate.directions)){ await env.INDEX_DB.prepare("DELETE FROM smart_gate_direction WHERE gate_id=?").bind(ev.id).run(); for(const d of ev.gate.directions){ try { await env.INDEX_DB.prepare("INSERT INTO smart_gate_direction (gate_id, world_version, origin_system_id, destination_system_id, linked, online, traversal_cost) VALUES (?,?,?,?,?,?,?)").bind(ev.id, worldId, d.origin_system_id||0, d.destination_system_id||0, d.linked?1:0, d.online?1:0, d.traversal_cost||0).run(); gate_edges_rebuilt++; } catch(inner){ errors.push(String(inner).slice(0,120)); error_count++; } } }
      } catch(e2){ errors.push(String(e2).slice(0,160)); error_count++; }
    }
  }
  if(events.length && assemblies_scanned){ if(highestBlock > (cursor?.last_block_number||0)){ await env.INDEX_DB.prepare("UPDATE event_cursor SET last_block_number=?, updated_at=CURRENT_TIMESTAMP WHERE id=1").bind(highestBlock).run(); const c2 = await env.INDEX_DB.prepare("SELECT id, last_block_number, last_log_index, updated_at FROM event_cursor WHERE id=1").all(); cursor = c2.results?.[0] || cursor; } }
  if(runId){ const durRes = await env.INDEX_DB.prepare("SELECT (julianday(CURRENT_TIMESTAMP)-julianday(run_started_at))*86400000 AS ms FROM indexer_run WHERE id=?").bind(runId).all(); const ms = Math.max(0, Math.round(durRes.results?.[0]?.ms||0)); const notes = errors.length? `processed with ${errors.length} errors`:'ok'; await env.INDEX_DB.prepare("UPDATE indexer_run SET run_finished_at=CURRENT_TIMESTAMP, run_duration_ms=?, assemblies_scanned=?, rows_added=?, rows_updated=?, rows_removed=?, gate_edges_rebuilt=?, error_count=?, notes=? WHERE id=?").bind(ms, assemblies_scanned, rows_added, rows_updated, rows_removed, gate_edges_rebuilt, error_count, notes, runId).run(); }
  const runRow = await env.INDEX_DB.prepare("SELECT id, run_started_at, run_finished_at, mode, run_duration_ms, assemblies_scanned, rows_added, rows_updated, rows_removed, gate_edges_rebuilt, error_count FROM indexer_run WHERE id=?").bind(runId).all();
  return json({ status:'ok', mode: extendedMode, modeInput, cursor, run: runRow.results?.[0]||null });
}

// Manual trigger endpoint: starts a store_all ingestion run unless one already in progress.
// Lightweight auth identical to /api/indexer-ingest (admin token or preview bypass). Returns early if a run is active.
async function handleIndexerTrigger(req, env){
  if(req.method !== 'POST') return json({ error:'Method Not Allowed' },405);
  if(!env.INDEX_DB) return json({ error:'INDEX_DB binding missing' },500);
  // Reuse auth pattern (token or preview bypass) without requiring body.
  const token = req.headers.get('X-Indexer-Admin');
  const authDisabled = env.INDEXER_AUTH_DISABLED === '1';
  const expected = (env.INDEXER_ADMIN_TOKEN||'').trim();
  const host = req.headers.get('host')||'';
  const isPreviewHost = host.endsWith('.pages.dev');
  let bypassAuth=false;
  try { const urlObj = new URL(req.url); bypassAuth = isPreviewHost && urlObj.searchParams.get('openPreview')==='1' && (!!expected ? token?.trim() !== expected : !token); } catch {}
  if(!authDisabled && expected && token?.trim() !== expected && !bypassAuth) return json({ error:'Unauthorized' },401);
  // Detect in-progress run (no finished_at yet) to avoid overlapping heavy RPC bursts.
  try {
    const active = await env.INDEX_DB.prepare("SELECT id, mode, run_started_at FROM indexer_run WHERE run_finished_at IS NULL ORDER BY id DESC LIMIT 1").all();
    const running = active.results?.[0] || null;
  if(running){
      // Extended watchdog: consider progress heartbeat (last_progress_at) if column exists
      let lastProgressTs=null;
      try {
        const lp = await env.INDEX_DB.prepare("SELECT last_progress_at FROM indexer_run WHERE id=?").bind(running.id).all();
        lastProgressTs = lp.results?.[0]?.last_progress_at || null;
      } catch { /* ignore if column not present */ }
      // Auto-finalize stale runs >25 minutes old to clear stuck state (e.g., prior worker eviction mid-run)
      try {
        const started = new Date(running.run_started_at + 'Z'); // treat as UTC
        const ageMs = Date.now() - started.getTime();
        const STALE_MS = parseInt(env.INDEXER_STALE_AGE_MS||'1500000',10); // default 25m
        const NO_PROGRESS_MS = parseInt(env.INDEXER_STALL_NO_PROGRESS_MS||'120000',10); // default 2m
        let noProgress=false;
        if(lastProgressTs){
          const lpDate = new Date(lastProgressTs + (lastProgressTs.endsWith('Z')?'':'Z'));
            if(!isNaN(lpDate.getTime())){
              const since = Date.now() - lpDate.getTime();
              if(since > NO_PROGRESS_MS) noProgress=true;
            }
        }
        if(!isNaN(ageMs) && ageMs > STALE_MS){
          await env.INDEX_DB.prepare("UPDATE indexer_run SET run_finished_at=CURRENT_TIMESTAMP, run_duration_ms=COALESCE(run_duration_ms, ?) , notes=COALESCE(notes,'auto-finalized_stale') WHERE id=?")
            .bind(ageMs, running.id).run();
        } else if(noProgress){
          // finalize due to missing heartbeat; increment stall_restarts counter
          try { await env.INDEX_DB.prepare("UPDATE indexer_run SET run_finished_at=CURRENT_TIMESTAMP, notes=COALESCE(notes,'auto-finalized_no_progress'), stall_restarts=COALESCE(stall_restarts,0)+1, run_duration_ms=COALESCE(run_duration_ms, (julianday(CURRENT_TIMESTAMP)-julianday(run_started_at))*86400000) WHERE id=?").bind(running.id).run(); } catch {/* ignore */}
          // Emit stall_restart usage metric (best-effort, no failure propagation)
          try {
            if(env.EF_STATS){
              const day = new Date().toISOString().slice(0,10);
              const dailyKey = 'daily/'+day+'.json';
              async function loadSnap(k){ const raw = await env.EF_STATS.get(k); if(!raw) return { version:1, updatedAt:new Date().toISOString(), counters:{}, sums:{} }; try { return JSON.parse(raw); } catch { return { version:1, updatedAt:new Date().toISOString(), counters:{}, sums:{} }; } }
              const cur = await loadSnap('current'); const daily = await loadSnap(dailyKey);
              cur.counters.stall_restarts = (cur.counters.stall_restarts||0)+1;
              daily.counters.stall_restarts = (daily.counters.stall_restarts||0)+1;
              await env.EF_STATS.put('current', JSON.stringify(cur));
              await env.EF_STATS.put(dailyKey, JSON.stringify(daily));
            }
          } catch { /* ignore metric errors */ }
        } else {
          return json({ status:'in_progress', run: running, bypassAuth });
        }
      } catch { return json({ status:'in_progress', run: running, bypassAuth, warn:'auto_finalize_failed' }); }
    }
  } catch { /* ignore presence errors */ }
  // Delegate to ingestion handler with mode store_all (raw capture). We construct a synthetic Request so handler logic (including auth bypass) is reused.
  // Inject chain params from env if available so manual trigger doesn't require JSON body each time.
  const bodyPayload = { mode:'store_all' };
  if(env.PYROPE_RPC) bodyPayload.rpc = env.PYROPE_RPC;
  if(env.WORLD_ADDRESS) bodyPayload.world = env.WORLD_ADDRESS;
  if(env.DEPLOY_BLOCK) bodyPayload.deployBlock = parseInt(env.DEPLOY_BLOCK,10)||env.DEPLOY_BLOCK;
  // Reuse cron tuning vars if present so manual trigger mirrors autonomous scheduled window
  if(env.INDEXER_CRON_MAX_BLOCKS) bodyPayload.maxBlocks = parseInt(env.INDEXER_CRON_MAX_BLOCKS,10)||env.INDEXER_CRON_MAX_BLOCKS;
  if(env.INDEXER_CRON_SEGMENT_BLOCKS) bodyPayload.segmentBlocks = parseInt(env.INDEXER_CRON_SEGMENT_BLOCKS,10)||env.INDEXER_CRON_SEGMENT_BLOCKS;
  if(env.INDEXER_CRON_ROW_CAP) bodyPayload.rowCap = parseInt(env.INDEXER_CRON_ROW_CAP,10)||env.INDEXER_CRON_ROW_CAP;
  const triggerReq = new Request(req.url, { method:'POST', headers:{ 'content-type':'application/json', ...(token? { 'X-Indexer-Admin': token }: {}) }, body: JSON.stringify(bodyPayload) });
  return handleIndexerIngest(triggerReq, env);
}

// Temporary debug: report whether secret is bound (no actual value leak)
function handleIndexerSecretDebug(env){
  const val = env.INDEXER_ADMIN_TOKEN || '';
  const info = val ? {
    present: true,
    length: val.length,
    startsWith: val.slice(0,4),
    endsWith: val.slice(-4),
    sha256: (()=>{ try { return Array.from(new Uint8Array(crypto.subtle.digestSync ? crypto.subtle.digestSync('SHA-256', new TextEncoder().encode(val)) : []))
      .map(b=>b.toString(16).padStart(2,'0')).join('').slice(0,16)+'…'; } catch { return 'unavailable'; } })()
  } : { present:false };
  return json({ secret: info });
}

function upgradeSnapshot(s){
  if(!s.version || s.version < SCHEMA_VERSION){
    if(s.sums){ delete s.sums.scout_baseline_time_ms_sum; delete s.sums.scout_baseline_time_count; }
    s.version = SCHEMA_VERSION;
  }
}

async function loadSnapshot(kv, key){
  const raw = await kv.get(key);
  if(!raw){
    if(key==='current') return { version:1, updatedAt:new Date().toISOString(), counters:{}, sums:{} };
    return { version:1, updatedAt:new Date().toISOString(), counters:{}, sums:{}, date: key.startsWith('daily/')? key.slice(6): undefined };
  }
  try { return JSON.parse(raw); } catch { return { version:1, updatedAt:new Date().toISOString(), counters:{}, sums:{} }; }
}
// Apply a usage event definition to a snapshot in-place. Returns true if applied.
function applyEvent(snapshot, type, body){
  const def = EVENT_MAP.get(type); if(!def) return false;
  snapshot.updatedAt = new Date().toISOString();
  if(def.counters){ def.counters.forEach(k=>{ snapshot.counters[k] = (snapshot.counters[k]||0)+1; }); }
  if(def.extraCounters){ (def.extraCounters(body||{})||[]).forEach(k=>{ snapshot.counters[k] = (snapshot.counters[k]||0)+1; }); }
  if(def.countersDynamic){ (def.countersDynamic(body||{})||[]).forEach(k=>{ snapshot.counters[k] = (snapshot.counters[k]||0)+1; }); }
  if(def.sum){ const v = Number(body?.[def.sum.valueField]); if(isFinite(v) && v>=0){ snapshot.sums[def.sum.key] = (snapshot.sums[def.sum.key]||0)+v; snapshot.sums[def.sum.countKey] = (snapshot.sums[def.sum.countKey]||0)+1; } }
  return true;
}
async function handleUsageEvent(req, env){
  if(req.method !== 'POST') return new Response('Method Not Allowed',{ status:405 });
  let body={}; try { body = req.headers.get('content-type')?.includes('application/json') ? await req.json():{}; } catch { return new Response('Invalid JSON',{ status:400 }); }
  const { type } = body;
  if(typeof type !== 'string') return new Response('Missing type',{ status:400 });
  if(!EVENT_MAP.has(type)) return new Response('Unknown type',{ status:400 });
  const current = await loadSnapshot(env.EF_STATS,'current'); upgradeSnapshot(current);
  const day = new Date().toISOString().slice(0,10); const dailyKey = 'daily/'+day+'.json';
  const daily = await loadSnapshot(env.EF_STATS,dailyKey); upgradeSnapshot(daily);
  if(applyEvent(current,type, body) && applyEvent(daily,type, body)){
    await env.EF_STATS.put('current', JSON.stringify(current));
    await env.EF_STATS.put(dailyKey, JSON.stringify(daily));
  }
  return new Response(null,{ status:204 });
}
// Share creation endpoint
async function handleCreateShare(req, env){
  if(req.method !== 'POST') return json({ error:'Method Not Allowed' },405);
  if(!env.EF_SHARES) return json({ error:'EF_SHARES KV not bound' },500);
  let body={}; try { if(req.headers.get('content-type')?.includes('application/json')) body = await req.json(); } catch { return json({ error:'Invalid JSON' },400); }
  const { data, preferId } = body||{};
  if(typeof data !== 'string' || !data.trim()) return json({ error:'Missing data' },400);
  if(!data.startsWith('r1|')) return json({ error:'Invalid share payload' },400);
  let id = typeof preferId==='string'? preferId.slice(0,16).replace(/[^A-Za-z0-9_-]/g,''):'';
  if(!id) id = crypto.randomUUID().replace(/-/g,'').slice(0,10);
  for(let i=0;i<5;i++){
    const existing = await env.EF_SHARES.get(id);
    if(existing !== null){ id = crypto.randomUUID().replace(/-/g,'').slice(0,10); continue; }
    await env.EF_SHARES.put(id, data);
    return json({ id });
  }
  return json({ error:'Could not allocate id' },500);
}

async function handleGetShare(url, env){
  const id = url.searchParams.get('id');
  if(!id) return json({ error:'Missing id' },400);
  const value = await env.EF_SHARES.get(id);
  if(value === null) return json({ error:'Not found' },404);
  return json({ data:value });
}

async function handleStats(url, env){
  if(!env.EF_STATS){
    return json({ error:'EF_STATS KV not bound', current:{ version:SCHEMA_VERSION, updatedAt:new Date().toISOString(), counters:{}, sums:{} }, history:[] },500);
  }
  let raw = await env.EF_STATS.get('current');
  if(!raw) raw = JSON.stringify({ version:1, updatedAt:new Date().toISOString(), counters:{}, sums:{} });
  const histParam = url.searchParams.get('history');
  let history=[]; let histDays=0; if(histParam){ histDays=Math.min(120,Math.max(1,parseInt(histParam,10)||0)); }
  const debug = url.searchParams.get('debug')==='1';
  let foundKeys=[];
  if(histDays>0){
    try {
      let cursor=null; const all=[];
      do {
        const list = await env.EF_STATS.list({ prefix:'daily/', cursor });
        list.keys.forEach(k=>{ if(k.name.endsWith('.json')) all.push(k.name); });
        cursor = list.list_complete? null : list.cursor;
      } while(cursor);
      all.sort();
      const filtered = all.filter(k=>!k.endsWith('.json.json'));
      foundKeys = filtered.slice(-histDays);
      for(const k of foundKeys){
        try { const text = await env.EF_STATS.get(k); if(text){ history.push(JSON.parse(text)); } }
        catch(e){ if(debug){ history.push({ date:k.split('/').pop(), parse_error:true, message:String(e).slice(0,80) }); } }
      }
      // Ensure "today" appears in history even if no events have fired yet (synthetic zero snapshot)
      try {
        const today = new Date().toISOString().slice(0,10);
        const todayKey = 'daily/'+today+'.json';
        const haveTodayKey = foundKeys.includes(todayKey);
        const haveTodayInHistory = history.some(h=>{
          const d = (h && typeof h==='object') ? (h.date ? String(h.date).replace(/\.json$/,'') : (h.updatedAt? String(h.updatedAt).slice(0,10): '')) : '';
          return d === today;
        });
        if(!haveTodayKey && !haveTodayInHistory){
          history.push({ version: SCHEMA_VERSION, updatedAt: new Date().toISOString(), counters:{}, sums:{}, date: today });
          // Do not mutate KV; this is a view-only placeholder so charts/table include today's row.
        }
      } catch { /* ignore synthetic today errors */ }
    } catch(e){ if(debug){ history.push({ error:'list_failed', message:String(e) }); } }
  }
  if(debug){
    return json({ current: JSON.parse(raw), history, debug:{ mode:'list', requestedDays: histDays, foundDailyKeys: foundKeys } });
  }
  return json({ current: JSON.parse(raw), history });
}

async function handleListStats(env){
  if(!env.EF_STATS) return json({ error:'EF_STATS KV not bound' },500);
  const out={ daily:[], other:[] };
  try {
    let cursor=null; do {
      const list = await env.EF_STATS.list({ cursor });
      list.keys.forEach(k=>{ if(k.name.startsWith('daily/')) out.daily.push(k.name); else out.other.push(k.name); });
      cursor = list.list_complete? null : list.cursor;
    } while(cursor);
    out.daily.sort(); out.other.sort();
  } catch(e){ return json({ error:'list_failed', message:String(e) },500); }
  return json(out);
}

// Overlay endpoint parity: supply recent gate direction changes + deletions since a timestamp or minutes lookback
async function handleIndexerOverlay(url, env){
  if(!env.INDEX_DB) return json({ error:'INDEX_DB binding missing' },500);
  let sinceTs = url.searchParams.get('sinceTs');
  const minutesParam = url.searchParams.get('minutes');
  if(!sinceTs){
    const mins = Math.min(120, Math.max(1, parseInt(minutesParam||'5',10)||5));
    sinceTs = new Date(Date.now() - mins*60000).toISOString();
  }
  let sinceDate = new Date(sinceTs);
  if(isNaN(sinceDate.getTime())) return json({ error:'invalid_sinceTs' },400);
  const limit = Math.min(500, Math.max(1, parseInt(url.searchParams.get('limit')||'100',10)||100));
  try {
    const gateRows = await env.INDEX_DB.prepare("SELECT DISTINCT gate_id FROM smart_gate_direction WHERE last_change_at >= ? ORDER BY last_change_at DESC LIMIT ?").bind(sinceDate.toISOString(), limit).all();
    const gateIds = (gateRows.results||[]).map(r=> r.gate_id);
    const gates=[];
    for(const gid of gateIds){
      try {
        const dirsRes = await env.INDEX_DB.prepare("SELECT gate_id, world_version, origin_system_id, destination_system_id, linked, online, traversal_cost FROM smart_gate_direction WHERE gate_id=?").bind(gid).all();
        const dirs = (dirsRes.results||[]).map(d=> ({ origin_system_id:d.origin_system_id, destination_system_id:d.destination_system_id, linked:!!d.linked, online:!!d.online, traversal_cost:d.traversal_cost }));
        const world_version = dirsRes.results?.[0]?.world_version || null;
        gates.push({ gate_id: gid, world_version, directions: dirs });
      } catch { /* ignore */ }
    }
    let deletions=[]; try {
      const delRes = await env.INDEX_DB.prepare("SELECT gate_id, world_version, deleted_at FROM gate_tombstone WHERE deleted_at >= ? ORDER BY deleted_at DESC LIMIT ?").bind(sinceDate.toISOString(), limit).all();
      deletions = (delRes.results||[]).map(r=> ({ gate_id:r.gate_id, world_version:r.world_version, deleted_at:r.deleted_at }));
    } catch { /* ignore */ }
    const more = gateIds.length === limit;
    return json({ sinceTs: sinceDate.toISOString(), gates, deletions, more });
  } catch(e){
    return json({ error:'overlay_failed', message:String(e) },500);
  }
}

// Diagnostic: expose presence (not values) of ingestion environment configuration
async function handleIndexerEnv(req, env){
  if(req.method !== 'GET') return json({ error:'Method Not Allowed' },405);
  const token = req.headers.get('X-Indexer-Admin');
  const authDisabled = env.INDEXER_AUTH_DISABLED === '1';
  const expected = (env.INDEXER_ADMIN_TOKEN||'').trim();
  const host = req.headers.get('host')||'';
  const isPreviewHost = host.endsWith('.pages.dev');
  let bypassAuth=false;
  try { const urlObj = new URL(req.url); bypassAuth = isPreviewHost && urlObj.searchParams.get('openPreview')==='1' && (!!expected ? token?.trim() !== expected : !token); } catch {}
  if(!authDisabled && expected && token?.trim() !== expected && !bypassAuth) return json({ error:'Unauthorized' },401);
  const out = {
    rpc: !!env.PYROPE_RPC,
    world: !!env.WORLD_ADDRESS,
    deployBlock: !!env.DEPLOY_BLOCK,
    confirmDepth: !!env.CONFIRM_DEPTH,
    adminToken: !!expected
  };
  // Optionally include active run id & cursor snapshot when DB bound
  if(env.INDEX_DB){
    try {
      const run = await env.INDEX_DB.prepare("SELECT id, run_started_at FROM indexer_run WHERE run_finished_at IS NULL ORDER BY id DESC LIMIT 1").all();
      const cur = await env.INDEX_DB.prepare("SELECT last_block_number FROM event_cursor WHERE id=1").all();
      out.activeRun = run.results?.[0]||null;
      out.cursorBlock = cur.results?.[0]?.last_block_number ?? null;
    } catch { /* ignore */ }
  }
  return json({ status:'ok', config: out, bypassAuth });
}

// Reset endpoint: finalize any active run and reset cursor to (DEPLOY_BLOCK-1) so next ingest begins from deployment block.
// Preview bypass allowed; production requires admin token. Does not truncate data (raw_logs retained) to permit forensic review.
async function handleIndexerReset(req, env){
  if(req.method !== 'POST') return json({ error:'Method Not Allowed' },405);
  if(!env.INDEX_DB) return json({ error:'INDEX_DB binding missing' },500);
  const token = req.headers.get('X-Indexer-Admin');
  const authDisabled = env.INDEXER_AUTH_DISABLED === '1';
  const expected = (env.INDEXER_ADMIN_TOKEN||'').trim();
  const host = req.headers.get('host')||'';
  const isPreviewHost = host.endsWith('.pages.dev');
  let bypassAuth=false;
  try { const urlObj = new URL(req.url); bypassAuth = isPreviewHost && urlObj.searchParams.get('openPreview')==='1' && (!!expected ? token?.trim() !== expected : !token); } catch {}
  if(!authDisabled && expected && token?.trim() !== expected && !bypassAuth) return json({ error:'Unauthorized' },401);
  const deployBlock = parseInt(env.DEPLOY_BLOCK||'0',10) || 0;
  let activeRun=null; let previousCursor=null; let updatedCursor=null;
  try {
    const run = await env.INDEX_DB.prepare("SELECT id, run_started_at FROM indexer_run WHERE run_finished_at IS NULL ORDER BY id DESC LIMIT 1").all();
    activeRun = run.results?.[0]||null;
    if(activeRun){
      // finalize with note
      await env.INDEX_DB.prepare("UPDATE indexer_run SET run_finished_at=CURRENT_TIMESTAMP, notes=COALESCE(notes,'reset_finalized'), run_duration_ms=COALESCE(run_duration_ms, (julianday(CURRENT_TIMESTAMP)-julianday(run_started_at))*86400000) WHERE id=?").bind(activeRun.id).run();
    }
  } catch { /* ignore */ }
  try {
    const cur = await env.INDEX_DB.prepare("SELECT last_block_number, last_log_index FROM event_cursor WHERE id=1").all();
    previousCursor = cur.results?.[0]||null;
    if(deployBlock>0){
      const newBlock = Math.max(0, deployBlock-1);
      await env.INDEX_DB.prepare("UPDATE event_cursor SET last_block_number=?, last_log_index=0, updated_at=CURRENT_TIMESTAMP WHERE id=1").bind(newBlock).run();
      const cur2 = await env.INDEX_DB.prepare("SELECT last_block_number, last_log_index FROM event_cursor WHERE id=1").all();
      updatedCursor = cur2.results?.[0]||null;
    }
  } catch(e){ return json({ error:'cursor_reset_failed', message:String(e) },500); }
  return json({ status:'ok', activeRunFinalized: !!activeRun, previousCursor, updatedCursor, deployBlock, bypassAuth });
}

async function handleDebugKV(url, env){
  const limit = parseInt(url.searchParams.get('limit')||'50',10);
  const prefix = url.searchParams.get('prefix')||'';
  try { const list = await env.EF_STATS.list({ prefix, limit: Math.min(1000, Math.max(1, limit)) }); return json({ keys: list.keys.map(k=>({ name:k.name, expiration:k.expiration, metadata:k.metadata })), list_complete: list.list_complete }); } catch(e){ return json({ error:'debug_failed', message:String(e) },500); }
}


// (Removed duplicate handleListStats definition)

function json(obj,status=200){ return new Response(JSON.stringify(obj),{ status, headers:{ 'Content-Type':'application/json','Cache-Control':'no-store' } }); }

// Return aggregate count in a block range for raw_logs / raw_logs_new (shadow) for gap analysis
async function handleIndexerRawLogsRange(url, env){
  if(!env.INDEX_DB) return json({ error:'INDEX_DB binding missing' },500);
  const from = parseInt(url.searchParams.get('from')||'0',10);
  const to = parseInt(url.searchParams.get('to')||'0',10);
  if(!(from>=0) || !(to>=from)) return json({ error:'invalid_range' },400);
  const shadow = url.searchParams.get('shadow')==='1';
  const table = shadow? 'raw_logs_new':'raw_logs';
  try {
    const r = await env.INDEX_DB.prepare(`SELECT COUNT(1) as c FROM ${table} WHERE block_number BETWEEN ? AND ?`).bind(from,to).all();
    return json({ status:'ok', table, from, to, count: r.results?.[0]?.c||0 });
  } catch(e){ return json({ error:'range_query_failed', message:String(e) },500); }
}

// Accept POST with JSON { from, to, expected, found, missing, sampleCount, notes }
async function handleIndexerGapReport(req, env){
  if(req.method !== 'POST') return json({ error:'Method Not Allowed' },405);
  if(!env.INDEX_DB) return json({ error:'INDEX_DB binding missing' },500);
  let b={}; try { if(req.headers.get('content-type')?.includes('application/json')) b = await req.json(); } catch { return json({ error:'invalid_json' },400); }
  const { from, to, expected, found, missing, sampleCount, notes } = b;
  if(!Number.isInteger(from)||!Number.isInteger(to)||to<from) return json({ error:'invalid_range' },400);
  if(!Number.isInteger(expected)||!Number.isInteger(found)||!Number.isInteger(missing)) return json({ error:'invalid_counts' },400);
  try {
    await env.INDEX_DB.prepare("INSERT INTO gap_scan_result (from_block,to_block,expected_logs,found_logs,missing_logs,sample_count,notes) VALUES (?,?,?,?,?,?,?)")
      .bind(from,to,expected,found,missing, sampleCount??null, notes? String(notes).slice(0,240): null).run();
    return json({ status:'recorded' });
  } catch(e){ return json({ error:'gap_record_failed', message:String(e) },500); }
}

export default {
  async fetch(req, env, ctx){
    const url = new URL(req.url); const p = url.pathname;
    if(p === '/api/create-share') return handleCreateShare(req, env);
    if(p === '/api/get-share') return handleGetShare(url, env);
    if(p === '/api/usage-event') return handleUsageEvent(req, env);
  if(p === '/api/stats') return handleStats(url, env);
  if(p === '/api/list-stats') return handleListStats(env);
  if(p === '/api/debug-kv') return handleDebugKV(url, env);
  if(p === '/api/indexer-health') return handleIndexerHealth(env, url);
  if(p === '/api/indexer-runs') return handleIndexerRuns(env, url);
  if(p === '/api/indexer-migrate') return handleIndexerMigrate(req, env);
  if(p === '/api/indexer-bootstrap') return handleIndexerBootstrap(req, env);
  if(p === '/api/indexer-ingest') return handleIndexerIngest(req, env);
  if(p === '/api/indexer-trigger') return handleIndexerTrigger(req, env);
  if(p === '/api/indexer-env') return handleIndexerEnv(req, env);
  if(p === '/api/indexer-reset') return handleIndexerReset(req, env);
  if(p === '/api/indexer-secret-debug') return handleIndexerSecretDebug(env);
  if(p === '/api/indexer-overlay') return handleIndexerOverlay(url, env);
  if(p === '/api/indexer-rawlogs-range') return handleIndexerRawLogsRange(url, env);
  if(p === '/api/indexer-gap-report') return handleIndexerGapReport(req, env);
  if(p === '/api/indexer-rawlogs-archive-chunk') {
    if(req.method !== 'POST') return json({ error:'Method Not Allowed' },405);
    // Auth: allow preview bypass (openPreview=1 on *.pages.dev) or admin token. Same pattern as other mutating endpoints.
    const token = req.headers.get('X-Indexer-Admin');
    const expected = (env.INDEXER_ADMIN_TOKEN||'').trim();
    const host = req.headers.get('host')||''; const isPreviewHost = host.endsWith('.pages.dev');
    let bypass=false; try { const u=new URL(req.url); bypass = isPreviewHost && u.searchParams.get('openPreview')==='1' && (!!expected ? token?.trim()!==expected : !token); } catch{}
    if(expected && token?.trim()!==expected && !bypass) return json({ error:'Unauthorized' },401);
    if(!env.INDEX_DB) return json({ error:'INDEX_DB binding missing' },500);
    // Destination binding: support INDEX_DB_A1 initially (more can be added later via dest param)
    const destKey = 'INDEX_DB_A1';
    const dest = env[destKey];
    if(!dest) return json({ error:'Archive DB binding missing', binding: destKey },500);
    let body={}; try { if(req.headers.get('content-type')?.includes('application/json')) body = await req.json(); } catch { return json({ error:'Invalid JSON' },400); }
    const from = parseInt(body.from,10), to = parseInt(body.to,10);
    const dryRun = body.dryRun===true || body.dryRun==='1';
    const limit = Math.min(5000, Math.max(1, parseInt(body.limit||'2000',10)||2000));
    if(!Number.isInteger(from) || !Number.isInteger(to) || to < from) return json({ error:'invalid_range' },400);
    // Ensure destination schema exists (raw_logs + indexes)
    try {
      await dest.exec("CREATE TABLE IF NOT EXISTS raw_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, block_number INTEGER NOT NULL, log_index INTEGER NOT NULL, tx_hash TEXT NOT NULL, address TEXT NOT NULL, topic0 TEXT NULL, topic1 TEXT NULL, topic2 TEXT NULL, topic3 TEXT NULL, data TEXT NOT NULL, created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP);");
      await dest.exec("CREATE UNIQUE INDEX IF NOT EXISTS u_raw_logs_block_logindex ON raw_logs(block_number, log_index);");
      await dest.exec("CREATE INDEX IF NOT EXISTS idx_raw_logs_block ON raw_logs(block_number);");
      await dest.exec("CREATE INDEX IF NOT EXISTS idx_raw_logs_address ON raw_logs(address);");
      await dest.exec("CREATE INDEX IF NOT EXISTS idx_raw_logs_topic0 ON raw_logs(topic0);");
    } catch(e){ return json({ error:'dest_schema_failed', message:String(e) },500); }
    // Fetch a page from primary
    let rows=[]; try {
      const sel = await env.INDEX_DB.prepare("SELECT block_number, log_index, tx_hash, address, topic0, topic1, topic2, topic3, data FROM raw_logs WHERE block_number BETWEEN ? AND ? ORDER BY block_number, log_index LIMIT ?").bind(from,to,limit).all();
      rows = sel.results||[];
    } catch(e){ return json({ error:'select_failed', message:String(e) },500); }
    if(!rows.length){
      // Also report remaining for visibility
      try {
        const r2 = await env.INDEX_DB.prepare("SELECT COUNT(1) AS c FROM raw_logs WHERE block_number BETWEEN ? AND ?").bind(from,to).all();
        return json({ status:'empty', copied:0, deleted:0, remaining: r2.results?.[0]?.c||0, dryRun });
      } catch { return json({ status:'empty', copied:0, deleted:0, remaining:null, dryRun }); }
    }
    if(dryRun){
      // Do not mutate; return sample and counts
      let remaining=null; try { const r = await env.INDEX_DB.prepare("SELECT COUNT(1) AS c FROM raw_logs WHERE block_number BETWEEN ? AND ?").bind(from,to).all(); remaining = r.results?.[0]?.c||0; } catch{}
      return json({ status:'dry_run', page: rows.length, sample: rows.slice(0,3), remaining });
    }
    // Insert into destination in batches respecting D1 var limit (9 vars/row; cap 100 vars)
    const VARS_PER_ROW = 9, D1_PARAM_LIMIT=100;
    const maxRowsPerStmt = Math.max(1, Math.floor(D1_PARAM_LIMIT / VARS_PER_ROW));
    let inserted=0; let firstErr=null;
    for(let i=0;i<rows.length;){
      const slice = rows.slice(i, i+maxRowsPerStmt);
      const placeholders = slice.map(()=> '(?,?,?,?,?,?,?,?,?)').join(',');
      const flat=[]; for(const r of slice){ flat.push(r.block_number, r.log_index, r.tx_hash||'', (r.address||'').toLowerCase(), r.topic0||null, r.topic1||null, r.topic2||null, r.topic3||null, r.data||'0x'); }
      try {
        const res = await dest.prepare(`INSERT OR IGNORE INTO raw_logs (block_number, log_index, tx_hash, address, topic0, topic1, topic2, topic3, data) VALUES ${placeholders}`).bind(...flat).run();
        const changes = (res && res.meta && typeof res.meta.changes==='number')? res.meta.changes: 0;
        inserted += changes;
      } catch(e){ if(!firstErr) firstErr=String(e).slice(0,160); }
      i += slice.length;
    }
    // Delete the rows that we selected (by exact keys)
    let deleted=0;
    for(const r of rows){
      try {
        const del = await env.INDEX_DB.prepare("DELETE FROM raw_logs WHERE block_number=? AND log_index=?").bind(r.block_number, r.log_index).run();
        const ch = (del && del.meta && typeof del.meta.changes==='number')? del.meta.changes:0; deleted += ch;
      } catch{ /* continue */ }
    }
    // Report remaining in range after deletion
    let remaining=null; try { const r = await env.INDEX_DB.prepare("SELECT COUNT(1) AS c FROM raw_logs WHERE block_number BETWEEN ? AND ?").bind(from,to).all(); remaining = r.results?.[0]?.c||0; } catch{}
    return json({ status:'ok', moved: inserted, deleted, page: rows.length, remaining, dest: destKey, firstErr });
  }
  if(p === '/api/indexer-topic-map') {
    if(!env.INDEX_DB) return json({ error:'INDEX_DB binding missing' },500);
    try {
      const full = url.searchParams.get('full')==='1';
      const tm = await env.INDEX_DB.prepare("SELECT abi_hash, json, inserted_at FROM topic_map ORDER BY inserted_at DESC LIMIT 1").all();
      if(!tm.results || !tm.results.length){ return json({ status:'empty' }); }
      const row = tm.results[0];
      if(!full){
        let meta=null; try { const j = JSON.parse(row.json); meta = j.meta||{ eventCount: Object.keys(j.events||{}).length, functionCount: Object.keys(j.functions||{}).length }; } catch{}
        return json({ status:'ok', abiHash: row.abi_hash, inserted_at: row.inserted_at, meta });
      }
      return json({ status:'ok', abiHash: row.abi_hash, inserted_at: row.inserted_at, map: JSON.parse(row.json) });
    } catch(e){ return json({ error:'topic_map_fetch_failed', message:String(e) },500); }
  }
  if(p === '/api/indexer-topic-map-refresh') {
    if(req.method !== 'POST') return json({ error:'Method Not Allowed' },405);
    const token = req.headers.get('X-Indexer-Admin');
    const expected = (env.INDEXER_ADMIN_TOKEN||'').trim();
    const host = req.headers.get('host')||''; const isPreviewHost = host.endsWith('.pages.dev');
    const urlObj = new URL(req.url); const bypass = isPreviewHost && urlObj.searchParams.get('openPreview')==='1' && (!expected || token?.trim()!==expected);
    if(expected && token?.trim()!==expected && !bypass) return json({ error:'Unauthorized' },401);
    if(!env.INDEX_DB) return json({ error:'INDEX_DB binding missing' },500);
    try {
      const origin = new URL(req.url).origin;
      const resp = await env.ASSETS.fetch(origin + '/topic_map.json');
      if(!resp.ok) return json({ error:'asset_fetch_failed', status: resp.status },502);
      const text = await resp.text();
      let parsed; try { parsed = JSON.parse(text); } catch(e){ return json({ error:'invalid_json', message:String(e) },400); }
      const abiHash = parsed?.meta?.abiHash || parsed?.meta?.abi_hash || null;
      if(!abiHash) return json({ error:'missing_abi_hash' },400);
      await env.INDEX_DB.prepare("INSERT OR REPLACE INTO topic_map (abi_hash, json) VALUES (?, ?)").bind(abiHash, JSON.stringify(parsed)).run();
      return json({ status:'stored', abiHash });
    } catch(e){ return json({ error:'topic_map_store_failed', message:String(e) },500); }
  }
  if(p === '/api/indexer-decode-batch') {
    if(req.method !== 'POST') return json({ error:'Method Not Allowed' },405);
    if(!env.INDEX_DB) return json({ error:'INDEX_DB binding missing' },500);
    const token = req.headers.get('X-Indexer-Admin');
    const expected = (env.INDEXER_ADMIN_TOKEN||'').trim();
    const host = req.headers.get('host')||''; const isPreviewHost = host.endsWith('.pages.dev');
    const urlObj = new URL(req.url); const bypass = isPreviewHost && urlObj.searchParams.get('openPreview')==='1' && (!expected || token?.trim()!==expected);
    if(expected && token?.trim()!==expected && !bypass) return json({ error:'Unauthorized' },401);
    try {
      const cur = await env.INDEX_DB.prepare("SELECT last_block, last_log_index FROM decoded_cursor WHERE id=1").all();
      const cursor = cur.results?.[0] || { last_block:0, last_log_index:0 };
      return json({ status:'noop', decoded:0, cursor });
    } catch(e){ return json({ error:'decode_batch_failed', message:String(e) },500); }
  }
  if(p === '/api/indexer-wipe') {
    if(req.method !== 'POST') return json({ error:'Method Not Allowed' },405);
    const token = req.headers.get('X-Indexer-Admin');
    const expected = (env.INDEXER_ADMIN_TOKEN||'').trim();
    const host = req.headers.get('host')||''; const isPreviewHost = host.endsWith('.pages.dev');
    const urlObj = new URL(req.url); const bypass = isPreviewHost && urlObj.searchParams.get('openPreview')==='1' && (!expected || token?.trim()!==expected);
    if(expected && token?.trim()!==expected && !bypass) return json({ error:'Unauthorized' },401);
    if(!env.INDEX_DB) return json({ error:'INDEX_DB binding missing' },500);
    if(urlObj.searchParams.get('confirm')!=='YES') return json({ error:'confirm_param_required', hint:'POST /api/indexer-wipe?confirm=YES&openPreview=1' },400);
  const dropList = ['raw_logs_new','raw_logs','store_events','table_registry','decode_progress','smart_assembly','smart_gate_direction','gate_acl','gate_access_cache','structure_generic','adjacency_snapshot_meta','gate_tombstone','event_cursor','indexer_run','topic_map','record_latest','decoded_cursor','_migrations'];
    const failed=[]; for(const t of dropList){ try { await env.INDEX_DB.prepare(`DROP TABLE IF EXISTS ${t}`).run(); } catch(e){ failed.push({ table:t, error:String(e).slice(0,120) }); } }
    return json({ status:'wiped', dropped: dropList.length, failed });
  }
  if(p === '/api/debug-rawlogs'){
    if(!env.INDEX_DB) return json({ error:'INDEX_DB binding missing' },500);
    try { const res = await env.INDEX_DB.prepare("SELECT COUNT(*) AS c FROM raw_logs").all(); return json({ count: res.results?.[0]?.c||0 }); } catch(e){ return json({ error:'raw_logs_query_failed', message:String(e) },500); }
  }
    const resp = await env.ASSETS.fetch(req);
    const h = new Headers(resp.headers); h.set('X-Stats-Impl','pages-list-v1');
    return new Response(resp.body,{ status:resp.status, statusText:resp.statusText, headers:h });
  }
};

// Scheduled cron handler (Cloudflare Cron Triggers) – autonomous ingestion loop.
// Executes every 5 minutes (see wrangler.jsonc triggers.crons). Gated by INDEXER_CRON_ENABLED=1.
// Logic: skip if active run younger than 2m; finalize stale (>30m) unfinished run; then invoke store_all ingestion
// with configured window (INDEXER_CRON_MAX_BLOCKS / SEGMENT_BLOCKS / ROW_CAP). Internal call bypasses external auth.
export async function scheduled(event, env, ctx){
  try {
    if(env.INDEXER_CRON_ENABLED !== '1') return; // disabled gate
    if(!env.INDEX_DB) return; // nothing to do without DB
    // Overlap lock: detect unfinished run
    let active=null;
    try {
      const r = await env.INDEX_DB.prepare("SELECT id, run_started_at FROM indexer_run WHERE run_finished_at IS NULL ORDER BY id DESC LIMIT 1").all();
      active = r.results?.[0]||null;
    } catch { /* ignore */ }
    if(active){
      try {
        const started = new Date(active.run_started_at + 'Z');
        const ageMs = Date.now() - started.getTime();
        const STALE_MS = 30*60*1000; // 30m
        const MIN_AGE_MS = 2*60*1000; // consider in-progress if <2m
        if(ageMs < MIN_AGE_MS){
          return; // recent active run – skip
        } else if(ageMs > STALE_MS){
          // finalize stale run so next cron can progress
          try {
            await env.INDEX_DB.prepare("UPDATE indexer_run SET run_finished_at=CURRENT_TIMESTAMP, notes=COALESCE(notes,'auto-finalized_cron_stale'), run_duration_ms=COALESCE(run_duration_ms, (julianday(CURRENT_TIMESTAMP)-julianday(run_started_at))*86400000) WHERE id=?").bind(active.id).run();
          } catch { /* ignore finalize error */ }
        } else {
          // mid-age active run – let it finish
          return;
        }
      } catch { return; }
    }
    // Construct internal ingestion request (store_all mode)
    const maxBlocks = parseInt(env.INDEXER_CRON_MAX_BLOCKS||'4000',10)||4000;
    const segmentBlocks = parseInt(env.INDEXER_CRON_SEGMENT_BLOCKS||'300',10)||300;
    const rowCap = parseInt(env.INDEXER_CRON_ROW_CAP||'50000',10)||50000;
    const payload = { mode:'store_all', maxBlocks, segmentBlocks, rowCap };
    if(env.PYROPE_RPC) payload.rpc = env.PYROPE_RPC;
    if(env.WORLD_ADDRESS) payload.world = env.WORLD_ADDRESS;
    if(env.DEPLOY_BLOCK) payload.deployBlock = parseInt(env.DEPLOY_BLOCK,10)||env.DEPLOY_BLOCK;
    const headers = { 'content-type':'application/json' };
    if(env.INDEXER_ADMIN_TOKEN) headers['X-Indexer-Admin'] = env.INDEXER_ADMIN_TOKEN;
    const internalReq = new Request('https://internal/api/indexer-ingest', { method:'POST', headers, body: JSON.stringify(payload) });
    // Fire and wait (ensure single run per cron invocation)
    await handleIndexerIngest(internalReq, env);
  } catch(e){
    // Best-effort logging; cron exits silently otherwise
    console.log('cron_ingest_error', String(e).slice(0,160));
  }
}
