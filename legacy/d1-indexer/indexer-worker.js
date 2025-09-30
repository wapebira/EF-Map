// Standalone Indexer Worker (temporary dev path)
// Provides /api/indexer-health, /api/indexer-migrate, /api/indexer-ingest (stub+store)
// Uses D1 binding INDEX_DB. Auth optional: if INDEXER_ADMIN_TOKEN set, require X-Indexer-Admin header match.

const WORLD_API_BASE = 'https://world-api-stillness.live.tech.evefrontier.com';

function json(data, status=200){ return new Response(JSON.stringify(data), { status, headers:{ 'content-type':'application/json' } }); }

// Inline migrations (same content as pages worker) - trimmed to essentials for ingestion.
const MIGRATION_SQL = {
  '001_init': `CREATE TABLE IF NOT EXISTS world_version (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    version_number INTEGER NOT NULL,
    world_address TEXT NOT NULL,
    contracts_version TEXT NOT NULL,
    archived_at TIMESTAMP NULL
  );
  CREATE TABLE IF NOT EXISTS smart_assembly (
    id TEXT PRIMARY KEY,
    world_version INTEGER NOT NULL,
    type TEXT NOT NULL,
    state TEXT NOT NULL,
    name TEXT NOT NULL,
    system_id INTEGER NOT NULL,
    owner_address TEXT NOT NULL,
    owner_name TEXT NOT NULL,
    type_id INTEGER NULL,
    energy_usage INTEGER NOT NULL DEFAULT 0,
    hash TEXT NOT NULL,
    last_seen_at TIMESTAMP NOT NULL
  );
  CREATE TABLE IF NOT EXISTS smart_gate_direction (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    gate_id TEXT NOT NULL,
    world_version INTEGER NOT NULL,
    origin_system_id INTEGER NOT NULL,
    destination_system_id INTEGER NOT NULL,
    linked INTEGER NOT NULL,
    online INTEGER NOT NULL,
    traversal_cost INTEGER NOT NULL DEFAULT 0
  );`,
  '002_enrichment': `CREATE TABLE IF NOT EXISTS structure_generic (
    id TEXT PRIMARY KEY,
    world_version INTEGER NOT NULL,
    assembly_id TEXT NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS assembly_metadata (
    assembly_id TEXT PRIMARY KEY,
    world_version INTEGER NOT NULL,
    meta_json TEXT NOT NULL,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
  );`,
  '003_cursor': `CREATE TABLE IF NOT EXISTS event_cursor (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    last_block_number INTEGER NOT NULL DEFAULT 0,
    last_log_index INTEGER NOT NULL DEFAULT 0,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  INSERT INTO event_cursor (id, last_block_number, last_log_index)
    SELECT 1,0,0 WHERE NOT EXISTS (SELECT 1 FROM event_cursor WHERE id=1);`,
  '004_run_duration': `CREATE TABLE IF NOT EXISTS indexer_run (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    world_version INTEGER NOT NULL,
    mode TEXT NOT NULL,
    run_started_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    run_finished_at TIMESTAMP NULL,
    run_duration_ms INTEGER NULL,
    assemblies_scanned INTEGER NOT NULL DEFAULT 0,
    rows_added INTEGER NOT NULL DEFAULT 0,
    rows_updated INTEGER NOT NULL DEFAULT 0,
    rows_removed INTEGER NOT NULL DEFAULT 0,
    gate_edges_rebuilt INTEGER NOT NULL DEFAULT 0,
    error_count INTEGER NOT NULL DEFAULT 0,
    snapshot_version INTEGER NULL,
    notes TEXT NULL
  );`,
  '005_overlay': `CREATE TABLE IF NOT EXISTS gate_tombstone (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    gate_id TEXT NOT NULL,
    world_version INTEGER NOT NULL,
    deleted_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
  );`,
  '006_store_registry': `CREATE TABLE IF NOT EXISTS table_registry (
      table_id TEXT PRIMARY KEY,
      first_block INTEGER NOT NULL,
      last_block INTEGER NOT NULL,
      appearances INTEGER NOT NULL DEFAULT 1,
      finalized INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_table_registry_last_block ON table_registry(last_block);
    CREATE TABLE IF NOT EXISTS store_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      block_number INTEGER NOT NULL,
      log_index INTEGER NOT NULL,
      tx_hash TEXT NOT NULL,
      topic0 TEXT NOT NULL,
      table_id TEXT NOT NULL,
      key_hex TEXT,
      field_index INTEGER,
      value_hex TEXT,
      ephemeral INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_store_events_block ON store_events(block_number);
    CREATE INDEX IF NOT EXISTS idx_store_events_table ON store_events(table_id);
    CREATE TABLE IF NOT EXISTS decode_progress (
      table_id TEXT PRIMARY KEY,
      last_decoded_event_id INTEGER NOT NULL DEFAULT 0,
      last_decoded_block INTEGER NOT NULL DEFAULT 0,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    );`
};

async function handleMigrate(req, env){
  if(req.method !== 'POST') return json({ error:'Method Not Allowed' },405);
  const token = req.headers.get('X-Indexer-Admin');
  const expect = (env.INDEXER_ADMIN_TOKEN||'').trim();
  if(expect && token?.trim() !== expect) return json({ error:'Unauthorized' },401);
  await env.INDEX_DB.exec("CREATE TABLE IF NOT EXISTS _migrations (id TEXT PRIMARY KEY, applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP)");
  const migrationList = ['001_init','002_enrichment','003_cursor','004_run_duration','005_overlay','006_store_registry'];
  const appliedRes = await env.INDEX_DB.prepare("SELECT id FROM _migrations").all();
  const applied = new Set((appliedRes.results||[]).map(r=>r.id));
  const executed=[]; const skipped=[];
  for(const m of migrationList){
    if(applied.has(m)){ skipped.push(m); continue; }
    try { await env.INDEX_DB.exec(MIGRATION_SQL[m]); await env.INDEX_DB.prepare("INSERT INTO _migrations (id) VALUES (?)").bind(m).run(); executed.push(m); }
    catch(e){ return json({ error:'migration_failed', migration:m, executed, skipped, message:String(e) },500); }
  }
  return json({ status:'migrated', executed, skipped });
}

async function handleHealth(env){
  if(!env.INDEX_DB) return json({ status:'disabled' });
  let migrationsApplied=null; try { const r = await env.INDEX_DB.prepare("SELECT id FROM _migrations ORDER BY id").all(); migrationsApplied = (r.results||[]).map(x=>x.id); } catch{}
  let cursor=null; try { const c= await env.INDEX_DB.prepare("SELECT last_block_number, updated_at FROM event_cursor WHERE id=1").all(); cursor=c.results?.[0]||null; } catch{}
  let counts={};
  for(const table of ['smart_assembly','smart_gate_direction','table_registry','store_events']){
    try { const r= await env.INDEX_DB.prepare(`SELECT COUNT(1) as c FROM ${table}`).all(); counts[table]= r.results?.[0]?.c ?? 0; } catch{ counts[table]='n/a'; }
  }
  return json({ status:'ok', cursor, counts, migrationsApplied });
}

async function handleIngest(req, env){
  if(req.method !== 'POST') return json({ error:'Method Not Allowed' },405);
  if(!env.INDEX_DB) return json({ error:'INDEX_DB binding missing' },500);
  const token = req.headers.get('X-Indexer-Admin');
  const expect = (env.INDEXER_ADMIN_TOKEN||'').trim();
  if(expect && token?.trim() !== expect) return json({ error:'Unauthorized' },401);
  let body={}; try { if(req.headers.get('content-type')?.includes('application/json')) body = await req.json(); } catch{}
  const mode = body.mode==='store'?'store':'stub';
  await env.INDEX_DB.exec("INSERT INTO event_cursor (id, last_block_number, last_log_index) SELECT 1,0,0 WHERE NOT EXISTS (SELECT 1 FROM event_cursor WHERE id=1)");
  const cur = await env.INDEX_DB.prepare("SELECT last_block_number FROM event_cursor WHERE id=1").all();
  let lastBlock = cur.results?.[0]?.last_block_number || 0;
  // world_version placeholder
  const worldRow = await env.INDEX_DB.prepare("SELECT id FROM world_version ORDER BY version_number DESC LIMIT 1").all();
  let worldId = worldRow.results?.[0]?.id;
  if(!worldId){
    await env.INDEX_DB.prepare("INSERT INTO world_version (version_number, world_address, contracts_version) VALUES (?,?,?)").bind(1, (env.WORLD_ADDRESS||'0xworld'), 'v1').run();
    const wr = await env.INDEX_DB.prepare("SELECT id FROM world_version ORDER BY version_number DESC LIMIT 1").all();
    worldId = wr.results?.[0]?.id;
  }
  await env.INDEX_DB.prepare("INSERT INTO indexer_run (world_version, mode, assemblies_scanned, rows_added, rows_updated, rows_removed, gate_edges_rebuilt, snapshot_version, notes) VALUES (?, ?, 0,0,0,0,0,NULL,?)").bind(worldId, mode, mode+' start').run();
  const started = await env.INDEX_DB.prepare("SELECT id, run_started_at FROM indexer_run WHERE world_version=? ORDER BY id DESC LIMIT 1").bind(worldId).all();
  const runId = started.results?.[0]?.id;
  if(mode==='store'){
    const RPC = env.PYROPE_RPC || body.rpc || '';
    const WORLD = (env.WORLD_ADDRESS || body.world || '').toLowerCase();
    if(!RPC || !WORLD) return json({ error:'missing_rpc_or_world' },400);
    const CONFIRM_DEPTH = BigInt(env.CONFIRM_DEPTH || body.confirmDepth || 8);
    const deployBlock = BigInt(env.DEPLOY_BLOCK || body.deployBlock || 0);
    const maxBlocks = Math.min(Number(body.maxBlocks||1000),5000);
    const topics = Array.isArray(body.topics)? body.topics : null;
    if(!topics) return json({ error:'missing_topics' },400);
    async function rpc(method, params){
      const r = await fetch(RPC,{ method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ jsonrpc:'2.0', id:1, method, params }) });
      if(!r.ok) throw new Error('rpc_http_'+r.status); const j= await r.json(); if(j.error) throw new Error(j.error.message); return j.result; }
    const latestHex = await rpc('eth_blockNumber',[]); const latest = BigInt(latestHex);
    if(latest < deployBlock + CONFIRM_DEPTH) return json({ status:'head_too_low', latest:Number(latest) });
    const finalizedHead = latest - CONFIRM_DEPTH;
    let start = BigInt(lastBlock)+1n; if(start < deployBlock) start = deployBlock; if(start > finalizedHead) return json({ status:'up_to_date', lastBlock });
    const end = start + BigInt(maxBlocks); const toBlock = end>finalizedHead? finalizedHead : end;
    let rawEvents=0, newTables=0, existingTables=0;
    for(const t of topics){
      try {
        const logs = await rpc('eth_getLogs',[{ address: WORLD, topics:[t], fromBlock:'0x'+start.toString(16), toBlock:'0x'+toBlock.toString(16) }]);
        for(const log of logs){ rawEvents++; const tableId=(log.topics&&log.topics[1])? log.topics[1].toLowerCase():null; if(!tableId) continue;
          try { await env.INDEX_DB.prepare("INSERT INTO store_events (block_number, log_index, tx_hash, topic0, table_id, key_hex, field_index, value_hex, ephemeral) VALUES (?,?,?,?,?,?,?,?,?)")
            .bind(Number(BigInt(log.blockNumber)), log.logIndex||0, log.transactionHash||'', log.topics[0]||'', tableId, (log.topics?.[2]||''), null, log.data||'', t.includes('ephemeral')?1:0).run(); } catch{}
          const existing = await env.INDEX_DB.prepare("SELECT table_id FROM table_registry WHERE table_id=?").bind(tableId).all();
          if(existing.results?.length){ existingTables++; await env.INDEX_DB.prepare("UPDATE table_registry SET last_block=?, appearances=appearances+1 WHERE table_id=?").bind(Number(BigInt(log.blockNumber)), tableId).run(); }
          else { newTables++; await env.INDEX_DB.prepare("INSERT INTO table_registry (table_id, first_block, last_block, appearances, finalized) VALUES (?,?,?,?,0)").bind(tableId, Number(BigInt(log.blockNumber)), Number(BigInt(log.blockNumber)),1).run(); }
        }
      } catch{}
    }
    await env.INDEX_DB.prepare("UPDATE table_registry SET finalized=1 WHERE finalized=0 AND last_block <= ?").bind(Number(finalizedHead)).run();
    await env.INDEX_DB.prepare("UPDATE event_cursor SET last_block_number=?, updated_at=CURRENT_TIMESTAMP WHERE id=1").bind(Number(toBlock)).run();
    const durRes = await env.INDEX_DB.prepare("SELECT (julianday(CURRENT_TIMESTAMP)-julianday(run_started_at))*86400000 AS ms FROM indexer_run WHERE id=?").bind(runId).all();
    const ms = Math.max(0, Math.round(durRes.results?.[0]?.ms||0));
    await env.INDEX_DB.prepare("UPDATE indexer_run SET run_finished_at=CURRENT_TIMESTAMP, run_duration_ms=?, rows_added=?, rows_updated=?, notes=? WHERE id=?")
      .bind(ms, rawEvents, newTables, 'store events '+rawEvents, runId).run();
    return json({ status:'ok', mode:'store', range:{ from:Number(start), to:Number(toBlock)}, rawEvents, newTables, existingTables });
  }
  // stub mode
  const simCount = Math.min(3, Math.max(1, Number(body.simEvents||2)));
  let assemblies_scanned=0, rows_added=0, rows_updated=0; const events=[]; const fromBlock=lastBlock+1; let highest=lastBlock;
  for(let i=0;i<simCount;i++){ const blk=fromBlock+i; highest=Math.max(highest, blk); events.push({ id:`sim_${blk}_${i}`, systemId:1000+i, owner:'0xowner', state:'online', name:`Sim ${i}`, hash:`h${blk}_${i}`, blockNumber:blk, gate: (i%2===0)? { directions:[{ origin_system_id:1000+i, destination_system_id:2000+i, linked:1, online:1, traversal_cost:0 }] }: null }); }
  for(const ev of events){ assemblies_scanned++; const existing = await env.INDEX_DB.prepare("SELECT id, hash FROM smart_assembly WHERE id=?").bind(ev.id).all(); if(existing.results?.length){ const ex=existing.results[0]; if(ex.hash!==ev.hash){ await env.INDEX_DB.prepare("UPDATE smart_assembly SET state=?, name=?, system_id=?, owner_address=?, last_seen_at=CURRENT_TIMESTAMP, hash=? WHERE id=?").bind(ev.state,'Sim',ev.systemId,ev.owner,ev.hash,ev.id).run(); rows_updated++; } else { await env.INDEX_DB.prepare("UPDATE smart_assembly SET last_seen_at=CURRENT_TIMESTAMP WHERE id=?").bind(ev.id).run(); } } else { await env.INDEX_DB.prepare("INSERT INTO smart_assembly (id, world_version, type, state, name, system_id, owner_address, owner_name, type_id, energy_usage, hash, last_seen_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)").bind(ev.id, worldId, 'generic', ev.state, ev.name, ev.systemId, ev.owner,'', null, 0, ev.hash).run(); rows_added++; } if(ev.gate && Array.isArray(ev.gate.directions)){ await env.INDEX_DB.prepare("DELETE FROM smart_gate_direction WHERE gate_id=?").bind(ev.id).run(); for(const d of ev.gate.directions){ try { await env.INDEX_DB.prepare("INSERT INTO smart_gate_direction (gate_id, world_version, origin_system_id, destination_system_id, linked, online, traversal_cost) VALUES (?,?,?,?,?,?,?)").bind(ev.id, worldId, d.origin_system_id, d.destination_system_id, d.linked, d.online, d.traversal_cost).run(); } catch{} } } }
  if(highest>lastBlock){ await env.INDEX_DB.prepare("UPDATE event_cursor SET last_block_number=?, updated_at=CURRENT_TIMESTAMP WHERE id=1").bind(highest).run(); }
  const durRes = await env.INDEX_DB.prepare("SELECT (julianday(CURRENT_TIMESTAMP)-julianday(run_started_at))*86400000 AS ms FROM indexer_run WHERE id=?").bind(runId).all();
  const ms = Math.max(0, Math.round(durRes.results?.[0]?.ms||0));
  await env.INDEX_DB.prepare("UPDATE indexer_run SET run_finished_at=CURRENT_TIMESTAMP, run_duration_ms=?, assemblies_scanned=?, rows_added=?, rows_updated=?, notes='stub ok' WHERE id=?")
    .bind(ms, assemblies_scanned, rows_added, rows_updated, runId).run();
  return json({ status:'ok', mode:'stub', assemblies_scanned, rows_added, rows_updated, advancedBy: highest-lastBlock });
}

export default {
  fetch(req, env){
    const url = new URL(req.url);
    if(url.pathname === '/api/indexer-health') return handleHealth(env);
    if(url.pathname === '/api/indexer-migrate') return handleMigrate(req, env);
    if(url.pathname === '/api/indexer-ingest') return handleIngest(req, env);
    return new Response('indexer-worker', { status:200 });
  }
};
