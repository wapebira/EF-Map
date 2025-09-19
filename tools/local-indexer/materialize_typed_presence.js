#!/usr/bin/env node
/*
 Generic typed presence materializer for MUD tables.
 - Input: erc_mud_latest
 - Output: user-specified table with key columns + block_number, log_index
 - Behavior: pages over DISTINCT key tuples for a given MUD table, picks latest row (block_number DESC, log_index DESC), and upserts.

 Env:
   DECODED_DB_PATH  path to decoded DB (default data/local-indexer-decoded.db)
   ONLY_TABLE       namespace/name (e.g., tbevefrontier/Role)
   OUTPUT_TABLE     output table name (e.g., mud_role)
   KEY_COUNT        1..4 (default 1) number of keys to project (key0..keyN-1)
   CHUNK            page size (default 20000)
*/
/* eslint-disable no-console */
const path = require('path');
const fs = require('fs');
let BetterSqlite3=null; try{ BetterSqlite3=require('better-sqlite3'); }catch{}
if(!BetterSqlite3){ console.error('better-sqlite3 required'); process.exit(2); }

const ROOT = path.resolve(__dirname, '../../');
const OUT_DB = process.env.DECODED_DB_PATH || path.resolve(ROOT, 'data/local-indexer-decoded.db');
const ONLY_TABLE = process.env.ONLY_TABLE || '';
const OUTPUT_TABLE = process.env.OUTPUT_TABLE || '';
const KEY_COUNT = Math.min(4, Math.max(1, Number(process.env.KEY_COUNT||1)));
const CHUNK = Number(process.env.CHUNK || 20000);

function ensureSchema(db, tableName){
  // Create if missing
  const exists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(tableName);
  if (!exists){
    db.exec(`CREATE TABLE IF NOT EXISTS ${tableName} (
        key0 TEXT,
        key1 TEXT,
        key2 TEXT,
        key3 TEXT,
        block_number INTEGER NOT NULL,
        log_index INTEGER NOT NULL,
        PRIMARY KEY (key0, key1, key2, key3)
      );`);
  } else {
    // Migrate older tables to uniform 4-key schema
    const info = db.prepare(`PRAGMA table_info(${tableName})`).all();
    const cols = info.map(c=>c.name);
    const pkCols = info.filter(c=>c.pk>0).sort((a,b)=>a.pk-b.pk).map(c=>c.name);
    const needText = ['key0','key1','key2','key3'];
    const needInt = ['block_number','log_index'];
    for (const k of needText){ if (!cols.includes(k)) db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${k} TEXT`); }
    for (const k of needInt){ if (!cols.includes(k)) db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${k} INTEGER`); }

    // If primary key is not composite on (key0..key3), rebuild table
    const desiredPk = ['key0','key1','key2','key3'];
    const pkMatches = pkCols.length===4 && desiredPk.every((k,i)=> pkCols[i]===k);
    if (!pkMatches){
      const tmp = `${tableName}__new_${Date.now()}`;
      db.exec(`CREATE TABLE ${tmp} (
          key0 TEXT,
          key1 TEXT,
          key2 TEXT,
          key3 TEXT,
          block_number INTEGER NOT NULL,
          log_index INTEGER NOT NULL,
          PRIMARY KEY (key0, key1, key2, key3)
        );`);
      // Build a SELECT list that tolerates missing columns
      const selKey = (k)=> cols.includes(k) ? k : 'NULL';
      const sel = `INSERT OR IGNORE INTO ${tmp}(key0,key1,key2,key3,block_number,log_index)
                   SELECT ${selKey('key0')} AS key0,
                          ${selKey('key1')} AS key1,
                          ${selKey('key2')} AS key2,
                          ${selKey('key3')} AS key3,
                          ${selKey('block_number')} AS block_number,
                          ${selKey('log_index')} AS log_index
                   FROM ${tableName}`;
      db.exec(sel);
      db.exec(`DROP TABLE ${tableName};`);
      db.exec(`ALTER TABLE ${tmp} RENAME TO ${tableName};`);
    }
  }
  // Ensure supporting indexes (unique on keys for ON CONFLICT to work, and block index for queries)
  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS uniq_${tableName}_keys ON ${tableName}(key0, key1, key2, key3);
           CREATE INDEX IF NOT EXISTS idx_${tableName}_block ON ${tableName}(block_number);`);
}

function findTableId(db, namespace, name){
  try { const r=db.prepare('SELECT table_id FROM erc_mud_table_stats WHERE namespace=? AND name=?').get(namespace,name); if(r&&r.table_id) return r.table_id; } catch{}
  const toHex=(s)=>Buffer.from(String(s||''),'utf8');
  const pad32=(b)=> (b.length>=32? b.slice(0,32): Buffer.concat([b, Buffer.alloc(32-b.length)]));
  return '0x'+Buffer.concat([pad32(toHex(namespace)), pad32(toHex(name))]).toString('hex');
}

function main(){
  if (!ONLY_TABLE || !OUTPUT_TABLE){
    console.error('ONLY_TABLE and OUTPUT_TABLE required');
    process.exit(1);
  }
  if (!fs.existsSync(OUT_DB)){ console.error('missing decoded db:', OUT_DB); process.exit(1); }
  const db = new BetterSqlite3(OUT_DB);
  const [ns, name] = ONLY_TABLE.split('/');
  const tableId = findTableId(db, ns, name);
  ensureSchema(db, OUTPUT_TABLE);
  const haveLatest = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='erc_mud_latest'").get();
  if (!haveLatest){ console.error('missing erc_mud_latest'); process.exit(1); }

  // Build distinct-id selector based on key count
  const keyCols = Array.from({length:KEY_COUNT}, (_,i)=>`key${i}`).join(', ');
  const selIdsSQL = `SELECT DISTINCT ${keyCols} FROM erc_mud_latest WHERE table_id=? ORDER BY ${keyCols} LIMIT ? OFFSET ?`;
  const selIds = db.prepare(selIdsSQL);
  const orderKeys = keyCols; // reuse for join predicate

  const selLatestSQL = `SELECT block_number, log_index FROM erc_mud_latest WHERE table_id=? AND ${Array.from({length:KEY_COUNT},(_,i)=>`key${i}=?`).join(' AND ')} ORDER BY block_number DESC, log_index DESC LIMIT 1`;
  const selLatest = db.prepare(selLatestSQL);

  const upCols = `key0, key1, key2, key3, block_number, log_index`;
  const upParams = `?, ?, ?, ?, ?, ?`;
  const up = db.prepare(`INSERT INTO ${OUTPUT_TABLE}(${upCols}) VALUES (${upParams})
    ON CONFLICT(key0, key1, key2, key3)
    DO UPDATE SET block_number=excluded.block_number, log_index=excluded.log_index`);
  const tx = db.transaction((rows)=>{ for(const r of rows) up.run(...r); });

  const count = db.prepare(`SELECT COUNT(1) AS c FROM (SELECT DISTINCT ${keyCols} FROM erc_mud_latest WHERE table_id=?)`).get(tableId).c|0;
  let processed=0;
  for (let off=0; off<count; off+=CHUNK){
    const ids = selIds.all(tableId, CHUNK, off);
    const rows = ids.map((idrow)=>{
      const idVals = Array.from({length:KEY_COUNT}, (_,i)=> idrow[`key${i}`]||null);
      // pad to 4 keys for uniform schema
      while (idVals.length < 4) idVals.push(null);
      const latest = selLatest.get(tableId, ...idVals.slice(0, KEY_COUNT));
      return [...idVals.slice(0,4), (latest?.block_number|0), (latest?.log_index|0) ];
    });
    if (rows.length) tx(rows);
    processed += rows.length; process.stdout.write(`\r[typed-presence ${OUTPUT_TABLE}] ${processed}/${count}`);
  }
  process.stdout.write('\n');
  const outCount = db.prepare(`SELECT COUNT(1) AS c FROM ${OUTPUT_TABLE}`).get().c|0;
  console.log(JSON.stringify({ status:'ok', table: OUTPUT_TABLE, processed, outCount }, null, 2));
  try { db.close(); } catch {}
}

main();
