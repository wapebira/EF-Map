#!/usr/bin/env node
/*
 List MUD tables whose namespace or name contains a given substring (case-insensitive).
 Usage: SUBSTR=deploy node tools/local-indexer/list_mud_tables_like.js
*/
/* eslint-disable no-console */
const path = require('path');
const fs = require('fs');
let BetterSqlite3=null; try{ BetterSqlite3=require('better-sqlite3'); }catch{}
if(!BetterSqlite3){ console.error('better-sqlite3 required'); process.exit(2); }

const ROOT = path.resolve(__dirname, '../../');
const OUT_DB = process.env.DECODED_DB_PATH || path.resolve(ROOT, 'data/local-indexer-decoded.db');
const SUBSTR = (process.env.SUBSTR || process.argv[2] || '').toLowerCase();

function main(){
  if (!SUBSTR){ console.error('Provide SUBSTR env or arg'); process.exit(1); }
  if (!fs.existsSync(OUT_DB)){ console.error('missing decoded db:', OUT_DB); process.exit(1); }
  const db = new BetterSqlite3(OUT_DB, { readonly:true, fileMustExist:true });
  const rows = db.prepare('SELECT namespace, name, table_id, rows FROM erc_mud_table_stats ORDER BY rows DESC').all();
  const out = rows.filter(r=> (String(r.namespace||'').toLowerCase().includes(SUBSTR) || String(r.name||'').toLowerCase().includes(SUBSTR)) )
                  .map(r=> ({ namespace:r.namespace, name:r.name, rows:r.rows|0 }));
  console.log(JSON.stringify({ substr: SUBSTR, count: out.length, tables: out }, null, 2));
  try{ db.close(); }catch{}
}

main();
