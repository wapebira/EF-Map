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
};
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
          const lr = await env.INDEX_DB.prepare("SELECT id, mode, run_started_at, run_finished_at, run_duration_ms, assemblies_scanned, rows_added, rows_updated, rows_removed, gate_edges_rebuilt, error_count FROM indexer_run ORDER BY id DESC LIMIT 1").all();
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
  return json({ status:'ok', world, chain: chainDeploy? { chainId, ...chainDeploy }: null, counts, lastRun, cursor, ingestionLagMs, pendingChanges, snapshotRecommended, snapshotReason, changeSummary, hasAdminToken, migrationsApplied, probeStats: includeProbeStats? _pendingProbeStats : undefined });
  } catch(e){
    return json({ status:'error', error:String(e), chain: chainDeploy? { chainId, ...chainDeploy }: null, counts, lastRun });
  }
}

async function handleIndexerMigrate(req, env){
  if(req.method !== 'POST') return json({ error:'Method Not Allowed' },405);
  const token = req.headers.get('X-Indexer-Admin');
  const host = req.headers.get('host')||'';
  const isPreviewHost = host.endsWith('.pages.dev');
  const urlObj = new URL(req.url);
  const openPreview = urlObj.searchParams.get('openPreview') === '1';
  const tokenValid = !!token && token === (env.INDEXER_ADMIN_TOKEN||'');
  const bypassAuth = !tokenValid && isPreviewHost && openPreview;
  if(!tokenValid && !bypassAuth) return json({ error:'Unauthorized' },401);
  if(!env.INDEX_DB) return json({ error:'INDEX_DB binding missing' },500);
  await env.INDEX_DB.exec("CREATE TABLE IF NOT EXISTS _migrations (id TEXT PRIMARY KEY, applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP)");
  const migrationList = ['001_init','002_enrichment','003_cursor','004_run_duration','005_overlay','006_store_registry','007_raw_logs'];
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
  if(!token || token !== (env.INDEXER_ADMIN_TOKEN||'')) return json({ error:'Unauthorized' },401);
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
  const expected = (env.INDEXER_ADMIN_TOKEN||'').trim();
  const host = req.headers.get('host')||'';
  const isPreviewHost = host.endsWith('.pages.dev');
  let bypassAuth=false;
  try { const urlObj = new URL(req.url); bypassAuth = isPreviewHost && urlObj.searchParams.get('openPreview')==='1' && (!!expected ? token?.trim() !== expected : !token); } catch{ /* ignore URL parse */ }
  if(expected && token?.trim() !== expected && !bypassAuth) return json({ error:'Unauthorized' },401);
  let body={}; try { if(req.headers.get('content-type')?.includes('application/json')) body = await req.json(); } catch { body={}; }
  const baseMode = body.mode === 'store' ? 'store' : 'stub';
  const extendedMode = body.mode === 'store_all' ? 'store_all' : baseMode; // store_all = address-only raw capture
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
  if(extendedMode === 'store_all'){
    // Broad address-only capture with batched inserts to mitigate per-row overhead (reduces Worker 1101 exceptions).
    try {
      const RPC = env.PYROPE_RPC || body.rpc || '';
      const WORLD = (env.WORLD_ADDRESS || body.world || '').toLowerCase();
      if(!RPC || !WORLD) return json({ error:'missing_rpc_or_world' },400);
      const CONFIRM_DEPTH = BigInt(env.CONFIRM_DEPTH || body.confirmDepth || 8);
      const deployBlock = BigInt(env.DEPLOY_BLOCK || body.deployBlock || 0);
      const maxBlocks = Math.min(Number(body.maxBlocks||2000),20000);
      const segmentBlocks = Math.min(Number(body.segmentBlocks||0)||0, maxBlocks);
      const rowCap = Math.min(Number(body.rowCap||50000),200000);
      // Ensure schema
      try {
        await env.INDEX_DB.exec("CREATE TABLE IF NOT EXISTS raw_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, block_number INTEGER NOT NULL, log_index INTEGER NOT NULL, tx_hash TEXT NOT NULL, address TEXT NOT NULL, topic0 TEXT NULL, topic1 TEXT NULL, topic2 TEXT NULL, topic3 TEXT NULL, data TEXT NOT NULL, created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP);");
        await env.INDEX_DB.exec("CREATE UNIQUE INDEX IF NOT EXISTS u_raw_logs_block_logindex ON raw_logs(block_number, log_index);");
        await env.INDEX_DB.exec("CREATE INDEX IF NOT EXISTS idx_raw_logs_block ON raw_logs(block_number);");
        await env.INDEX_DB.exec("CREATE INDEX IF NOT EXISTS idx_raw_logs_address ON raw_logs(address);");
        await env.INDEX_DB.exec("CREATE INDEX IF NOT EXISTS idx_raw_logs_topic0 ON raw_logs(topic0);");
      } catch(e){ return json({ error:'raw_logs_ddl_failed', message:String(e) },500); }
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
          const sql = `INSERT OR IGNORE INTO raw_logs (block_number, log_index, tx_hash, address, topic0, topic1, topic2, topic3, data) VALUES ${placeholders}`;
          try {
            if(sliceSize * VARS_PER_ROW > D1_PARAM_LIMIT){ throw new Error('synthetic_var_limit'); }
            const r = await env.INDEX_DB.prepare(sql).bind(...flat).run();
            inserted += slice.length; // keep existing semantics (so cursor can advance even if duplicates)
            if(r && r.meta && typeof r.meta.changes === 'number') actualInserted += r.meta.changes;
            idx += sliceSize; batchFlushes++;
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
          while(segFrom <= toBlock && (inserted + pending.length) < rowCap){
            if(segRequests >= MAX_SEG_REQ){ truncated=true; break; }
            const remainingBlocks = (toBlock - segFrom) + 1n;
            if(dynamicSeg > remainingBlocks) dynamicSeg = remainingBlocks;
            if(dynamicSeg <= 0) break;
            const segTo = segFrom + dynamicSeg - 1n;
            let segLogs;
            try {
              segLogs = await rpc('eth_getLogs',[{ address: WORLD, fromBlock:'0x'+segFrom.toString(16), toBlock:'0x'+segTo.toString(16) }]);
              segRequests++;
            } catch(segErr){
              await flush();
              const advanceTo = (inserted < rowCap) ? Number(segFrom-1n) : Number(segTo);
              if(inserted){ await env.INDEX_DB.prepare("UPDATE event_cursor SET last_block_number=?, updated_at=CURRENT_TIMESTAMP WHERE id=1").bind(advanceTo).run(); }
              return json({ error:'log_fetch_failed', message:'segment_error:'+String(segErr), inserted, attempted, batchFlushes, segment:{ from:Number(segFrom), to:Number(segTo) }, segRequests, segmentsProcessed, truncated });
            }
            await handleLogs(segLogs);
            segmentsProcessed++;
            segFrom = segTo + 1n;
            if((inserted + pending.length) >= rowCap) break;
          }
        } else {
          const logs = await rpc('eth_getLogs',[{ address: WORLD, fromBlock:'0x'+startBlock.toString(16), toBlock:'0x'+toBlock.toString(16) }]);
          segRequests=1; segmentsProcessed=1; await handleLogs(logs);
        }
      } catch(e){ await flush(); return json({ error:'log_fetch_failed', message:String(e), inserted, attempted, batchFlushes, segRequests, segmentsProcessed, truncated }); }
      await flush();
      // If we attempted logs but inserted none, do NOT advance cursor to avoid data loss; surface retry signal.
  if(attempted>0 && actualInserted===0){
        if(runId){ const durRes = await env.INDEX_DB.prepare("SELECT (julianday(CURRENT_TIMESTAMP)-julianday(run_started_at))*86400000 AS ms FROM indexer_run WHERE id=?").bind(runId).all(); const ms = Math.max(0, Math.round(durRes.results?.[0]?.ms||0)); await env.INDEX_DB.prepare("UPDATE indexer_run SET run_finished_at=CURRENT_TIMESTAMP, run_duration_ms=?, rows_added=?, notes=? WHERE id=?").bind(ms, 0, 'store_all batch_insert_failed shrinks:'+batchShrinks+' errs:'+insertErrors.length, runId).run(); }
  return json({ status:'batch_insert_failed', retry:true, cursor, range:{ from:Number(startBlock), to:Number(toBlock) }, inserted, actualInserted, attempted, adaptiveBatch, batchShrinks, batchFlushes, insertErrorCount: insertErrors.length, firstInsertError: insertErrors[0]||null, uniqueTopics: Array.from(uniqueTopics), topicCount: uniqueTopics.size, rowCapApplied: rowCap, bypassAuth, segRequests, segmentsProcessed, truncated, segmentBlocksRequested: segmentBlocks||0 });
      }
      const advanceTo = (inserted < rowCap) ? Number(toBlock) : (lastBlock!==null? lastBlock: Number(toBlock));
      if(inserted>0){
        await env.INDEX_DB.prepare("UPDATE event_cursor SET last_block_number=?, updated_at=CURRENT_TIMESTAMP WHERE id=1").bind(advanceTo).run();
        const c2 = await env.INDEX_DB.prepare("SELECT id, last_block_number, last_log_index, updated_at FROM event_cursor WHERE id=1").all();
        cursor = c2.results?.[0] || cursor;
      }
      if(runId){ const durRes = await env.INDEX_DB.prepare("SELECT (julianday(CURRENT_TIMESTAMP)-julianday(run_started_at))*86400000 AS ms FROM indexer_run WHERE id=?").bind(runId).all(); const ms = Math.max(0, Math.round(durRes.results?.[0]?.ms||0)); await env.INDEX_DB.prepare("UPDATE indexer_run SET run_finished_at=CURRENT_TIMESTAMP, run_duration_ms=?, rows_added=?, notes=? WHERE id=?").bind(ms, inserted, 'store_all raw '+inserted+' batches:'+batchFlushes+' shrinks:'+batchShrinks+' segReq:'+segRequests, runId).run(); }
  return json({ status:'ok', mode:'store_all', cursor, range:{ from:Number(startBlock), to:Number(toBlock) }, inserted, actualInserted, attempted, adaptiveBatchInitial:REQUESTED_BATCH, adaptiveBatchFinal:adaptiveBatch, batchShrinks, batchFlushes, insertErrorCount: insertErrors.length, firstInsertError: insertErrors[0]||null, uniqueTopics: Array.from(uniqueTopics), topicCount: uniqueTopics.size, rowCapApplied: rowCap, blocks:{ first:firstBlock, last:lastBlock }, bypassAuth, segRequests, segmentsProcessed, truncated, segmentBlocksRequested: segmentBlocks||0 });
    } catch(e){
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
  return json({ status:'ok', mode: extendedMode, cursor, run: runRow.results?.[0]||null });
}

// Manual trigger endpoint: starts a store_all ingestion run unless one already in progress.
// Lightweight auth identical to /api/indexer-ingest (admin token or preview bypass). Returns early if a run is active.
async function handleIndexerTrigger(req, env){
  if(req.method !== 'POST') return json({ error:'Method Not Allowed' },405);
  if(!env.INDEX_DB) return json({ error:'INDEX_DB binding missing' },500);
  // Reuse auth pattern (token or preview bypass) without requiring body.
  const token = req.headers.get('X-Indexer-Admin');
  const expected = (env.INDEXER_ADMIN_TOKEN||'').trim();
  const host = req.headers.get('host')||'';
  const isPreviewHost = host.endsWith('.pages.dev');
  let bypassAuth=false;
  try { const urlObj = new URL(req.url); bypassAuth = isPreviewHost && urlObj.searchParams.get('openPreview')==='1' && (!!expected ? token?.trim() !== expected : !token); } catch {}
  if(expected && token?.trim() !== expected && !bypassAuth) return json({ error:'Unauthorized' },401);
  // Detect in-progress run (no finished_at yet) to avoid overlapping heavy RPC bursts.
  try {
    const active = await env.INDEX_DB.prepare("SELECT id, mode, run_started_at FROM indexer_run WHERE run_finished_at IS NULL ORDER BY id DESC LIMIT 1").all();
    const running = active.results?.[0] || null;
    if(running){
      return json({ status:'in_progress', run: running, bypassAuth });
    }
  } catch { /* ignore presence errors */ }
  // Delegate to ingestion handler with mode store_all (raw capture). We construct a synthetic Request so handler logic (including auth bypass) is reused.
  const triggerReq = new Request(req.url, { method:'POST', headers:{ 'content-type':'application/json', ...(token? { 'X-Indexer-Admin': token }: {}) }, body: JSON.stringify({ mode:'store_all' }) });
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

async function handleDebugKV(url, env){
  const limit = parseInt(url.searchParams.get('limit')||'50',10);
  const prefix = url.searchParams.get('prefix')||'';
  try { const list = await env.EF_STATS.list({ prefix, limit: Math.min(1000, Math.max(1, limit)) }); return json({ keys: list.keys.map(k=>({ name:k.name, expiration:k.expiration, metadata:k.metadata })), list_complete: list.list_complete }); } catch(e){ return json({ error:'debug_failed', message:String(e) },500); }
}


// (Removed duplicate handleListStats definition)

function json(obj,status=200){ return new Response(JSON.stringify(obj),{ status, headers:{ 'Content-Type':'application/json','Cache-Control':'no-store' } }); }

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
  if(p === '/api/indexer-migrate') return handleIndexerMigrate(req, env);
  if(p === '/api/indexer-bootstrap') return handleIndexerBootstrap(req, env);
  if(p === '/api/indexer-ingest') return handleIndexerIngest(req, env);
  if(p === '/api/indexer-trigger') return handleIndexerTrigger(req, env);
  if(p === '/api/indexer-secret-debug') return handleIndexerSecretDebug(env);
  if(p === '/api/indexer-overlay') return handleIndexerOverlay(url, env);
  if(p === '/api/debug-rawlogs'){
    if(!env.INDEX_DB) return json({ error:'INDEX_DB binding missing' },500);
    try { const res = await env.INDEX_DB.prepare("SELECT COUNT(*) AS c FROM raw_logs").all(); return json({ count: res.results?.[0]?.c||0 }); } catch(e){ return json({ error:'raw_logs_query_failed', message:String(e) },500); }
  }
    const resp = await env.ASSETS.fetch(req);
    const h = new Headers(resp.headers); h.set('X-Stats-Impl','pages-list-v1');
    return new Response(resp.body,{ status:resp.status, statusText:resp.statusText, headers:h });
  }
};
