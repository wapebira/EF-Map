#!/usr/bin/env node
/*
 Apply minimal decode bootstrap tables into the local DB (record_latest, decoded_cursor, topic_map).
*/
const fs = require('fs');
const path = require('path');
require('dotenv').config();
let BetterSqlite3 = null; try { BetterSqlite3 = require('better-sqlite3'); } catch {}

const DB_PATH = process.env.LOCAL_DB_PATH || path.resolve(__dirname, '../../data/local-indexer.db');

function main(){
  if (!BetterSqlite3) {
    console.error('better-sqlite3 is required to apply schema quickly. Please ensure it is installed.');
    process.exit(2);
  }
  const db = new BetterSqlite3(DB_PATH, { fileMustExist: true });
  const sql = fs.readFileSync(path.resolve(__dirname, '../../migrations/014_decode_bootstrap.sql'), 'utf8');
  db.exec(sql);
  console.log(JSON.stringify({ status:'applied', file:'migrations/014_decode_bootstrap.sql' }));
}

main();
