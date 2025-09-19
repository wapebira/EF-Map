#!/usr/bin/env node
/*
 Create lightweight ERC-20 views on the decoded DB to support quick queries.
 - Depends on data/local-indexer-decoded.db (decoded_events table)
 - Since we don't persist full ABI-decoded fields yet, these views expose topics-derived fields only.
*/
const fs = require('fs');
const path = require('path');
require('dotenv').config();
let BetterSqlite3 = null; try { BetterSqlite3 = require('better-sqlite3'); } catch {}

if (!BetterSqlite3) { console.error('better-sqlite3 is required'); process.exit(2); }

const ROOT = path.resolve(__dirname, '../../');
const OUT_DB = process.env.DECODED_DB_PATH || path.resolve(ROOT, 'data/local-indexer-decoded.db');

if (!fs.existsSync(OUT_DB)) { console.error('Decoded DB not found:', OUT_DB); process.exit(1); }

const TRANSFER_SIG = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const APPROVAL_SIG = '0x8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925';

const db = new BetterSqlite3(OUT_DB);
db.pragma('journal_mode=WAL');

// Normalize lowercase comparison in WHERE using lower()
db.exec(`
  CREATE VIEW IF NOT EXISTS erc20_transfers_v AS
  SELECT
    block_number,
    log_index,
    address AS token,
    -- Extract last 40 hex chars of topic1/2 as address; prepend 0x
    '0x' || substr(topic1, length(topic1) - 39, 40) AS from_addr,
    '0x' || substr(topic2, length(topic2) - 39, 40) AS to_addr
  FROM decoded_events
  WHERE lower(topic0) = '${TRANSFER_SIG}';

  CREATE VIEW IF NOT EXISTS erc20_approvals_v AS
  SELECT
    block_number,
    log_index,
    address AS token,
    '0x' || substr(topic1, length(topic1) - 39, 40) AS owner_addr,
    '0x' || substr(topic2, length(topic2) - 39, 40) AS spender_addr
  FROM decoded_events
  WHERE lower(topic0) = '${APPROVAL_SIG}';
`);

console.log(JSON.stringify({ status: 'ok', db: OUT_DB }));
