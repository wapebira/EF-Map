#!/usr/bin/env node
const path = require('path');
let b; try { b = require('better-sqlite3'); } catch { console.error('better-sqlite3 required'); process.exit(2); }
const dbPath = process.env.DECODED_DB_PATH || path.resolve(__dirname, '../../data/local-indexer-decoded.db');
const db = new b(dbPath, { readonly: true, fileMustExist: true });
const sig = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
function get(sql, ...a){ try { const r = db.prepare(sql).get(...a); return (r && (r.c|0)) || 0; } catch { return -1; } }
const tot = get('SELECT COUNT(1) AS c FROM decoded_events WHERE lower(topic0)=?;', sig);
const with3 = get('SELECT COUNT(1) AS c FROM decoded_events WHERE lower(topic0)=? AND topic3 IS NOT NULL;', sig);
const without3 = get('SELECT COUNT(1) AS c FROM decoded_events WHERE lower(topic0)=? AND topic3 IS NULL;', sig);
console.log(JSON.stringify({ dbPath, tot, with3, without3 }));
try { db.close(); } catch {}
