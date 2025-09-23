#!/usr/bin/env node
const path = require('path');
const fs = require('fs');
let BetterSqlite3 = null; try { BetterSqlite3 = require('better-sqlite3'); } catch {}
const ROOT = path.resolve(__dirname, '../../');
const OUT_DB = process.env.DECODED_DB_PATH || path.resolve(ROOT, 'data/local-indexer-decoded.db');
const SRC_DB = process.env.LOCAL_DB_PATH || path.resolve(ROOT, 'data/local-indexer.db');
const topic0 = (process.argv[2]||'').toLowerCase();
if (!topic0 || !topic0.startsWith('0x') || topic0.length<10) { console.error('usage: node tools/local-indexer/sample_topic.js <topic0Hash>'); process.exit(1); }
if (!fs.existsSync(OUT_DB)) { console.error('missing decoded db', OUT_DB); process.exit(1); }
const db = new BetterSqlite3(OUT_DB, { readonly:true, fileMustExist:true });
const src = fs.existsSync(SRC_DB) ? new BetterSqlite3(SRC_DB, { readonly:true, fileMustExist:true }) : null;
const total = db.prepare('SELECT COUNT(1) AS c FROM decoded_events WHERE lower(topic0)=?').get(topic0).c|0;
const topContracts = db.prepare('SELECT address AS token, COUNT(1) AS c FROM decoded_events WHERE lower(topic0)=? GROUP BY address ORDER BY c DESC LIMIT 5').all(topic0);
const samples = db.prepare('SELECT block_number, log_index, tx_hash, address, topic1, topic2, topic3 FROM decoded_events WHERE lower(topic0)=? ORDER BY block_number, log_index LIMIT 5').all(topic0);
let sampleData=[];
if (src && samples.length) {
  const gd = src.prepare('SELECT data FROM raw_logs WHERE block_number=? AND log_index=?');
  for (const s of samples){ try { const g = gd.get(s.block_number|0, s.log_index|0); sampleData.push((g&&g.data)||null) } catch { sampleData.push(null) } }
}
const info = { topic0, total, topContracts, samples, sampleData, hints:{} };
info.hints.topicsPresent = { t1: !!(samples[0]?.topic1), t2: !!(samples[0]?.topic2), t3: !!(samples[0]?.topic3) };
info.hints.dataLengths = sampleData.map(d=> d? (d.length-2)/2 : null);
if (sampleData[0]) { const h = sampleData[0].replace(/^0x/,''); info.hints.firstWords = [h.slice(0,64), h.slice(64,128), h.slice(128,192)]; }
console.log(JSON.stringify(info, null, 2));