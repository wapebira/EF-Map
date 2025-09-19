#!/usr/bin/env node
/*
 Derive MUD table stats from erc_mud_set_record into a compact summary table.
 - Input: data/local-indexer-decoded.db (erc_mud_set_record)
 - Output: erc_mud_table_stats(table_id PK, namespace, name, rows, unique_keys, first_block, last_block)
 - Safe to re-run; uses INSERT OR REPLACE per table_id.
 - Progress is lightweight via stdout only; no status file writes.
*/
/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');
let BetterSqlite3 = null; try { BetterSqlite3 = require('better-sqlite3'); } catch {}
if (!BetterSqlite3) { console.error('better-sqlite3 required'); process.exit(2); }

const ROOT = path.resolve(__dirname, '../../');
const OUT_DB = process.env.DECODED_DB_PATH || path.resolve(ROOT, 'data/local-indexer-decoded.db');

function decodeTableId(id){
  if (!id) return { namespace:'', name:'', raw:id };
  const hex = String(id).toLowerCase();
  if (!hex.startsWith('0x') || hex.length !== 66) return { namespace:'', name:'', raw:id };
  const nsHex = hex.slice(2, 34);
  const nameHex = hex.slice(34);
  const hexToAscii = (h) => {
    let out = '';
    for (let i=0;i<h.length;i+=2){
      const byte = parseInt(h.slice(i,i+2), 16);
      if (byte === 0) break;
      if (byte >= 32 && byte <= 126) out += String.fromCharCode(byte);
    }
    return out;
  };
  return { namespace: hexToAscii(nsHex), name: hexToAscii(nameHex), raw: id };
}

function ensureSchema(db){
  db.exec(`
    CREATE TABLE IF NOT EXISTS erc_mud_table_stats (
      table_id TEXT PRIMARY KEY,
      namespace TEXT,
      name TEXT,
      rows INTEGER,
      unique_keys INTEGER,
      first_block INTEGER,
      last_block INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_mud_stats_rows ON erc_mud_table_stats(rows DESC);
  `);
}

function main(){
  if (!fs.existsSync(OUT_DB)) { console.error('decoded db missing:', OUT_DB); process.exit(1); }
  const db = new BetterSqlite3(OUT_DB);
  db.pragma('busy_timeout=1000');
  ensureSchema(db);

  // Aggregate per table_id in one pass for rows/first/last, then compute unique key count per table.
  const exists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='erc_mud_set_record'").get();
  if (!exists) { console.error('missing erc_mud_set_record table'); process.exit(1); }

  console.log('[mud] computing table aggregates…');
  const aggRows = db.prepare(`
    SELECT table_id AS table_id,
           COUNT(1) AS rows,
           MIN(block_number) AS first_block,
           MAX(block_number) AS last_block
    FROM erc_mud_set_record
    GROUP BY table_id
  `).all();

  const getUnique = db.prepare(`
    SELECT COUNT(1) AS c FROM (
      SELECT DISTINCT table_id, COALESCE(key0,''), COALESCE(key1,''), COALESCE(key2,''), COALESCE(key3,'')
      FROM erc_mud_set_record WHERE table_id = ?
    )
  `);

  const up = db.prepare(`
    INSERT INTO erc_mud_table_stats(table_id, namespace, name, rows, unique_keys, first_block, last_block)
    VALUES (@table_id, @namespace, @name, @rows, @unique_keys, @first_block, @last_block)
    ON CONFLICT(table_id) DO UPDATE SET
      namespace=excluded.namespace,
      name=excluded.name,
      rows=excluded.rows,
      unique_keys=excluded.unique_keys,
      first_block=excluded.first_block,
      last_block=excluded.last_block
  `);
  const tx = db.transaction((rows)=>{ for(const r of rows) up.run(r); });

  const outRows = [];
  let i = 0;
  for (const r of aggRows){
    i++; if (i % 50 === 0) console.log(`[mud] processed ${i}/${aggRows.length}`);
    const { namespace, name } = decodeTableId(r.table_id);
    let unique = 0; try { unique = getUnique.get(r.table_id).c|0; } catch {}
    outRows.push({
      table_id: r.table_id,
      namespace,
      name,
      rows: r.rows|0,
      unique_keys: unique|0,
      first_block: r.first_block|0,
      last_block: r.last_block|0,
    });
  }
  if (outRows.length) tx(outRows);
  console.log(JSON.stringify({ status:'ok', tables: outRows.length }, null, 2));
  try { db.close(); } catch {}
}

main();
