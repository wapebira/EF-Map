#!/usr/bin/env node
/*
 Build/update a latest-pointer snapshot for selected MUD tables.
 - Input: OUT_DB (decoded db with erc_mud_set_record & erc_mud_table_stats)
 - Output: erc_mud_latest(table_id, key0..key3, block_number, log_index) with PK on (table_id, keys)
 - Scope: Wave-1 tables listed in mud_tables_wave1.json (override via ONLY_TABLE)
 - Purpose: fast, stable lookup of current state per key tuple, without decoding values yet.

 Env:
   DECODED_DB_PATH   path to decoded DB (default data/local-indexer-decoded.db)
   STATUS_PATH       status json path (default data/local-indexer-status.json)
   ONLY_TABLE        optional filter in form "namespace/name" to process only one
   MAX_PER_TABLE     optional cap of processed rows per table (for testing)
   CHUNK             batch size (default 10000)
*/
/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');
let BetterSqlite3 = null; try { BetterSqlite3 = require('better-sqlite3'); } catch {}
if (!BetterSqlite3) { console.error('better-sqlite3 required'); process.exit(2); }

const ROOT = path.resolve(__dirname, '../../');
const OUT_DB = process.env.DECODED_DB_PATH || path.resolve(ROOT, 'data/local-indexer-decoded.db');
const STATUS_PATH = process.env.STATUS_PATH || path.resolve(ROOT, 'data/local-indexer-status.json');
const CHUNK = Number(process.env.CHUNK || 10000);
const MAX_PER_TABLE = process.env.MAX_PER_TABLE ? Number(process.env.MAX_PER_TABLE) : null;
const ONLY_TABLE = process.env.ONLY_TABLE || '';

function readJson(p, fb){ try { return JSON.parse(fs.readFileSync(p,'utf8')); } catch { return fb; } }
function writeJson(p, obj){ try { fs.writeFileSync(p, JSON.stringify(obj, null, 2)); } catch {} }
function updateStatus(patch){
  const s = readJson(STATUS_PATH, {});
  s.decodeMudLatest = { ...(s.decodeMudLatest||{}), ...patch, t:new Date().toISOString() };
  writeJson(STATUS_PATH, s);
}

function ensureSchema(db){
  db.exec(`
    CREATE TABLE IF NOT EXISTS erc_mud_latest (
      table_id TEXT NOT NULL,
      key0 TEXT,
      key1 TEXT,
      key2 TEXT,
      key3 TEXT,
      block_number INTEGER NOT NULL,
      log_index INTEGER NOT NULL,
      PRIMARY KEY (table_id, key0, key1, key2, key3)
    );
    CREATE INDEX IF NOT EXISTS idx_mud_latest_table ON erc_mud_latest(table_id);
    CREATE INDEX IF NOT EXISTS idx_mud_latest_block ON erc_mud_latest(block_number);
  `);
}

function loadWave1(){
  const p = path.resolve(__dirname, 'mud_tables_wave1.json');
  const arr = readJson(p, []);
  if (!Array.isArray(arr) || !arr.length){
    console.error('wave1 list empty:', p);
    process.exit(1);
  }
  if (ONLY_TABLE){
  const [ns, name] = ONLY_TABLE.split('/').map((s)=> (s||'').trim());
  // If ONLY_TABLE exists in wave1, filter to it; else allow arbitrary table via explicit tuple
  const inWave = arr.find((r)=> r.namespace===ns && r.name===name);
  return inWave ? [inWave] : [{ namespace: ns, name }];
  }
  return arr;
}

function findTableId(db, namespace, name){
  // Prefer authoritative id from stats table to avoid encoding mismatches
  try{
    const r = db.prepare('SELECT table_id FROM erc_mud_table_stats WHERE namespace=? AND name=?').get(namespace, name);
    if (r && r.table_id) return r.table_id;
  } catch {}
  // Fallback: encode ascii -> bytes32 padded (ns + name)
  const toHex = (str)=> Buffer.from(String(str||''), 'utf8');
  const pad32 = (buf)=> (buf.length>=32? buf.slice(0,32) : Buffer.concat([buf, Buffer.alloc(32-buf.length)]) );
  const nsHex = pad32(toHex(namespace));
  const nameHex = pad32(toHex(name));
  return '0x' + Buffer.concat([nsHex, nameHex]).toString('hex');
}

function main(){
  if (!fs.existsSync(OUT_DB)) { console.error('decoded db missing:', OUT_DB); process.exit(1); }
  const db = new BetterSqlite3(OUT_DB);
  db.pragma('busy_timeout=1000');
  ensureSchema(db);

  const wave = loadWave1();
  const selNext = db.prepare(`SELECT table_id, key0, key1, key2, key3, block_number, log_index
    FROM erc_mud_set_record
    WHERE table_id = ? AND (block_number > ? OR (block_number = ? AND log_index > ?))
    ORDER BY block_number, log_index
    LIMIT ?`);
  const up = db.prepare(`INSERT INTO erc_mud_latest(table_id,key0,key1,key2,key3,block_number,log_index)
    VALUES (@table_id,@key0,@key1,@key2,@key3,@block_number,@log_index)
    ON CONFLICT(table_id,key0,key1,key2,key3)
    DO UPDATE SET block_number=excluded.block_number, log_index=excluded.log_index`);
  const tx = db.transaction((rows)=>{ for(const r of rows) up.run(r); });

  let totalProcessed = 0;
  const perTable = [];

  for (const t of wave){
    const tableId = findTableId(db, t.namespace, t.name);
    if (!tableId){ console.warn('skip (no id):', t.namespace, t.name); continue; }
    let done = 0;
    let curB = 0, curI = -1;
    const t0 = Date.now();
    // Attempt to resume: we can query the max pointer we already wrote and start after that.
    try{
      const last = db.prepare('SELECT MAX(block_number) AS b, MAX(log_index) AS i FROM erc_mud_latest WHERE table_id=?').get(tableId);
      if (last && Number.isFinite(last.b)) { curB = last.b|0; }
      if (last && Number.isFinite(last.i)) { curI = last.i|0; }
    } catch {}
    while(true){
      if (MAX_PER_TABLE!=null && done>=MAX_PER_TABLE) break;
      const rows = selNext.all(tableId, curB, curB, curI, CHUNK);
      if (!rows.length) break;
      const mapped = rows.map((r)=> ({
        table_id: r.table_id,
        key0: r.key0||null,
        key1: r.key1||null,
        key2: r.key2||null,
        key3: r.key3||null,
        block_number: r.block_number|0,
        log_index: r.log_index|0,
      }));
      if (mapped.length) tx(mapped);
      done += rows.length; totalProcessed += rows.length;
      const last = rows[rows.length-1]; curB = last.block_number|0; curI = last.log_index|0;
      const dt = Math.max(1, Date.now()-t0); const rps = Math.round(done/(dt/1000));
      updateStatus({ state:'mud_latest_running', table: `${t.namespace}/${t.name}`, tableId, done, rps, totalProcessed });
    }
    perTable.push({ namespace: t.namespace, name: t.name, tableId, processed: done });
  }

  updateStatus({ state:'mud_latest_done', totalProcessed, perTable });
  try { db.close(); } catch {}
  console.log(JSON.stringify({ status:'ok', totalProcessed, perTable }, null, 2));
}

main();
