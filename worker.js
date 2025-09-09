// Cloudflare Worker – Expanded Sandbox Implementation
// Endpoints:
//   POST /api/create-share        -> { id }
//   GET  /api/get-share?id=ID     -> { data }
//   POST /api/usage-event         -> accepts single {type, ...} or { events:[{type, body}, ...] }
//   GET  /api/stats[?history=7]   -> { current, history:[] }
//   GET  /s/<id>                  -> Serve SPA index (no redirect) and let client resolve short id in-place
//   POST /api/indexer-migrate     -> run DB migrations (admin)
//   POST /api/indexer-bootstrap   -> ensure world_version row (admin)
//   POST /api/indexer-ingest      -> ingestion (stub or store modes) (admin)
//   GET  /api/indexer-health      -> counts, cursor, pending changes
// Namespaces: EF_SHARES, EF_STATS, (optional) INDEX_DB (D1)
// No PII stored.

// Schema + event catalog (mirrors Pages _worker)
const SCHEMA_VERSION = 2;
const WORLD_API_BASE = 'https://world-api-stillness.live.tech.evefrontier.com';
// EVENT_MAP as plain object (root worker references via property indexing)
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
};

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

// Ingestion endpoint (stub | store | store_all)
export async function handleIndexerIngest(req, env){
  if(req.method !== 'POST') return json({ error:'Method Not Allowed' },405);
  if(!env.INDEX_DB) return json({ error:'INDEX_DB binding missing' },500);
  // Preview bypass parity with app worker: allow ?openPreview=1 on *.pages.dev when token missing/mismatch
  const token = req.headers.get('X-Indexer-Admin');
  const expected = (env.INDEXER_ADMIN_TOKEN||'').trim();
  const host = req.headers.get('host')||'';
  const isPreviewHost = host.endsWith('.pages.dev');
  let bypassAuth=false; try { const u=new URL(req.url); bypassAuth = isPreviewHost && u.searchParams.get('openPreview')==='1' && (!!expected ? token?.trim() !== expected : !token); } catch{}
  if(expected && token?.trim() !== expected && !bypassAuth) return json({ error:'Unauthorized' },401);
  let body={}; try { if(req.headers.get('content-type')?.includes('application/json')) body = await req.json(); } catch { body={}; }
  const baseMode = body.mode === 'store' ? 'store' : 'stub';
  const extendedMode = body.mode === 'store_all' ? 'store_all' : baseMode;
  const rawDelay = Number(body.delayMs);
  const delayMs = isFinite(rawDelay) ? Math.min(5000, Math.max(0, rawDelay)) : 0;
  // Ensure base tables & cursor
  await env.INDEX_DB.exec("CREATE TABLE IF NOT EXISTS gate_tombstone (id INTEGER PRIMARY KEY AUTOINCREMENT, gate_id TEXT NOT NULL, world_version INTEGER NOT NULL, deleted_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP);");
  await env.INDEX_DB.exec("CREATE TABLE IF NOT EXISTS event_cursor (id INTEGER PRIMARY KEY CHECK (id = 1), last_block_number INTEGER NOT NULL DEFAULT 0, last_log_index INTEGER NOT NULL DEFAULT 0, updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP);");
  await env.INDEX_DB.exec("INSERT INTO event_cursor (id, last_block_number, last_log_index) SELECT 1,0,0 WHERE NOT EXISTS (SELECT 1 FROM event_cursor WHERE id=1);");
  const curRes = await env.INDEX_DB.prepare("SELECT id, last_block_number, last_log_index, updated_at FROM event_cursor WHERE id=1").all();
  let cursor = curRes.results?.[0] || null;
  const w = await env.INDEX_DB.prepare("SELECT id FROM world_version WHERE archived_at IS NULL ORDER BY version_number DESC LIMIT 1").all();
  const worldId = w.results?.[0]?.id || null;
  if(!worldId) return json({ error:'no_active_world_version' },500);
  // Insert run row; include optional triggerSource if provided in body (cron/manual) for observability
  const triggerSource = typeof body.triggerSource === 'string' ? body.triggerSource.slice(0,16) : 'manual';
  await env.INDEX_DB.prepare("INSERT INTO indexer_run (world_version, mode, assemblies_scanned, rows_added, rows_updated, rows_removed, gate_edges_rebuilt, snapshot_version, notes) VALUES (?, ?, 0,0,0,0,0,NULL,?)")
    .bind(worldId, extendedMode, (extendedMode==='store'?'store ingest start':(extendedMode==='store_all'?'store_all raw capture start':'stub start')) + ' src:'+triggerSource)
    .run();
  const started = await env.INDEX_DB.prepare("SELECT id, run_started_at FROM indexer_run WHERE world_version=? ORDER BY id DESC LIMIT 1").bind(worldId).all();
  const runId = started.results?.[0]?.id;
  if(delayMs>0) await new Promise(r=>setTimeout(r, delayMs));

  if(extendedMode === 'store_all'){
    // Updated store_all with batching & segmentation cap (parity with Pages worker enhancements)
    try {
      // Define finalizeRun early so ALL early returns can close the run (previously some exits left runs open)
      async function finalizeRun(note){
        if(!runId) return; try {
          await env.INDEX_DB.prepare("UPDATE indexer_run SET run_finished_at=CURRENT_TIMESTAMP, run_duration_ms=(julianday(CURRENT_TIMESTAMP)-julianday(run_started_at))*86400000, notes=COALESCE(notes,'') || ' ' || ? WHERE id=? AND run_finished_at IS NULL").bind(note.slice(0,200), runId).run();
        } catch{/* ignore */}
      }
      const RPC = env.PYROPE_RPC || body.rpc || '';
      const WORLD = (env.WORLD_ADDRESS || body.world || '').toLowerCase();
      if(!RPC || !WORLD){ await finalizeRun('early_fail missing_rpc_or_world'); return json({ error:'missing_rpc_or_world' },400); }
      const CONFIRM_DEPTH = BigInt(env.CONFIRM_DEPTH || body.confirmDepth || 8);
      const deployBlock = BigInt(env.DEPLOY_BLOCK || body.deployBlock || 0);
      const maxBlocks = Math.min(Number(body.maxBlocks||2000),20000);
      const segmentBlocks = Math.min(Number(body.segmentBlocks||0)||0, maxBlocks);
  // Throttle between segment RPC calls (preview parity). Accept body.throttleMs or env.INDEXER_THROTTLE_MS (clamped 0..60000)
  const throttleMs = Math.min(60000, Math.max(0, parseInt(body.throttleMs || env.INDEXER_THROTTLE_MS || '0',10)||0));
  // Limit number of segments processed in a single invocation; 0 => unlimited (bounded by MAX_SEG_REQ)
  const maxSegments = Math.min(Math.max(1, parseInt(body.maxSegments || env.INDEXER_MAX_SEGMENTS || '0',10)||0), 500);
      const rowCap = Math.min(Number(body.rowCap||50000),200000);
      // Ensure schema
      try {
        await env.INDEX_DB.exec("CREATE TABLE IF NOT EXISTS raw_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, block_number INTEGER NOT NULL, log_index INTEGER NOT NULL, tx_hash TEXT NOT NULL, address TEXT NOT NULL, topic0 TEXT NULL, topic1 TEXT NULL, topic2 TEXT NULL, topic3 TEXT NULL, data TEXT NOT NULL, created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP);");
        await env.INDEX_DB.exec("CREATE UNIQUE INDEX IF NOT EXISTS u_raw_logs_block_logindex ON raw_logs(block_number, log_index);");
        await env.INDEX_DB.exec("CREATE INDEX IF NOT EXISTS idx_raw_logs_block ON raw_logs(block_number);");
        await env.INDEX_DB.exec("CREATE INDEX IF NOT EXISTS idx_raw_logs_address ON raw_logs(address);");
        await env.INDEX_DB.exec("CREATE INDEX IF NOT EXISTS idx_raw_logs_topic0 ON raw_logs(topic0);");
      } catch(e){ await finalizeRun('early_fail raw_logs_ddl_failed'); return json({ error:'raw_logs_ddl_failed', message:String(e) },500); }
  async function rpc(method, params){ const r = await fetch(RPC,{ method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ jsonrpc:'2.0', id:1, method, params }) }); if(!r.ok) throw new Error('rpc_http_'+r.status); const j = await r.json(); if(j.error) throw new Error('rpc_'+j.error.message); return j.result; }
  let latestHex; try { latestHex = await rpc('eth_blockNumber', []); } catch(e){ await finalizeRun('head_fetch_failed'); return json({ error:'head_fetch_failed', message:String(e) },502); }
      const latest = BigInt(latestHex);
      if(latest < deployBlock + CONFIRM_DEPTH){
        await finalizeRun('store_all head_too_low');
        return json({ status:'head_too_low', latest:Number(latest) });
      }
      const finalizedHead = latest - CONFIRM_DEPTH;
      let startBlock = BigInt(cursor?.last_block_number||0) + 1n;
      if(startBlock < deployBlock) startBlock = deployBlock;
      if(startBlock > finalizedHead){
        await finalizeRun('store_all up_to_date');
        return json({ status:'up_to_date', cursor, bypassAuth });
      }
      const endBlock = startBlock + BigInt(maxBlocks);
      const toBlock = endBlock > finalizedHead ? finalizedHead : endBlock;
      let inserted=0; let uniqueTopics=new Set(); let firstBlock=null; let lastBlock=null; let attempted=0; const insertErrors=[];
      // Safe batch sizing: D1 has a ~100 parameter per statement limit. Each row consumes 9 params.
      // Compute safe upper bound (floor(100/9)=11). Allow caller override only to lower it.
      const REPORTED_BATCH = Number(body.batchSize||150);
      const MAX_PARAMS = 100; // conservative ceiling
      const PARAMS_PER_ROW = 9;
      const SAFE_CAP = Math.max(1, Math.floor(MAX_PARAMS / PARAMS_PER_ROW)); // => 11
      const BATCH_SIZE = Math.min(Math.max(1, REPORTED_BATCH), SAFE_CAP);
      let pending=[]; let batchFlushes=0; let paramLimitEncountered=false;
      async function execInsert(rows){
        if(!rows.length) return 0;
        // Split further if rows * PARAMS_PER_ROW exceed MAX_PARAMS (defensive; should not with SAFE_CAP but guard anyway)
        if(rows.length * PARAMS_PER_ROW > MAX_PARAMS){
          let insertedLocal=0;
          for(let i=0;i<rows.length;i+=SAFE_CAP){
            insertedLocal += await execInsert(rows.slice(i, i+SAFE_CAP));
          }
          return insertedLocal;
        }
        const placeholders = rows.map(()=> '(?,?,?,?,?,?,?,?,?)').join(',');
        const sql = `INSERT OR IGNORE INTO raw_logs (block_number, log_index, tx_hash, address, topic0, topic1, topic2, topic3, data) VALUES ${placeholders}`;
        const flat=[]; for(const r of rows) flat.push(...r);
        try {
          await env.INDEX_DB.prepare(sql).bind(...flat).run();
          return rows.length;
        } catch(e){
          const msg = String(e);
            // Detect param limit; fallback to single-row inserts to salvage data
            if(/too many sql variables/i.test(msg) || /too many SQL variables/i.test(msg)){
              paramLimitEncountered=true;
              // Fallback per-row salvage
              let salvaged=0;
              for(const single of rows){
                try {
                  await env.INDEX_DB.prepare('INSERT OR IGNORE INTO raw_logs (block_number, log_index, tx_hash, address, topic0, topic1, topic2, topic3, data) VALUES (?,?,?,?,?,?,?,?,?)').bind(...single).run();
                  salvaged++;
                } catch(inner){ /* ignore individual failures */ }
              }
              insertErrors.push(msg.slice(0,160)+' salvage:'+salvaged+'/'+rows.length);
              return salvaged;
            }
            insertErrors.push(msg.slice(0,160));
            return 0;
        }
      }
      async function flush(){ if(!pending.length) return; const toInsert = pending; pending=[]; const added = await execInsert(toInsert); inserted += added; batchFlushes++; }
      async function handleLogs(logs){
        for(const log of logs){
          if(inserted + pending.length >= rowCap) break;
          const bn = Number(BigInt(log.blockNumber)); if(firstBlock===null) firstBlock=bn; lastBlock=bn;
          const t0 = (log.topics&&log.topics[0])? log.topics[0] : null;
          uniqueTopics.add((t0||'').toLowerCase());
          attempted++;
            pending.push([bn, Number(log.logIndex||0), log.transactionHash||'', (log.address||'').toLowerCase(), t0, log.topics?.[1]||null, log.topics?.[2]||null, log.topics?.[3]||null, log.data||'0x']);
          if(pending.length >= BATCH_SIZE) await flush();
        }
      }
  const MAX_SEG_REQ = 40; let segRequests=0; let segmentsProcessed=0; let truncated=false;
      try {
        if(segmentBlocks && segmentBlocks > 0){
          let segFrom = startBlock; let dynamicSeg = BigInt(segmentBlocks);
          while(segFrom <= toBlock && (inserted + pending.length) < rowCap){
    if(maxSegments && segmentsProcessed >= maxSegments){ truncated=true; break; }
    if(segRequests >= MAX_SEG_REQ){ truncated=true; break; }
            const remaining = (toBlock - segFrom)+1n; if(dynamicSeg > remaining) dynamicSeg = remaining; if(dynamicSeg <= 0) break; const segTo = segFrom + dynamicSeg - 1n;
            let segLogs; try { segLogs = await rpc('eth_getLogs',[{ address: WORLD, fromBlock:'0x'+segFrom.toString(16), toBlock:'0x'+segTo.toString(16) }]); segRequests++; } catch(segErr){ await flush(); const advanceTo = (inserted < rowCap) ? Number(segFrom-1n) : Number(segTo); if(inserted){ await env.INDEX_DB.prepare("UPDATE event_cursor SET last_block_number=?, updated_at=CURRENT_TIMESTAMP WHERE id=1").bind(advanceTo).run(); } return json({ error:'log_fetch_failed', message:'segment_error:'+String(segErr), inserted, attempted, batchFlushes, segment:{ from:Number(segFrom), to:Number(segTo) }, segRequests, segmentsProcessed, truncated, bypassAuth }); }
            await handleLogs(segLogs); segmentsProcessed++; segFrom = segTo + 1n; if((inserted + pending.length) >= rowCap) break; }
        } else { const logs = await rpc('eth_getLogs',[{ address: WORLD, fromBlock:'0x'+startBlock.toString(16), toBlock:'0x'+toBlock.toString(16) }]); segRequests=1; segmentsProcessed=1; await handleLogs(logs); }
  } catch(e){ await flush(); await finalizeRun('store_all log_fetch_failed'); return json({ error:'log_fetch_failed', message:String(e), inserted, attempted, batchFlushes, segRequests, segmentsProcessed, truncated, bypassAuth }); }
      await flush();
      // Advance cursor ONLY if we actually inserted rows or hit rowCap (progress) and no param-limit fatal preventing all inserts.
      let advanceTo = null;
      if(inserted>0 || (inserted>=rowCap)){
        advanceTo = (inserted < rowCap) ? Number(toBlock) : (lastBlock!==null? lastBlock: Number(toBlock));
      } else if(!paramLimitEncountered){
        // No rows but also not a param limit -> still advance to avoid stuck loop (e.g., legitimately empty range)
        advanceTo = Number(toBlock);
      }
      if(advanceTo!==null){
        await env.INDEX_DB.prepare("UPDATE event_cursor SET last_block_number=?, updated_at=CURRENT_TIMESTAMP WHERE id=1").bind(advanceTo).run();
        const c2 = await env.INDEX_DB.prepare("SELECT id, last_block_number, last_log_index, updated_at FROM event_cursor WHERE id=1").all(); cursor = c2.results?.[0] || cursor;
      }
      const finalStatus = (paramLimitEncountered && inserted===0) ? 'param_limit_blocked' : 'ok';
      await finalizeRun('store_all '+finalStatus+' inserted:'+inserted+' batches:'+batchFlushes+' segReq:'+segRequests + (truncated?' truncated':'') + (paramLimitEncountered?' param_limit':''));
      return json({ status:finalStatus, mode:'store_all', cursor, range:{ from:Number(startBlock), to:Number(toBlock) }, inserted, attempted, batchFlushes, batchSize:BATCH_SIZE, insertErrorCount: insertErrors.length, firstInsertError: insertErrors[0]||null, uniqueTopics: Array.from(uniqueTopics), topicCount: uniqueTopics.size, rowCapApplied: rowCap, blocks:{ first:firstBlock, last:lastBlock }, bypassAuth, segRequests, segmentsProcessed, truncated, segmentBlocksRequested: segmentBlocks||0, throttleMsApplied: throttleMs, maxSegmentsApplied: maxSegments||0, paramLimitEncountered });
    } catch(e){
  try { if(runId) await env.INDEX_DB.prepare("UPDATE indexer_run SET run_finished_at=CURRENT_TIMESTAMP, run_duration_ms=(julianday(CURRENT_TIMESTAMP)-julianday(run_started_at))*86400000, notes=COALESCE(notes,'') || ' unhandled '+? WHERE id=? AND run_finished_at IS NULL").bind(String(e).slice(0,120), runId).run(); } catch{/* ignore */}
      return json({ error:'store_all_unhandled', message:String(e) },500);
    }
  }

  if(extendedMode === 'store'){
    const RPC = env.PYROPE_RPC || body.rpc || '';
    if(!RPC) return json({ error:'missing_rpc' },500);
    const WORLD = (env.WORLD_ADDRESS || body.world || '').toLowerCase();
    if(!WORLD) return json({ error:'missing_world' },500);
    const CONFIRM_DEPTH = BigInt(env.CONFIRM_DEPTH || body.confirmDepth || 8);
    const deployBlock = BigInt(env.DEPLOY_BLOCK || body.deployBlock || 0);
    const maxBlocks = Math.min(Number(body.maxBlocks||3000), 10000);
    const providedTopics = Array.isArray(body.topics)? body.topics : null;
    if(!providedTopics) return json({ error:'missing_topics_prehashed', note:'Provide body.topics (array of topic0 hashes)' },400);
    async function rpc(method, params){ const res2 = await fetch(RPC, { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ jsonrpc:'2.0', id:1, method, params }) }); if(!res2.ok) throw new Error('rpc_http_'+res2.status); const j = await res2.json(); if(j.error) throw new Error('rpc_'+j.error.message); return j.result; }
    const latestHex = await rpc('eth_blockNumber', []); const latest = BigInt(latestHex);
    if(latest < deployBlock + CONFIRM_DEPTH) return json({ status:'head_too_low', latest: Number(latest), need: Number(deployBlock + CONFIRM_DEPTH), bypassAuth });
    const finalizedHead = latest - CONFIRM_DEPTH;
    let startBlock = BigInt(cursor?.last_block_number||0) + 1n; if(startBlock < deployBlock) startBlock = deployBlock; if(startBlock > finalizedHead) return json({ status:'up_to_date', cursor, bypassAuth });
    const endBlock = startBlock + BigInt(maxBlocks); const toBlock = endBlock > finalizedHead ? finalizedHead : endBlock;
    let rawEvents=0, newTables=0, existingTables=0; const fromBlockNum = Number(startBlock), toBlockNum = Number(toBlock);
    for(const topic of providedTopics){ try { const logs = await rpc('eth_getLogs', [{ address: WORLD, topics:[topic], fromBlock:'0x'+startBlock.toString(16), toBlock:'0x'+toBlock.toString(16) }]); for(const log of logs){ rawEvents++; const tableId = (log.topics && log.topics[1]) ? log.topics[1].toLowerCase():null; if(!tableId) continue; try { await env.INDEX_DB.prepare("INSERT INTO store_events (block_number, log_index, tx_hash, topic0, table_id, key_hex, field_index, value_hex, ephemeral) VALUES (?,?,?,?,?,?,?,?,?)").bind(Number(BigInt(log.blockNumber)), log.logIndex||0, log.transactionHash||'', log.topics[0]||'', tableId, (log.topics?.[2]||''), null, log.data||'', topic.includes('ephemeral')?1:0).run(); } catch{} const existing = await env.INDEX_DB.prepare("SELECT table_id FROM table_registry WHERE table_id=?").bind(tableId).all(); if(existing.results && existing.results.length){ existingTables++; await env.INDEX_DB.prepare("UPDATE table_registry SET last_block=?, appearances=appearances+1 WHERE table_id=?").bind(Number(BigInt(log.blockNumber)), tableId).run(); } else { newTables++; await env.INDEX_DB.prepare("INSERT INTO table_registry (table_id, first_block, last_block, appearances, finalized) VALUES (?,?,?,?,0)").bind(tableId, Number(BigInt(log.blockNumber)), Number(BigInt(log.blockNumber)), 1).run(); } } } catch{} }
    await env.INDEX_DB.prepare("UPDATE table_registry SET finalized=1 WHERE finalized=0 AND last_block <= ?").bind(Number(finalizedHead)).run();
    await env.INDEX_DB.prepare("UPDATE event_cursor SET last_block_number=?, updated_at=CURRENT_TIMESTAMP WHERE id=1").bind(Number(toBlock)).run();
    const cur2 = await env.INDEX_DB.prepare("SELECT id, last_block_number, last_log_index, updated_at FROM event_cursor WHERE id=1").all(); cursor = cur2.results?.[0] || cursor;
    if(runId){ const durRes = await env.INDEX_DB.prepare("SELECT (julianday(CURRENT_TIMESTAMP)-julianday(run_started_at))*86400000 AS ms FROM indexer_run WHERE id=?").bind(runId).all(); const ms = Math.max(0, Math.round(durRes.results?.[0]?.ms||0)); await env.INDEX_DB.prepare("UPDATE indexer_run SET run_finished_at=CURRENT_TIMESTAMP, run_duration_ms=?, assemblies_scanned=?, rows_added=?, rows_updated=?, rows_removed=?, gate_edges_rebuilt=?, error_count=?, notes=? WHERE id=?").bind(ms, 0, rawEvents, newTables, 0, 0, 0, `store events ${rawEvents}`, runId).run(); }
    return json({ status:'ok', mode:'store', cursor, range:{ from: fromBlockNum, to: toBlockNum }, rawEvents, newTables, existingTables, topics: providedTopics.length, bypassAuth });
  }

  // Stub simulation branch
  let cursorRes = cursor; // alias
  let events=[]; let highestBlock = cursorRes?.last_block_number || 0;
  const fromBlock = (cursorRes?.last_block_number||0)+1;
  try { const evResp = await fetch(WORLD_API_BASE + `/events?fromBlock=${fromBlock}&limit=50`); if(evResp.ok){ const data = await evResp.json(); if(Array.isArray(data?.events)){ events = data.events; highestBlock = Math.max(highestBlock, ...(events.map(e=>e.blockNumber||0))); } } } catch{}
  if(!events.length){
    const simCount = Math.min(3, Math.max(1, Number(body.simEvents)||2));
    for(let i=0;i<simCount;i++){ const blk = fromBlock + i; highestBlock = Math.max(highestBlock, blk); const gate=(i%2===0); events.push({ type:'assembly_upsert', id:`sim_${blk}_${i}`, systemId:1000+i, owner:'0xowner', state:'online', name:`Sim Assembly ${i}`, hash:`h${blk}_${i}`, blockNumber:blk, gate: gate? { directions:[{ origin_system_id:1000+i, destination_system_id:2000+i, linked:1, online:1, traversal_cost:0 }] }: null }); }
  }
  let assemblies_scanned=0, rows_added=0, rows_updated=0, rows_removed=0, gate_edges_rebuilt=0, error_count=0; const errors=[];
  for(const ev of events){
    if(ev.type==='assembly_upsert'){
      assemblies_scanned++;
      try { const existing = await env.INDEX_DB.prepare("SELECT id, hash FROM smart_assembly WHERE id=?").bind(ev.id).all(); if(existing.results && existing.results.length){ const ex = existing.results[0]; if(ex.hash!==ev.hash){ await env.INDEX_DB.prepare("UPDATE smart_assembly SET state=?, name=?, system_id=?, owner_address=?, last_seen_at=CURRENT_TIMESTAMP, hash=? WHERE id=?").bind(ev.state||'online', ev.name||'', ev.systemId||0, ev.owner||'', ev.hash, ev.id).run(); rows_updated++; } else { await env.INDEX_DB.prepare("UPDATE smart_assembly SET last_seen_at=CURRENT_TIMESTAMP WHERE id=?").bind(ev.id).run(); } } else { await env.INDEX_DB.prepare("INSERT INTO smart_assembly (id, world_version, type, state, name, system_id, owner_address, owner_name, type_id, energy_usage, hash, last_seen_at) VALUES (?, ?, ?, ?, ?, ?, ?, '', NULL, 0, ?, CURRENT_TIMESTAMP)").bind(ev.id, worldId, 'generic', ev.state||'online', ev.name||'', ev.systemId||0, ev.owner||'', ev.hash).run(); rows_added++; } if(ev.gate && Array.isArray(ev.gate.directions)){ await env.INDEX_DB.prepare("DELETE FROM smart_gate_direction WHERE gate_id=?").bind(ev.id).run(); for(const d of ev.gate.directions){ try { await env.INDEX_DB.prepare("INSERT INTO smart_gate_direction (gate_id, world_version, origin_system_id, destination_system_id, linked, online, traversal_cost) VALUES (?,?,?,?,?,?,?)").bind(ev.id, worldId, d.origin_system_id||0, d.destination_system_id||0, d.linked?1:0, d.online?1:0, d.traversal_cost||0).run(); gate_edges_rebuilt++; } catch(inner){ errors.push(String(inner).slice(0,120)); error_count++; } } } } catch(e2){ errors.push(String(e2).slice(0,160)); error_count++; }
    } else if(ev.type==='assembly_delete'){
      assemblies_scanned++; try { const existing = await env.INDEX_DB.prepare("SELECT id FROM smart_assembly WHERE id=?").bind(ev.id).all(); if(existing.results && existing.results.length){ await env.INDEX_DB.prepare("DELETE FROM smart_assembly WHERE id=?").bind(ev.id).run(); rows_removed++; try { await env.INDEX_DB.prepare("DELETE FROM smart_gate_direction WHERE gate_id=?").bind(ev.id).run(); } catch{} try { await env.INDEX_DB.prepare("INSERT INTO gate_tombstone (gate_id, world_version) VALUES (?, ?)").bind(ev.id, worldId).run(); } catch{} } } catch(e3){ errors.push(String(e3).slice(0,160)); error_count++; }
    }
  }
  if(events.length && assemblies_scanned){ const highestBlock2 = Math.max(...events.map(e=>e.blockNumber||0)); if(highestBlock2 > (cursorRes?.last_block_number||0)){ await env.INDEX_DB.prepare("UPDATE event_cursor SET last_block_number=?, updated_at=CURRENT_TIMESTAMP WHERE id=1").bind(highestBlock2).run(); const cur2 = await env.INDEX_DB.prepare("SELECT id, last_block_number, last_log_index, updated_at FROM event_cursor WHERE id=1").all(); cursor = cur2.results?.[0] || cursor; } }
  if(runId){ const durRes = await env.INDEX_DB.prepare("SELECT (julianday(CURRENT_TIMESTAMP)-julianday(run_started_at))*86400000 AS ms FROM indexer_run WHERE id=?").bind(runId).all(); const ms = Math.max(0, Math.round(durRes.results?.[0]?.ms||0)); const notes = errors.length? `processed with ${errors.length} errors`:'ok'; await env.INDEX_DB.prepare("UPDATE indexer_run SET run_finished_at=CURRENT_TIMESTAMP, run_duration_ms=?, assemblies_scanned=?, rows_added=?, rows_updated=?, rows_removed=?, gate_edges_rebuilt=?, error_count=?, notes=? WHERE id=?").bind(ms, assemblies_scanned, rows_added, rows_updated, rows_removed, gate_edges_rebuilt, error_count, notes, runId).run(); }
  const runRow = await env.INDEX_DB.prepare("SELECT id, run_started_at, run_finished_at, mode, run_duration_ms, assemblies_scanned, rows_added, rows_updated, rows_removed, gate_edges_rebuilt, error_count FROM indexer_run WHERE id=?").bind(runId).all();
  return json({ status:'ok', mode: extendedMode, cursor, run: runRow.results?.[0]||null, bypassAuth });
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
  // Add new migrations here in order. Each file: migrations/<id>.sql
  const migrationList = ['001_init','002_enrichment','003_cursor','004_run_duration','005_overlay','006_store_registry','007_raw_logs','014_decode_bootstrap'];
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
  if(m === '001_init'){
          // Fallback for initial schema only (known set of statements)
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
        } else if(m === '007_raw_logs') {
          // Inline fallback for raw_logs schema (parity with Pages worker migration 007)
          const rawLogsStatements = [
            "CREATE TABLE IF NOT EXISTS raw_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, block_number INTEGER NOT NULL, log_index INTEGER NOT NULL, tx_hash TEXT NOT NULL, address TEXT NOT NULL, topic0 TEXT NULL, topic1 TEXT NULL, topic2 TEXT NULL, topic3 TEXT NULL, data TEXT NOT NULL, created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP);",
            "CREATE UNIQUE INDEX IF NOT EXISTS u_raw_logs_block_logindex ON raw_logs(block_number, log_index);",
            "CREATE INDEX IF NOT EXISTS idx_raw_logs_block ON raw_logs(block_number);",
            "CREATE INDEX IF NOT EXISTS idx_raw_logs_address ON raw_logs(address);",
            "CREATE INDEX IF NOT EXISTS idx_raw_logs_topic0 ON raw_logs(topic0);"
          ];
          for(let i=0;i<rawLogsStatements.length;i++){
            const stmt = rawLogsStatements[i];
            try { await env.INDEX_DB.prepare(stmt).run(); } catch(e){ return json({ error:'Migration failed', migration:m, message:String(e), fallbackIndex:i, statement:stmt.slice(0,160) },500); }
          }
        } else {
          // Generic fallback: split multi-statement script and run sequentially.
          const stmts = cleaned.split(/;\s*\n/).map(s=>s.trim()).filter(s=>s && !s.startsWith('--'));
          for(let i=0;i<stmts.length;i++){
            const stmt = stmts[i];
            try { await env.INDEX_DB.prepare(stmt).run(); }
            catch(e){
              // If adding already existing column in 002_enrichment, ignore duplicate error.
              if(/duplicate column name: api_enrichments/i.test(String(e))) continue;
              if(/duplicate column name: run_duration_ms/i.test(String(e))) continue;
              return json({ error:'Migration failed', migration:m, message:String(e), statement: stmt.slice(0,160), index:i },500);
            }
          }
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

// (old duplicate handleIndexerIngest removed)

async function handleGetShare(url, env){
  const id = url.searchParams.get('id');
  if(!id) return json({ error:'Missing id' },400);
  if(!env.EF_SHARES) return json({ error:'EF_SHARES KV not bound' },500);
  const value = await env.EF_SHARES.get(id);
  if(value === null) return json({ error:'Not found' },404);
  return json({ data:value });
}

// Simplified health endpoint (parity with Pages version sans snapshot heuristics)
async function handleIndexerHealth(env, url){
  if(!env.INDEX_DB) return json({ status:'disabled', reason:'INDEX_DB binding missing' });
  let chainDeploy=null; let chainId=null;
  try {
    const assetResp = await env.ASSETS.fetch(new Request(new URL('/worlds.json', url).toString()));
    if(assetResp.ok){
      const mapping = await assetResp.json();
      const provided = url.searchParams.get('chainId');
      if(provided && mapping[provided]){ chainDeploy = mapping[provided]; chainId = provided; }
      else { const keys = Object.keys(mapping); if(keys.length){ chainId = keys[0]; chainDeploy = mapping[chainId]; } }
    }
  } catch{}
  try {
    const probe = await env.INDEX_DB.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='world_version'").all();
    if(!probe.results || !probe.results.length){ return json({ status:'uninitialized', world:null, chain:{ chainId, ...chainDeploy } }); }
    const w = await env.INDEX_DB.prepare("SELECT version_number, world_address, contracts_version FROM world_version WHERE archived_at IS NULL ORDER BY version_number DESC LIMIT 1").all();
    const world = w.results?.[0] || null;
    const details = url.searchParams.get('details')==='1';
    let counts=null; let lastRun=null;
    if(details){
      counts={};
      const tables=['smart_assembly','smart_gate_direction','structure_generic','assembly_metadata','table_registry','store_events'];
      for(const t of tables){
        try { const r = await env.INDEX_DB.prepare(`SELECT COUNT(1) as c FROM ${t}`).all(); counts[t]= r.results?.[0]?.c ?? 0; } catch{ counts[t]='err'; }
      }
      try { const lr = await env.INDEX_DB.prepare("SELECT id, mode, run_started_at, run_finished_at, run_duration_ms, assemblies_scanned, rows_added, rows_updated, rows_removed, gate_edges_rebuilt, error_count FROM indexer_run ORDER BY id DESC LIMIT 1").all(); lastRun = lr.results?.[0] || null; } catch{}
    }
    let cursor=null; let ingestionLagMs=null;
    try { const c = await env.INDEX_DB.prepare("SELECT id, last_block_number, last_log_index, updated_at FROM event_cursor WHERE id=1").all(); cursor = c.results?.[0]||null; if(cursor?.updated_at){ const ts=Date.parse(cursor.updated_at + (cursor.updated_at.endsWith('Z')?'':'Z')); if(!isNaN(ts)) ingestionLagMs = Date.now()-ts; } } catch{}
    let migrationsApplied=null; try { const mig = await env.INDEX_DB.prepare("SELECT id FROM _migrations ORDER BY id").all(); migrationsApplied = (mig.results||[]).map(r=>r.id); } catch{}
    return json({ status:'ok', world, chain: chainDeploy? { chainId, ...chainDeploy }: null, counts, lastRun, cursor, ingestionLagMs, migrationsApplied });
  } catch(e){
    return json({ status:'error', error:String(e), chain: chainDeploy? { chainId, ...chainDeploy }: null });
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
        if(!dr) continue;
        let text = dr;
        if(text.charCodeAt(0) === 0xFEFF){ text = text.slice(1); }
        try {
          history.push(JSON.parse(text));
        } catch(e){
          if(debug){ history.push({ date:k.split('/').pop(), parse_error:true, message:String(e).slice(0,80), preview: text.slice(0,120) }); }
        }
      }
    } catch(e){ if(debug){ history.push({ error:'list_failed', message:String(e) }); } }
  }
  if(debug){
    return json({ current: JSON.parse(raw), history, debug:{ mode:'list', requestedDays: histDays, foundDailyKeys: foundKeys } });
  }
  return json({ current: JSON.parse(raw), history });
}

// Overlay endpoint: returns recent gate direction mutations and deletions (tombstones)
// Query params:
//   sinceTs=ISO timestamp OR minutes=N (relative lookback, max 120) default 5
//   limit= max gate mutations (default 100, cap 500)
// Response: { sinceTs, gates:[{ gate_id, world_version, directions:[...]}], deletions:[{ gate_id, world_version, deleted_at }], more:boolean }
async function handleIndexerOverlay(url, env){
  if(!env.INDEX_DB) return json({ error:'INDEX_DB binding missing' },500);
  let sinceTs = url.searchParams.get('sinceTs');
  const minutesParam = url.searchParams.get('minutes');
  if(!sinceTs){
    const mins = Math.min(120, Math.max(1, parseInt(minutesParam||'5',10)||5));
    sinceTs = new Date(Date.now() - mins*60000).toISOString();
  }
  // Normalize sinceTs to ISO and validate
  let sinceDate = new Date(sinceTs);
  if(isNaN(sinceDate.getTime())) return json({ error:'invalid_sinceTs' },400);
  const limit = Math.min(500, Math.max(1, parseInt(url.searchParams.get('limit')||'100',10)||100));
  try {
    // Fetch distinct gate_ids with direction changes since sinceTs
    const gateRows = await env.INDEX_DB.prepare("SELECT DISTINCT gate_id FROM smart_gate_direction WHERE last_change_at >= ? ORDER BY last_change_at DESC LIMIT ?").bind(sinceDate.toISOString(), limit).all();
    const gateIds = (gateRows.results||[]).map(r=> r.gate_id);
    let gates=[];
    if(gateIds.length){
      // For each gate, fetch its current directions
      for(const gid of gateIds){
        try {
          const dirsRes = await env.INDEX_DB.prepare("SELECT gate_id, world_version, origin_system_id, destination_system_id, linked, online, traversal_cost, last_change_at FROM smart_gate_direction WHERE gate_id=?").bind(gid).all();
          const dirs = (dirsRes.results||[]).map(d=> ({ origin_system_id:d.origin_system_id, destination_system_id:d.destination_system_id, linked: !!d.linked, online: !!d.online, traversal_cost: d.traversal_cost }));
          const world_version = dirsRes.results?.[0]?.world_version || null;
          gates.push({ gate_id: gid, world_version, directions: dirs });
        } catch{/* ignore per-gate errors */}
      }
    }
    // Deletions (tombstones)
    let deletions=[];
    try {
      const delRes = await env.INDEX_DB.prepare("SELECT gate_id, world_version, deleted_at FROM gate_tombstone WHERE deleted_at >= ? ORDER BY deleted_at DESC LIMIT ?").bind(sinceDate.toISOString(), limit).all();
      deletions = (delRes.results||[]).map(r=> ({ gate_id:r.gate_id, world_version:r.world_version, deleted_at:r.deleted_at }));
    } catch{/* ignore */}
    const more = gateIds.length === limit; // heuristic; true if we likely truncated
    return json({ sinceTs: sinceDate.toISOString(), gates, deletions, more });
  } catch(e){
    return json({ error:'overlay_failed', message:String(e) },500);
  }
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
  if(p === '/api/indexer-health') return handleIndexerHealth(env, url);
  if(p === '/api/indexer-migrate') return handleIndexerMigrate(req, env);
  if(p === '/api/indexer-bootstrap') return handleIndexerBootstrap(req, env);
  if(p === '/api/indexer-ingest') return handleIndexerIngest(req, env);
  if(p === '/api/cron-force'){
    // Manual debug endpoint to invoke scheduled() logic inside this worker (no auth while troubleshooting)
    try {
      const before = Date.now();
      await scheduled(null, env, { waitUntil:()=>{} });
      return json({ status:'cron_invoked', took: Date.now()-before });
    } catch(e){ return json({ error:'cron_force_failed', message:String(e) },500); }
  }
  if(p === '/api/indexer-overlay') return handleIndexerOverlay(url, env);
  if(p === '/api/debug-runs') {
    if(!env.INDEX_DB) return json({ error:'INDEX_DB binding missing' },500);
    try {
      const unfinished = await env.INDEX_DB.prepare("SELECT id, run_started_at, mode, run_finished_at, notes FROM indexer_run WHERE run_finished_at IS NULL ORDER BY id DESC LIMIT 5").all();
      const recent = await env.INDEX_DB.prepare("SELECT id, run_started_at, run_finished_at, mode, notes FROM indexer_run ORDER BY id DESC LIMIT 10").all();
      return json({ unfinished: unfinished.results||[], recent: recent.results||[] });
    } catch(e){ return json({ error:'debug_runs_failed', message:String(e) },500); }
  }
  if(p === '/api/admin-finalize-stale') {
    // Admin endpoint to force finalize dangling runs (older than ?minutes=, default 2). Auth required unless preview bypass.
    if(req.method !== 'POST') return json({ error:'Method Not Allowed' },405);
    const token = req.headers.get('X-Indexer-Admin');
    const expected = (env.INDEXER_ADMIN_TOKEN||'').trim();
    const host = req.headers.get('host')||''; const isPreviewHost = host.endsWith('.pages.dev');
    const u2 = new URL(req.url); const bypass = isPreviewHost && u2.searchParams.get('openPreview')==='1' && (!expected || token?.trim()!==expected);
    if(expected && token?.trim()!==expected && !bypass) return json({ error:'Unauthorized' },401);
    if(!env.INDEX_DB) return json({ error:'INDEX_DB binding missing' },500);
    const mins = Math.min(120, Math.max(0, parseInt(u2.searchParams.get('minutes')||'2',10)||2));
    try {
      // run_started_at stored as 'YYYY-MM-DD HH:MM:SS'. We cannot reliably parse, so compare using julianday difference.
      const stmt = mins>0 ?
        "UPDATE indexer_run SET run_finished_at=CURRENT_TIMESTAMP, run_duration_ms=(julianday(CURRENT_TIMESTAMP)-julianday(run_started_at))*86400000, notes=COALESCE(notes,'') || ' manual-finalize' WHERE run_finished_at IS NULL AND ( (julianday(CURRENT_TIMESTAMP)-julianday(run_started_at))*1440 ) >= ?" :
        "UPDATE indexer_run SET run_finished_at=CURRENT_TIMESTAMP, run_duration_ms=(julianday(CURRENT_TIMESTAMP)-julianday(run_started_at))*86400000, notes=COALESCE(notes,'') || ' manual-finalize' WHERE run_finished_at IS NULL";
      const res = mins>0 ? await env.INDEX_DB.prepare(stmt).bind(mins).run() : await env.INDEX_DB.prepare(stmt).run();
      const after = await env.INDEX_DB.prepare("SELECT id, run_started_at, run_finished_at, notes FROM indexer_run ORDER BY id DESC LIMIT 5").all();
      return json({ status:'finalized', minutes: mins, changed: res.meta?.changes||0, sample: after.results||[] });
    } catch(e){ return json({ error:'finalize_failed', message:String(e) },500); }
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
      // Load asset topic_map.json
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
    // Auth parity with ingest
    const token = req.headers.get('X-Indexer-Admin');
    const expected = (env.INDEXER_ADMIN_TOKEN||'').trim();
    const host = req.headers.get('host')||''; const isPreviewHost = host.endsWith('.pages.dev');
    const urlObj = new URL(req.url); const bypass = isPreviewHost && urlObj.searchParams.get('openPreview')==='1' && (!expected || token?.trim()!==expected);
    if(expected && token?.trim()!==expected && !bypass) return json({ error:'Unauthorized' },401);
    // Skeleton: just report counts until decoder implemented
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
    // Require confirm=YES to avoid accidental wipe.
    if(urlObj.searchParams.get('confirm')!=='YES') return json({ error:'confirm_param_required', hint:'POST /api/indexer-wipe?confirm=YES&openPreview=1' },400);
    const dropList = ['raw_logs','store_events','table_registry','decode_progress','smart_assembly','smart_gate_direction','gate_acl','gate_access_cache','structure_generic','adjacency_snapshot_meta','gate_tombstone','event_cursor','indexer_run'];
    const failed=[]; for(const t of dropList){ try { await env.INDEX_DB.prepare(`DROP TABLE IF EXISTS ${t}`).run(); } catch(e){ failed.push({ table:t, error:String(e).slice(0,120) }); } }
    return json({ status:'wiped', dropped: dropList.length, failed });
  }
  if(p === '/api/debug-rawlogs') {
    if(!env.INDEX_DB) return json({ error:'INDEX_DB binding missing' },500);
    try { const res = await env.INDEX_DB.prepare("SELECT COUNT(*) AS c FROM raw_logs").all(); return json({ count: res.results?.[0]?.c||0 }); } catch(e){ return json({ error:'raw_logs_query_failed', message:String(e) },500); }
  }
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

// Scheduled cron job (configured via wrangler.jsonc triggers.crons) to run autonomous store_all ingestion
// Environment flags:
//   INDEXER_CRON_ENABLED = '1' to enable
//   INDEXER_CRON_MODE = 'store_all' (future: other modes)
//   INDEXER_CRON_MAXBLOCKS / INDEXER_CRON_SEGMENT / INDEXER_CRON_ROWCAP optional tuning
export async function scheduled(event, env, ctx){
  // Early instrumentation: record that cron fired regardless of later early-return reasons
  async function logCron(reason, extra){
    if(env.INDEXER_CRON_LOG==='1' && env.INDEX_DB){
      try { await env.INDEX_DB.prepare("INSERT INTO raw_logs (block_number, log_index, tx_hash, address, topic0, topic1, topic2, topic3, data) VALUES (0,0,'',?,NULL,NULL,NULL,NULL,?)").bind('cron_tick', JSON.stringify({ ts:Date.now(), reason, ...(extra||{}) }).slice(0,1000)).run(); } catch{/* ignore */}
    }
  }
  if(env.INDEXER_CRON_ENABLED !== '1'){ await logCron('disabled'); return; }
  if(!env.INDEX_DB){ await logCron('no_db'); return; }
  const mode = env.INDEXER_CRON_MODE || 'store_all';
  // Overlap lock & stale finalizer: skip if unfinished run <2m old; if >30m old finalize; if 2-30m let it finish naturally.
  try {
    const unfinished = await env.INDEX_DB.prepare("SELECT id, run_started_at, mode FROM indexer_run WHERE run_finished_at IS NULL ORDER BY id DESC LIMIT 1").all();
    if(unfinished.results && unfinished.results.length){
      const rs = unfinished.results[0].run_started_at; const t= Date.parse(rs + (rs.endsWith('Z')?'':'Z'));
      if(!isNaN(t)){
        const age = Date.now()-t;
        if(age < 120000){ await logCron('skip_recent',{ age }); return; } // <2m: skip new run (recently started)
        if(age >= 300000){ // >=5m treat as stale (previous implementation used 30m; lower to recover hung runs faster)
          try { await env.INDEX_DB.prepare("UPDATE indexer_run SET run_finished_at=CURRENT_TIMESTAMP, notes=COALESCE(notes,'auto-finalized_stale_cron'), run_duration_ms=(julianday(CURRENT_TIMESTAMP)-julianday(run_started_at))*86400000 WHERE id=? AND run_finished_at IS NULL").bind(unfinished.results[0].id).run(); await logCron('finalize_stale',{ runId:unfinished.results[0].id, age }); } catch{/* ignore */}
        } else {
          await logCron('allow_existing',{ age });
          return; // 2-5m old: allow to keep working
        }
      }
    }
  } catch{/* ignore */}
  // Fire-and-forget ingestion POST internally using fetch to self
  const payload = { mode,
    maxBlocks: Number(env.INDEXER_CRON_MAXBLOCKS||4000),
    segmentBlocks: Number(env.INDEXER_CRON_SEGMENT||300),
    rowCap: Number(env.INDEXER_CRON_ROWCAP||50000),
    throttleMs: Number(env.INDEXER_CRON_THROTTLE_MS|| env.INDEXER_THROTTLE_MS || 0),
    maxSegments: Number(env.INDEXER_CRON_MAX_SEGMENTS|| env.INDEXER_MAX_SEGMENTS || 0),
    rpc: env.PYROPE_RPC||'', world: env.WORLD_ADDRESS||'', deployBlock: Number(env.DEPLOY_BLOCK||0), triggerSource:'cron' };
  // Direct invocation of ingestion handler instead of external fetch to dummy host (which never resolves).
  // This avoids relying on self-HTTP round trip and ensures cron actually performs work within the same isolate.
  try {
    const headers = new Headers({ 'content-type':'application/json' });
    if(env.INDEXER_ADMIN_TOKEN) headers.set('X-Indexer-Admin', env.INDEXER_ADMIN_TOKEN);
    // openPreview=1 retained for parity with preview bypass semantics (harmless if auth token present)
    const req = new Request('https://scheduled.internal/api/indexer-ingest?openPreview=1', {
      method:'POST', headers, body: JSON.stringify(payload)
    });
    const t0=Date.now();
    await handleIndexerIngest(req, env);
    if(env.INDEXER_CRON_LOG==='1'){
      try { await env.INDEX_DB.prepare("INSERT INTO raw_logs (block_number, log_index, tx_hash, address, topic0, topic1, topic2, topic3, data) VALUES (?,?,?,?,?,?,?,?,?)").bind(0,0,'','cron_log',null,null,null,null, JSON.stringify({ ts:Date.now(), took:Date.now()-t0, note:'cron_ingest_invoked' })).run(); } catch{/* ignore logging failure */}
    }
  } catch(e){
    // Swallow to prevent cron failure storms; future enhancement: log summary once per span.
    if(env.INDEXER_CRON_LOG==='1'){
      try { await env.INDEX_DB.prepare("INSERT INTO raw_logs (block_number, log_index, tx_hash, address, topic0, topic1, topic2, topic3, data) VALUES (?,?,?,?,?,?,?,?,?)").bind(0,0,'','cron_log_err',null,null,null,null, JSON.stringify({ ts:Date.now(), error:String(e).slice(0,180) })).run(); } catch{/* ignore */}
    }
  }
}
