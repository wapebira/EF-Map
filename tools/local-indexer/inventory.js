#!/usr/bin/env node
/*
 Inventory raw_logs: distinct addresses, topic0s, block span, row counts.
 Useful to scope decode work and allowlists.
*/
const fs = require('fs');
const path = require('path');
require('dotenv').config();
let BetterSqlite3 = null;
try { BetterSqlite3 = require('better-sqlite3'); } catch {}
const initSqlJs = require('sql.js');

const DB_PATH = process.env.LOCAL_DB_PATH || path.resolve(__dirname, '../../data/local-indexer.db');
const OUT_PATH = process.env.OUT_PATH || path.resolve(__dirname, '../../data/inventory.json');

async function main(){
  let useBetter = false; let db = null; let sqljs = null;
  if (BetterSqlite3) {
    try { db = new BetterSqlite3(DB_PATH, { readonly: true, fileMustExist: true }); useBetter = true; } catch {}
  }
  if (!useBetter) {
    const stat = fs.existsSync(DB_PATH) ? fs.statSync(DB_PATH) : null;
    if (stat && stat.size > (2 * 1024 * 1024 * 1024)) {
      console.error('DB too large for sql.js path; install native better-sqlite3 to run inventory against large DBs.');
      process.exit(2);
    }
    sqljs = await initSqlJs({ locateFile: f=>require.resolve('sql.js/dist/sql-wasm.wasm') });
    const filebuffer = fs.existsSync(DB_PATH) ? fs.readFileSync(DB_PATH) : null;
    db = filebuffer ? new sqljs.Database(filebuffer) : new sqljs.Database();
    const schemaSql = fs.readFileSync(path.resolve(__dirname, './schema.sql'), 'utf8');
    db.exec(schemaSql);
  }

  function single(sql){
    if (useBetter) { return db.prepare(sql).get(); }
    const st = db.prepare(sql); st.step(); const row=st.getAsObject(); st.free(); return row;
  }

  const total = (single('SELECT COUNT(1) AS c FROM raw_logs').c)|0;
  const span = single('SELECT MIN(block_number) AS mn, MAX(block_number) AS mx FROM raw_logs');

  const topN = 1000;
  function collect(sql){
    if (useBetter) { return db.prepare(sql).all(); }
    const st = db.prepare(sql); const arr=[]; while (st.step()) arr.push(st.getAsObject()); st.free(); return arr;
  }

  const topic0s = collect(`SELECT topic0 AS t, COUNT(1) AS c FROM raw_logs WHERE topic0 IS NOT NULL GROUP BY topic0 ORDER BY c DESC LIMIT ${topN}`);
  const addresses = collect(`SELECT address AS a, COUNT(1) AS c FROM raw_logs GROUP BY address ORDER BY c DESC LIMIT ${topN}`);

  const out = { total, minBlock: span.mn|0, maxBlock: span.mx|0, distinct: { topic0: topic0s.length, address: addresses.length }, top: { topic0s, addresses } };
  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  fs.writeFileSync(OUT_PATH, JSON.stringify(out, null, 2));
  console.log(JSON.stringify({ status:'ok', total, out: OUT_PATH, engine: useBetter ? 'better-sqlite3' : 'sql.js' }));
}

main().catch(e=>{ console.error(e); process.exit(1); });
