#!/usr/bin/env node
const path = require('path');
const fs = require('fs');
let BetterSqlite3 = null; try { BetterSqlite3 = require('better-sqlite3'); } catch {}
const ROOT = path.resolve(__dirname, '../../');
const OUT_DB = process.env.DECODED_DB_PATH || path.resolve(ROOT, 'data/local-indexer-decoded.db');
if (!fs.existsSync(OUT_DB)) { console.error('missing', OUT_DB); process.exit(1); }
const TRANSFER_SIG = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const APPROVAL_SIG = '0x8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925';
const db = new BetterSqlite3(OUT_DB, { readonly:true, fileMustExist:true });
const total = db.prepare('SELECT COUNT(1) AS c FROM decoded_events').get().c|0;
const transfers = db.prepare('SELECT COUNT(1) AS c FROM decoded_events WHERE lower(topic0)=?').get(TRANSFER_SIG).c|0;
const approvals = db.prepare('SELECT COUNT(1) AS c FROM decoded_events WHERE lower(topic0)=?').get(APPROVAL_SIG).c|0;
console.log(JSON.stringify({ dbPath: OUT_DB, total, transfers, approvals }));