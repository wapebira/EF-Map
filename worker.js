// Cloudflare Worker – Expanded Sandbox Implementation
// Endpoints:
//   POST /api/create-share        -> { id }
//   GET  /api/get-share?id=ID     -> { data }
//   POST /api/usage-event         -> accepts single {type, ...} or { events:[{type, body}, ...] }
//   GET  /api/stats[?history=7]   -> { current, history:[] }
//   GET  /s/<id>                  -> Serve SPA index (no redirect) and let client resolve short id in-place
// Namespaces (bindings via wrangler.jsonc): EF_SHARES, EF_STATS
// Mirrors Netlify usage-event EVENT_MAP (anonymized metrics). No PII stored.

// Share creation (random id)
async function handleCreateShare(req, env){
  if(req.method !== 'POST') return json({ error:'Method Not Allowed' }, 405);
  let body; try { body = req.headers.get('content-type')?.includes('application/json') ? await req.json() : {}; } catch { return json({ error:'Invalid JSON' },400); }
  const { data, preferId } = body || {};
  if(typeof data !== 'string' || !data.trim()) return json({ error:'Missing data' },400);
  if(!data.startsWith('r1|')) return json({ error:'Invalid share payload' },400);
  let id = typeof preferId === 'string' ? preferId.slice(0,16).replace(/[^A-Za-z0-9_-]/g,'') : '';
  if(!id) id = crypto.randomUUID().replace(/-/g,'').slice(0,10);
  for(let attempts=0; attempts<5; attempts++){
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

// ---- Usage / Stats (Full parity map) ----
const SCHEMA_VERSION = 2;
// EVENT_MAP mirrors Netlify version (keep in sync). Keys map to counters, sums, dynamic counters, etc.
const EVENT_MAP = {
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
  ui_scale: { countersDynamic: (b)=> { const allowed=[50,60,70,80,90,100,110,120,130]; const s=Number(b.scale); return allowed.includes(s)? ['ui_scale_'+s]:[]; } },
  page_load: { counters: ['page_loads'] },
  db_load_time: { sum: { key: 'db_load_time_ms_sum', countKey: 'db_load_time_count', valueField: 'ms' } },
  first_route_delay: { sum: { key: 'first_route_delay_ms_sum', countKey: 'first_route_delay_count', valueField: 'ms' } },
  first_action: { counters: ['first_actions'] },
  session_time: { sum: { key: 'session_time_ms_sum', countKey: 'session_time_count', valueField: 'ms' } },
  active_session_time: { sum: { key: 'active_session_time_ms_sum', countKey: 'active_session_time_count', valueField: 'ms' } },
  cinematic_enter: { counters: ['cinematic_enters'] },
  cinematic_first: { counters: ['cinematic_sessions'] },
  cinematic_time: { sum: { key: 'cinematic_time_ms_sum', countKey: 'cinematic_time_count', valueField: 'ms' } },
  session_bucket: { countersDynamic: (b)=> { const valid=['sess_lt_1m','sess_1_5m','sess_5_15m','sess_15_60m','sess_gt_60m']; return valid.includes(b.bucket)? [b.bucket]:[]; } },
  p2p_algo: { countersDynamic: (b)=> { const a=b.algo; return (a==='astar'||a==='dijkstra')? ['p2p_algo_'+a]: []; } },
  p2p_opt_mode: { countersDynamic: (b)=> { const m=b.mode; return (m==='fuel'||m==='jumps'||m==='explore')? ['p2p_mode_'+m]: []; } },
  p2p_hops_bucket: { countersDynamic: (b)=> { const v=b.bucket; const allowed=['hops_lt_10','hops_10_30','hops_30_60','hops_gt_60']; return allowed.includes(v)? [v]:[]; } },
  waypoint_count_bucket: { countersDynamic: (b)=> { const v=b.bucket; const allowed=['wp_0','wp_1_2','wp_3_5','wp_6_plus']; return allowed.includes(v)? [v]:[]; } },
  scout_hops_bucket: { countersDynamic: (b)=> { const v=b.bucket; const allowed=['scout_hops_lt_10','scout_hops_10_30','scout_hops_30_60','scout_hops_gt_60']; return allowed.includes(v)? [v]:[]; } },
  p2p_cancelled: { counters: ['p2p_cancelled'] },
  planet_bins_active_bucket: { countersDynamic: (b)=> { const v=b.bucket; const allowed=['bins_5','bins_3_4','bins_1_2','bins_0']; return allowed.includes(v)? [v]:[]; } },
  opt_workers_used: { countersDynamic: (b)=> { const n=Number(b.count); return (isFinite(n)&&n>=1&&n<=16)? ['opt_workers_used_'+n]:[]; } },
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
  reachability_range_bucket: { countersDynamic: (b)=> { const v=b.bucket; const allowed=['rng_lt_10','rng_10_25','rng_25_50','rng_50_100','rng_gt_100']; return allowed.includes(v)? [v]:[]; } },
  region_stats_view: { counters: ['region_stats_views'] },
  compare_regions_open: { counters: ['compare_regions_opens'] },
  overlay_open: { counters: ['overlay_opens'] },
  overlay_open_first: { counters: ['overlay_sessions'] },
  overlay_add_mark: { counters: ['overlay_add_marks'] },
  overlay_add_first: { counters: ['overlay_add_sessions'] },
  overlay_export: { counters: ['overlay_exports'] },
  overlay_import: { counters: ['overlay_imports'] },
  overlay_panel_time: { sum: { key:'overlay_panel_time_ms_sum', countKey:'overlay_panel_time_count', valueField:'ms' } },
  overlay_marks_count_bucket: { countersDynamic: (b)=> { const v=b.bucket; const allowed=['marks_0','marks_1_5','marks_6_15','marks_16_30','marks_31_60','marks_61_plus']; return allowed.includes(v)? [v]:[]; } },
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
  transmission_echo_msgs_bucket: { countersDynamic: (b)=> { const v=b.bucket; const allowed=['echo_0','echo_1_5','echo_6_15','echo_16_30','echo_gt_30']; return allowed.includes(v)? [v]:[]; } },
  transmission_open_share_bucket: { countersDynamic: (b)=> { const v=b.bucket; const allowed=['tx_share_0','tx_share_lt_10','tx_share_10_30','tx_share_30_60','tx_share_gt_60']; return allowed.includes(v)? [v]:[]; } },
  screen_res_bucket: { countersDynamic: (b)=> { const v=b.bucket; const allowed=['res_720p','res_1080p','res_1440p','res_4k_plus']; return allowed.includes(v)? [v]:[]; } },
  cpu_cores_bucket: { countersDynamic: (b)=> { const v=b.bucket; const allowed=['cores_1_2','cores_3_4','cores_5_8','cores_9_12','cores_13_16','cores_17_plus']; return allowed.includes(v)? [v]:[]; } },
  // Internal diagnostic counter: increments if an event ingestion exception occurs (never emitted by client)
  ingestion_error: { counters:['ingestion_errors'] }
};

// --- Indexer / Migration Scaffold (feature/indexer branch) ---
// NOTE: D1 binding (e.g., INDEX_DB) not yet declared in wrangler.jsonc; endpoints are inert until binding added.
const WORLD_API_BASE = 'https://world-api-stillness.live.tech.evefrontier.com'; // TODO: make configurable via env var if multiple environments needed
async function handleIndexerHealth(env){
  if(!env.INDEX_DB){
    return json({ status:'disabled', reason:'INDEX_DB binding missing' });
  }
  try {
    // Probe for world_version existence
    const probe = await env.INDEX_DB.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='world_version'").all();
    if(!probe.results || probe.results.length === 0){
      return json({ status:'uninitialized', world:null });
    }
    const { results } = await env.INDEX_DB.prepare("SELECT version_number, world_address, contracts_version FROM world_version WHERE archived_at IS NULL ORDER BY version_number DESC LIMIT 1").all();
    return json({ status:'ok', world: results?.[0] || null });
  } catch(e){
    return json({ status:'error', error: String(e) });
  }
}

// (Fallback token removed after initial migration bootstrap)

async function handleIndexerMigrate(req, env){
  if(req.method !== 'POST') return json({ error:'Method Not Allowed' },405);
  const token = req.headers.get('X-Indexer-Admin');
  const expected = (env.INDEXER_ADMIN_TOKEN||'').trim();
  const provided = (token||'').trim();
  if(!provided || provided !== expected) return json({ error:'Unauthorized' },401);
  if(!env.INDEX_DB) return json({ error:'INDEX_DB binding missing' },500);
  // Simple idempotent executor: runs all migrations in numeric order; tracks applied via world_version.version_number presence NOT sufficient → create _migrations table.
  await env.INDEX_DB.exec("CREATE TABLE IF NOT EXISTS _migrations (id TEXT PRIMARY KEY, applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP)");
  const migrationList = ['001_init'];
  const appliedRes = await env.INDEX_DB.prepare("SELECT id FROM _migrations").all();
  const applied = new Set((appliedRes?.results||[]).map(r=>r.id));
  const executed=[]; const skipped=[];
  for(const m of migrationList){
    if(applied.has(m)){ skipped.push(m); continue; }
    const path = `/migrations/${m}.sql`;
    try {
      const origin = new URL(req.url).origin;
      const sqlResp = await env.ASSETS.fetch(origin + path);
      if(!sqlResp.ok){ return json({ error:'Migration file fetch failed', migration:m, status: sqlResp.status },500); }
      let sqlText = await sqlResp.text();
      sqlText = sqlText.replace(/\r\n/g,'\n');
      if(sqlText.charCodeAt(0)===0xFEFF) sqlText = sqlText.slice(1);
      // Remove meta lines starting with '.' entirely before execution
      const cleaned = sqlText.split('\n').filter(l=>!l.trim().startsWith('.')).join('\n');
      try {
        await env.INDEX_DB.exec(cleaned);
      } catch(primaryErr){
        // Fallback: naive split on semicolons outside strings
        const fallbackStatements = [
          `CREATE TABLE IF NOT EXISTS world_version (\n  id INTEGER PRIMARY KEY AUTOINCREMENT,\n  version_number INTEGER NOT NULL UNIQUE,\n  world_address TEXT NOT NULL,\n  contracts_version TEXT DEFAULT '',\n  cycle_start TIMESTAMP NULL,\n  started_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,\n  archived_at TIMESTAMP NULL\n);`,
          `CREATE INDEX IF NOT EXISTS idx_world_version_active ON world_version(archived_at);`,
          `CREATE TABLE IF NOT EXISTS smart_assembly (\n  id TEXT PRIMARY KEY,\n  world_version INTEGER NOT NULL REFERENCES world_version(id) ON DELETE RESTRICT,\n  type TEXT NOT NULL,\n  state TEXT NOT NULL,\n  name TEXT DEFAULT '',\n  system_id INTEGER NOT NULL,\n  owner_address TEXT NOT NULL,\n  owner_name TEXT DEFAULT '',\n  type_id INTEGER,\n  energy_usage INTEGER DEFAULT 0,\n  hash TEXT NOT NULL,\n  last_seen_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,\n  updated_at TIMESTAMP NULL\n);`,
          `CREATE INDEX IF NOT EXISTS idx_smart_assembly_world ON smart_assembly(world_version);`,
            `CREATE INDEX IF NOT EXISTS idx_smart_assembly_type_state ON smart_assembly(type, state);`,
            `CREATE INDEX IF NOT EXISTS idx_smart_assembly_system ON smart_assembly(system_id);`,
          `CREATE TABLE IF NOT EXISTS smart_gate_direction (\n  gate_id TEXT NOT NULL REFERENCES smart_assembly(id) ON DELETE CASCADE,\n  world_version INTEGER NOT NULL REFERENCES world_version(id) ON DELETE RESTRICT,\n  origin_system_id INTEGER NOT NULL,\n  destination_system_id INTEGER NOT NULL,\n  linked BOOLEAN NOT NULL DEFAULT 0,\n  online BOOLEAN NOT NULL DEFAULT 0,\n  traversal_cost INTEGER NOT NULL DEFAULT 0,\n  last_change_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,\n  PRIMARY KEY (gate_id, origin_system_id, destination_system_id)\n);`,
          `CREATE INDEX IF NOT EXISTS idx_gate_direction_world ON smart_gate_direction(world_version);`,
          `CREATE INDEX IF NOT EXISTS idx_gate_direction_origin ON smart_gate_direction(origin_system_id);`,
          `CREATE INDEX IF NOT EXISTS idx_gate_direction_dest ON smart_gate_direction(destination_system_id);`,
          `CREATE TABLE IF NOT EXISTS gate_acl (\n  gate_id TEXT NOT NULL REFERENCES smart_assembly(id) ON DELETE CASCADE,\n  world_version INTEGER NOT NULL REFERENCES world_version(id) ON DELETE RESTRICT,\n  wallet_address TEXT NOT NULL,\n  access_level TEXT NOT NULL DEFAULT 'allow',\n  expires_at TIMESTAMP NULL,\n  added_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,\n  PRIMARY KEY (gate_id, wallet_address)\n);`,
          `CREATE INDEX IF NOT EXISTS idx_gate_acl_world ON gate_acl(world_version);`,
          `CREATE TABLE IF NOT EXISTS gate_access_cache (\n  gate_id TEXT NOT NULL REFERENCES smart_assembly(id) ON DELETE CASCADE,\n  world_version INTEGER NOT NULL REFERENCES world_version(id) ON DELETE RESTRICT,\n  visibility_class TEXT NOT NULL,\n  tribe_id TEXT NOT NULL DEFAULT '',\n  direction_origin_system_id INTEGER NOT NULL DEFAULT 0,\n  direction_destination_system_id INTEGER NOT NULL DEFAULT 0,\n  snapshot_version INTEGER NOT NULL,\n  computed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,\n  PRIMARY KEY (gate_id, visibility_class, tribe_id, direction_origin_system_id, direction_destination_system_id)\n);`,
          `CREATE INDEX IF NOT EXISTS idx_gate_access_cache_world ON gate_access_cache(world_version);`,
          `CREATE INDEX IF NOT EXISTS idx_gate_access_cache_tribe ON gate_access_cache(tribe_id);`,
          `CREATE TABLE IF NOT EXISTS structure_generic (\n  id TEXT PRIMARY KEY REFERENCES smart_assembly(id) ON DELETE CASCADE,\n  world_version INTEGER NOT NULL REFERENCES world_version(id) ON DELETE RESTRICT,\n  visibility TEXT NOT NULL DEFAULT 'public',\n  org_id TEXT NULL,\n  meta_json TEXT NULL\n);`,
          `CREATE TABLE IF NOT EXISTS adjacency_snapshot_meta (\n  id INTEGER PRIMARY KEY AUTOINCREMENT,\n  world_version INTEGER NOT NULL REFERENCES world_version(id) ON DELETE RESTRICT,\n  snapshot_version INTEGER NOT NULL,\n  gate_edge_count INTEGER NOT NULL,\n  published_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,\n  build_duration_ms INTEGER NOT NULL,\n  coalesced_events INTEGER NOT NULL DEFAULT 0\n);`,
          `CREATE INDEX IF NOT EXISTS idx_adj_snapshot_world ON adjacency_snapshot_meta(world_version);`,
          `CREATE UNIQUE INDEX IF NOT EXISTS u_adj_snapshot_world_version ON adjacency_snapshot_meta(world_version, snapshot_version);`,
          `CREATE TABLE IF NOT EXISTS indexer_run (\n  id INTEGER PRIMARY KEY AUTOINCREMENT,\n  world_version INTEGER NOT NULL REFERENCES world_version(id) ON DELETE RESTRICT,\n  run_started_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,\n  run_finished_at TIMESTAMP NULL,\n  mode TEXT NOT NULL,\n  assemblies_scanned INTEGER DEFAULT 0,\n  rows_added INTEGER DEFAULT 0,\n  rows_updated INTEGER DEFAULT 0,\n  rows_removed INTEGER DEFAULT 0,\n  gate_edges_rebuilt INTEGER DEFAULT 0,\n  snapshot_version INTEGER NULL,\n  error_count INTEGER DEFAULT 0,\n  notes TEXT NULL\n);`,
          `CREATE INDEX IF NOT EXISTS idx_indexer_run_world ON indexer_run(world_version);`,
          `CREATE INDEX IF NOT EXISTS idx_indexer_run_mode ON indexer_run(mode);`
        ];
        for(let i=0;i<fallbackStatements.length;i++){
          const stmt = fallbackStatements[i];
          try { await env.INDEX_DB.prepare(stmt).run(); } catch(e){ return json({ error:'Migration failed', migration:m, message:String(e), fallbackIndex:i, statement:stmt.slice(0,160) },500); }
        }
      }
      await env.INDEX_DB.prepare("INSERT INTO _migrations (id) VALUES (?)").bind(m).run();
      executed.push(m);
    } catch(e){
      return json({ error:'Migration failed', migration:m, message:String(e), executed, skipped });
    }
  }
  return json({ status:'migrated', executed, skipped });
}

// Bootstrap or advance world_version based on /config world address + contractsVersion.
// POST /api/indexer-bootstrap  (admin token required)
// Behavior:
//   - If no active world_version: insert version_number=1
//   - If active exists and world_address unchanged: update contracts_version if changed (no version bump)
//   - If world_address changed: archive existing active rows (set archived_at) and insert new version_number=prev+1
// Returns: { action, world }
async function handleIndexerBootstrap(req, env){
  if(req.method !== 'POST') return json({ error:'Method Not Allowed' },405);
  const token = req.headers.get('X-Indexer-Admin');
  const expected = (env.INDEXER_ADMIN_TOKEN||'').trim();
  const provided = (token||'').trim();
  if(!provided || provided !== expected) return json({ error:'Unauthorized' },401);
  if(!env.INDEX_DB) return json({ error:'INDEX_DB binding missing' },500);
  let cfgRaw; try {
    const resp = await fetch(WORLD_API_BASE + '/config');
    if(!resp.ok) return json({ error:'config_fetch_failed', status:resp.status },502);
    cfgRaw = await resp.json();
  } catch(e){ return json({ error:'config_fetch_error', message:String(e) },502); }
  const cfg = Array.isArray(cfgRaw) ? cfgRaw[0] : cfgRaw;
  const worldAddress = cfg?.contracts?.world?.address || '';
  const contractsVersion = cfg?.contractsVersion || '';
  if(!worldAddress) return json({ error:'missing_world_address' },500);
  try {
    const currentRes = await env.INDEX_DB.prepare("SELECT id, version_number, world_address, contracts_version FROM world_version WHERE archived_at IS NULL ORDER BY version_number DESC LIMIT 1").all();
    const current = currentRes.results?.[0] || null;
    if(!current){
      // insert first
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
    // world address changed -> archive and insert new version_number = previous + 1
    const newVersion = (current.version_number||0)+1;
    await env.INDEX_DB.prepare("UPDATE world_version SET archived_at=CURRENT_TIMESTAMP WHERE archived_at IS NULL").run();
    await env.INDEX_DB.prepare("INSERT INTO world_version (version_number, world_address, contracts_version) VALUES (?, ?, ?)").bind(newVersion, worldAddress, contractsVersion).run();
    const latest = await env.INDEX_DB.prepare("SELECT id, version_number, world_address, contracts_version FROM world_version WHERE archived_at IS NULL ORDER BY version_number DESC LIMIT 1").all();
    return json({ action:'version_bumped', world: latest.results?.[0]||null });
  } catch(e){
    return json({ error:'bootstrap_failed', message:String(e) });
  }
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
    return { version:1, updatedAt:new Date().toISOString(), counters:{}, sums:{}, date:key.startsWith('daily/')? key.slice(6) : undefined };
  }
  try { return JSON.parse(raw); } catch { return { version:1, updatedAt:new Date().toISOString(), counters:{}, sums:{} }; }
}

function applyEvent(snapshot, type, body){
  const def = EVENT_MAP[type]; if(!def) return false;
  snapshot.updatedAt = new Date().toISOString();
  if(def.counters){ def.counters.forEach(k=>{ snapshot.counters[k] = (snapshot.counters[k]||0)+1; }); }
  if(def.extraCounters){ (def.extraCounters(body||{})||[]).forEach(k=>{ snapshot.counters[k] = (snapshot.counters[k]||0)+1; }); }
  if(def.countersDynamic){ (def.countersDynamic(body||{})||[]).forEach(k=>{ snapshot.counters[k] = (snapshot.counters[k]||0)+1; }); }
  if(def.sum){ const v = Number(body?.[def.sum.valueField]); if(isFinite(v) && v>=0){ snapshot.sums[def.sum.key] = (snapshot.sums[def.sum.key]||0)+v; snapshot.sums[def.sum.countKey] = (snapshot.sums[def.sum.countKey]||0)+1; } }
  return true;
}

async function handleUsageEvent(req, env){
  if(req.method !== 'POST') return new Response('Method Not Allowed',{ status:405 });
  let body={}; try { body = req.headers.get('content-type')?.includes('application/json') ? await req.json() : {}; } catch { return new Response('Invalid JSON',{ status:400 }); }
  const events = Array.isArray(body.events) ? body.events : (body.type ? [{ type: body.type, body: body.body || body }] : []);
  if(!events.length) return new Response('Missing events',{ status:400 });
  const current = await loadSnapshot(env.EF_STATS, 'current'); upgradeSnapshot(current);
  const day = new Date().toISOString().slice(0,10);
  const dailyKey = 'daily/' + day + '.json';
  const daily = await loadSnapshot(env.EF_STATS, dailyKey); upgradeSnapshot(daily);
  let appliedAny=false;
  for(const evt of events){
    try {
      if(typeof evt.type !== 'string') continue; if(!EVENT_MAP[evt.type]) continue;
      const ok1 = applyEvent(current, evt.type, evt.body||{});
      const ok2 = applyEvent(daily, evt.type, evt.body||{});
      if(ok1 && ok2) appliedAny=true;
    } catch(e){
      try { applyEvent(current, 'ingestion_error', {}); applyEvent(daily, 'ingestion_error', {}); appliedAny=true; } catch{/* ignore */}
    }
  }
  if(appliedAny){ await env.EF_STATS.put('current', JSON.stringify(current)); await env.EF_STATS.put(dailyKey, JSON.stringify(daily)); }
  return new Response(null,{ status:204 });
}

async function handleStats(url, env){
  let raw = await env.EF_STATS.get('current');
  if(!raw) raw = JSON.stringify({ version:1, updatedAt:new Date().toISOString(), counters:{}, sums:{} });
  const histParam = url.searchParams.get('history');
  const debug = url.searchParams.get('debug')==='1';
  let history=[]; let histDays=0; if(histParam){ histDays = Math.min(120, Math.max(1, parseInt(histParam,10)||0)); }
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
  // Filter out accidental duplicate keys with double .json extension (daily/YYYY-MM-DD.json.json)
  const filtered = all.filter(k=>!k.endsWith('.json.json'));
  foundKeys = filtered.slice(-histDays);
      for(const k of foundKeys){
        const dr = await env.EF_STATS.get(k);
        if(dr){
          try {
            history.push(JSON.parse(dr));
          } catch(e){
            if(debug){
              history.push({ date:k.split('/').pop(), parse_error:true, message:String(e).slice(0,80), preview: dr.slice(0,120) });
            }
          }
        }
      }
    } catch(e){ if(debug){ history.push({ error:'list_failed', message:String(e) }); } }
  }
  if(debug){
    return json({ current: JSON.parse(raw), history, debug:{ mode:'list', requestedDays: histDays, foundDailyKeys: foundKeys } });
  }
  return json({ current: JSON.parse(raw), history });
}

// Migration: copy missing daily snapshots from EF_STATS_OLD -> EF_STATS (idempotent)
async function handleMigrateHistory(url, env){
  if(!env.EF_STATS_OLD) return json({ error:'EF_STATS_OLD not bound' },500);
  const confirm = url.searchParams.get('confirm')==='1';
  const dry = url.searchParams.get('dry')==='1';
  let copied=0, skipped=0, existing=0, errors=[]; const toCopy=[];
  try {
    let cursor=null; const oldKeys=[];
    do {
      const list = await env.EF_STATS_OLD.list({ prefix:'daily/', cursor });
      list.keys.forEach(k=>{ if(k.name.endsWith('.json')) oldKeys.push(k.name); });
      cursor = list.list_complete? null : list.cursor;
    } while(cursor);
    oldKeys.sort();
    for(const k of oldKeys){
      const cur = await env.EF_STATS.get(k);
      if(cur){ existing++; continue; }
      toCopy.push(k);
    }
    if(!confirm){
      return json({ mode:'plan', toCopyCount: toCopy.length, existing, note:'Re-run with ?confirm=1 to execute. Use &dry=1 to simulate writes.' });
    }
    for(const k of toCopy){
      try {
        const v = await env.EF_STATS_OLD.get(k);
        if(!v){ skipped++; continue; }
        if(!dry) await env.EF_STATS.put(k, v);
        copied++;
      } catch(e){ errors.push({ key:k, message:String(e) }); }
    }
  } catch(e){ return json({ error:'migrate_failed', message:String(e) },500); }
  return json({ mode: dry? 'dry-run':'migrated', copied, skipped, existing, errors });
}

function json(obj, status=200){ return new Response(JSON.stringify(obj), { status, headers:{ 'Content-Type':'application/json','Cache-Control':'no-store' } }); }

export default {
  async fetch(req, env, ctx){
    const url = new URL(req.url);
    const p = url.pathname;
    // Short share persistent path /s/<id>: serve index.html without redirect so URL stays short.
    if(p.startsWith('/s/')){
      const id = p.slice(3).replace(/[^A-Za-z0-9_-]/g,'');
      if(!id) return new Response('Not found',{ status:404 });
      // Best-effort existence check (avoid 404 after app boot). If not found -> 404 now.
      const exists = await env.EF_SHARES.get(id);
      if(exists === null) return new Response('Not found', { status:404 });
      // Re-map request to root so SPA bootstraps; keep original URL (no history rewrite from server).
      const rootUrl = new URL(req.url); rootUrl.pathname = '/'; rootUrl.search = '';
      const indexResp = await env.ASSETS.fetch(new Request(rootUrl.toString(), req));
      // Return as-is; client will detect window.location.pathname /s/<id> and fetch share.
      return indexResp;
    }
  // Cloudflare-only endpoints post-cutover (Netlify fallbacks removed)
  if(p === '/api/create-share') return handleCreateShare(req, env);
  if(p === '/api/get-share') return handleGetShare(url, env);
  if(p === '/api/usage-event') return handleUsageEvent(req, env);
  if(p === '/api/stats') return handleStats(url, env);
  if(p === '/api/migrate-history') return handleMigrateHistory(url, env);
  if(p === '/api/indexer-health') return handleIndexerHealth(env);
  if(p === '/api/indexer-migrate') return handleIndexerMigrate(req, env);
  if(p === '/api/indexer-bootstrap') return handleIndexerBootstrap(req, env);
    // Temporary diagnostic endpoints (will remove after history verification)
    if(p === '/api/list-stats'){
      try {
        const out={ daily:[], other:[] };
        let cursor=null; do {
          const list = await env.EF_STATS.list({ cursor });
          list.keys.forEach(k=>{ if(k.name.startsWith('daily/')) out.daily.push(k.name); else out.other.push(k.name); });
          cursor = list.list_complete? null : list.cursor;
        } while(cursor);
        out.daily.sort(); out.other.sort();
        return json(out);
      } catch(e){ return json({ error:'list_failed', message:String(e) },500); }
    }
    if(p === '/api/debug-kv'){
      const limit = parseInt(url.searchParams.get('limit')||'50',10);
      const prefix = url.searchParams.get('prefix')||'';
      try {
        const list = await env.EF_STATS.list({ prefix, limit: Math.min(1000, Math.max(1, limit)) });
        return json({ keys: list.keys.map(k=>({ name:k.name, expiration:k.expiration, metadata:k.metadata })), list_complete: list.list_complete });
      } catch(e){ return json({ error:'debug_failed', message:String(e) },500); }
    }
    // Fallback to assets (static site) – will serve SPA.
  const resp = await env.ASSETS.fetch(req);
  // Add diagnostic header so we can confirm this worker variant is serving responses.
  const newHeaders = new Headers(resp.headers);
  newHeaders.set('X-Stats-Impl','root-list-v1');
  return new Response(resp.body, { status: resp.status, statusText: resp.statusText, headers: newHeaders });
  }
};
