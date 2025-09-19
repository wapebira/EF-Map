#!/usr/bin/env node
/*
 Typed materializer for tbevefrontier/OwnershipByObjec.
 - Input: erc_mud_latest + erc_mud_values (decoded DB)
 - Output: mud_ownership(object_id PRIMARY KEY, owner TEXT NULL, block_number, log_index)
 - Heuristic: owner address read from dynamic_hex tail if length>=20 bytes; else NULL.
*/
const path = require('path');
const fs = require('fs');
let BetterSqlite3=null; try{ BetterSqlite3=require('better-sqlite3'); }catch{}
if(!BetterSqlite3){ console.error('better-sqlite3 required'); process.exit(2); }

const ROOT = path.resolve(__dirname, '../../');
const OUT_DB = process.env.DECODED_DB_PATH || path.resolve(ROOT, 'data/local-indexer-decoded.db');

function ensureSchema(db){
  db.exec(`
    CREATE TABLE IF NOT EXISTS mud_ownership (
      object_id TEXT PRIMARY KEY,
      owner TEXT,
      block_number INTEGER NOT NULL,
      log_index INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_mud_ownership_owner ON mud_ownership(owner);
    CREATE INDEX IF NOT EXISTS idx_mud_ownership_block ON mud_ownership(block_number);
  `);
}

function findTableId(db, namespace, name){
  try { const r = db.prepare('SELECT table_id FROM erc_mud_table_stats WHERE namespace=? AND name=?').get(namespace, name); if (r&&r.table_id) return r.table_id; } catch {}
  const toHex = (s)=> Buffer.from(String(s||''), 'utf8');
  const pad32 = (b)=> (b.length>=32? b.slice(0,32): Buffer.concat([b, Buffer.alloc(32-b.length)]));
  return '0x' + Buffer.concat([pad32(toHex(namespace)), pad32(toHex(name))]).toString('hex');
}

function parseOwnerFromDynamicHex(dynamicHex){
  if (!dynamicHex || typeof dynamicHex !== 'string') return null;
  const h = dynamicHex.replace(/^0x/,'');
  if (h.length < 40) return null; // need at least 20 bytes
  // Take last 20 bytes as a heuristic owner address
  const tail = h.slice(-40);
  return '0x'+tail.toLowerCase();
}

function main(){
  if (!fs.existsSync(OUT_DB)) { console.error('missing decoded db:', OUT_DB); process.exit(1); }
  const db = new BetterSqlite3(OUT_DB);
  ensureSchema(db);
  const tableId = findTableId(db, 'tbevefrontier', 'OwnershipByObjec');
  const haveLatest = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='erc_mud_latest'").get();
  const haveValues = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='erc_mud_values'").get();
  if (!haveLatest || !haveValues){ console.error('missing required tables'); process.exit(1); }
  const CHUNK = Number(process.env.CHUNK || 20000);
  // Count distinct object ids (key0) to avoid duplicates
  const count = db.prepare('SELECT COUNT(DISTINCT key0) AS c FROM erc_mud_latest WHERE table_id=?').get(tableId).c|0;
  const up = db.prepare('INSERT INTO mud_ownership(object_id, owner, block_number, log_index) VALUES (@object_id, @owner, @block_number, @log_index) ON CONFLICT(object_id) DO UPDATE SET owner=excluded.owner, block_number=excluded.block_number, log_index=excluded.log_index');
  const tx = db.transaction((rows)=>{ for(const r of rows) up.run(r); });
  const selIds = db.prepare('SELECT DISTINCT key0 AS object_id FROM erc_mud_latest WHERE table_id=? ORDER BY object_id LIMIT ? OFFSET ?');
  const selLatest = db.prepare('SELECT block_number, log_index, key0, key1, key2, key3 FROM erc_mud_latest WHERE table_id=? AND key0=? ORDER BY block_number DESC, log_index DESC LIMIT 1');
  const selVal = db.prepare('SELECT dynamic_hex FROM erc_mud_values WHERE table_id=? AND key0=? AND key1 IS ? AND key2 IS ? AND key3 IS ?');
  let processed=0;
  for (let off=0; off<count; off+=CHUNK){
    const ids = selIds.all(tableId, CHUNK, off);
    const rows = ids.map(({object_id})=>{
      const latest = selLatest.get(tableId, object_id);
      const dyn = selVal.get(tableId, latest?.key0 ?? null, latest?.key1 ?? null, latest?.key2 ?? null, latest?.key3 ?? null);
      return { object_id: object_id||null, owner: parseOwnerFromDynamicHex(dyn?.dynamic_hex)||null, block_number: (latest?.block_number|0), log_index: (latest?.log_index|0) };
    });
    if (rows.length) tx(rows);
    processed += rows.length; process.stdout.write(`\r[typed-ownership] ${processed}/${count}`);
  }
  process.stdout.write('\n');
  const outCount = db.prepare('SELECT COUNT(1) AS c FROM mud_ownership').get().c|0;
  console.log(JSON.stringify({ status:'ok', processed, outCount }, null, 2));
  try { db.close(); } catch {}
}

main();
