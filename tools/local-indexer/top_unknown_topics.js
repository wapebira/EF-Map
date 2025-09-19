#!/usr/bin/env node
const path = require('path');
const fs = require('fs');
let BetterSqlite3 = null; try { BetterSqlite3 = require('better-sqlite3'); } catch {}
const ROOT = path.resolve(__dirname, '../../');
const OUT_DB = process.env.DECODED_DB_PATH || path.resolve(ROOT, 'data/local-indexer-decoded.db');
if (!fs.existsSync(OUT_DB)) { console.error('missing', OUT_DB); process.exit(1); }
const KNOWN = new Set([
  '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef', // ERC20 Transfer
  '0x8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925', // ERC20 Approval
  '0xc3d58168c5ae7397731d063d5bbf3d657854427343f4c083240f7aacaa2d0f62', // ERC1155 TransferSingle
  '0x4a39dc06d4c0dbc64b70b34c0aad6ce4d02e3b43c0bf98dde8b4b2f47061aee3', // ERC1155 TransferBatch
  '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef', // ERC721 Transfer (same hash)
]);
const db = new BetterSqlite3(OUT_DB, { readonly:true, fileMustExist:true });
const rows = db.prepare('SELECT lower(topic0) AS t0, COUNT(1) AS c FROM decoded_events GROUP BY lower(topic0) ORDER BY c DESC').all();
const unknown = rows.filter(r=> r.t0 && !KNOWN.has(r.t0));
console.log(JSON.stringify({ totalDistinct: rows.length, unknownCount: unknown.length, top: unknown.slice(0,20) }, null, 2));