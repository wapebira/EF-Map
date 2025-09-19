#!/usr/bin/env node
/*
 Materialize ERC-721 transfers into a dedicated table with progress tracking.
 - Reads from data/local-indexer-decoded.db (decoded_events)
 - Writes erc721_transfers(block_number, log_index, token, from_addr, to_addr, token_id_hex, token_id_dec, tx_hash)
 - Idempotent UPSERT by (block_number, log_index); resumable
 - Progress persisted to data/local-indexer-status.json under key `decode721`
*/
const fs = require('fs');
const path = require('path');
require('dotenv').config();
let BetterSqlite3 = null; try { BetterSqlite3 = require('better-sqlite3'); } catch {}

if (!BetterSqlite3) { console.error('better-sqlite3 is required'); process.exit(2); }

const ROOT = path.resolve(__dirname, '../../');
const OUT_DB = process.env.DECODED_DB_PATH || path.resolve(ROOT, 'data/local-indexer-decoded.db');
const STATUS_PATH = process.env.STATUS_PATH || path.resolve(ROOT, 'data/local-indexer-status.json');
const CHUNK = Number(process.env.ERC721_CHUNK || 25000);

const TRANSFER_SIG = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

function readJson(p, fb){ try { return JSON.parse(fs.readFileSync(p,'utf8')); } catch { return fb; } }
function writeJson(p, obj){ try { fs.writeFileSync(p, JSON.stringify(obj, null, 2)); } catch {} }

function updateStatus(patch){
  const s = readJson(STATUS_PATH, {});
  s.decode721 = { ...(s.decode721||{}), ...patch, t: new Date().toISOString() };
  writeJson(STATUS_PATH, s);
}

function ensureSchema(db){
  db.exec(`
    PRAGMA journal_mode=WAL;
    CREATE TABLE IF NOT EXISTS erc721_transfers (
      block_number INTEGER NOT NULL,
      log_index INTEGER NOT NULL,
      token TEXT,
      from_addr TEXT,
      to_addr TEXT,
      token_id_hex TEXT,
      token_id_dec TEXT,
      tx_hash TEXT,
      PRIMARY KEY (block_number, log_index)
    );
    CREATE INDEX IF NOT EXISTS idx_erc721_token ON erc721_transfers(token);
    CREATE INDEX IF NOT EXISTS idx_erc721_from ON erc721_transfers(from_addr);
    CREATE INDEX IF NOT EXISTS idx_erc721_to ON erc721_transfers(to_addr);
    CREATE INDEX IF NOT EXISTS idx_erc721_tokenid ON erc721_transfers(token_id_dec);
  `);
}

function hexToDecString(hex){ try { return BigInt(hex).toString(10); } catch { return null; } }
function last40(hex){ if(!hex) return null; const h = hex.toLowerCase(); return '0x' + h.slice(-40); }
function tokenIdHexFromTopic3(topic3){ if(!topic3) return null; const h = topic3.toLowerCase().replace(/^0x/,''); return '0x' + h.slice(-64); }

function main(){
  if (!fs.existsSync(OUT_DB)) { console.error('Decoded DB not found:', OUT_DB); process.exit(1); }
  const db = new BetterSqlite3(OUT_DB);
  db.pragma('busy_timeout=500');
  ensureSchema(db);

  const totalRow = db.prepare(`SELECT COUNT(1) AS c FROM decoded_events WHERE lower(topic0)=? AND topic1 IS NOT NULL AND topic2 IS NOT NULL AND topic3 IS NOT NULL`).get(TRANSFER_SIG);
  const total = totalRow && totalRow.c || 0;
  const startedAt = new Date().toISOString();
  updateStatus({ state:'erc721_running', total, done:0, rps:0, etaMs:null, startedAt });

  // Resume support
  let curBlock = 0, curIdx = -1, done = 0;
  try {
    const last = db.prepare('SELECT block_number, log_index FROM erc721_transfers ORDER BY block_number DESC, log_index DESC LIMIT 1').get();
    if (last){ curBlock = last.block_number|0; curIdx = last.log_index|0; }
    // Also compute done so far
    const dc = db.prepare('SELECT COUNT(1) AS c FROM erc721_transfers').get();
    if (dc && typeof dc.c === 'number') done = dc.c|0;
  } catch {}

  const select = db.prepare(`
    SELECT block_number, log_index, tx_hash, address, topic1, topic2, topic3
    FROM decoded_events
    WHERE lower(topic0)=? AND topic1 IS NOT NULL AND topic2 IS NOT NULL AND topic3 IS NOT NULL
      AND (block_number > ? OR (block_number = ? AND log_index > ?))
    ORDER BY block_number, log_index
    LIMIT ?
  `);
  const upsert = db.prepare(`
    INSERT INTO erc721_transfers(block_number, log_index, token, from_addr, to_addr, token_id_hex, token_id_dec, tx_hash)
    VALUES (@block_number,@log_index,@token,@from_addr,@to_addr,@token_id_hex,@token_id_dec,@tx_hash)
    ON CONFLICT(block_number,log_index) DO UPDATE SET token=excluded.token, from_addr=excluded.from_addr, to_addr=excluded.to_addr, token_id_hex=excluded.token_id_hex, token_id_dec=excluded.token_id_dec, tx_hash=excluded.tx_hash
  `);
  const txn = db.transaction((rows)=>{ for(const r of rows){ upsert.run(r); } });

  const t0 = Date.now();
  for(;;){
    const rows = select.all(TRANSFER_SIG, curBlock, curBlock, curIdx, CHUNK);
    if (!rows || rows.length===0) break;
    const mapped = rows.map(r=>{
      const from_addr = last40(r.topic1);
      const to_addr = last40(r.topic2);
      const token_id_hex = tokenIdHexFromTopic3(r.topic3);
      const token_id_dec = token_id_hex ? hexToDecString(token_id_hex) : null;
      return {
        block_number: r.block_number|0,
        log_index: r.log_index|0,
        token: r.address||null,
        from_addr,
        to_addr,
        token_id_hex,
        token_id_dec,
        tx_hash: r.tx_hash||null,
      };
    });
    txn(mapped);
    done += mapped.length;
    const last = mapped[mapped.length-1];
    curBlock = last.block_number; curIdx = last.log_index;
    // status
    const dt = Math.max(1, Date.now() - t0);
    const rps = Math.round(done / (dt/1000));
    const remain = Math.max(0, total - done);
    const etaMs = rps>0 ? Math.round((remain / rps) * 1000) : null;
    updateStatus({ state:'erc721_running', total, done, rps, etaMs });
    if (done % (CHUNK*4) === 0) console.log(JSON.stringify({ done, total, pct: Number(((done/Math.max(1,total))*100).toFixed(2)), rps }));
  }

  updateStatus({ state:'erc721_done', total, done, rps:0, etaMs:0, finishedAt: new Date().toISOString() });
  // Final summary
  const outCount = db.prepare('SELECT COUNT(1) AS c FROM erc721_transfers').get().c|0;
  try { db.close(); } catch {}
  console.log(JSON.stringify({ status:'ok', total, outCount }));
}

main();
