#!/usr/bin/env node
/*
 Typed materializer for tbevefrontier/Entity.
 - Input: erc_mud_latest (decoded DB)
 - Output: mud_entity(entity_id PRIMARY KEY, block_number, log_index)
 - Note: This is a schema scaffold; value payload not needed for Entity presence.
*/
const path = require('path');
const fs = require('fs');
let BetterSqlite3=null; try{ BetterSqlite3=require('better-sqlite3'); }catch{}
if(!BetterSqlite3){ console.error('better-sqlite3 required'); process.exit(2); }

const ROOT = path.resolve(__dirname, '../../');
const OUT_DB = process.env.DECODED_DB_PATH || path.resolve(ROOT, 'data/local-indexer-decoded.db');

function ensureSchema(db){
  db.exec(`
    CREATE TABLE IF NOT EXISTS mud_entity (
      entity_id TEXT PRIMARY KEY,
      block_number INTEGER NOT NULL,
      log_index INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_mud_entity_block ON mud_entity(block_number);
  `);
}

function findTableId(db, namespace, name){
  try { const r = db.prepare('SELECT table_id FROM erc_mud_table_stats WHERE namespace=? AND name=?').get(namespace, name); if (r&&r.table_id) return r.table_id; } catch {}
  const toHex = (s)=> Buffer.from(String(s||''), 'utf8');
  const pad32 = (b)=> (b.length>=32? b.slice(0,32): Buffer.concat([b, Buffer.alloc(32-b.length)]));
  return '0x' + Buffer.concat([pad32(toHex(namespace)), pad32(toHex(name))]).toString('hex');
}

function main(){
  if (!fs.existsSync(OUT_DB)) { console.error('missing decoded db:', OUT_DB); process.exit(1); }
  const db = new BetterSqlite3(OUT_DB);
  ensureSchema(db);
  const tableId = findTableId(db, 'tbevefrontier', 'Entity');
  const have = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='erc_mud_latest'").get();
  if (!have){ console.error('missing erc_mud_latest'); process.exit(1); }
  const up = db.prepare('INSERT INTO mud_entity(entity_id, block_number, log_index) VALUES (@entity_id, @block_number, @log_index) ON CONFLICT(entity_id) DO UPDATE SET block_number=excluded.block_number, log_index=excluded.log_index');
  const tx = db.transaction((rows)=>{ for(const r of rows) up.run(r); });
  const CHUNK = Number(process.env.CHUNK || 20000);
  // Count distinct entity ids (key0) to ensure 1:1 rows in target table
  const count = db.prepare('SELECT COUNT(DISTINCT key0) AS c FROM erc_mud_latest WHERE table_id=?').get(tableId).c|0;
  let processed = 0;
  // Page over distinct entity ids for stability; for each id, pick latest by (block_number, log_index)
  const selIds = db.prepare('SELECT DISTINCT key0 AS entity_id FROM erc_mud_latest WHERE table_id=? ORDER BY entity_id LIMIT ? OFFSET ?');
  const selLatest = db.prepare('SELECT block_number, log_index FROM erc_mud_latest WHERE table_id=? AND key0=? ORDER BY block_number DESC, log_index DESC LIMIT 1');
  for (let off=0; off<count; off+=CHUNK){
    const ids = selIds.all(tableId, CHUNK, off);
    const rows = ids.map(({entity_id})=>{
      const latest = selLatest.get(tableId, entity_id);
      return { entity_id: entity_id||null, block_number: (latest?.block_number|0), log_index: (latest?.log_index|0) };
    });
    if (rows.length) tx(rows);
    processed += rows.length;
    process.stdout.write(`\r[typed-entity] ${processed}/${count}`);
  }
  process.stdout.write('\n');
  const outCount = db.prepare('SELECT COUNT(1) AS c FROM mud_entity').get().c|0;
  console.log(JSON.stringify({ status:'ok', processed, outCount }, null, 2));
  try { db.close(); } catch {}
}

main();
