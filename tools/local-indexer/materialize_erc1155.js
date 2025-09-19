#!/usr/bin/env node
/*
 Materialize ERC-1155 transfers with progress tracking.
 - Reads from data/local-indexer.db (raw_logs) to access data payload
 - Writes into data/local-indexer-decoded.db tables:
   - erc1155_single_transfers
   - erc1155_batch_transfers (one row per element)
 - Tracks progress in data/local-indexer-status.json under decode1155
*/
const fs = require('fs');
const path = require('path');
require('dotenv').config();
let BetterSqlite3 = null; try { BetterSqlite3 = require('better-sqlite3'); } catch {}

if (!BetterSqlite3) { console.error('better-sqlite3 is required'); process.exit(2); }

const ROOT = path.resolve(__dirname, '../../');
const SRC_DB = process.env.LOCAL_DB_PATH || path.resolve(ROOT, 'data/local-indexer.db');
const OUT_DB = process.env.DECODED_DB_PATH || path.resolve(ROOT, 'data/local-indexer-decoded.db');
const STATUS_PATH = process.env.STATUS_PATH || path.resolve(ROOT, 'data/local-indexer-status.json');
const CHUNK = Number(process.env.ERC1155_CHUNK || 10000);

// Match by topic0 prefix to avoid dependency on exact full hash spelling
const SIG_SINGLE_PFX = '0xc3d58168'; // TransferSingle(address,address,address,uint256,uint256)
const SIG_BATCH_PFX  = '0x4a39dc06'; // TransferBatch(address,address,address,uint256[],uint256[])

function readJson(p, fb){ try { return JSON.parse(fs.readFileSync(p,'utf8')); } catch { return fb; } }
function writeJson(p, obj){ try { fs.writeFileSync(p, JSON.stringify(obj, null, 2)); } catch {} }
function updateStatus(patch){ const s = readJson(STATUS_PATH, {}); s.decode1155 = { ...(s.decode1155||{}), ...patch, t:new Date().toISOString() }; writeJson(STATUS_PATH, s); }
function last40(hex){ if(!hex) return null; const h = String(hex).toLowerCase(); return '0x' + h.slice(-40); }
function u256ToHex(slice){ const h = slice.toLowerCase(); return '0x' + h.padStart(64,'0').slice(-64); }
function u256ToDec(slice){ try { return BigInt('0x'+slice).toString(10); } catch { return null; } }

function ensureSchema(out){
  out.exec(`
    PRAGMA journal_mode=WAL;
    CREATE TABLE IF NOT EXISTS erc1155_single_transfers (
      block_number INTEGER NOT NULL,
      log_index INTEGER NOT NULL,
      token TEXT,
      operator TEXT,
      from_addr TEXT,
      to_addr TEXT,
      id_hex TEXT,
      id_dec TEXT,
      value_dec TEXT,
      tx_hash TEXT,
      PRIMARY KEY (block_number, log_index)
    );
    CREATE INDEX IF NOT EXISTS idx_e1155s_token ON erc1155_single_transfers(token);
    CREATE INDEX IF NOT EXISTS idx_e1155s_from ON erc1155_single_transfers(from_addr);
    CREATE INDEX IF NOT EXISTS idx_e1155s_to ON erc1155_single_transfers(to_addr);

    CREATE TABLE IF NOT EXISTS erc1155_batch_transfers (
      block_number INTEGER NOT NULL,
      log_index INTEGER NOT NULL,
      idx INTEGER NOT NULL,
      token TEXT,
      operator TEXT,
      from_addr TEXT,
      to_addr TEXT,
      id_hex TEXT,
      id_dec TEXT,
      value_dec TEXT,
      tx_hash TEXT,
      PRIMARY KEY (block_number, log_index, idx)
    );
    CREATE INDEX IF NOT EXISTS idx_e1155b_token ON erc1155_batch_transfers(token);
    CREATE INDEX IF NOT EXISTS idx_e1155b_from ON erc1155_batch_transfers(from_addr);
    CREATE INDEX IF NOT EXISTS idx_e1155b_to ON erc1155_batch_transfers(to_addr);
  `);
}

function parseSingleData(dataHex){
  if (!dataHex) return null;
  const h = dataHex.replace(/^0x/,'').toLowerCase();
  if (h.length < 128) return null;
  const id = h.slice(0,64);
  const val = h.slice(64,128);
  return { id_hex: u256ToHex(id), id_dec: u256ToDec(id), value_dec: u256ToDec(val) };
}

function parseBatchData(dataHex){
  // ABI: [off_ids][off_vals][ids_len][ids...][vals_len][vals...]
  if (!dataHex) return null;
  const h = dataHex.replace(/^0x/,'').toLowerCase();
  const n = h.length;
  const readU = (pos)=> h.slice(pos, pos+64);
  const toNum = (u)=> Number(BigInt('0x'+u));
  if (n < 128) return null;
  try {
    const offIds = toNum(readU(0));
    const offVals = toNum(readU(64));
    const idsLenPos = offIds*2; // hex chars index
    const idsLen = toNum(readU(idsLenPos));
    const ids = [];
    let p = idsLenPos + 64;
    for (let i=0;i<idsLen;i++){ const id = readU(p); ids.push({ id_hex: u256ToHex(id), id_dec: u256ToDec(id) }); p += 64; }
    const valsLenPos = offVals*2;
    const valsLen = toNum(readU(valsLenPos));
    const vals = [];
    p = valsLenPos + 64;
    for (let i=0;i<valsLen;i++){ const v = readU(p); vals.push(u256ToDec(v)); p += 64; }
    const out = [];
    const m = Math.min(ids.length, vals.length);
    for (let i=0;i<m;i++){ out.push({ idx:i, ...ids[i], value_dec: vals[i] }); }
    return out;
  } catch { return null; }
}

function main(){
  if (!fs.existsSync(SRC_DB)) { console.error('Source DB not found:', SRC_DB); process.exit(1); }
  const src = new BetterSqlite3(SRC_DB, { readonly: true, fileMustExist: true });
  const out = new BetterSqlite3(OUT_DB);
  ensureSchema(out);

  const singleTotal = src.prepare("SELECT COUNT(1) AS c FROM raw_logs WHERE lower(topic0) LIKE ?").get(SIG_SINGLE_PFX+'%').c|0;
  const batchTotal  = src.prepare("SELECT COUNT(1) AS c FROM raw_logs WHERE lower(topic0) LIKE ?").get(SIG_BATCH_PFX+'%').c|0;
  const total = singleTotal + batchTotal;
  const startedAt = new Date().toISOString();
  updateStatus({ state:'erc1155_running', total, done:0, rps:0, etaMs:null, startedAt, singleTotal, batchTotal });

  const upS = out.prepare(`INSERT INTO erc1155_single_transfers(block_number,log_index,token,operator,from_addr,to_addr,id_hex,id_dec,value_dec,tx_hash)
    VALUES (@block_number,@log_index,@token,@operator,@from_addr,@to_addr,@id_hex,@id_dec,@value_dec,@tx_hash)
    ON CONFLICT(block_number,log_index) DO UPDATE SET token=excluded.token, operator=excluded.operator, from_addr=excluded.from_addr, to_addr=excluded.to_addr, id_hex=excluded.id_hex, id_dec=excluded.id_dec, value_dec=excluded.value_dec, tx_hash=excluded.tx_hash`);
  const upB = out.prepare(`INSERT INTO erc1155_batch_transfers(block_number,log_index,idx,token,operator,from_addr,to_addr,id_hex,id_dec,value_dec,tx_hash)
    VALUES (@block_number,@log_index,@idx,@token,@operator,@from_addr,@to_addr,@id_hex,@id_dec,@value_dec,@tx_hash)
    ON CONFLICT(block_number,log_index,idx) DO UPDATE SET token=excluded.token, operator=excluded.operator, from_addr=excluded.from_addr, to_addr=excluded.to_addr, id_hex=excluded.id_hex, id_dec=excluded.id_dec, value_dec=excluded.value_dec, tx_hash=excluded.tx_hash`);
  const txS = out.transaction((rows)=>{ for(const r of rows){ upS.run(r); } });
  const txB = out.transaction((rows)=>{ for(const r of rows){ upB.run(r); } });

  const t0 = Date.now();
  let done = 0;

  // Resume cursors
  let sBlock = 0, sIdx = -1; let bBlock = 0, bIdx = -1;
  try { const lastS = out.prepare('SELECT block_number, log_index FROM erc1155_single_transfers ORDER BY block_number DESC, log_index DESC LIMIT 1').get(); if (lastS){ sBlock=lastS.block_number|0; sIdx=lastS.log_index|0; const c=out.prepare('SELECT COUNT(1) AS c FROM erc1155_single_transfers').get(); done += (c?.c|0);} } catch {}
  try { const lastB = out.prepare('SELECT block_number, log_index FROM erc1155_batch_transfers ORDER BY block_number DESC, log_index DESC LIMIT 1').get(); if (lastB){ bBlock=lastB.block_number|0; bIdx=lastB.log_index|0; const c=out.prepare('SELECT COUNT(DISTINCT block_number, log_index) AS c FROM erc1155_batch_transfers').get(); done += (c?.c|0);} } catch {}

  const selSingle = src.prepare(`SELECT block_number, log_index, tx_hash, address, topic1, topic2, topic3, data FROM raw_logs
    WHERE lower(topic0) LIKE ? AND (block_number > ? OR (block_number = ? AND log_index > ?))
    ORDER BY block_number, log_index LIMIT ?`);
  const selBatch = src.prepare(`SELECT block_number, log_index, tx_hash, address, topic1, topic2, topic3, data FROM raw_logs
    WHERE lower(topic0) LIKE ? AND (block_number > ? OR (block_number = ? AND log_index > ?))
    ORDER BY block_number, log_index LIMIT ?`);

  // Process singles
  for(;;){
    const rows = selSingle.all(SIG_SINGLE_PFX+'%', sBlock, sBlock, sIdx, CHUNK);
    if (!rows || rows.length===0) break;
    const mapped = [];
    for(const r of rows){
      const parsed = parseSingleData(r.data||'');
      if (!parsed) continue;
      mapped.push({
        block_number: r.block_number|0,
        log_index: r.log_index|0,
        token: r.address||null,
        operator: last40(r.topic1),
        from_addr: last40(r.topic2),
        to_addr: last40(r.topic3),
        id_hex: parsed.id_hex,
        id_dec: parsed.id_dec,
        value_dec: parsed.value_dec,
        tx_hash: r.tx_hash||null,
      });
    }
    if (mapped.length) txS(mapped);
    done += rows.length;
    const last = rows[rows.length-1]; sBlock = last.block_number; sIdx = last.log_index;
    const dt = Math.max(1, Date.now()-t0); const rps = Math.round(done/(dt/1000)); const remain = Math.max(0, total-done); const etaMs = rps>0? Math.round((remain/rps)*1000) : null;
    updateStatus({ state:'erc1155_running', total, done, rps, etaMs });
    if (done % (CHUNK*4) === 0) console.log(JSON.stringify({ phase:'single', done, total, pct: Number(((done/Math.max(1,total))*100).toFixed(2)) }));
  }

  // Process batches
  for(;;){
    const rows = selBatch.all(SIG_BATCH_PFX+'%', bBlock, bBlock, bIdx, CHUNK);
    if (!rows || rows.length===0) break;
    const mapped = [];
    for(const r of rows){
      const parsed = parseBatchData(r.data||'');
      if (!parsed || !parsed.length) continue;
      for(const item of parsed){
        mapped.push({
          block_number: r.block_number|0,
          log_index: r.log_index|0,
          idx: item.idx|0,
          token: r.address||null,
          operator: last40(r.topic1),
          from_addr: last40(r.topic2),
          to_addr: last40(r.topic3),
          id_hex: item.id_hex,
          id_dec: item.id_dec,
          value_dec: item.value_dec,
          tx_hash: r.tx_hash||null,
        });
      }
    }
    if (mapped.length) txB(mapped);
    done += rows.length;
    const last = rows[rows.length-1]; bBlock = last.block_number; bIdx = last.log_index;
    const dt = Math.max(1, Date.now()-t0); const rps = Math.round(done/(dt/1000)); const remain = Math.max(0, total-done); const etaMs = rps>0? Math.round((remain/rps)*1000) : null;
    updateStatus({ state:'erc1155_running', total, done, rps, etaMs });
    if (done % (CHUNK*4) === 0) console.log(JSON.stringify({ phase:'batch', done, total, pct: Number(((done/Math.max(1,total))*100).toFixed(2)) }));
  }

  updateStatus({ state:'erc1155_done', total, done, rps:0, etaMs:0, finishedAt: new Date().toISOString() });
  const sCount = out.prepare('SELECT COUNT(1) AS c FROM erc1155_single_transfers').get().c|0;
  const bCount = out.prepare('SELECT COUNT(1) AS c FROM erc1155_batch_transfers').get().c|0;
  try { src.close(); } catch {}
  try { out.close(); } catch {}
  console.log(JSON.stringify({ status:'ok', totalLogs: total, singles: sCount, batchItems: bCount }));
}

main();
