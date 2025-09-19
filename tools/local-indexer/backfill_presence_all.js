#!/usr/bin/env node
/*
 Backfill typed presence tables for all non-Wave‑1 MUD tables.
 For each table: determine KEY_COUNT via distinct tuple analysis, then call materialize_typed_presence.js.
*/
/* eslint-disable no-console */
const path = require('path');
const { spawnSync } = require('child_process');
const fs = require('fs');
let BetterSqlite3=null; try{ BetterSqlite3=require('better-sqlite3'); }catch{}
if(!BetterSqlite3){ console.error('better-sqlite3 required'); process.exit(2); }

const ROOT = path.resolve(__dirname, '../../');
const OUT_DB = process.env.DECODED_DB_PATH || path.resolve(ROOT, 'data/local-indexer-decoded.db');

function readJson(p, fb){ try { return JSON.parse(fs.readFileSync(p,'utf8')); } catch { return fb; } }

function recommendKeyCount(db, tableId){
  const c = db.prepare('SELECT COUNT(1) AS c FROM erc_mud_latest WHERE table_id=?').get(tableId).c|0;
  const d1 = db.prepare('SELECT COUNT(DISTINCT key0) AS c FROM erc_mud_latest WHERE table_id=?').get(tableId).c|0;
  const d2 = db.prepare('SELECT COUNT(1) AS c FROM (SELECT DISTINCT key0,key1 FROM erc_mud_latest WHERE table_id=?)').get(tableId).c|0;
  const d3 = db.prepare('SELECT COUNT(1) AS c FROM (SELECT DISTINCT key0,key1,key2 FROM erc_mud_latest WHERE table_id=?)').get(tableId).c|0;
  // If deeper distinct counts equal c, we can stop at that key depth
  if (d1===c) return 1;
  if (d2===c) return 2;
  if (d3===c) return 3;
  return 4;
}

function main(){
  if (!fs.existsSync(OUT_DB)){ console.error('missing decoded db:', OUT_DB); process.exit(1); }
  const db = new BetterSqlite3(OUT_DB, { readonly:false, fileMustExist:true });
  const wave1 = readJson(path.resolve(__dirname, 'mud_tables_wave1.json'), []);
  const waveSet = new Set(wave1.map((t)=> `${t.namespace}/${t.name}`));
  const rows = db.prepare('SELECT namespace, name, table_id FROM erc_mud_table_stats ORDER BY rows DESC').all();
  const targets = rows.filter((r)=> !waveSet.has(`${r.namespace}/${r.name}`));
  const envBase = { ...process.env, DECODED_DB_PATH: OUT_DB };
  const results=[];
  for (const t of targets){
    const keyCount = recommendKeyCount(db, t.table_id);
    const outputTable = `mud_${t.name}`.replace(/[^a-zA-Z0-9_]/g,'_').toLowerCase();
    const env = { ...envBase, ONLY_TABLE: `${t.namespace}/${t.name}`, OUTPUT_TABLE: outputTable, KEY_COUNT: String(keyCount) };
    process.stdout.write(`\n[backfill] ${t.namespace}/${t.name} -> ${outputTable} (keys=${keyCount})\n`);
    const r = spawnSync(process.execPath, [ path.resolve(__dirname, 'materialize_typed_presence.js') ], { env, stdio: 'inherit' });
    results.push({ table: `${t.namespace}/${t.name}`, outputTable, keyCount, code: r.status });
  }
  try{ db.close(); }catch{}
  console.log(JSON.stringify({ status:'ok', processed: results.length }, null, 2));
}

main();
