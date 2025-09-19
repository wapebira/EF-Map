#!/usr/bin/env node
/*
 Materialize MUD Store_SetRecord events (topic0=0x8c0b5119...)
 - Read from decoded_events for matching topic0 (fast indexable)
 - Fetch data from raw_logs to parse keyTuple length and up to 4 keys
 - Write into erc_mud_set_record table (lightweight, no large blobs)
 - Track progress into data/local-indexer-status.json as decodeMud
*/
const fs = require('fs');
const path = require('path');
let BetterSqlite3=null; try{ BetterSqlite3=require('better-sqlite3'); }catch{}
if (!BetterSqlite3){ console.error('better-sqlite3 required'); process.exit(2); }
const ROOT = path.resolve(__dirname, '../../');
const OUT_DB = process.env.DECODED_DB_PATH || path.resolve(ROOT, 'data/local-indexer-decoded.db');
const SRC_DB = process.env.LOCAL_DB_PATH || path.resolve(ROOT, 'data/local-indexer.db');
const STATUS_PATH = process.env.STATUS_PATH || path.resolve(ROOT, 'data/local-indexer-status.json');
const CHUNK = Number(process.env.MUD_CHUNK || 10000);
const MAX_ROWS = process.env.MUD_MAX_ROWS ? Number(process.env.MUD_MAX_ROWS) : null; // optional cap for validation runs
const SIG_SETRECORD = '0x8c0b5119d4cec7b284c6b1b39252a03d1e2f2d7451a5895562524c113bb952be';

function readJson(p, fb){ try { return JSON.parse(fs.readFileSync(p,'utf8')); } catch { return fb; } }
function writeJson(p, obj){ try { fs.writeFileSync(p, JSON.stringify(obj, null, 2)); } catch {} }
function updateStatus(patch){ const s=readJson(STATUS_PATH, {}); s.decodeMud={ ...(s.decodeMud||{}), ...patch, t:new Date().toISOString() }; writeJson(STATUS_PATH, s); }

function ensureSchema(db){
  db.exec(`
    CREATE TABLE IF NOT EXISTS erc_mud_set_record (
      block_number INTEGER NOT NULL,
      log_index INTEGER NOT NULL,
      address TEXT,
      table_id TEXT,
      key_count INTEGER,
      key0 TEXT,
      key1 TEXT,
      key2 TEXT,
      key3 TEXT,
      tx_hash TEXT,
      PRIMARY KEY (block_number, log_index)
    );
    CREATE INDEX IF NOT EXISTS idx_mud_table ON erc_mud_set_record(table_id);
    CREATE INDEX IF NOT EXISTS idx_mud_addr ON erc_mud_set_record(address);
  `);
}

function parseKeyTupleFromData(hex){
  if (!hex) return { keyCount:0, keys:[] };
  const h = hex.replace(/^0x/,'').toLowerCase();
  const readU = (pos)=> h.slice(pos, pos+64);
  const toNum = (u)=> Number(BigInt('0x'+u));
  try{
    // Offsets for dynamic params: keyTuple, staticData, encodedLengths, dynamicData
    const offKey = parseInt(readU(0), 16) * 2; // to hex index
    const len = toNum(readU(offKey));
    const keys=[]; let p = offKey + 64;
    for (let i=0;i<len;i++){ const w = readU(p); keys.push('0x'+w.slice(-40)); p += 64; if (keys.length>=4) break; }
    return { keyCount: len, keys };
  } catch {
    return { keyCount:0, keys:[] };
  }
}

function main(){
  if (!fs.existsSync(OUT_DB) || !fs.existsSync(SRC_DB)) { console.error('missing dbs'); process.exit(1); }
  const out = new BetterSqlite3(OUT_DB);
  const src = new BetterSqlite3(SRC_DB, { readonly:true, fileMustExist:true });
  ensureSchema(out);
  const total = out.prepare('SELECT COUNT(1) AS c FROM decoded_events WHERE lower(topic0)=?').get(SIG_SETRECORD).c|0;
  const startedAt = new Date().toISOString();
  updateStatus({ state:'mud_running', total, done:0, rps:0, etaMs:null, startedAt });

  const sel = out.prepare(`SELECT block_number, log_index, tx_hash, address, topic1 AS table_id FROM decoded_events
    WHERE lower(topic0)=? AND (block_number > ? OR (block_number = ? AND log_index > ?))
    ORDER BY block_number, log_index LIMIT ?`);
  const getData = src.prepare('SELECT data FROM raw_logs WHERE block_number=? AND log_index=?');
  const up = out.prepare(`INSERT INTO erc_mud_set_record(block_number,log_index,address,table_id,key_count,key0,key1,key2,key3,tx_hash)
    VALUES (@block_number,@log_index,@address,@table_id,@key_count,@key0,@key1,@key2,@key3,@tx_hash)
    ON CONFLICT(block_number,log_index) DO UPDATE SET address=excluded.address, table_id=excluded.table_id, key_count=excluded.key_count, key0=excluded.key0, key1=excluded.key1, key2=excluded.key2, key3=excluded.key3, tx_hash=excluded.tx_hash`);
  const tx = out.transaction((rows)=>{ for(const r of rows) up.run(r); });

  // resume cursor
  let curB=0, curI=-1, done=0; const t0=Date.now();
  const last = out.prepare('SELECT block_number, log_index FROM erc_mud_set_record ORDER BY block_number DESC, log_index DESC LIMIT 1').get();
  if (last){ curB = last.block_number|0; curI = last.log_index|0; }

  while(true){
    if (MAX_ROWS!=null && done>=MAX_ROWS) break;
    const rows = sel.all(SIG_SETRECORD, curB, curB, curI, CHUNK);
    if (!rows.length) break;
    const mapped = [];
    for(const r of rows){
      let dataHex = null; try { const g = getData.get(r.block_number|0, r.log_index|0); dataHex = g && g.data || null; } catch {}
      const parsed = parseKeyTupleFromData(dataHex);
      mapped.push({
        block_number: r.block_number|0,
        log_index: r.log_index|0,
        address: r.address||null,
        table_id: r.table_id||null,
        key_count: parsed.keyCount|0,
        key0: parsed.keys[0]||null,
        key1: parsed.keys[1]||null,
        key2: parsed.keys[2]||null,
        key3: parsed.keys[3]||null,
        tx_hash: r.tx_hash||null,
      });
    }
    if (mapped.length) tx(mapped);
    done += rows.length;
    const lastRow = rows[rows.length-1]; curB = lastRow.block_number; curI = lastRow.log_index;
    const dt = Math.max(1, Date.now()-t0); const rps = Math.round(done/(dt/1000)); const remain = Math.max(0, total-done); const etaMs = rps>0? Math.round((remain/rps)*1000) : null;
    updateStatus({ state:'mud_running', total, done, rps, etaMs });
  }
  updateStatus({ state:'mud_done', total, done, rps:0, etaMs:0, finishedAt: new Date().toISOString() });
  try { out.close(); } catch {}
  try { src.close(); } catch {}
  console.log(JSON.stringify({ status:'ok', total, processed: done }));
}

main();
