#!/usr/bin/env node
/*
 Decode runner (Pass A – progress only):
 - Scans raw_logs and classifies MUD Store events vs unknown (no info ignored)
 - Updates a decode progress block inside STATUS_PATH (shared with ingest dashboard)
 - Writes a small decode history file for rate smoothing
 - Detached-friendly: minimal stdout, uses a PID file so other tools can manage it

 Note: This pass does NOT materialize record_latest; it focuses on
 reliable progress accounting and complete topic coverage. A subsequent pass will
 replay Store_* mutations into record_latest using the same iteration.
*/
const fs = require('fs');
const path = require('path');
require('dotenv').config();
let BetterSqlite3 = null; try { BetterSqlite3 = require('better-sqlite3'); } catch {}

if (!BetterSqlite3) { console.error('better-sqlite3 is required'); process.exit(2); }

// Paths and settings
function sane(v, fb){ if (v===undefined||v===null||/^true$/i.test(String(v))) return fb; return v; }
const ROOT = path.resolve(__dirname, '../../');
const DB_PATH = sane(process.env.LOCAL_DB_PATH, path.resolve(ROOT, 'data/local-indexer.db'));
// Phase 0 hardening: write decode status to its own file to avoid races with ingest status
const DECODE_STATUS_PATH = sane(process.env.DECODE_STATUS_PATH, path.resolve(ROOT, 'data/local-indexer-decode-status.json'));
// The ingest status (STATUS_PATH) remains read-only for this process in Phase 0
const STATUS_PATH = sane(process.env.STATUS_PATH, path.resolve(ROOT, 'data/local-indexer-status.json'));
const DECODE_HISTORY_PATH = sane(process.env.DECODE_HISTORY_PATH, path.resolve(ROOT, 'data/local-indexer-decode-history.json'));
const CONTROL_PATH = sane(process.env.CONTROL_PATH, path.resolve(ROOT, 'data/local-indexer-control.json'));
const PID_PATH = sane(process.env.DECODE_PID_PATH, path.resolve(ROOT, 'data/local-indexer-decode.pid'));
const CHUNK = Number(process.env.DECODE_CHUNK || 50000);
const SAVE_MS = Number(process.env.DECODE_SAVE_MS || 1000);
// Optional early-exit guards for safe smoke tests
const MAX_MS = process.env.DECODE_MAX_MS ? Number(process.env.DECODE_MAX_MS) : 0; // 0 = no limit
const MAX_ROWS = process.env.DECODE_MAX_ROWS ? Number(process.env.DECODE_MAX_ROWS) : 0; // 0 = no limit

// Known MUD Store topics (from derived_topic_map)
const TOPIC = {
  SetRecord: '0x8dbb3a9672eebfd3773e72dd9c102393436816d832c7ba9e1e1ac8fcadcac7a9',
  DeleteRecord: '0x0e1f72f429eb97e64878619984a91e687ae91610348b9ff4216782cc96e49d07',
  SpliceDynamic: '0xfe158a7adba34e256807c8a149028d3162918713c3838afc643ce9f96716ebfd',
  SpliceStatic: '0x8c0b5119d4cec7b284c6b1b39252a03d1e2f2d7451a5895562524c113bb952be'
};
const STORE_SET = new Set(Object.values(TOPIC).map(s=>s.toLowerCase()));

function readJson(p, fb){ try { return JSON.parse(fs.readFileSync(p,'utf8')); } catch { return fb; } }
function writeJsonAtomic(p, obj){
  try {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    const tmp = p + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(obj, null, 2));
    fs.renameSync(tmp, p);
  } catch(e){}
}
function nowIso(){ return new Date().toISOString(); }

function updateDecodeStatus(patch){
  const cur = readJson(DECODE_STATUS_PATH, {}) || {};
  const next = Object.assign({}, cur, patch, { updatedAt: nowIso() });
  writeJsonAtomic(DECODE_STATUS_PATH, next);
}
function appendHistPoint(done){
  let arr = readJson(DECODE_HISTORY_PATH, []); if (!Array.isArray(arr)) arr = [];
  arr.push({ t: nowIso(), done });
  if (arr.length > 400) arr = arr.slice(arr.length-400);
  writeJsonAtomic(DECODE_HISTORY_PATH, arr);
}
function readControl(){ return readJson(CONTROL_PATH, {}) || {}; }

async function main(){
  // PID lifecycle
  try { fs.writeFileSync(PID_PATH, String(process.pid)); } catch {}
  const cleanup = ()=>{ try { fs.unlinkSync(PID_PATH); } catch {} };
  process.on('exit', cleanup); process.on('SIGINT', ()=>{ cleanup(); process.exit(0); }); process.on('SIGTERM', ()=>{ cleanup(); process.exit(0); });

  const db = new BetterSqlite3(DB_PATH, { readonly: true, fileMustExist: true });
  const totalRows = db.prepare('SELECT COUNT(1) AS c FROM raw_logs').get().c|0;
  // Best-effort estimate of store rows (for % calculation)
  let storeRows = 0; try {
    const t = db.prepare('SELECT topic0, COUNT(1) AS c FROM raw_logs GROUP BY topic0').all();
    for (const r of t){ if (r.topic0 && STORE_SET.has(String(r.topic0).toLowerCase())) storeRows += (r.c|0); }
  } catch {}

  const startTs = Date.now();
  let lastSave = 0;
  let done = 0; let unk = 0;
  let lastBlock = 0; let lastIdx = -1;

  updateDecodeStatus({ state:'decode_starting', total: totalRows, storeRows, done: 0, unknown: 0, startedAt: nowIso() });

  const stmt = db.prepare('SELECT block_number, log_index, topic0 FROM raw_logs WHERE (block_number > ? OR (block_number = ? AND log_index > ?)) ORDER BY block_number, log_index LIMIT ?');

  for(;;){
    // Cooperative stop via control file
  const ctrl = readControl(); if (ctrl && ctrl.stop) { updateDecodeStatus({ state:'decode_stopping', done, lastBlock, lastIdx }); break; }
    const rows = stmt.all(lastBlock, lastBlock, lastIdx, CHUNK);
    if (!rows || rows.length === 0) break;
    for (const r of rows){
      const t0 = (r.topic0||'').toLowerCase();
      if (!STORE_SET.has(t0)) unk++;
      done++;
      lastBlock = r.block_number|0; lastIdx = r.log_index|0;
      if (MAX_ROWS && done >= MAX_ROWS) break;
    }
    if (MAX_ROWS && done >= MAX_ROWS) break;
    const now = Date.now();
    if ((now - lastSave) >= SAVE_MS){
      const elapsed = Math.max(1, now - startTs);
      const rps = (done * 1000) / elapsed;
      const total = totalRows;
      const remain = Math.max(0, total - done);
      const etaMs = rps > 0 ? (remain / rps) * 1000 : null;
  updateDecodeStatus({ state:'decode_running', done, total, unknown: unk, lastBlock, lastIdx, rps: Math.round(rps), etaMs: etaMs!=null? Math.round(etaMs): null });
      appendHistPoint(done);
      lastSave = now;
    }
    if (MAX_MS && (Date.now() - startTs) >= MAX_MS) { updateStatus({ state:'decode_timeboxed', done, lastBlock, lastIdx }); break; }
  }

  const elapsed = Math.max(1, Date.now() - startTs);
  const rps = (done * 1000) / elapsed;
  const finalState = (MAX_MS && (Date.now()-startTs)>=MAX_MS) ? 'decode_timeboxed_done' : (MAX_ROWS && done>=MAX_ROWS) ? 'decode_partial_done' : 'decode_done';
  updateDecodeStatus({ state: finalState, done, total: totalRows, unknown: unk, lastBlock, lastIdx, rps: Math.round(rps), finishedAt: nowIso() });
  try { db.close(); } catch {}
}

main().catch(e=>{ try { updateDecodeStatus({ state:'decode_error', error: String(e && e.message || e) }); } catch(_){} console.error(e); process.exit(1); });
