#!/usr/bin/env node
/*
 Build/update raw value blobs for latest MUD records per key tuple.
 - Input: OUT_DB (erc_mud_latest) + SRC_DB (raw_logs for data)
 - Output: erc_mud_values(table_id, key0..key3, block_number, log_index, static_hex, encoded_lengths_hex, dynamic_hex)
 - Scope: Wave-1 tables listed in mud_tables_wave1.json (override via ONLY_TABLE)
 - Purpose: capture value bytes for later typed decoding without re-walking history.

 Env:
   DECODED_DB_PATH   path to decoded DB (default data/local-indexer-decoded.db)
   LOCAL_DB_PATH     path to raw logs DB (default data/local-indexer.db)
   ONLY_TABLE        optional filter in form "namespace/name" to process only one
   MAX_PER_TABLE     optional cap of processed keys per table (for testing)
   CHUNK             batch size (default 10000)
*/
/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');
let BetterSqlite3 = null; try { BetterSqlite3 = require('better-sqlite3'); } catch {}
if (!BetterSqlite3) { console.error('better-sqlite3 required'); process.exit(2); }

const ROOT = path.resolve(__dirname, '../../');
const OUT_DB = process.env.DECODED_DB_PATH || path.resolve(ROOT, 'data/local-indexer-decoded.db');
const SRC_DB = process.env.LOCAL_DB_PATH || path.resolve(ROOT, 'data/local-indexer.db');
const CHUNK = Number(process.env.CHUNK || 10000);
const MAX_PER_TABLE = process.env.MAX_PER_TABLE ? Number(process.env.MAX_PER_TABLE) : null;
const ONLY_TABLE = process.env.ONLY_TABLE || '';

function readJson(p, fb){ try { return JSON.parse(fs.readFileSync(p,'utf8')); } catch { return fb; } }

function ensureSchema(db){
  db.exec(`
    CREATE TABLE IF NOT EXISTS erc_mud_values (
      table_id TEXT NOT NULL,
      key0 TEXT,
      key1 TEXT,
      key2 TEXT,
      key3 TEXT,
      block_number INTEGER NOT NULL,
      log_index INTEGER NOT NULL,
      static_hex TEXT,
      encoded_lengths_hex TEXT,
      dynamic_hex TEXT,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (table_id, key0, key1, key2, key3)
    );
    CREATE INDEX IF NOT EXISTS idx_mud_values_table ON erc_mud_values(table_id);
    CREATE INDEX IF NOT EXISTS idx_mud_values_block ON erc_mud_values(block_number);
  `);
}

function loadWave1(){
  const p = path.resolve(__dirname, 'mud_tables_wave1.json');
  const arr = readJson(p, []);
  if (!Array.isArray(arr) || !arr.length){
    console.error('wave1 list empty:', p);
    process.exit(1);
  }
  if (ONLY_TABLE){
  const [ns, name] = ONLY_TABLE.split('/').map((s)=> (s||'').trim());
  const inWave = arr.find((r)=> r.namespace===ns && r.name===name);
  return inWave ? [inWave] : [{ namespace: ns, name }];
  }
  return arr;
}

function findTableId(db, namespace, name){
  try{
    const r = db.prepare('SELECT table_id FROM erc_mud_table_stats WHERE namespace=? AND name=?').get(namespace, name);
    if (r && r.table_id) return r.table_id;
  } catch {}
  const toHex = (str)=> Buffer.from(String(str||''), 'utf8');
  const pad32 = (buf)=> (buf.length>=32? buf.slice(0,32) : Buffer.concat([buf, Buffer.alloc(32-buf.length)]) );
  const nsHex = pad32(toHex(namespace));
  const nameHex = pad32(toHex(name));
  return '0x' + Buffer.concat([nsHex, nameHex]).toString('hex');
}

function parseSegmentsFromData(hex){
  if (!hex) return { keyCount:0, keys:[], staticHex:null, encodedLengthsHex:null, dynamicHex:null };
  const h = hex.replace(/^0x/,'').toLowerCase();
  const readU = (pos)=> h.slice(pos, pos+64);
  const toNum = (u)=> Number(BigInt('0x'+u));
  const readBytes = (offsetWords)=>{
    const off = toNum(offsetWords) * 2; // hex index
    const len = toNum(readU(off));
    const start = off + 64;
    const end = start + (Math.ceil(len/32)*32)*2;
    const full = h.slice(start, end);
    return { hex: '0x'+full.slice(0, len*2), len };
  };
  try{
    const offKey = readU(0);
    const { hex: keyHex } = readBytes(offKey);
    const keyCount = toNum(keyHex.slice(2, 2+64));
    const keys=[];
    let p = 2 + 64; // skip length
    for (let i=0;i<keyCount;i++){
      const w = keyHex.slice(p, p+64);
      if (!w || w.length<64) break;
      keys.push('0x'+w.slice(-40));
      p += 64;
      if (keys.length>=4) break;
    }
    const staticSeg = readBytes(readU(64));
    const encLenSeg = readBytes(readU(128));
    const dynamicSeg = readBytes(readU(192));
    return { keyCount, keys, staticHex: staticSeg.hex, encodedLengthsHex: encLenSeg.hex, dynamicHex: dynamicSeg.hex };
  } catch {
    return { keyCount:0, keys:[], staticHex:null, encodedLengthsHex:null, dynamicHex:null };
  }
}

function main(){
  if (!fs.existsSync(OUT_DB) || !fs.existsSync(SRC_DB)) { console.error('missing dbs'); process.exit(1); }
  const out = new BetterSqlite3(OUT_DB);
  const src = new BetterSqlite3(SRC_DB, { readonly:true, fileMustExist:true });
  ensureSchema(out);

  const wave = loadWave1();
  const getData = src.prepare('SELECT data FROM raw_logs WHERE block_number=? AND log_index=?');
  const selectKeys = out.prepare(`SELECT table_id, key0, key1, key2, key3, block_number, log_index
    FROM erc_mud_latest WHERE table_id = ? ORDER BY key0, key1, key2, key3 LIMIT ? OFFSET ?`);
  const up = out.prepare(`INSERT INTO erc_mud_values(table_id,key0,key1,key2,key3,block_number,log_index,static_hex,encoded_lengths_hex,dynamic_hex)
    VALUES (@table_id,@key0,@key1,@key2,@key3,@block_number,@log_index,@static_hex,@encoded_lengths_hex,@dynamic_hex)
    ON CONFLICT(table_id,key0,key1,key2,key3)
    DO UPDATE SET block_number=excluded.block_number, log_index=excluded.log_index, static_hex=excluded.static_hex, encoded_lengths_hex=excluded.encoded_lengths_hex, dynamic_hex=excluded.dynamic_hex, updated_at=CURRENT_TIMESTAMP`);
  const tx = out.transaction((rows)=>{ for(const r of rows) up.run(r); });

  let total = 0;
  const perTable = [];
  for (const t of wave){
    const tableId = findTableId(out, t.namespace, t.name);
    if (!tableId){ console.warn('skip (no id):', t.namespace, t.name); continue; }
    const countRow = out.prepare('SELECT COUNT(1) AS c FROM erc_mud_latest WHERE table_id=?').get(tableId);
    const totalKeys = (countRow && countRow.c)|0;
    let processed = 0;
    for (let offset=0; offset<totalKeys; offset += CHUNK){
      if (MAX_PER_TABLE!=null && processed>=MAX_PER_TABLE) break;
      const rows = selectKeys.all(tableId, CHUNK, offset);
      if (!rows.length) break;
      const mapped = [];
      for (const r of rows){
        let dataHex = null; try { const g = getData.get(r.block_number|0, r.log_index|0); dataHex = g && g.data || null; } catch {}
        const seg = parseSegmentsFromData(dataHex);
        mapped.push({
          table_id: r.table_id,
          key0: r.key0||null,
          key1: r.key1||null,
          key2: r.key2||null,
          key3: r.key3||null,
          block_number: r.block_number|0,
          log_index: r.log_index|0,
          static_hex: seg.staticHex,
          encoded_lengths_hex: seg.encodedLengthsHex,
          dynamic_hex: seg.dynamicHex,
        });
      }
      if (mapped.length) tx(mapped);
      processed += rows.length; total += rows.length;
      const pct = totalKeys ? Math.round((processed/totalKeys)*100) : 100;
      process.stdout.write(`\r[mud-values] ${t.namespace}/${t.name} ${processed}/${totalKeys} (${pct}%)   `);
    }
    process.stdout.write('\n');
    perTable.push({ namespace: t.namespace, name: t.name, tableId, processed, totalKeys });
  }

  try { out.close(); } catch {}
  try { src.close(); } catch {}
  console.log(JSON.stringify({ status:'ok', total, perTable }, null, 2));
}

main();
