#!/usr/bin/env node
/*
 Materialize ERC-20 transfers and approvals from decoded_events.
 - Input: data/local-indexer-decoded.db (decoded_events)
 - Output tables: erc20_transfers, erc20_approvals
 - Fast, idempotent upsert keyed by (block_number, log_index)
*/
const fs = require('fs');
const path = require('path');
let BetterSqlite3 = null; try { BetterSqlite3 = require('better-sqlite3'); } catch {}
if (!BetterSqlite3) { console.error('better-sqlite3 required'); process.exit(2); }
const ROOT = path.resolve(__dirname, '../../');
const OUT_DB = process.env.DECODED_DB_PATH || path.resolve(ROOT, 'data/local-indexer-decoded.db');
const SRC_DB = process.env.LOCAL_DB_PATH || path.resolve(ROOT, 'data/local-indexer.db');

const TRANSFER_SIG = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const APPROVAL_SIG = '0x8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925';

function last40(hex){ if(!hex) return null; const h=String(hex).toLowerCase(); return '0x'+h.slice(-40); }

function main(){
  if (!fs.existsSync(OUT_DB)) { console.error('missing decoded db', OUT_DB); process.exit(1); }
  const db = new BetterSqlite3(OUT_DB);
  const src = fs.existsSync(SRC_DB) ? new BetterSqlite3(SRC_DB, { readonly:true, fileMustExist:true }) : null;
  db.pragma('journal_mode=WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS erc20_transfers (
      block_number INTEGER NOT NULL,
      log_index INTEGER NOT NULL,
      token TEXT,
      from_addr TEXT,
      to_addr TEXT,
      value_hex TEXT,
      tx_hash TEXT,
      PRIMARY KEY (block_number, log_index)
    );
    CREATE INDEX IF NOT EXISTS idx_e20t_token ON erc20_transfers(token);
    CREATE INDEX IF NOT EXISTS idx_e20t_from ON erc20_transfers(from_addr);
    CREATE INDEX IF NOT EXISTS idx_e20t_to ON erc20_transfers(to_addr);
    
    CREATE TABLE IF NOT EXISTS erc20_approvals (
      block_number INTEGER NOT NULL,
      log_index INTEGER NOT NULL,
      token TEXT,
      owner TEXT,
      spender TEXT,
      value_hex TEXT,
      tx_hash TEXT,
      PRIMARY KEY (block_number, log_index)
    );
    CREATE INDEX IF NOT EXISTS idx_e20a_token ON erc20_approvals(token);
    CREATE INDEX IF NOT EXISTS idx_e20a_owner ON erc20_approvals(owner);
    CREATE INDEX IF NOT EXISTS idx_e20a_spender ON erc20_approvals(spender);
  `);

  const tip = db.prepare('SELECT MAX(block_number) AS m FROM decoded_events').get().m|0;
  const CHUNK = Number(process.env.ERC20_CHUNK || 10000);
  let done = 0; const t0 = Date.now();

  const upT = db.prepare(`INSERT INTO erc20_transfers(block_number,log_index,token,from_addr,to_addr,value_hex,tx_hash)
    VALUES (@block_number,@log_index,@token,@from_addr,@to_addr,@value_hex,@tx_hash)
    ON CONFLICT(block_number,log_index) DO UPDATE SET token=excluded.token, from_addr=excluded.from_addr, to_addr=excluded.to_addr, value_hex=excluded.value_hex, tx_hash=excluded.tx_hash`);
  const upA = db.prepare(`INSERT INTO erc20_approvals(block_number,log_index,token,owner,spender,value_hex,tx_hash)
    VALUES (@block_number,@log_index,@token,@owner,@spender,@value_hex,@tx_hash)
    ON CONFLICT(block_number,log_index) DO UPDATE SET token=excluded.token, owner=excluded.owner, spender=excluded.spender, value_hex=excluded.value_hex, tx_hash=excluded.tx_hash`);
  const txT = db.transaction((rows)=>{ for(const r of rows){ upT.run(r); } });
  const txA = db.transaction((rows)=>{ for(const r of rows){ upA.run(r); } });

  // Resume cursors for each event type (so we only scan relevant rows)
  let tBlock = 0, tIdx = -1; let aBlock = 0, aIdx = -1;
  const lastT = db.prepare('SELECT block_number, log_index FROM erc20_transfers ORDER BY block_number DESC, log_index DESC LIMIT 1').get();
  const lastA = db.prepare('SELECT block_number, log_index FROM erc20_approvals ORDER BY block_number DESC, log_index DESC LIMIT 1').get();
  if (lastT) { tBlock = lastT.block_number|0; tIdx = lastT.log_index|0; }
  if (lastA) { aBlock = lastA.block_number|0; aIdx = lastA.log_index|0; }

  const selT = db.prepare(`SELECT block_number, log_index, tx_hash, address, topic1, topic2 FROM decoded_events
    WHERE lower(topic0)=? AND (block_number > ? OR (block_number = ? AND log_index > ?))
    ORDER BY block_number, log_index LIMIT ?`);
  const selA = db.prepare(`SELECT block_number, log_index, tx_hash, address, topic1, topic2 FROM decoded_events
    WHERE lower(topic0)=? AND (block_number > ? OR (block_number = ? AND log_index > ?))
    ORDER BY block_number, log_index LIMIT ?`);

  const getData = src ? src.prepare('SELECT data FROM raw_logs WHERE block_number=? AND log_index=?') : null;

  // Transfers
  for(;;){
    const rows = selT.all(TRANSFER_SIG, tBlock, tBlock, tIdx, CHUNK);
    if (!rows.length) break;
    const batchT = [];
    for (const r of rows){
      let value_hex = null;
      if (getData) {
        try { const g = getData.get(r.block_number|0, r.log_index|0); value_hex = (g && g.data || '').toLowerCase(); } catch {}
      }
      batchT.push({
        block_number: r.block_number|0,
        log_index: r.log_index|0,
        token: r.address||null,
        from_addr: last40(r.topic1),
        to_addr: last40(r.topic2),
        value_hex,
        tx_hash: r.tx_hash||null,
      });
    }
    if (batchT.length) txT(batchT);
    done += rows.length;
    const last = rows[rows.length-1]; tBlock = last.block_number; tIdx = last.log_index;
  }

  // Approvals
  for(;;){
    const rows = selA.all(APPROVAL_SIG, aBlock, aBlock, aIdx, CHUNK);
    if (!rows.length) break;
    const batchA = [];
    for (const r of rows){
      let value_hex = null;
      if (getData) {
        try { const g = getData.get(r.block_number|0, r.log_index|0); value_hex = (g && g.data || '').toLowerCase(); } catch {}
      }
      batchA.push({
        block_number: r.block_number|0,
        log_index: r.log_index|0,
        token: r.address||null,
        owner: last40(r.topic1),
        spender: last40(r.topic2),
        value_hex,
        tx_hash: r.tx_hash||null,
      });
    }
    if (batchA.length) txA(batchA);
    done += rows.length;
    const last = rows[rows.length-1]; aBlock = last.block_number; aIdx = last.log_index;
  }

  const t = db.prepare('SELECT COUNT(1) AS c FROM erc20_transfers').get().c|0;
  const a = db.prepare('SELECT COUNT(1) AS c FROM erc20_approvals').get().c|0;
  try { db.close(); } catch {}
  try { if (src) src.close(); } catch {}
  console.log(JSON.stringify({ status:'ok', transfers:t, approvals:a }));
}

main();
