#!/usr/bin/env node
/*
 High-throughput local raw logs ingestor.
 - SQLite via better-sqlite3 (sync, fast)
 - Viem RPC for eth_getLogs
 - WAL + tuned pragmas for speed
 - Idempotent inserts (UNIQUE on block_number,log_index)
 - Cursor in DB (event_cursor)
 - Windowing and segmentation to respect RPC limits
*/

const fs = require('fs');
const path = require('path');
require('dotenv').config();
// Prefer native better-sqlite3 when available for high throughput; fall back to sql.js (WASM)
let BetterSqlite3 = null;
try { BetterSqlite3 = require('better-sqlite3'); } catch {}
const initSqlJs = require('sql.js');
const { createPublicClient, http, formatters, parseAbiItem, hexToNumber } = require('viem');

// Helpers to sanitize environment values (guard against "True" and invalid types)
function saneStr(v, fallback, wantUrl){
  if (v === undefined || v === null) return fallback;
  const s = String(v).trim();
  if (s === '' || /^true$/i.test(s)) return fallback;
  if (wantUrl && !/^https?:\/\//i.test(s)) return fallback;
  return s;
}
function saneNum(v, fallback){
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

// Config (sanitized)
const RPC_URL = saneStr(process.env.RPC_URL || process.env.PYROPE_RPC, 'https://rpc.pyropechain.com', true);
if (!RPC_URL) {
  console.error('Missing RPC_URL; provide a valid http(s) endpoint');
  process.exit(1);
}
const WORLD_ADDRESS = saneStr(process.env.WORLD_ADDRESS, '').toLowerCase();
const CHAIN_ID = saneStr(process.env.CHAIN_ID, '695569');
const DB_PATH = saneStr(process.env.LOCAL_DB_PATH, path.resolve(__dirname, '../../data/local-indexer.db'));
const STATUS_PATH = saneStr(process.env.STATUS_PATH, path.resolve(__dirname, '../../data/local-indexer-status.json'));
const HISTORY_PATH = saneStr(process.env.HISTORY_PATH, path.resolve(__dirname, '../../data/local-indexer-status-history.json'));
const CONTROL_PATH = saneStr(process.env.CONTROL_PATH, path.resolve(__dirname, '../../data/local-indexer-control.json'));
const PID_PATH = saneStr(process.env.PID_PATH, path.resolve(__dirname, '../../data/local-indexer-ingest.pid'));
const FROM_BLOCK = saneNum(process.env.FROM_BLOCK, 0);
const TO_BLOCK = (process.env.TO_BLOCK === undefined || process.env.TO_BLOCK === null || process.env.TO_BLOCK === '' || /^true$/i.test(String(process.env.TO_BLOCK)))
  ? null : saneNum(process.env.TO_BLOCK, null);
const CONFIRM_DEPTH = saneNum(process.env.CONFIRM_DEPTH, 8);
const WINDOW_BLOCKS = saneNum(process.env.WINDOW_BLOCKS, 20000); // large window; ingestor will segment
const SEGMENT_BLOCKS = saneNum(process.env.SEGMENT_BLOCKS, 1200); // RPC safe size
const MAX_RETRIES = saneNum(process.env.MAX_RETRIES, 5);
const RETRY_BACKOFF_MS = saneNum(process.env.RETRY_BACKOFF_MS, 1500);
const ADDRESS_ALLOWLIST = saneStr(process.env.ADDRESS_ALLOWLIST, '').toLowerCase(); // comma-separated addresses; empty = all
const TOPIC0_ALLOWLIST = saneStr(process.env.TOPIC0_ALLOWLIST, '').toLowerCase(); // optional comma-separated topics
const ENGINE = saneStr(process.env.DB_ENGINE, BetterSqlite3 ? 'better-sqlite3' : 'sql.js');
const SAVE_INTERVAL_MS = saneNum(process.env.SAVE_INTERVAL_MS, BetterSqlite3 ? 2000 : 15000);
const SAVE_SEGMENTS = saneNum(process.env.SAVE_SEGMENTS, BetterSqlite3 ? 1 : 5);

// Setup DB
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
let SQL = null; let db = null; let wasmReady = null; let isBetter = false;
const client = createPublicClient({ transport: http(RPC_URL, { timeout: 20_000 }) });

function sleep(ms){ return new Promise(r=>setTimeout(r, ms)); }

function locateWasm(file){
  try {
    const jsPath = require.resolve('sql.js/dist/sql-wasm.js');
    return path.resolve(jsPath, '../', file);
  } catch {
    return path.join(__dirname, '../../node_modules/sql.js/dist/', file);
  }
}

async function openDb(){
  // Try native engine first when requested and available; if it fails (ABI mismatch, missing deps), fall back to sql.js
  if (ENGINE === 'better-sqlite3' && BetterSqlite3) {
    try {
      isBetter = true;
      db = new BetterSqlite3(DB_PATH, { verbose: null, fileMustExist: false });
      // Speed pragmas for better-sqlite3
      db.pragma('journal_mode = WAL');
      db.pragma('synchronous = NORMAL');
      db.pragma('temp_store = MEMORY');
      db.pragma('cache_size = -200000');
      const schemaSql = fs.readFileSync(path.resolve(__dirname, './schema.sql'), 'utf8');
      db.exec(schemaSql);
    } catch (e) {
      // Native module failed to load; degrade gracefully to sql.js
      try { console.error('better-sqlite3 load failed; falling back to sql.js engine:', e && (e.details || e.message || e)); } catch {}
      isBetter = false;
      db = null;
    }
  }
  if (!db) {
    if (!SQL) SQL = await initSqlJs({ locateFile: locateWasm });
    let needSchema = false;
    if (fs.existsSync(DB_PATH)) {
      try {
        const filebuffer = fs.readFileSync(DB_PATH);
        db = new SQL.Database(filebuffer);
        db.exec('PRAGMA user_version;');
      } catch (e) {
        try {
          const backupPath = DB_PATH + '.corrupt.' + Date.now();
          fs.copyFileSync(DB_PATH, backupPath);
          console.error('Corrupt DB detected. Backed up to', backupPath, 'and creating a new DB.');
        } catch {}
        db = new SQL.Database();
        needSchema = true;
      }
    } else {
      db = new SQL.Database();
      needSchema = true;
    }
    const schemaSql = fs.readFileSync(path.resolve(__dirname, './schema.sql'), 'utf8');
    db.exec(schemaSql);
  }
  // Chain pinning
  if (isBetter) {
    const sel = db.prepare('SELECT chain_id, world_address FROM chain_info WHERE id=1');
    const row = sel.get();
    const envChain = String(CHAIN_ID);
    const envWorld = String(WORLD_ADDRESS).toLowerCase();
    const rowChain = row ? String(row.chain_id || '') : '';
    const rowWorld = row ? String(row.world_address || '').toLowerCase() : '';
    if (row && (rowChain === '' || rowWorld === '')) {
      // Initialize missing values (store world in lowercase canonical form)
      db.prepare('UPDATE chain_info SET chain_id=?, world_address=? WHERE id=1').run(envChain, envWorld);
    } else if (row) {
      if (rowChain !== envChain) {
        console.error('DB chain mismatch; set a different LOCAL_DB_PATH or clear DB.', row, { CHAIN_ID: envChain, WORLD_ADDRESS: envWorld });
        process.exit(1);
      }
      // If only world_address casing differs, normalize DB to lowercase and continue
      const rowWorldRaw = String(row.world_address || '');
      if (rowWorldRaw && rowWorldRaw.toLowerCase() !== envWorld) {
        // True mismatch (not just casing) – bail out to avoid cross-chain corruption
        console.error('DB world address mismatch; set a different LOCAL_DB_PATH or clear DB.', { db: rowWorldRaw, env: envWorld });
        process.exit(1);
      }
      if (rowWorldRaw && rowWorldRaw !== rowWorldRaw.toLowerCase()) {
        try { db.prepare('UPDATE chain_info SET world_address=? WHERE id=1').run(envWorld); } catch {}
      }
    }
  } else {
    const stmt = db.prepare('SELECT chain_id, world_address FROM chain_info WHERE id=1');
    stmt.step();
    const row = stmt.getAsObject();
    stmt.free();
    const envChain = String(CHAIN_ID);
    const envWorld = String(WORLD_ADDRESS).toLowerCase();
    const rowChain = row ? String(row.chain_id || '') : '';
    const rowWorldRaw = row ? String(row.world_address || '') : '';
    const rowWorld = rowWorldRaw.toLowerCase();
    if (row && (rowChain === '' || rowWorld === '')) {
      const upd = db.prepare('UPDATE chain_info SET chain_id=?, world_address=? WHERE id=1');
      upd.run([envChain, envWorld]);
      upd.free();
    } else if (row) {
      if (rowChain !== envChain) {
        console.error('DB chain mismatch; set a different LOCAL_DB_PATH or clear DB.', row, { CHAIN_ID: envChain, WORLD_ADDRESS: envWorld });
        process.exit(1);
      }
      if (rowWorldRaw && rowWorldRaw.toLowerCase() !== envWorld) {
        console.error('DB world address mismatch; set a different LOCAL_DB_PATH or clear DB.', { db: rowWorldRaw, env: envWorld });
        process.exit(1);
      }
      if (rowWorldRaw && rowWorldRaw !== rowWorldRaw.toLowerCase()) {
        const upd2 = db.prepare('UPDATE chain_info SET world_address=? WHERE id=1');
        upd2.run([envWorld]);
        upd2.free();
      }
    }
  }
}

function saveDb(){
  if (isBetter) return; // better-sqlite3 persists to file immediately
  const data = db.export();
  const buffer = Buffer.from(data);
  fs.writeFileSync(DB_PATH, buffer);
}

function getCursor(){
  if (isBetter) {
    return db.prepare('SELECT last_block_number, last_log_index FROM event_cursor WHERE id=1').get() || { last_block_number:0, last_log_index:0 };
  }
  const stmt = db.prepare('SELECT last_block_number, last_log_index FROM event_cursor WHERE id=1');
  stmt.step();
  const row = stmt.getAsObject();
  stmt.free();
  return row;
}
function setCursor(bn, li){
  if (isBetter) {
    db.prepare('UPDATE event_cursor SET last_block_number=?, last_log_index=?, updated_at=CURRENT_TIMESTAMP WHERE id=1').run(bn, li);
    return;
  }
  const upd = db.prepare('UPDATE event_cursor SET last_block_number=?, last_log_index=?, updated_at=CURRENT_TIMESTAMP WHERE id=1');
  upd.run([bn, li]);
  upd.free();
}

function saveBatch(rows){
  if (!rows || !rows.length) return;
  if (isBetter) {
    const tx = db.transaction((batch)=>{
      const stmt = db.prepare('INSERT OR IGNORE INTO raw_logs (block_number, log_index, tx_hash, address, topic0, topic1, topic2, topic3, data) VALUES (?,?,?,?,?,?,?,?,?)');
      for (const r of batch) stmt.run(r.block_number, r.log_index, r.tx_hash, r.address, r.topic0, r.topic1, r.topic2, r.topic3, r.data);
    });
    tx(rows);
    return;
    }
  db.exec('BEGIN');
  const ins = db.prepare('INSERT OR IGNORE INTO raw_logs (block_number, log_index, tx_hash, address, topic0, topic1, topic2, topic3, data) VALUES (?,?,?,?,?,?,?,?,?)');
  try {
    for (const r of rows){
      ins.run([r.block_number, r.log_index, r.tx_hash, r.address, r.topic0, r.topic1, r.topic2, r.topic3, r.data]);
    }
    db.exec('COMMIT');
  } catch (e){
    db.exec('ROLLBACK');
    ins.free();
    throw e;
  }
  ins.free();
}

function parseLog(l){
  // viem log fields may be hex or number depending on RPC; normalize
  const blockNumber = typeof l.blockNumber === 'bigint' ? Number(l.blockNumber) : hexToNumber(l.blockNumber);
  const logIndex = typeof l.logIndex === 'number' ? l.logIndex : hexToNumber(l.logIndex);
  const txHash = l.transactionHash.toLowerCase();
  const address = l.address.toLowerCase();
  const topics = l.topics || [];
  return {
    block_number: blockNumber,
    log_index: logIndex,
    tx_hash: txHash,
    address,
    topic0: topics[0]?.toLowerCase() || null,
    topic1: topics[1]?.toLowerCase() || null,
    topic2: topics[2]?.toLowerCase() || null,
    topic3: topics[3]?.toLowerCase() || null,
    data: l.data?.toLowerCase() || '0x'
  };
}

function allow(l){
  if (ADDRESS_ALLOWLIST) {
    const allowed = new Set(ADDRESS_ALLOWLIST.split(',').map(s=>s.trim()).filter(Boolean));
    if (!allowed.has(l.address)) return false;
  }
  if (TOPIC0_ALLOWLIST) {
    const allowedT = new Set(TOPIC0_ALLOWLIST.split(',').map(s=>s.trim()).filter(Boolean));
    if (!allowedT.has(l.topic0)) return false;
  }
  return true;
}

async function fetchLogsRange(from, to){
  const filter = { fromBlock: BigInt(from), toBlock: BigInt(to) };
  if (ADDRESS_ALLOWLIST) filter.address = ADDRESS_ALLOWLIST.split(',').map(s=>s.trim()).filter(Boolean);
  if (TOPIC0_ALLOWLIST) {
    const t0 = TOPIC0_ALLOWLIST.split(',').map(s=>s.trim()).filter(Boolean);
    if (t0.length) filter.topics = [t0]; // OR across allowed topics for slot 0
  }
  // viem: client.getLogs auto-paginates by block range if RPC enforces caps; we do segmentation ourselves
  for (let i=0; i<MAX_RETRIES; i++){
    try {
      const logs = await client.getLogs(filter);
      return logs;
    } catch (e) {
      const code = e?.code || e?.name || 'ERR';
      if (i === MAX_RETRIES-1) throw e;
      await sleep(RETRY_BACKOFF_MS * (i+1));
    }
  }
}

async function fetchLogsAdaptive(from, to){
  try {
    return await fetchLogsRange(from, to);
  } catch (e){
    const message = (e?.details || e?.message || '').toString().toLowerCase();
    const tooLarge = message.includes('too large') || message.includes('response too large');
    const status = e?.status|0;
    if ((tooLarge || status === 413 || status === 500) && (to - from) >= 1){
      const mid = Math.floor((from + to) / 2);
      const left = await fetchLogsAdaptive(from, mid);
      const right = await fetchLogsAdaptive(mid+1, to);
      return left.concat(right);
    }
    throw e;
  }
}

function readControl(){
  try { return JSON.parse(fs.readFileSync(CONTROL_PATH,'utf8')); } catch { return null; }
}

async function waitIfPaused(safeHead, head){
  // Check control file and pause if requested; also handle stop
  for(;;){
    const ctrl = readControl() || {};
  if (ctrl.stop) {
      // mark stopping and exit gracefully
      try {
  const status = collectStatus(safeHead, undefined, 'stopping', head);
        fs.writeFileSync(STATUS_PATH, JSON.stringify(status));
      } catch {}
      // Persist DB and remove PID, then exit
      try { saveDb(); } catch {}
      try { fs.unlinkSync(PID_PATH); } catch {}
      console.log(JSON.stringify({ status:'stopped' }));
      process.exit(0);
    }
    if (ctrl.paused) {
      try {
  const status = collectStatus(safeHead, undefined, 'paused', head);
        fs.writeFileSync(STATUS_PATH, JSON.stringify(status));
      } catch {}
      await sleep(1000);
      continue;
    }
    break;
  }
}

async function run(){
  // write PID file & ensure cleanup hooks
  try { fs.writeFileSync(PID_PATH, String(process.pid)); } catch {}
  const cleanup = ()=>{ try { fs.unlinkSync(PID_PATH); } catch {} };
  process.on('exit', cleanup);
  process.on('SIGINT', ()=>{ cleanup(); process.exit(0); });
  process.on('SIGTERM', ()=>{ cleanup(); process.exit(0); });

  await openDb();
  // If cursor looks zeroed and there is prior status/history, attempt resume
  try {
    const cur0 = getCursor();
    if (!cur0.last_block_number || cur0.last_block_number === 0) {
      let resumeBlock = null;
      try {
        const status = JSON.parse(fs.readFileSync(STATUS_PATH,'utf8'));
        if (status && status.cursor && status.cursor.last_block_number) resumeBlock = Number(status.cursor.last_block_number);
      } catch {}
      if (resumeBlock == null) {
        try {
          const hist = JSON.parse(fs.readFileSync(HISTORY_PATH,'utf8'));
          if (Array.isArray(hist) && hist.length) {
            const last = hist[hist.length-1];
            if (last && last.block) resumeBlock = Number(last.block);
          }
        } catch {}
      }
      if (resumeBlock != null && isFinite(resumeBlock) && resumeBlock > 0) {
        setCursor(resumeBlock, 0);
        console.log(JSON.stringify({ resumeFrom: resumeBlock }));
      }
    }
  } catch {}
  const windowBlocks = WINDOW_BLOCKS;
  let lastSaveTs = 0;
  let segSinceSave = 0;
  for(;;){
    let head = Number(await client.getBlockNumber());
    let safeHead = head - CONFIRM_DEPTH;
    const cur = getCursor();
    let start = Math.max(FROM_BLOCK, cur.last_block_number || 0);
    if (start === 0) start = FROM_BLOCK || 0;
    let finalTo = TO_BLOCK != null ? Math.min(TO_BLOCK, safeHead) : safeHead;
    if (finalTo < start) {
      // Idle heartbeat when up-to-date
      const status = collectStatus(safeHead, undefined, 'idle', head);
      try { fs.writeFileSync(STATUS_PATH, JSON.stringify(status)); } catch {}
      try { appendHistory(status); } catch {}
      await waitIfPaused(safeHead, head);
      await sleep(2000);
      continue;
    }

    // reset save cadence each catch-up cycle
    lastSaveTs = 0; segSinceSave = 0;
    for (let wFrom = start; wFrom <= finalTo; wFrom += windowBlocks+1){
    // refresh head/safe head and handle pause/stop between windows
    try {
      head = Number(await client.getBlockNumber());
      safeHead = head - CONFIRM_DEPTH;
    } catch {}
  await waitIfPaused(safeHead, head);
    const wTo = Math.min(wFrom + windowBlocks, finalTo);
    // segment loop
    for (let sFrom = wFrom; sFrom <= wTo; sFrom += SEGMENT_BLOCKS+1){
  await waitIfPaused(safeHead, head);
  const sTo = Math.min(sFrom + SEGMENT_BLOCKS, wTo);
  const logs = await fetchLogsAdaptive(sFrom, sTo);
      const rows = [];
      for (const lg of logs) {
        const rec = parseLog(lg);
        if (!allow(rec)) continue;
        rows.push(rec);
      }
      if (rows.length){
        saveBatch(rows);
      }
      // advance cursor to sTo; log_index 0 as boundary
      setCursor(sTo, 0);
      // Throttled persistence to improve throughput
      segSinceSave++;
      const now = Date.now();
      if ((now - lastSaveTs) >= SAVE_INTERVAL_MS || segSinceSave >= SAVE_SEGMENTS) {
        saveDb();
        lastSaveTs = now;
        segSinceSave = 0;
      }
  const status = collectStatus(safeHead, { from:sFrom, to:sTo, rows:rows.length }, 'ingest', head);
  try { fs.writeFileSync(STATUS_PATH, JSON.stringify(status)); } catch {}
  try { appendHistory(status); } catch {}
      console.log(JSON.stringify({ segment:{ from:sFrom, to:sTo, rows:rows.length } }));
    }
    }
    // final save for this cycle
    try { saveDb(); } catch {}
    console.log(JSON.stringify({ status:'done', advancedTo: finalTo }));
    // Loop back to check for new head and continue
  }
}

function collectStatus(safeHead, segment, state='ingest', tipHead){
  // counts and min/max are approximate/fast queries via SQL.js
  let counts=undefined, blocks=undefined;
  try {
    if (isBetter) {
      const row = db.prepare('SELECT COUNT(1) AS c, MIN(block_number) AS mn, MAX(block_number) AS mx FROM raw_logs').get();
      counts = { raw_logs: (row?.c|0) };
      blocks = { min: (row?.mn|0), max: (row?.mx|0) };
    } else {
      const cStmt = db.prepare('SELECT COUNT(1) AS c, MIN(block_number) AS mn, MAX(block_number) AS mx FROM raw_logs');
      cStmt.step();
      const row = cStmt.getAsObject();
      cStmt.free();
      counts = { raw_logs: row.c|0 };
      blocks = { min: row.mn|0, max: row.mx|0 };
    }
  } catch {}
  const cursor = getCursor();
  let dbSizeBytes = null;
  try { dbSizeBytes = fs.statSync(DB_PATH).size; } catch {}
  // Chain metadata from env (normalized) is included for consumer UIs
  return {
    status: 'running', state, updatedAt: new Date().toISOString(),
    segment, cursor, safeHead, counts, blocks, rpc: RPC_URL,
  dbSizeBytes,
  engine: isBetter ? 'better-sqlite3' : 'sql.js',
  head: (tipHead!=null ? Number(tipHead) : undefined),
  chainId: CHAIN_ID,
  worldAddress: WORLD_ADDRESS
  };
}

function appendHistory(s){
  try {
    let arr = [];
    if (fs.existsSync(HISTORY_PATH)) {
      arr = JSON.parse(fs.readFileSync(HISTORY_PATH, 'utf8'));
      if (!Array.isArray(arr)) arr = [];
    }
    // Reset history if DB appears to have been recreated or cursor jumped backwards
    if (arr.length) {
      const last = arr[arr.length - 1];
      const curRows = s.counts?.raw_logs || 0;
      const curBlock = s.cursor?.last_block_number || 0;
      if (curRows < (last.rows || 0) || curBlock < (last.block || 0)) {
        arr = [];
      }
    }
    // Keep compact sample
    const sample = {
      t: s.updatedAt,
      block: s.cursor?.last_block_number||0,
      rows: s.counts?.raw_logs||0,
      db: s.dbSizeBytes||0
    };
    arr.push(sample);
    if (arr.length > 400) arr = arr.slice(arr.length - 400);
    fs.writeFileSync(HISTORY_PATH, JSON.stringify(arr));
  } catch {}
}

run().catch(e=>{ console.error(e); process.exit(1); });
