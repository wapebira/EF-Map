#!/usr/bin/env node
/*
 Materialize decoded events into a standalone SQLite DB for fast queries.
 - Reads raw_logs from data/local-indexer.db
 - Uses decode status (data/local-indexer-status.json) to confirm completion
 - Writes to data/local-indexer-decoded.db (created if missing)
 - Table: decoded_events(block_number, log_index, tx_hash, address, topic0, topic1, topic2, topic3, event_name, fields_json)
 - Idempotent UPSERT by (block_number, log_index)
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
const CHUNK = Number(process.env.MAT_CHUNK || 25000);

function readJson(p, fb){ try { return JSON.parse(fs.readFileSync(p,'utf8')); } catch { return fb; } }

function ensureSchema(db){
  db.exec(`
    PRAGMA journal_mode=WAL;
    CREATE TABLE IF NOT EXISTS decoded_events (
      block_number INTEGER NOT NULL,
      log_index INTEGER NOT NULL,
      tx_hash TEXT,
      address TEXT,
      topic0 TEXT,
      topic1 TEXT,
      topic2 TEXT,
      topic3 TEXT,
      event_name TEXT,
      fields_json TEXT,
      PRIMARY KEY (block_number, log_index)
    );
    CREATE INDEX IF NOT EXISTS idx_decoded_topic0 ON decoded_events(topic0);
    CREATE INDEX IF NOT EXISTS idx_decoded_event ON decoded_events(event_name);
    CREATE INDEX IF NOT EXISTS idx_decoded_address_event ON decoded_events(address, event_name);
  `);
}

function main(){
  const status = readJson(STATUS_PATH, {});
  const d = status && status.decode || {};
  if (d.state !== 'decode_done' || !d.total || d.total !== d.done){
    console.error('Decode not complete yet or counts mismatch. Aborting materialization.');
    process.exit(1);
  }

  const src = new BetterSqlite3(SRC_DB, { readonly: true, fileMustExist: true });
  const out = new BetterSqlite3(OUT_DB);
  ensureSchema(out);

  // Simple materialization: copy rows, annotate minimal decoded info
  const total = src.prepare('SELECT COUNT(1) AS c FROM raw_logs').get().c|0;

  // Resume support: find last inserted cursor
  let curBlock = 0, curIdx = -1;
  try {
    const last = out.prepare('SELECT block_number, log_index FROM decoded_events ORDER BY block_number DESC, log_index DESC LIMIT 1').get();
    if (last){ curBlock = last.block_number|0; curIdx = last.log_index|0; }
  } catch {}

  const select = src.prepare('SELECT block_number, log_index, tx_hash, address, topic0, topic1, topic2, topic3 FROM raw_logs WHERE (block_number > ? OR (block_number = ? AND log_index > ?)) ORDER BY block_number, log_index LIMIT ?');
  const upsert = out.prepare('INSERT INTO decoded_events(block_number, log_index, tx_hash, address, topic0, topic1, topic2, topic3, event_name, fields_json) VALUES (@block_number,@log_index,@tx_hash,@address,@topic0,@topic1,@topic2,@topic3,@event_name,@fields_json) ON CONFLICT(block_number,log_index) DO UPDATE SET tx_hash=excluded.tx_hash, address=excluded.address, topic0=excluded.topic0, topic1=excluded.topic1, topic2=excluded.topic2, topic3=excluded.topic3, event_name=excluded.event_name, fields_json=excluded.fields_json');
  const txn = out.transaction((rows)=>{ for(const r of rows){ upsert.run(r); } });

  let copied = 0;
  for(;;){
    const rows = select.all(curBlock, curBlock, curIdx, CHUNK);
    if (!rows || rows.length===0) break;
    const mapped = rows.map(r=>({
      block_number: r.block_number|0,
      log_index: r.log_index|0,
      tx_hash: r.tx_hash||null,
      address: r.address||null,
      topic0: r.topic0||null,
      topic1: r.topic1||null,
      topic2: r.topic2||null,
      topic3: r.topic3||null,
      event_name: null,
      fields_json: null,
    }));
    txn(mapped);
    copied += mapped.length;
    const last = mapped[mapped.length-1];
    curBlock = last.block_number; curIdx = last.log_index;
    if (copied % (CHUNK*4) === 0) console.log(JSON.stringify({ copied, pct: Number(((copied/total)*100).toFixed(2)) }));
  }

  // Final report
  const outCount = out.prepare('SELECT COUNT(1) AS c FROM decoded_events').get().c|0;
  try { src.close(); } catch {}
  try { out.close(); } catch {}
  const size = fs.existsSync(OUT_DB) ? fs.statSync(OUT_DB).size : 0;
  console.log(JSON.stringify({ status:'ok', total, outCount, sizeBytes:size, outDb:OUT_DB }));
}

main();
