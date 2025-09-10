// Rebuilt cron ingestion worker with adaptive segmentation & safe batching.
export default {
  async fetch(req, env){
    const url = new URL(req.url);
    if(url.pathname === '/debug/run-once'){
      try { return json(await ingestOnce(env, { debug:true })); }
      catch(e){ return json({ error:'ingest_throw', detail:String(e).slice(0,200) }, 500); }
    }
    if(url.pathname === '/debug/health'){
      const cur = env.INDEX_DB ? await env.INDEX_DB.prepare("SELECT last_block_number, updated_at FROM event_cursor WHERE id=1").all().catch(()=>null):null;
      return json({ status:'ok', cursor: cur?.results?.[0]||null });
    }
    return json({ ok:true, worker:'cron_ingest' });
  },
  async scheduled(event, env){
    if(env.INDEXER_CRON_ENABLED !== '1' || !env.INDEX_DB) return;
    try { await ingestOnce(env, { debug:false }); } catch(e){ /* swallow */ }
  }
};

function json(o, status=200){ return new Response(JSON.stringify(o), { status, headers:{ 'content-type':'application/json','cache-control':'no-store' } }); }

async function ingestOnce(env, { debug }){
  const conf = loadConfig(env);
  if(conf.mode !== 'store_all') return { error:'unsupported_mode', mode: conf.mode };
  if(!conf.rpc || !conf.world) return { error:'missing_rpc_or_world' };
  await ensureSchema(env);
  const cursorRow = await env.INDEX_DB.prepare("SELECT id, last_block_number FROM event_cursor WHERE id=1").all().catch(()=>({ results:[] }));
  let cursor = cursorRow.results?.[0] || null;
  if(!cursor){ await env.INDEX_DB.prepare("INSERT INTO event_cursor (id,last_block_number,last_log_index) VALUES (1,0,0)").run(); cursor={ id:1, last_block_number:0 }; }
  const runId = conf.mini ? null : await startRun(env, 'store_all', conf.triggerSource);
  let head;
  try { head = await fetchHead(conf.rpc); } catch(e){ if(runId) await finalizeRun(env, runId, 'head_err '+String(e).slice(0,60)); return { error:'head_fetch', detail:String(e) }; }
  const finalized = head - BigInt(conf.confirmDepth);
  let startBlock = BigInt(cursor.last_block_number||0) + 1n;
  if(startBlock < BigInt(conf.deployBlock)) startBlock = BigInt(conf.deployBlock);
  if(startBlock > finalized){ if(runId) await finalizeRun(env, runId, 'up_to_date'); return { status:'up_to_date', head:Number(head) }; }
  if(conf.mini){
    const targetTo = startBlock + BigInt(conf.segmentBlocks) - 1n <= finalized ? startBlock + BigInt(conf.segmentBlocks) - 1n : finalized;
    let logs=[]; try { logs = await ethGetLogs(conf.rpc, conf.world, startBlock, targetTo); } catch(e){ return { error:'mini_fetch_failed', detail:String(e).slice(0,160) }; }
    const MAX_PARAMS=100, PARAMS_PER_ROW=9, SAFE_CAP=Math.floor(MAX_PARAMS/PARAMS_PER_ROW);
    const batch=[]; for(const log of logs.slice(0, SAFE_CAP)){
      const bn= Number(BigInt(log.blockNumber));
      batch.push([bn, Number(log.logIndex||0), log.transactionHash||'', (log.address||'').toLowerCase(), (log.topics&&log.topics[0])||null, log.topics?.[1]||null, log.topics?.[2]||null, log.topics?.[3]||null, log.data||'0x']);
    }
    if(batch.length){ await insertRows(env, batch); await env.INDEX_DB.prepare("UPDATE event_cursor SET last_block_number=?, updated_at=CURRENT_TIMESTAMP WHERE id=1").bind(Number(targetTo)).run(); return { status:'mini_ok', inserted: batch.length, range:{ from:Number(startBlock), to:Number(targetTo) } }; }
    await env.INDEX_DB.prepare("UPDATE event_cursor SET last_block_number=?, updated_at=CURRENT_TIMESTAMP WHERE id=1").bind(Number(targetTo)).run();
    return { status:'mini_empty', range:{ from:Number(startBlock), to:Number(targetTo) } };
  }
  const toBlock = (startBlock + BigInt(conf.maxBlocks)) > finalized ? finalized : (startBlock + BigInt(conf.maxBlocks));

  const MAX_PARAMS=100, PARAMS_PER_ROW=9, SAFE_CAP=Math.floor(MAX_PARAMS/PARAMS_PER_ROW); // 11
  const BATCH_SIZE = SAFE_CAP;
  let pending=[]; let inserted=0; let attempted=0; let firstBlock=null; let lastBlock=null; let batchFlushes=0; const insertErrors=[]; let paramLimit=false; let segmentsTried=0;
  async function flush(){
    if(!pending.length) return;
    const groupSize = conf.batchGroup || 1; // number of safe statements per batch() call
    let statements=[]; let consumed=0;
    while(consumed < pending.length){
      const slice = pending.slice(consumed, consumed + BATCH_SIZE);
      consumed += slice.length;
      statements.push(buildInsertStatement(slice));
      if(statements.length >= groupSize){
        const r = await runGrouped(env, statements);
        inserted += r.inserted; if(r.paramLimit) paramLimit=true; if(r.error) insertErrors.push(r.error); batchFlushes++; statements=[];
      }
    }
    if(statements.length){
      const r = await runGrouped(env, statements);
      inserted += r.inserted; if(r.paramLimit) paramLimit=true; if(r.error) insertErrors.push(r.error); batchFlushes++;
    }
    pending=[];
  }
  let approxSubrequests=0; const SUBREQ_SOFT_CAP=40;
  for await (const segLogs of fetchSegmentedLogs(conf, startBlock, toBlock, { subreq: ()=>approxSubrequests++ })){
    segmentsTried++;
    for(const log of segLogs){
      if(inserted + pending.length >= conf.rowCap) break;
      const bn = Number(BigInt(log.blockNumber));
      if(firstBlock===null) firstBlock=bn; lastBlock=bn; attempted++;
      const t0 = (log.topics&&log.topics[0])||null;
      pending.push([bn, Number(log.logIndex||0), log.transactionHash||'', (log.address||'').toLowerCase(), t0, log.topics?.[1]||null, log.topics?.[2]||null, log.topics?.[3]||null, log.data||'0x']);
      const threshold = BATCH_SIZE * (conf.batchGroup||1);
      if(pending.length>=threshold) await flush();
    }
  if(inserted + pending.length >= conf.rowCap) break;
  if(approxSubrequests >= SUBREQ_SOFT_CAP) break;
  }
  await flush();
  if(inserted>0){
    const advanceTo = (inserted < conf.rowCap) ? Number(toBlock) : (lastBlock!==null? lastBlock : Number(toBlock));
    await env.INDEX_DB.prepare("UPDATE event_cursor SET last_block_number=?, updated_at=CURRENT_TIMESTAMP WHERE id=1").bind(advanceTo).run();
  }
  const status = paramLimit && inserted===0 ? 'param_limit_blocked' : 'ok';
  // Note: conservative pacing (segmentBlocks, maxSegments, throttleMs) configured via env to avoid 1101 subrequest errors during reintroduction after mini mode.
  await finalizeRun(env, runId, `${status} ins:${inserted} seg:${segmentsTried} batches:${batchFlushes} subreq:${approxSubrequests}` + (paramLimit?' param_limit':''));
  return { status, range:{ from:Number(startBlock), to:Number(toBlock) }, inserted, attempted, batchFlushes, segmentsTried, approxSubrequests, firstInsertError: insertErrors[0]||null, paramLimit };
}

function loadConfig(env){
  const maxBlocksRaw = Number(env.INDEXER_CRON_MAXBLOCKS||900);
  const segmentRaw = Number(env.INDEXER_CRON_SEGMENT||150);
  const batchGroupRaw = Number(env.INDEXER_CRON_BATCH_GROUP||1);
  return {
    mode: env.INDEXER_CRON_MODE || 'store_all',
    rpc: env.PYROPE_RPC || '',
    world: (env.WORLD_ADDRESS||'').toLowerCase(),
    deployBlock: Number(env.DEPLOY_BLOCK||0),
    maxBlocks: Math.min(maxBlocksRaw, 2000),
    segmentBlocks: Math.max(25, Math.min(segmentRaw, 300)),
    rowCap: Math.min(Number(env.INDEXER_CRON_ROWCAP||50000), 100000),
    confirmDepth: Number(env.CONFIRM_DEPTH||8),
    throttleMs: Math.max(0, Math.min(Number(env.INDEXER_CRON_THROTTLE_MS||200), 5000)),
    maxSegments: Math.min(Math.max(0, Number(env.INDEXER_CRON_MAX_SEGMENTS||5)), 40),
    batchGroup: Math.max(1, Math.min(batchGroupRaw, 12)),
    mini: env.INDEXER_CRON_MINI === '1',
    triggerSource: 'cron'
  };
}

async function ensureSchema(env){
  await env.INDEX_DB.exec("CREATE TABLE IF NOT EXISTS raw_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, block_number INTEGER NOT NULL, log_index INTEGER NOT NULL, tx_hash TEXT NOT NULL, address TEXT NOT NULL, topic0 TEXT NULL, topic1 TEXT NULL, topic2 TEXT NULL, topic3 TEXT NULL, data TEXT NOT NULL, created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP);");
  await env.INDEX_DB.exec("CREATE UNIQUE INDEX IF NOT EXISTS u_raw_logs_block_logindex ON raw_logs(block_number, log_index);");
  await env.INDEX_DB.exec("CREATE INDEX IF NOT EXISTS idx_raw_logs_block ON raw_logs(block_number);");
  await env.INDEX_DB.exec("CREATE INDEX IF NOT EXISTS idx_raw_logs_address ON raw_logs(address);");
  await env.INDEX_DB.exec("CREATE INDEX IF NOT EXISTS idx_raw_logs_topic0 ON raw_logs(topic0);");
  await env.INDEX_DB.exec("CREATE TABLE IF NOT EXISTS event_cursor (id INTEGER PRIMARY KEY CHECK (id=1), last_block_number INTEGER NOT NULL DEFAULT 0, last_log_index INTEGER NOT NULL DEFAULT 0, updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP);");
}

async function startRun(env, mode, src){
  const w = await env.INDEX_DB.prepare("SELECT id FROM world_version WHERE archived_at IS NULL ORDER BY version_number DESC LIMIT 1").all();
  const worldId = w.results?.[0]?.id || null;
  if(!worldId) return null;
  await env.INDEX_DB.prepare("INSERT INTO indexer_run (world_version, mode, assemblies_scanned, rows_added, rows_updated, rows_removed, gate_edges_rebuilt, snapshot_version, notes) VALUES (?, ?, 0,0,0,0,0,NULL,?)").bind(worldId, mode, `${mode} raw capture start src:${src}`).run();
  const r = await env.INDEX_DB.prepare("SELECT id FROM indexer_run WHERE world_version=? ORDER BY id DESC LIMIT 1").bind(worldId).all();
  return r.results?.[0]?.id || null;
}

async function finalizeRun(env, runId, note){
  if(!runId) return; try { await env.INDEX_DB.prepare("UPDATE indexer_run SET run_finished_at=CURRENT_TIMESTAMP, run_duration_ms=(julianday(CURRENT_TIMESTAMP)-julianday(run_started_at))*86400000, notes=COALESCE(notes,'')||' '||? WHERE id=? AND run_finished_at IS NULL").bind(note.slice(0,180), runId).run(); } catch{/* ignore */}
}

async function fetchHead(rpc){ const r = await fetch(rpc,{ method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ jsonrpc:'2.0', id:1, method:'eth_blockNumber', params:[] }) }); if(!r.ok) throw new Error('rpc_http_'+r.status); const j = await r.json(); if(j.error) throw new Error('rpc_'+j.error.message); return BigInt(j.result); }

async function* fetchSegmentedLogs(conf, from, to, { subreq }){
  let dynamicSeg = conf.segmentBlocks>0 ? BigInt(conf.segmentBlocks) : (to-from+1n);
  let segFrom = from; let segments=0;
  const MIN_SEG = 25n;
  while(segFrom <= to){
    if(conf.maxSegments && conf.maxSegments>0 && segments>=conf.maxSegments) break;
    const remaining = (to - segFrom)+1n;
    if(dynamicSeg > remaining) dynamicSeg = remaining;
    if(dynamicSeg < MIN_SEG) dynamicSeg = MIN_SEG;
    const segTo = segFrom + dynamicSeg - 1n;
    let attempts=0; let maxAttempts=2; let logs=null; let lastErr=null;
    while(attempts < maxAttempts){
      attempts++;
      try {
  logs = await ethGetLogs(conf.rpc, conf.world, segFrom, segTo);
  subreq();
        break;
      } catch(e){
        lastErr = e; const msg=String(e);
        // On provider saturation or generic fetch/rpc error shrink segment and retry
        if(msg.includes('429') || msg.includes('5') || msg.includes('rpc_http_') || msg.includes('fetch') || msg.includes('timeout')){
          if(dynamicSeg > MIN_SEG){ dynamicSeg = dynamicSeg/2n; if(dynamicSeg < MIN_SEG) dynamicSeg = MIN_SEG; }
          await sleep(500 * attempts);
          continue;
        }
        break; // non-retriable
      }
    }
    if(!logs){
      console.log('segment_fail', Number(segFrom), Number(segTo), String(lastErr).slice(0,80));
      // Skip this window to avoid total halt; advance to next window boundary
      segFrom = segTo + 1n;
      continue;
    }
    yield logs;
    segments++;
    if(conf.throttleMs>0) await sleep(conf.throttleMs + 50); // small jitter
    segFrom = segTo + 1n;
  }
}

function sleep(ms){ return new Promise(r=> setTimeout(r, ms)); }

async function ethGetLogs(rpc, address, fromBlock, toBlock){
  const body = { jsonrpc:'2.0', id: Date.now(), method:'eth_getLogs', params:[{ address, fromBlock:'0x'+fromBlock.toString(16), toBlock:'0x'+toBlock.toString(16) }] };
  const r = await fetch(rpc,{ method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify(body) });
  if(!r.ok) throw new Error('rpc_http_'+r.status);
  const j = await r.json(); if(j.error) throw new Error('rpc_'+j.error.message);
  return j.result || [];
}

function buildInsertStatement(rows){
  const placeholders = rows.map(()=> '(?,?,?,?,?,?,?,?,?)').join(',');
  const sql = `INSERT OR IGNORE INTO raw_logs (block_number, log_index, tx_hash, address, topic0, topic1, topic2, topic3, data) VALUES ${placeholders}`;
  const params=[]; for(const r of rows) params.push(...r); return { sql, params };
}

async function runGrouped(env, statements){
  if(!statements.length) return { inserted:0 };
  try {
    if(statements.length===1){
      const st = statements[0];
      await env.INDEX_DB.prepare(st.sql).bind(...st.params).run();
      return { inserted: st.params.length/9 };
    }
    const batchReq = statements.map(s=> env.INDEX_DB.prepare(s.sql).bind(...s.params));
    await env.INDEX_DB.batch(batchReq);
    let totalRows=0; for(const s of statements) totalRows += s.params.length/9; return { inserted: totalRows };
  } catch(e){
    const msg=String(e);
    const paramLimit=/too many sql variables/i.test(msg);
    return { inserted:0, paramLimit, error: msg.slice(0,200) };
  }
}
