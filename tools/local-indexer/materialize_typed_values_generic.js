#!/usr/bin/env node
/*
 Generic typed values materializer from erc_mud_values_decoded → custom mud_* table.
 - Supports extracting up to N static words (default 1) as columns (hex + decimal) plus block/log.
 - Columns created as energy/value style names unless overridden.

 Env:
   DECODED_DB_PATH   path to decoded DB (default data/local-indexer-decoded.db)
   ONLY_TABLE        namespace/name (e.g., tbevefrontier/SomeTable)
   OUTPUT_TABLE      output table name (e.g., mud_some_table)
   KEY_COUNT         number of keys (1..4); if missing, inferred from erc_mud_latest
   WORDS             how many static words to extract (default 1)
   COL_PREFIX        prefix for columns (default 'value') → value0_hex/value0_dec, value1_*, etc.
   CHUNK             page size (default 20000)
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
const WORDS = Math.max(1, Number(process.env.WORDS || 1));
const COL_PREFIX = process.env.COL_PREFIX || 'value';
const CHUNK = Number(process.env.CHUNK || 20000);
const DYNAMIC_IF_EMPTY = String(process.env.DYNAMIC_IF_EMPTY||'0') === '1';

function ensureSchema(db, columns){
  const name = OUTPUT_TABLE;
  const exists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(name);
  if (!exists){
    const colsSql = columns.map(c=> `${c} TEXT`).join(', ');
    db.exec(`
      CREATE TABLE IF NOT EXISTS ${name} (
        key0 TEXT,
        key1 TEXT,
        key2 TEXT,
        key3 TEXT,
        ${colsSql},
        block_number INTEGER NOT NULL,
        log_index INTEGER NOT NULL,
        PRIMARY KEY (key0, key1, key2, key3)
      );
    `);
  } else {
    const info = db.prepare(`PRAGMA table_info(${name})`).all();
    const cols = info.map(c=>c.name);
    const pkCols = info.filter(c=>c.pk>0).sort((a,b)=>a.pk-b.pk).map(c=>c.name);
    // add missing core columns
    for (const k of ['key0','key1','key2','key3']){ if (!cols.includes(k)) db.exec(`ALTER TABLE ${name} ADD COLUMN ${k} TEXT`); }
    for (const k of ['block_number','log_index']){ if (!cols.includes(k)) db.exec(`ALTER TABLE ${name} ADD COLUMN ${k} INTEGER`); }
    // add missing dynamic text columns
    for (const c of columns){ if (!cols.includes(c)) db.exec(`ALTER TABLE ${name} ADD COLUMN ${c} TEXT`); }
    // ensure composite PK on keys
    const desiredPk = ['key0','key1','key2','key3'];
    const pkMatches = pkCols.length===4 && desiredPk.every((k,i)=> pkCols[i]===k);
    if (!pkMatches){
      const tmp = `${name}__new_${Date.now()}`;
      const colsSql = columns.map(c=> `${c} TEXT`).join(', ');
      db.exec(`CREATE TABLE ${tmp} (
        key0 TEXT,
        key1 TEXT,
        key2 TEXT,
        key3 TEXT,
        ${colsSql},
        block_number INTEGER NOT NULL,
        log_index INTEGER NOT NULL,
        PRIMARY KEY (key0, key1, key2, key3)
      );`);
      const selKey = (k)=> cols.includes(k) ? k : 'NULL';
      const selDyn = (c)=> cols.includes(c) ? c : 'NULL';
      const selectList = [ 'key0','key1','key2','key3', ...columns, 'block_number','log_index' ]
        .map(col=> selDyn(col)).join(', ');
      db.exec(`INSERT OR IGNORE INTO ${tmp}(key0,key1,key2,key3,${columns.join(',')},block_number,log_index)
               SELECT ${selKey('key0')},${selKey('key1')},${selKey('key2')},${selKey('key3')},${columns.map(selDyn).join(',')},${selKey('block_number')},${selKey('log_index')} FROM ${name}`);
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

function wordsFromHex(hex){
  if (!hex || typeof hex !== 'string') return [];
  const h = hex.replace(/^0x/, '').toLowerCase();
  const out = [];
  for (let i = 0; i < h.length; i += 64) {
    const w = h.slice(i, i + 64);
    if (!w) break;
    out.push('0x' + w.padEnd(64, '0'));
  }
  return out;
}

function main(){
  if (!ONLY_TABLE || !OUTPUT_TABLE){ console.error('ONLY_TABLE and OUTPUT_TABLE are required'); process.exit(1); }
  if (!fs.existsSync(OUT_DB)){ console.error('missing decoded db:', OUT_DB); process.exit(1); }
  const db = new BetterSqlite3(OUT_DB);
  db.pragma('busy_timeout=1000');
  const haveLatest = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='erc_mud_latest'").get();
  const haveValDec = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='erc_mud_values_decoded'").get();
  if (!haveLatest || !haveValDec){ console.error('missing required tables'); process.exit(1); }

  const [ns, name] = ONLY_TABLE.split('/');
  const tableId = findTableId(db, ns, name);
  const KEY_COUNT = Math.min(4, Math.max(1, Number(process.env.KEY_COUNT||inferKeyCount(db, tableId))));
  // build dynamic column list
  const cols = [];
  for (let i=0;i<WORDS;i+=1){ cols.push(`${COL_PREFIX}${i}_hex`); cols.push(`${COL_PREFIX}${i}_dec`); }
  ensureSchema(db, cols);

  const keyCols = Array.from({length:KEY_COUNT}, (_,i)=>`key${i}`).join(', ');
  const selIds = db.prepare(`SELECT DISTINCT ${keyCols} FROM erc_mud_latest WHERE table_id=? ORDER BY ${keyCols} LIMIT ? OFFSET ?`);
  const selLatest = db.prepare(`SELECT block_number, log_index FROM erc_mud_latest WHERE table_id=? AND ${Array.from({length:KEY_COUNT},(_,i)=>`key${i}=?`).join(' AND ')} ORDER BY block_number DESC, log_index DESC LIMIT 1`);
  const selVal = db.prepare(`SELECT static_words_json, dynamic_hex FROM erc_mud_values_decoded WHERE table_id=? AND ${Array.from({length:KEY_COUNT},(_,i)=>`key${i}=?`).join(' AND ')} LIMIT 1`);

  const count = db.prepare(`SELECT COUNT(1) AS c FROM (SELECT DISTINCT ${keyCols} FROM erc_mud_latest WHERE table_id=?)`).get(tableId).c|0;
  const placeholders = cols.map(()=> '?').join(', ');
  const up = db.prepare(`INSERT INTO ${OUTPUT_TABLE}(key0,key1,key2,key3,${cols.join(',')},block_number,log_index) VALUES (?,?,?,?,${placeholders},?,?)\n    ON CONFLICT(key0,key1,key2,key3) DO UPDATE SET ${cols.map(c=> `${c}=excluded.${c}`).join(', ')}, block_number=excluded.block_number, log_index=excluded.log_index`);
  const tx = db.transaction((rows)=>{ for(const r of rows) up.run(...r); });

  let processed=0;
  for (let off=0; off<count; off+=CHUNK){
    const ids = selIds.all(tableId, CHUNK, off);
    const rows = ids.map((idrow)=>{
      const keys = Array.from({length:KEY_COUNT}, (_,i)=> idrow[`key${i}`]||null);
      while (keys.length<4) keys.push(null);
      const latest = selLatest.get(tableId, ...keys.slice(0,KEY_COUNT));
      let words=[];
      try{
        const vd = selVal.get(tableId, ...keys.slice(0,KEY_COUNT));
        let arr = vd && vd.static_words_json ? JSON.parse(vd.static_words_json) : [];
        if ((!arr || !arr.length) && DYNAMIC_IF_EMPTY && vd && vd.dynamic_hex) {
          arr = wordsFromHex(vd.dynamic_hex);
        }
        if (Array.isArray(arr)) words = arr.slice(0, WORDS);
      }catch{}
      const flat = [];
      for (let i=0;i<WORDS;i+=1){ const w = words[i]||null; flat.push(w); flat.push(hexWordToDecString(w)); }
      return [ keys[0], keys[1], keys[2], keys[3], ...flat, (latest?.block_number|0), (latest?.log_index|0) ];
    });
    if (rows.length) tx(rows);
    processed += rows.length; process.stdout.write(`\r[typed-generic ${OUTPUT_TABLE}] ${processed}/${count}`);
  }
  process.stdout.write('\n');
  const outCount = db.prepare(`SELECT COUNT(1) AS c FROM ${OUTPUT_TABLE}`).get().c|0;
  console.log(JSON.stringify({ status:'ok', table: OUTPUT_TABLE, from: ONLY_TABLE, processed, outCount }, null, 2));
  try{ db.close(); }catch{}
}

main();
