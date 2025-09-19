#!/usr/bin/env node
/*
 Generic decoder for MUD value blobs.
 - Input: erc_mud_values (table_id, key0..key3, block_number, log_index, static_hex, encoded_lengths_hex, dynamic_hex)
 - Output: erc_mud_values_decoded (same keys + static_words_json, encoded_lengths_words_json, dynamic_hex, counts)
 - Purpose: provide semi-typed, inspectable representation to accelerate per-table schema mapping.

 Env:
   DECODED_DB_PATH  path to decoded DB (default data/local-indexer-decoded.db)
   ONLY_TABLE       optional filter (namespace/name)
   MAX_ROWS         optional cap of total rows processed (int)
   CHUNK            batch size (default 20000)
*/
/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');
let BetterSqlite3=null; try{ BetterSqlite3=require('better-sqlite3'); }catch{}
if(!BetterSqlite3){ console.error('better-sqlite3 required'); process.exit(2); }

const ROOT = path.resolve(__dirname, '../../');
const OUT_DB = process.env.DECODED_DB_PATH || path.resolve(ROOT, 'data/local-indexer-decoded.db');
const ONLY_TABLE = process.env.ONLY_TABLE || '';
const MAX_ROWS = process.env.MAX_ROWS ? Number(process.env.MAX_ROWS) : null;
const CHUNK = Number(process.env.CHUNK || 20000);

function readJson(p, fb){ try { return JSON.parse(fs.readFileSync(p,'utf8')); } catch { return fb; } }

function ensureSchema(db){
  db.exec(`
    CREATE TABLE IF NOT EXISTS erc_mud_values_decoded (
      table_id TEXT NOT NULL,
      key0 TEXT,
      key1 TEXT,
      key2 TEXT,
      key3 TEXT,
      block_number INTEGER NOT NULL,
      log_index INTEGER NOT NULL,
      static_word_count INTEGER,
      static_words_json TEXT,
      encoded_lengths_word_count INTEGER,
      encoded_lengths_words_json TEXT,
      dynamic_hex TEXT,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (table_id, key0, key1, key2, key3)
    );
    CREATE INDEX IF NOT EXISTS idx_mud_valdec_table ON erc_mud_values_decoded(table_id);
    CREATE INDEX IF NOT EXISTS idx_mud_valdec_block ON erc_mud_values_decoded(block_number);
  `);
}

function wordsFromHex(hex){
  if (!hex || typeof hex !== 'string') return [];
  const h = hex.replace(/^0x/,'').toLowerCase();
  const out = [];
  for (let i=0;i<h.length;i+=64){ const w = h.slice(i, i+64); if (!w) break; out.push('0x'+w.padEnd(64,'0')); }
  return out;
}

function findTableId(db, namespace, name){
  try { const r=db.prepare('SELECT table_id FROM erc_mud_table_stats WHERE namespace=? AND name=?').get(namespace,name); if(r&&r.table_id) return r.table_id; } catch{}
  const toHex=(s)=>Buffer.from(String(s||''),'utf8');
  const pad32=(b)=> (b.length>=32? b.slice(0,32): Buffer.concat([b, Buffer.alloc(32-b.length)]));
  return '0x'+Buffer.concat([pad32(toHex(namespace)), pad32(toHex(name))]).toString('hex');
}

function main(){
  if (!fs.existsSync(OUT_DB)) { console.error('decoded db missing:', OUT_DB); process.exit(1); }
  const db = new BetterSqlite3(OUT_DB);
  ensureSchema(db);
  const haveVals = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='erc_mud_values'").get();
  if (!haveVals){ console.error('missing erc_mud_values'); process.exit(1); }

  let tableIdFilter = null;
  if (ONLY_TABLE){
    const [ns, name] = ONLY_TABLE.split('/');
    tableIdFilter = findTableId(db, ns, name);
  }

  const countSql = tableIdFilter
    ? 'SELECT COUNT(1) AS c FROM erc_mud_values WHERE table_id=?'
    : 'SELECT COUNT(1) AS c FROM erc_mud_values';
  const total = tableIdFilter
    ? (db.prepare(countSql).get(tableIdFilter).c|0)
    : (db.prepare(countSql).get().c|0);

  const selSql = tableIdFilter
    ? 'SELECT table_id, key0, key1, key2, key3, block_number, log_index, static_hex, encoded_lengths_hex, dynamic_hex FROM erc_mud_values WHERE table_id=? ORDER BY key0,key1,key2,key3 LIMIT ? OFFSET ?'
    : 'SELECT table_id, key0, key1, key2, key3, block_number, log_index, static_hex, encoded_lengths_hex, dynamic_hex FROM erc_mud_values ORDER BY table_id, key0,key1,key2,key3 LIMIT ? OFFSET ?';
  const sel = tableIdFilter ? db.prepare(selSql) : db.prepare(selSql);

  const up = db.prepare(`INSERT INTO erc_mud_values_decoded(
      table_id,key0,key1,key2,key3,block_number,log_index,
      static_word_count,static_words_json,encoded_lengths_word_count,encoded_lengths_words_json,dynamic_hex
    ) VALUES (@table_id,@key0,@key1,@key2,@key3,@block_number,@log_index,@static_word_count,@static_words_json,@encoded_lengths_word_count,@encoded_lengths_words_json,@dynamic_hex)
    ON CONFLICT(table_id,key0,key1,key2,key3)
    DO UPDATE SET block_number=excluded.block_number, log_index=excluded.log_index,
      static_word_count=excluded.static_word_count, static_words_json=excluded.static_words_json,
      encoded_lengths_word_count=excluded.encoded_lengths_word_count, encoded_lengths_words_json=excluded.encoded_lengths_words_json,
      dynamic_hex=excluded.dynamic_hex, updated_at=CURRENT_TIMESTAMP`);
  const tx = db.transaction((rows)=>{ for(const r of rows) up.run(r); });

  let processed = 0;
  for (let off=0; off<total; off+=CHUNK){
    if (MAX_ROWS!=null && processed>=MAX_ROWS) break;
    const rows = tableIdFilter ? sel.all(tableIdFilter, CHUNK, off) : sel.all(CHUNK, off);
    if (!rows.length) break;
    const mapped = rows.map((r)=>{
      const staticWords = wordsFromHex(r.static_hex);
      const encLenWords = wordsFromHex(r.encoded_lengths_hex);
      return {
        table_id: r.table_id,
        key0: r.key0||null,
        key1: r.key1||null,
        key2: r.key2||null,
        key3: r.key3||null,
        block_number: r.block_number|0,
        log_index: r.log_index|0,
        static_word_count: staticWords.length,
        static_words_json: JSON.stringify(staticWords),
        encoded_lengths_word_count: encLenWords.length,
        encoded_lengths_words_json: JSON.stringify(encLenWords),
        dynamic_hex: r.dynamic_hex||null,
      };
    });
    if (mapped.length) tx(mapped);
    processed += rows.length;
    const pct = total? Math.round((Math.min(processed, total)/total)*100) : 100;
    process.stdout.write(`\r[mud-values-decoded] ${processed}/${total} (${pct}%)   `);
  }
  process.stdout.write('\n');
  const outCount = db.prepare('SELECT COUNT(1) AS c FROM erc_mud_values_decoded').get().c|0;
  console.log(JSON.stringify({ status:'ok', processed, total, outCount }, null, 2));
  try { db.close(); } catch {}
}

main();
