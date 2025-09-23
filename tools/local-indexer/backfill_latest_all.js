#!/usr/bin/env node
/*
 Build latest pointers (erc_mud_latest) for all non-Wave‑1 tables.
 Defaults: skip very heavy tables (Fuel, DeployableState) unless INCLUDE_HEAVY=1.

 Env:
   DECODED_DB_PATH  path to decoded DB
   INCLUDE_HEAVY    1 to include heavy tables (default 0)
   MAX_PER_TABLE    limit rows per table (optional, passed through)
*/
/* eslint-disable no-console */
const path = require('path');
const { spawnSync } = require('child_process');
const fs = require('fs');
let BetterSqlite3=null; try{ BetterSqlite3=require('better-sqlite3'); }catch{}
if(!BetterSqlite3){ console.error('better-sqlite3 required'); process.exit(2); }

const ROOT = path.resolve(__dirname, '../../');
const OUT_DB = process.env.DECODED_DB_PATH || path.resolve(ROOT, 'data/local-indexer-decoded.db');
const INCLUDE_HEAVY = process.env.INCLUDE_HEAVY === '1';
const MAX_PER_TABLE = process.env.MAX_PER_TABLE || '';

function readJson(p, fb){ try { return JSON.parse(fs.readFileSync(p,'utf8')); } catch { return fb; } }

function main(){
  if (!fs.existsSync(OUT_DB)){ console.error('missing decoded db:', OUT_DB); process.exit(1); }
  const db = new BetterSqlite3(OUT_DB, { readonly:true, fileMustExist:true });
  const rows = db.prepare('SELECT namespace, name, table_id, rows FROM erc_mud_table_stats ORDER BY rows DESC').all();
  const wave1 = readJson(path.resolve(__dirname, 'mud_tables_wave1.json'), []);
  const waveSet = new Set(wave1.map((t)=> `${t.namespace}/${t.name}`));
  const skipHeavy = new Set(['Fuel','DeployableState']);
  const targets = rows.filter((r)=> !waveSet.has(`${r.namespace}/${r.name}`) && (INCLUDE_HEAVY || !skipHeavy.has(r.name)) );
  const envBase = { ...process.env, DECODED_DB_PATH: OUT_DB };
  for (const t of targets){
    const env = { ...envBase, ONLY_TABLE: `${t.namespace}/${t.name}` };
    if (MAX_PER_TABLE) env.MAX_PER_TABLE = String(MAX_PER_TABLE);
    process.stdout.write(`\n[latest] ${t.namespace}/${t.name} rows≈${t.rows} ${MAX_PER_TABLE?`(cap ${MAX_PER_TABLE})`:''}\n`);
    const r = spawnSync(process.execPath, [ path.resolve(__dirname, 'materialize_mud_latest.js') ], { env, stdio: 'inherit' });
    if (r.status !== 0){ console.warn('latest spawn nonzero for', t.name, 'code=', r.status); }
  }
  try{ db.close(); }catch{}
}

main();
