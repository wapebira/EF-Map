#!/usr/bin/env node
const path = require('path');
const fs = require('fs');
let BetterSqlite3 = null; try { BetterSqlite3 = require('better-sqlite3'); } catch {}
const ROOT = path.resolve(__dirname, '../../');
const SRC_DB = process.env.LOCAL_DB_PATH || path.resolve(ROOT, 'data/local-indexer.db');
if (!fs.existsSync(SRC_DB)) { console.error('missing', SRC_DB); process.exit(1); }
const SIG_SINGLE_PFX = '0xc3d58168';
const SIG_BATCH_PFX  = '0x4a39dc06';
const db = new BetterSqlite3(SRC_DB, { readonly:true, fileMustExist:true });
const single = db.prepare('SELECT COUNT(1) AS c FROM raw_logs WHERE lower(topic0) LIKE ?').get(SIG_SINGLE_PFX+'%').c|0;
const batch  = db.prepare('SELECT COUNT(1) AS c FROM raw_logs WHERE lower(topic0) LIKE ?').get(SIG_BATCH_PFX+'%').c|0;
console.log(JSON.stringify({ dbPath:SRC_DB, single, batch, total: single+batch }));