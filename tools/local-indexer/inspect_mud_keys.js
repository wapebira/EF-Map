#!/usr/bin/env node
/*
 Inspect distinct key tuple cardinalities for a MUD table in erc_mud_latest to recommend KEY_COUNT.

 Env:
   DECODED_DB_PATH  path to decoded DB (default data/local-indexer-decoded.db)
   ONLY_TABLE       namespace/name (required)
*/
/* eslint-disable no-console */
const path = require('path');
const fs = require('fs');
let BetterSqlite3=null; try{ BetterSqlite3=require('better-sqlite3'); }catch{}
if(!BetterSqlite3){ console.error('better-sqlite3 required'); process.exit(2); }

const ROOT = path.resolve(__dirname, '../../');
const OUT_DB = process.env.DECODED_DB_PATH || path.resolve(ROOT, 'data/local-indexer-decoded.db');
const ONLY_TABLE = process.env.ONLY_TABLE || '';

function findTableId(db, namespace, name){
  try { const r=db.prepare('SELECT table_id FROM erc_mud_table_stats WHERE namespace=? AND name=?').get(namespace,name); if(r&&r.table_id) return r.table_id; } catch{}
  const toHex=(s)=>Buffer.from(String(s||''),'utf8');
  const pad32=(b)=> (b.length>=32? b.slice(0,32): Buffer.concat([b, Buffer.alloc(32-b.length)]));
  return '0x'+Buffer.concat([pad32(toHex(namespace)), pad32(toHex(name))]).toString('hex');
}

function main(){
  if (!ONLY_TABLE){ console.error('ONLY_TABLE required (namespace/name)'); process.exit(1); }
  if (!fs.existsSync(OUT_DB)){ console.error('missing decoded db:', OUT_DB); process.exit(1); }
  const db = new BetterSqlite3(OUT_DB, { readonly:true, fileMustExist:true });
  const [ns,name] = ONLY_TABLE.split('/');
  const tableId = findTableId(db, ns, name);
  const total = db.prepare('SELECT COUNT(1) AS c FROM erc_mud_latest WHERE table_id=?').get(tableId).c|0;
  const d1 = db.prepare('SELECT COUNT(DISTINCT key0) AS c FROM erc_mud_latest WHERE table_id=?').get(tableId).c|0;
  const d2 = db.prepare('SELECT COUNT(1) AS c FROM (SELECT DISTINCT key0, key1 FROM erc_mud_latest WHERE table_id=?)').get(tableId).c|0;
  const d3 = db.prepare('SELECT COUNT(1) AS c FROM (SELECT DISTINCT key0, key1, key2 FROM erc_mud_latest WHERE table_id=?)').get(tableId).c|0;
  const d4 = db.prepare('SELECT COUNT(1) AS c FROM (SELECT DISTINCT key0, key1, key2, key3 FROM erc_mud_latest WHERE table_id=?)').get(tableId).c|0;
  let recommended = 1;
  if (d1 !== total){ recommended = 2; }
  if (d2 !== total){ recommended = 3; }
  if (d3 !== total){ recommended = 4; }
  const out = { table: `${ns}/${name}`, tableId, total, distinct: { key0:d1, key01:d2, key012:d3, key0123:d4 }, recommended_key_count: recommended };
  console.log(JSON.stringify(out, null, 2));
  try{ db.close(); }catch{}
}

main();
