#!/usr/bin/env node
/*
 Create a safe on-disk snapshot of the local indexer DB.
 - Signals the ingestor to pause via CONTROL_PATH
 - Waits until status shows paused
 - Copies DB + sidecar WAL/SHM files to a timestamped snapshot dir
 - Resumes ingest (clears paused flag) unless STOP_AFTER env is set
*/
const fs = require('fs');
const path = require('path');
require('dotenv').config();

// Config paths (aligned with ingest_raw.js defaults)
const DB_PATH = process.env.LOCAL_DB_PATH || path.resolve(__dirname, '../../data/local-indexer.db');
const STATUS_PATH = process.env.STATUS_PATH || path.resolve(__dirname, '../../data/local-indexer-status.json');
const CONTROL_PATH = process.env.CONTROL_PATH || path.resolve(__dirname, '../../data/local-indexer-control.json');
const OUT_DIR = process.env.SNAPSHOT_DIR || path.resolve(__dirname, '../../data/local-snapshots');
const WAIT_MS = Number(process.env.PAUSE_WAIT_MS || 15000);
const STOP_AFTER = /^(1|true)$/i.test(String(process.env.STOP_AFTER || ''));

fs.mkdirSync(OUT_DIR, { recursive: true });

function sleep(ms){ return new Promise(r=>setTimeout(r, ms)); }

function readJson(p){ try { return JSON.parse(fs.readFileSync(p,'utf8')); } catch { return null; } }
function writeJson(p, obj){ fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, JSON.stringify(obj, null, 2)); }

async function waitPaused(deadlineTs){
  for(;;){
    const now = Date.now();
    if (now > deadlineTs) return false;
    const s = readJson(STATUS_PATH) || {};
    if (s && s.state === 'paused') return true;
    await sleep(400);
  }
}

function copyIfExists(src, dest){
  try {
    if (fs.existsSync(src)) fs.copyFileSync(src, dest);
  } catch (e){ console.warn('copyIfExists warn:', e.message); }
}

async function main(){
  const control = readJson(CONTROL_PATH) || {};
  control.paused = true; delete control.stop; // ensure pause, not stop
  writeJson(CONTROL_PATH, control);

  const ok = await waitPaused(Date.now() + WAIT_MS);
  if (!ok) console.warn('Timed out waiting for paused status; proceeding with best-effort copy');

  // Prepare snapshot file names
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const base = path.basename(DB_PATH, path.extname(DB_PATH));
  const snapDir = path.join(OUT_DIR, ts);
  fs.mkdirSync(snapDir, { recursive: true });
  const outDb = path.join(snapDir, base + '.db');

  // Copy DB and sidecars best-effort
  copyIfExists(DB_PATH, outDb);
  copyIfExists(DB_PATH + '-wal', path.join(snapDir, base + '.db-wal'));
  copyIfExists(DB_PATH + '-shm', path.join(snapDir, base + '.db-shm'));

  // Resume unless STOP_AFTER requested
  const c2 = readJson(CONTROL_PATH) || {};
  if (!STOP_AFTER){
    delete c2.paused; writeJson(CONTROL_PATH, c2);
  }

  // Emit manifest
  const meta = { status:'snapshotted', db: DB_PATH, outDir: snapDir, files: fs.readdirSync(snapDir) };
  fs.writeFileSync(path.join(snapDir, 'manifest.json'), JSON.stringify(meta, null, 2));
  console.log(JSON.stringify(meta));
}

main().catch(e=>{ console.error(e); process.exit(1); });
