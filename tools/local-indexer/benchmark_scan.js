#!/usr/bin/env node
/*
 Benchmark reading a sample of raw_logs rows to estimate scan throughput.
 Usage env: LIMIT=100000 OFFSET=0
*/
const path = require('path');
const fs = require('fs');
require('dotenv').config();
let BetterSqlite3 = null; try { BetterSqlite3 = require('better-sqlite3'); } catch {}

const DB_PATH = process.env.LOCAL_DB_PATH || path.resolve(__dirname, '../../data/local-indexer.db');
const LIMIT = Number(process.env.LIMIT || 100000);
const OFFSET = Number(process.env.OFFSET || 0);

function fmt(n){ return Intl.NumberFormat('en-US').format(n); }

function main(){
  if (!BetterSqlite3) { console.error('better-sqlite3 required'); process.exit(2); }
  const db = new BetterSqlite3(DB_PATH, { readonly: true, fileMustExist: true });
  const stmt = db.prepare('SELECT block_number, log_index, topic0, data FROM raw_logs ORDER BY block_number, log_index LIMIT ? OFFSET ?');
  const start = Date.now();
  let rows = 0; let touch = 0;
  for (const row of stmt.iterate(LIMIT, OFFSET)){
    rows++;
    // Touch a few bytes to simulate minimal decode work
    if (row.data) touch ^= (row.data.length & 0xff);
  }
  const ms = Date.now() - start;
  const rps = rows > 0 && ms > 0 ? (rows * 1000 / ms) : 0;
  console.log(JSON.stringify({ status:'ok', rows, ms, rowsPerSec: Math.round(rps), LIMIT, OFFSET, touch }));
}

main();
