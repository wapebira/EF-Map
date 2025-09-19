#!/usr/bin/env node
/*
 List MUD tables from erc_mud_table_stats with latest row counts.
*/
/* eslint-disable no-console */
const path = require('path');
const fs = require('fs');
let BetterSqlite3=null; try{ BetterSqlite3=require('better-sqlite3'); }catch{}
if(!BetterSqlite3){ console.error('better-sqlite3 required'); process.exit(2); }

const ROOT = path.resolve(__dirname, '../../');
const OUT_DB = process.env.DECODED_DB_PATH || path.resolve(ROOT, 'data/local-indexer-decoded.db');

function readJson(p, fb){ try { return JSON.parse(fs.readFileSync(p,'utf8')); } catch { return fb; } }

function main(){
  if (!fs.existsSync(OUT_DB)){ console.error('missing decoded db:', OUT_DB); process.exit(1); }
  const db = new BetterSqlite3(OUT_DB, { readonly:true, fileMustExist:true });
  const wave1 = readJson(path.resolve(__dirname, 'mud_tables_wave1.json'), []);
  const waveSet = new Set(wave1.map((t)=> `${t.namespace}/${t.name}`));
  const haveLatest = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='erc_mud_latest'").get();
  if (!haveLatest){ console.error('missing erc_mud_latest'); process.exit(1); }
  const rows = db.prepare('SELECT namespace, name, table_id, rows FROM erc_mud_table_stats ORDER BY rows DESC').all();
  const countLatest = db.prepare('SELECT COUNT(1) AS c FROM erc_mud_latest WHERE table_id=?');
  const out = rows.map((r)=>{
    const c = countLatest.get(r.table_id).c|0;
    const key0 = db.prepare('SELECT COUNT(DISTINCT key0) AS c FROM erc_mud_latest WHERE table_id=?').get(r.table_id).c|0;
    const key01 = db.prepare('SELECT COUNT(1) AS c FROM (SELECT DISTINCT key0,key1 FROM erc_mud_latest WHERE table_id=?)').get(r.table_id).c|0;
    const key012 = db.prepare('SELECT COUNT(1) AS c FROM (SELECT DISTINCT key0,key1,key2 FROM erc_mud_latest WHERE table_id=?)').get(r.table_id).c|0;
    const key0123 = db.prepare('SELECT COUNT(1) AS c FROM (SELECT DISTINCT key0,key1,key2,key3 FROM erc_mud_latest WHERE table_id=?)').get(r.table_id).c|0;
    let recommended=1; if(key0!==c) recommended=2; if(key01!==c) recommended=3; if(key012!==c) recommended=4;
    return { namespace:r.namespace, name:r.name, tableId:r.table_id, statsRows:r.rows, latest:c, distinct:{key0, key01, key012, key0123}, keyCount:recommended, inWave1: waveSet.has(`${r.namespace}/${r.name}`) };
  });
  console.log(JSON.stringify({ total: out.length, tables: out }, null, 2));
  try{ db.close(); }catch{}
}

main();
