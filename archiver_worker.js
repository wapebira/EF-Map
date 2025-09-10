// Archiver Worker: cron-driven raw_logs offloading from primary (INDEX_DB) to archive (INDEX_DB_A1)
// Runs in small batches to avoid long transactions. Also exposes /admin/archive-tick for manual triggering.

function sleep(ms){ return new Promise(r=>setTimeout(r, ms)); }

async function ensureDestSchema(dest){
  await dest.exec("CREATE TABLE IF NOT EXISTS raw_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, block_number INTEGER NOT NULL, log_index INTEGER NOT NULL, tx_hash TEXT NOT NULL, address TEXT NOT NULL, topic0 TEXT NULL, topic1 TEXT NULL, topic2 TEXT NULL, topic3 TEXT NULL, data TEXT NOT NULL, created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP);");
  await dest.exec("CREATE UNIQUE INDEX IF NOT EXISTS u_raw_logs_block_logindex ON raw_logs(block_number, log_index);");
  await dest.exec("CREATE INDEX IF NOT EXISTS idx_raw_logs_block ON raw_logs(block_number);");
  await dest.exec("CREATE INDEX IF NOT EXISTS idx_raw_logs_address ON raw_logs(address);");
  await dest.exec("CREATE INDEX IF NOT EXISTS idx_raw_logs_topic0 ON raw_logs(topic0);");
}

async function getHeadBlock(env){
  // Prefer event_cursor if present
  try {
    const r1 = await env.INDEX_DB.prepare("SELECT last_block_number AS h FROM event_cursor WHERE id=1").all();
    const h = r1.results?.[0]?.h; if(Number.isInteger(h)) return h;
  } catch { /* ignore */ }
  // Fallback to highest in raw_logs
  try {
    const r2 = await env.INDEX_DB.prepare("SELECT MAX(block_number) AS h FROM raw_logs").all();
    const h2 = r2.results?.[0]?.h; if(Number.isInteger(h2)) return h2;
  } catch { /* ignore */ }
  return null;
}

async function countRows(db){
  try { const r = await db.prepare("SELECT COUNT(1) AS c FROM raw_logs").all(); return r.results?.[0]?.c|0; } catch { return 0; }
}

async function runArchiveOnce(env, opts={}){
  let cutToStatic = Number.parseInt(env.ARCHIVE_CUT_TO || '7450000', 10);
  if(String(env.ARCHIVE_CUT_DYNAMIC||'0') === '1'){
    const head = await getHeadBlock(env);
    const offset = Number.parseInt(env.ARCHIVE_CUT_OFFSET_BLOCKS || '30000', 10);
    if(Number.isInteger(head)){
      const dyn = Math.max(0, head - offset);
      if(!Number.isFinite(cutToStatic) || cutToStatic<=0) cutToStatic = dyn; else cutToStatic = Math.min(cutToStatic, dyn);
    }
  }
  const cutTo = cutToStatic;
  // Keep small to stay within subrequest limits (each insert batch uses params; aim < ~40 subrequests)
  const pageLimit = Number.parseInt(env.ARCHIVE_PAGE_LIMIT || '330', 10);
  const rangeWindow = Number.parseInt(env.ARCHIVE_RANGE_WINDOW || '2000', 10);
  const maxPages = Number.parseInt(opts.maxPages ?? env.ARCHIVE_MAX_PAGES ?? '1', 10);
  const pauseMs = Number.parseInt(env.ARCHIVE_PAUSE_MS || '200', 10);

  if(!env.INDEX_DB) return { error:'INDEX_DB binding missing' };
  if(!env.INDEX_DB_A1) return { error:'INDEX_DB_A1 binding missing' };

  // Decide destination: prefer A1 unless it nears cap, then A2 (if present)
  const capA1 = Number.parseInt(env.ARCHIVE_A1_MAX_ROWS || '9500000', 10);
  let dest = env.INDEX_DB_A1; let destKey = 'INDEX_DB_A1';
  try {
    const a1c = await countRows(env.INDEX_DB_A1);
    if(a1c >= capA1 && env.INDEX_DB_A2){ dest = env.INDEX_DB_A2; destKey = 'INDEX_DB_A2'; }
  } catch { /* ignore */ }

  await ensureDestSchema(dest);

  let pages=0, movedTotal=0, deletedTotal=0, lastFrom=null, lastTo=null;
  const VARS_PER_ROW = 9, D1_PARAM_LIMIT=100;
  const maxRowsPerStmt = Math.max(1, Math.floor(D1_PARAM_LIMIT / VARS_PER_ROW));

  while(pages < maxPages){
    // Find the next earliest block <= cutTo with remaining rows
    const minRes = await env.INDEX_DB.prepare("SELECT MIN(block_number) AS m FROM raw_logs WHERE block_number <= ?").bind(cutTo).all();
    const m = minRes.results?.[0]?.m;
    if(m === null || m === undefined){
      break; // nothing to do
    }
    const from = m|0;
    const to = Math.min(cutTo, from + rangeWindow);

  const sel = await env.INDEX_DB.prepare("SELECT id, block_number, log_index, tx_hash, address, topic0, topic1, topic2, topic3, data FROM raw_logs WHERE block_number BETWEEN ? AND ? ORDER BY block_number, log_index LIMIT ?").bind(from, to, pageLimit).all();
    const rows = sel.results || [];
    if(!rows.length){
      // All rows in [from,to] likely consumed; proceed next loop
      lastFrom = from; lastTo = to;
      pages += 1; // count as a tick to avoid spin
      continue;
    }

    // Insert into archive using batch to reduce subrequests
    let inserted=0;
    const insStmts=[];
    for(let i=0;i<rows.length;i+=maxRowsPerStmt){
      const slice = rows.slice(i, i+maxRowsPerStmt);
      const placeholders = slice.map(()=> '(?,?,?,?,?,?,?,?,?)').join(',');
      const flat=[]; for(const r of slice){ flat.push(r.block_number, r.log_index, r.tx_hash||'', (r.address||'').toLowerCase(), r.topic0||null, r.topic1||null, r.topic2||null, r.topic3||null, r.data||'0x'); }
      insStmts.push(dest.prepare(`INSERT OR IGNORE INTO raw_logs (block_number, log_index, tx_hash, address, topic0, topic1, topic2, topic3, data) VALUES ${placeholders}`).bind(...flat));
    }
    const insRes = insStmts.length ? await dest.batch(insStmts) : [];
    for(const r of insRes){ const ch = (r && r.meta && typeof r.meta.changes==='number')? r.meta.changes:0; inserted += ch; }

    // Delete from primary using batched id IN lists to reduce subrequests
    let deleted=0;
    const ids = rows.map(r=> r.id);
    const DELETE_BATCH = 100; // D1 param limit safeguard
    const delStmts=[];
    for(let i=0;i<ids.length;i+=DELETE_BATCH){
      const group = ids.slice(i, i+DELETE_BATCH);
      const placeholders = group.map(()=> '?').join(',');
      delStmts.push(env.INDEX_DB.prepare(`DELETE FROM raw_logs WHERE id IN (${placeholders})`).bind(...group));
    }
    const delRes = delStmts.length ? await env.INDEX_DB.batch(delStmts) : [];
    for(const r of delRes){ const ch = (r && r.meta && typeof r.meta.changes==='number')? r.meta.changes:0; deleted += ch; }

    movedTotal += inserted; deletedTotal += deleted; lastFrom = from; lastTo = to; pages += 1;
    if(pauseMs>0) await sleep(pauseMs);
  }

  return { pages, movedTotal, deletedTotal, lastFrom, lastTo, cutTo, pageLimit, rangeWindow };
}

export default {
  async fetch(req, env){
    const url = new URL(req.url);
    if(url.pathname === '/admin/archive-tick'){
      // Optional simple token: provide ?open=1 to bypass for manual tests
      const open = url.searchParams.get('open') === '1';
      const hdr = req.headers.get('X-Archiver-Admin')?.trim();
      const expected = (env.ARCHIVER_ADMIN_TOKEN||'').trim();
      if(expected && hdr !== expected && !open){
        return new Response(JSON.stringify({ error:'Unauthorized' }), { status:401, headers:{'content-type':'application/json'} });
      }
      const maxPages = parseInt(url.searchParams.get('pages')||env.ARCHIVE_MAX_PAGES||'3',10)||3;
      try {
        const res = await runArchiveOnce(env, { maxPages });
        return new Response(JSON.stringify({ status:'ok', ...res }), { headers:{'content-type':'application/json'} });
      } catch(e){
        return new Response(JSON.stringify({ error:'archive_tick_failed', message:String(e) }), { status:500, headers:{'content-type':'application/json'} });
      }
    }
    return new Response('archiver: ok', { status:200 });
  },
  async scheduled(_event, env, ctx){
    ctx.waitUntil((async()=>{
      try { await runArchiveOnce(env, {}); } catch(e){ /* swallow */ }
    })());
  }
};
