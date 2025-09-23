#!/usr/bin/env node
/*
 Typed value materializer for tbevefrontier/NetworkNodeEnerg → mud_node_energy
 - Reads latest words from erc_mud_values_decoded for each key tuple
 - Decodes first static word as a big integer (decimal string) and stores both hex and decimal

 Env:
   DECODED_DB_PATH   path to decoded DB (default data/local-indexer-decoded.db)
   ONLY_TABLE        optional override namespace/name (defaults to tbevefrontier/NetworkNodeEnerg)
   KEY_COUNT         optional override (1..4). If not set, inferred from distinct counts.
   CHUNK             page size (default 20000)
*/
/* eslint-disable no-console */
const path = require('path');
const fs = require('fs');
let BetterSqlite3=null; try{ BetterSqlite3=require('better-sqlite3'); }catch{}
if(!BetterSqlite3){ console.error('better-sqlite3 required'); process.exit(2); }

const ROOT = path.resolve(__dirname, '../../');
const OUT_DB = process.env.DECODED_DB_PATH || path.resolve(ROOT, 'data/local-indexer-decoded.db');
const ONLY_TABLE = process.env.ONLY_TABLE || 'tbevefrontier/NetworkNodeEnerg';
const CHUNK = Number(process.env.CHUNK || 20000);

function ensureSchema(db){
  const name = 'mud_node_energy';
  const exists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(name);
  if (!exists){
    db.exec(`
      CREATE TABLE IF NOT EXISTS ${name} (
        key0 TEXT,
        key1 TEXT,
        key2 TEXT,
        key3 TEXT,
        energy_hex TEXT,
        energy_dec TEXT,
        block_number INTEGER NOT NULL,
        log_index INTEGER NOT NULL,
        PRIMARY KEY (key0, key1, key2, key3)
      );
    `);
  } else {
    const info = db.prepare(`PRAGMA table_info(${name})`).all();
    const cols = info.map(c=>c.name);
    const pkCols = info.filter(c=>c.pk>0).sort((a,b)=>a.pk-b.pk).map(c=>c.name);
    // add missing columns
    for (const k of ['key0','key1','key2','key3','energy_hex','energy_dec','block_number','log_index']){
      if (!cols.includes(k)) db.exec(`ALTER TABLE ${name} ADD COLUMN ${k} ${k.includes('key')||k.endsWith('_hex')||k.endsWith('_dec')? 'TEXT':'INTEGER'}`);
    }
    // rebuild if PK not on all 4 key columns
    const desiredPk = ['key0','key1','key2','key3'];
    const pkMatches = pkCols.length===4 && desiredPk.every((k,i)=> pkCols[i]===k);
    if (!pkMatches){
      const tmp = `${name}__new_${Date.now()}`;
      db.exec(`CREATE TABLE ${tmp} (
        key0 TEXT,
        key1 TEXT,
        key2 TEXT,
        key3 TEXT,
        energy_hex TEXT,
        energy_dec TEXT,
        block_number INTEGER NOT NULL,
        log_index INTEGER NOT NULL,
        PRIMARY KEY (key0, key1, key2, key3)
      );`);
      const selKey = (k)=> cols.includes(k) ? k : 'NULL';
      db.exec(`INSERT OR IGNORE INTO ${tmp}(key0,key1,key2,key3,energy_hex,energy_dec,block_number,log_index)
               SELECT ${selKey('key0')},${selKey('key1')},${selKey('key2')},${selKey('key3')},${selKey('energy_hex')},${selKey('energy_dec')},${selKey('block_number')},${selKey('log_index')} FROM ${name}`);
      db.exec(`DROP TABLE ${name};`);
      db.exec(`ALTER TABLE ${tmp} RENAME TO ${name};`);
    }
  }
  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS uniq_${name}_keys ON ${name}(key0,key1,key2,key3);`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_${name}_block ON ${name}(block_number);`);
}

function findTableId(db, namespace, name){
  try { const r=db.prepare('SELECT table_id FROM erc_mud_table_stats WHERE namespace=? AND name=?').get(namespace,name); if(r&&r.table_id) return r.table_id; } catch{}
  const toHex=(s)=>Buffer.from(String(s||''),'utf8');
  const pad32=(b)=> (b.length>=32? b.slice(0,32): Buffer.concat([b, Buffer.alloc(32-b.length)]));
  return '0x'+Buffer.concat([pad32(toHex(namespace)), pad32(toHex(name))]).toString('hex');
}

function inferKeyCount(db, tableId){
  const total = db.prepare('SELECT COUNT(1) AS c FROM erc_mud_latest WHERE table_id=?').get(tableId).c|0;
  const d1 = db.prepare('SELECT COUNT(DISTINCT key0) AS c FROM erc_mud_latest WHERE table_id=?').get(tableId).c|0;
  if (d1===total) return 1;
  const d2 = db.prepare('SELECT COUNT(1) AS c FROM (SELECT DISTINCT key0,key1 FROM erc_mud_latest WHERE table_id=?)').get(tableId).c|0;
  if (d2===total) return 2;
  const d3 = db.prepare('SELECT COUNT(1) AS c FROM (SELECT DISTINCT key0,key1,key2 FROM erc_mud_latest WHERE table_id=?)').get(tableId).c|0;
  if (d3===total) return 3;
  return 4;
}

function hexWordToDecString(word){
  if (!word) return null;
  try {
    const h = String(word).trim().replace(/^0x/, '');
    const bi = BigInt('0x'+h);
    return bi.toString(10);
  } catch { return null; }
}

function main(){
  if (!fs.existsSync(OUT_DB)){ console.error('missing decoded db:', OUT_DB); process.exit(1); }
  const db = new BetterSqlite3(OUT_DB);
  db.pragma('busy_timeout=1000');
  const haveLatest = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='erc_mud_latest'").get();
  const haveValDec = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='erc_mud_values_decoded'").get();
  if (!haveLatest || !haveValDec){ console.error('missing required tables (erc_mud_latest, erc_mud_values_decoded)'); process.exit(1); }

  const [ns, name] = ONLY_TABLE.split('/');
  const tableId = findTableId(db, ns, name);
  const KEY_COUNT = Math.min(4, Math.max(1, Number(process.env.KEY_COUNT||inferKeyCount(db, tableId))));
  ensureSchema(db);

  const keyCols = Array.from({length:KEY_COUNT}, (_,i)=>`key${i}`).join(', ');
  const selIds = db.prepare(`SELECT DISTINCT ${keyCols} FROM erc_mud_latest WHERE table_id=? ORDER BY ${keyCols} LIMIT ? OFFSET ?`);
  const selLatest = db.prepare(`SELECT block_number, log_index FROM erc_mud_latest WHERE table_id=? AND ${Array.from({length:KEY_COUNT},(_,i)=>`key${i}=?`).join(' AND ')} ORDER BY block_number DESC, log_index DESC LIMIT 1`);
  const selVal = db.prepare(`SELECT static_words_json FROM erc_mud_values_decoded WHERE table_id=? AND ${Array.from({length:KEY_COUNT},(_,i)=>`key${i}=?`).join(' AND ')} LIMIT 1`);

  const count = db.prepare(`SELECT COUNT(1) AS c FROM (SELECT DISTINCT ${keyCols} FROM erc_mud_latest WHERE table_id=?)`).get(tableId).c|0;
  const up = db.prepare('INSERT INTO mud_node_energy(key0,key1,key2,key3,energy_hex,energy_dec,block_number,log_index) VALUES (?,?,?,?,?,?,?,?)\n    ON CONFLICT(key0,key1,key2,key3) DO UPDATE SET energy_hex=excluded.energy_hex, energy_dec=excluded.energy_dec, block_number=excluded.block_number, log_index=excluded.log_index');
  const tx = db.transaction((rows)=>{ for(const r of rows) up.run(...r); });

  let processed=0;
  for (let off=0; off<count; off+=CHUNK){
    const ids = selIds.all(tableId, CHUNK, off);
    const rows = ids.map((idrow)=>{
      const keys = Array.from({length:KEY_COUNT}, (_,i)=> idrow[`key${i}`]||null);
      while (keys.length<4) keys.push(null);
      const latest = selLatest.get(tableId, ...keys.slice(0,KEY_COUNT));
      let energyHex=null, energyDec=null;
      try{
        const vd = selVal.get(tableId, ...keys.slice(0,KEY_COUNT));
        const arr = vd && vd.static_words_json ? JSON.parse(vd.static_words_json) : [];
        if (Array.isArray(arr) && arr.length>0){ energyHex = arr[0]; energyDec = hexWordToDecString(arr[0]); }
      }catch{}
      return [ keys[0], keys[1], keys[2], keys[3], energyHex, energyDec, (latest?.block_number|0), (latest?.log_index|0) ];
    });
    if (rows.length) tx(rows);
    processed += rows.length; process.stdout.write(`\r[typed-node-energy] ${processed}/${count}`);
  }
  process.stdout.write('\n');
  const outCount = db.prepare('SELECT COUNT(1) AS c FROM mud_node_energy').get().c|0;
  console.log(JSON.stringify({ status:'ok', table:'mud_node_energy', keys:ONLY_TABLE, processed, outCount }, null, 2));
  try{ db.close(); }catch{}
}

main();
