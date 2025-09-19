/*
 Read-only metrics server for the local indexer dashboard.
 - Separate process; does not modify ingestion.
 - Attempts to read SQLite via better-sqlite3 (if available) in read-only mode.
 - Fallback to calling `sqlite3` CLI with -readonly if module is not available.
 - If DB unavailable, serves minimal health + log-derived alerts.
*/
/* eslint-disable no-console */
const http = require('http');
const url = require('url');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ARGV = process.argv.slice(2);
function getArg(key) {
  const pfx = `--${key}`;
  for (let i = 0; i < ARGV.length; i += 1) {
    const a = ARGV[i];
    if (a === pfx && ARGV[i + 1]) return ARGV[i + 1];
    if (a.startsWith(pfx + '=')) return a.slice(pfx.length + 1);
  }
  return null;
}

const PORT = Number(getArg('port') || process.env.PORT || 8731);
const ROOT = path.resolve(__dirname);
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const DEFAULT_DB = process.env.DB_PATH || path.resolve(ROOT, 'local.db');
const PREFERRED_LOCAL_DB = path.resolve(REPO_ROOT, 'data', 'local-indexer.db');
const ERR_LOG = process.env.ERR_LOG || path.resolve(REPO_ROOT, 'data', 'ingest_raw.err.log');
const OUT_LOG = process.env.OUT_LOG || path.resolve(REPO_ROOT, 'data', 'ingest_raw.out.log');
const CONTROL_PATH = process.env.CONTROL_PATH || path.resolve(REPO_ROOT, 'data', 'local-indexer-control.json');
const STATUS_FILE = process.env.STATUS_FILE || path.resolve(REPO_ROOT, 'data', 'local-indexer-status.json');
const HISTORY_FILE = process.env.HISTORY_FILE || path.resolve(REPO_ROOT, 'data', 'local-indexer-status-history.json');
// Phase 0: decode writes its own status file atomically to avoid races
const DECODE_STATUS_FILE = process.env.DECODE_STATUS_FILE || path.resolve(REPO_ROOT, 'data', 'local-indexer-decode-status.json');
const DECODE_HISTORY_FILE = process.env.DECODE_HISTORY_FILE || path.resolve(REPO_ROOT, 'data', 'local-indexer-decode-history.json');
// World API DLT snapshots (produced by tools/world_api_dlt/pipeline.py)
const WORLD_API_DIR = path.resolve(REPO_ROOT, 'scratch', 'world_api');
const WORLD_API_META = path.resolve(WORLD_API_DIR, 'meta.json');

// Try to resolve RPC URL and meta from decision log for convenience.
function parseDecisionLog() {
  const out = { rpcUrl: null, chainId: null, worldAddress: null };
  try {
    const p = path.join(REPO_ROOT, 'docs', 'decision-log.md');
    if (!fs.existsSync(p)) return out;
    const text = fs.readFileSync(p, 'utf8');
    // RPC URL
    let m = text.match(/RPC\s*Endpoint:\s*(https?:\/\/[^\s)"']+)/i);
    if (!m) m = text.match(/https?:\/\/[^\s)"']*(rpc[^\s)"']*)/i);
    if (m && m[1]) out.rpcUrl = (m[1] || m[0]).trim();
    // Chain ID (explicit line or near key)
    let mc = text.match(/Chain\s*ID\s*:\s*(\d{2,})/i);
    if (!mc) mc = text.match(/CHAIN_ID\s*=\s*(\d{2,})/i);
    if (mc && mc[1]) out.chainId = String(mc[1]).trim();
    // World address (explicit or env style)
    let mw = text.match(/World\s*Address\s*:\s*(0x[a-fA-F0-9]{40})/i);
    if (!mw) mw = text.match(/WORLD_ADDRESS\s*=\s*(0x[a-fA-F0-9]{40})/i);
    if (!mw) mw = text.match(/\b(0x[a-fA-F0-9]{40})\b(?=[^\n]*world)/i);
    if (mw && (mw[1] || mw[0])) out.worldAddress = String(mw[1] || mw[0]).toLowerCase();
  } catch {}
  return out;
}

let RPC_URL = process.env.RPC_URL || '';
let rpcSource = 'disabled';
const DECISION_META = parseDecisionLog();
if (RPC_URL) {
  rpcSource = 'env';
} else if (DECISION_META && DECISION_META.rpcUrl) {
  RPC_URL = DECISION_META.rpcUrl;
  rpcSource = 'decision-log';
}
let chainHeadTip = null;
let lastRpcLatencyMs = null;
let lastRpcError = null;
let lastRpcAt = null; // timestamp of last successful RPC head sample
let rpcPollTimer = null; // interval handle for RPC polling when enabled late

// Attempt to set up DB access
let dbDriver = null; // { type: 'better'|'cli', query(sql): any }

function findFallbackDb() {
  // Prefer the local indexer DB if present (for chain_info)
  if (fs.existsSync(PREFERRED_LOCAL_DB)) return PREFERRED_LOCAL_DB;
  if (fs.existsSync(DEFAULT_DB)) return DEFAULT_DB;
  // Find the newest .db file under repo root as a last resort
  try {
    const files = fs.readdirSync(REPO_ROOT)
      .filter((f) => f.endsWith('.db'))
      .map((f) => ({ f, t: fs.statSync(path.join(REPO_ROOT, f)).mtimeMs }))
      .sort((a, b) => b.t - a.t);
    if (files.length) return path.join(REPO_ROOT, files[0].f);
  } catch {}
  return null;
}

function initDb() {
  const dbPath = findFallbackDb();
  if (!dbPath) return { ok: false, reason: 'no-db' };

  // Try better-sqlite3
  try {
    // eslint-disable-next-line import/no-extraneous-dependencies, global-require
    const BetterSqlite3 = require('better-sqlite3');
    const db = new BetterSqlite3(dbPath, { readonly: true, fileMustExist: true });
    db.pragma('busy_timeout=250');
    dbDriver = {
      type: 'better',
      dbPath,
      query(sql, params = {}) {
        try {
          const stmt = db.prepare(sql);
          if (/\bselect\b/i.test(sql)) {
            return stmt.all(params);
          }
          return stmt.run(params);
        } catch (e) {
          if (String(e && e.code).includes('BUSY')) throw Object.assign(new Error('DB busy'), { code: 'BUSY' });
          throw e;
        }
      },
      close() { try { db.close(); } catch {} },
    };
    return { ok: true, type: 'better', dbPath };
  } catch (e) {
    // Fallback to sqlite3 CLI
    const v = spawnSync('sqlite3', ['-version'], { encoding: 'utf8' });
    if (v.status !== 0) return { ok: false, reason: 'no-sqlite3-cli', dbPath };
    dbDriver = {
      type: 'cli',
      dbPath,
      query(sql) {
        const res = spawnSync('sqlite3', ['-readonly', dbPath, '-json', sql], { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
        if (res.status !== 0) {
          const err = new Error(res.stderr || 'sqlite3 error');
          if ((res.stderr || '').includes('database is locked')) err.code = 'BUSY';
          throw err;
        }
        try {
          return JSON.parse(res.stdout || '[]');
        } catch {
          return [];
        }
      },
      close() {},
    };
    return { ok: true, type: 'cli', dbPath };
  }
}

const dbInit = initDb();
console.log(`[metrics] DB init: ${dbInit.ok ? dbInit.type + ' ' + dbInit.dbPath : 'unavailable (' + dbInit.reason + ')'}`);

// Simple in-memory sampler/cache (1Hz sampling; 1s cache window)
let startTs = Date.now();
let lastSample = null;
// Maintain fixed-length 60-second rings for charts
let lastTputSeries = []; // [{t, blocks}] length <= 60
let lastErrSeries = [];  // [{t, errors}] length <= 60
let lastLagSeries = [];  // [{t, lag}] length <= 60
let lastAlerts = [];
let lastSummary = null;
let lastSummaryAt = 0;
// Track chain head sampling for chain rate calculation
// Track chain head samples for smoother rate over ~60s
let chainSamples = []; // array of { t, head }
// Light cache for ERC20 stats
let lastErc20 = null;
let lastErc20At = 0;
// Short caches for MUD endpoints to avoid flicker under DB contention
let lastMudTyped = null; // { exists, tip, totalTables, returned, items, stale?:true }
let lastMudTypedAt = 0;
let lastMudLatest = null; // { exists, wave, totals, stale?:true }
let lastMudLatestAt = 0;
// Cache for unified ECS list
let lastMudEcs = null; // { exists, returned, items, stale?:true }
let lastMudEcsAt = 0;
// Cache for needs-decoding list
let lastMudNeeds = null; // { exists, returned, items, stale?:true }
let lastMudNeedsAt = 0;
const MUD_TTL_MS = 2000; // serve cached result for 2s between heavy queries

// Cache last-good status/history to avoid flicker on partial writes
let lastStatusGood = null;
let lastHistGood = [];
let lastStatusReadAt = 0;
// Cache last-good decode status and history to avoid UI reset on transient read/null
let lastDecodeGood = null;
let lastDecodeReadAt = 0;
let lastDecodeHistGood = [];
// Cache chain metadata from DB (chain_id/world_address)
let lastChainInfo = null; // { chain_id, world_address }
let lastChainInfoAt = 0;

function readJsonSafe(p) {
  try {
    if (!fs.existsSync(p)) return null;
  // Read file fully and ignore .tmp transitional files
  if (p.endsWith('.tmp')) return null;
  const txt = fs.readFileSync(p, 'utf8');
    return JSON.parse(txt);
  } catch {
    return null;
  }
}

function getStatusSnapshotStable() {
  const status = readJsonSafe(STATUS_FILE);
  const hist = readJsonSafe(HISTORY_FILE);
  // Merge decode status/history from dedicated files if present
  const dStat = readJsonSafe(DECODE_STATUS_FILE);
  const dHist = readJsonSafe(DECODE_HISTORY_FILE);
  // Only update caches on successful parse; otherwise reuse last-good
  let merged = lastStatusGood || {};
  if (status && typeof status === 'object') { merged = status; lastStatusGood = status; lastStatusReadAt = Date.now(); }
  // Attach decode block if available
  if (dStat && typeof dStat === 'object') {
    lastDecodeGood = dStat; lastDecodeReadAt = Date.now();
    try { merged = { ...merged, decode: dStat }; } catch {}
  } else if (lastDecodeGood) {
    // Preserve last-good decode when current read fails or is missing
    try { merged = { ...merged, decode: lastDecodeGood }; } catch {}
  }
  // History merge: keep ingest history as before; decode history is separate but available for future charts
  if (Array.isArray(hist)) { lastHistGood = hist; }
  if (Array.isArray(dHist)) { lastDecodeHistGood = dHist; }
  return { status: merged, hist: lastHistGood, decodeHist: Array.isArray(dHist) ? dHist : lastDecodeHistGood };
}

function tailErrLog(limitBytes = 64 * 1024) {
  try {
    if (!fs.existsSync(ERR_LOG)) return [];
    const stats = fs.statSync(ERR_LOG);
    const start = Math.max(0, stats.size - limitBytes);
    const fd = fs.openSync(ERR_LOG, 'r');
    const buf = Buffer.alloc(Math.min(limitBytes, stats.size));
    fs.readSync(fd, buf, 0, buf.length, start);
    fs.closeSync(fd);
    const now = Date.now();
    const lines = buf.toString('utf8').split(/\r?\n/).filter(Boolean).reverse();
    // Parse with simple dedupe and conservative timestamping to avoid flicker
    const seen = new Set();
    const alerts = [];
  for (const line of lines) {
      const lower = line.toLowerCase();
      let level = null;
      if (lower.includes('error')) level = 'error';
      else if (lower.includes('warn')) level = 'warning';
      else if (lower.includes('info')) level = 'info';
      if (!level) continue;
      const key = level + '|' + line.trim().slice(0, 200);
      if (seen.has(key)) continue;
      seen.add(key);
      const tsMatch = line.match(/(\d{4}-\d{2}-\d{2}[ t]\d{2}:\d{2}:\d{2}(?:\.\d+)?)/);
      // If no timestamp, use file mtime as coarse proxy instead of "now"
      const ts = tsMatch ? Date.parse(tsMatch[1].replace(' ', 'T')) : Math.max(0, stats.mtimeMs | 0);
      alerts.push({ ts, level, msg: line.slice(0, 240) });
      if (alerts.length >= 50) break;
    }
    // Filter out very old alerts to reduce noise (default 6 hours)
    const MAX_AGE_MS = Number(process.env.ALERT_MAX_AGE_MS || (6 * 60 * 60 * 1000));
    const cutoff = Date.now() - MAX_AGE_MS;
    return alerts.filter((a) => (a.ts || 0) >= cutoff);
  } catch {
    return [];
  }
}

function safeQuery(sql, params) {
  if (!dbDriver) return null;
  try {
    return dbDriver.query(sql, params);
  } catch (e) {
    if (e && (e.code === 'BUSY' || /database is locked/i.test(String(e)))) {
      return { busy: true };
    }
    return null;
  }
}

function openDecodedDb(readonly = true) {
  try {
    // eslint-disable-next-line global-require
    const BetterSqlite3 = require('better-sqlite3');
    const OUT_DB = process.env.DECODED_DB_PATH || path.resolve(REPO_ROOT, 'data/local-indexer-decoded.db');
    if (!fs.existsSync(OUT_DB)) return null;
    const db = new BetterSqlite3(OUT_DB, { readonly, fileMustExist: true });
    try { db.pragma('busy_timeout=1000'); } catch {}
    return db;
  } catch {}
  return null;
}

function readChainInfo() {
  // Refresh at most every 60s
  const now = Date.now();
  if (lastChainInfo && (now - lastChainInfoAt) < 60_000) return lastChainInfo;
  try {
    if (!dbDriver) return lastChainInfo;
    const rows = safeQuery("SELECT chain_id, world_address FROM chain_info WHERE id=1") || [];
    if (Array.isArray(rows) && rows.length) {
      lastChainInfo = { chain_id: String(rows[0].chain_id || ''), world_address: String(rows[0].world_address || '') };
      lastChainInfoAt = now;
    }
  } catch {}
  // If DB didn't provide it, attempt to fill from decision log once
  if ((!lastChainInfo || (!lastChainInfo.chain_id && !lastChainInfo.world_address)) && DECISION_META) {
    lastChainInfo = {
      chain_id: DECISION_META.chainId ? String(DECISION_META.chainId) : (lastChainInfo && lastChainInfo.chain_id) || '',
      world_address: DECISION_META.worldAddress ? String(DECISION_META.worldAddress).toLowerCase() : (lastChainInfo && lastChainInfo.world_address) || '',
    };
    lastChainInfoAt = now;
  }
  return lastChainInfo;
}

function computeSample() {
  const now = Date.now();
  // Prefer lightweight file snapshots to avoid DB contention.
  const { status, hist } = getStatusSnapshotStable();
  // Helper to validate URLs
  const isLikelyHttpUrl = (s) => typeof s === 'string' && /^https?:\/\//i.test(s.trim());
  // Opportunistically adopt RPC URL from status if not configured or invalid, so UI isn't 'n/a'
  try {
    const sRpc = status && typeof status.rpc === 'string' ? status.rpc.trim() : '';
    const haveValidRpc = isLikelyHttpUrl(RPC_URL);
    if ((rpcSource === 'disabled' || !haveValidRpc) && isLikelyHttpUrl(sRpc)) {
      RPC_URL = sRpc;
      rpcSource = 'status';
      // enable polling if available and not already running
      if (typeof fetch === 'function' && !rpcPollTimer) {
        pollRpcOnce();
        rpcPollTimer = setInterval(pollRpcOnce, 30_000);
      }
    }
  } catch {}
  let indexedHead = null;
  if (status && status.cursor && Number.isFinite(Number(status.cursor.last_block_number))) {
    indexedHead = Number(status.cursor.last_block_number);
  } else if (hist.length) {
    const last = hist[hist.length - 1];
    if (last && Number.isFinite(Number(last.block))) indexedHead = Number(last.block);
  }
  // If still unknown, keep previous to avoid flicker
  if (indexedHead == null && lastSummary && typeof lastSummary.indexedHead === 'number') {
    indexedHead = lastSummary.indexedHead;
  }

  // Compute ingest throughput using last history window (up to 5 minutes); fallback to in-memory delta
  let blocksPerMin = 0;
  const recentCut = now - 5 * 60_000; // up to 5 minutes window
  const histRecent = Array.isArray(hist) && hist.length
    ? hist.filter((r) => {
        const tt = Date.parse(r.t || 0);
        return Number.isFinite(tt) && tt >= recentCut;
      })
    : [];
  if (histRecent.length >= 2) {
    const first = histRecent[0];
    const lastH = histRecent[histRecent.length - 1];
    const bFirst = Number(first.block || 0);
    const bLast = Number(lastH.block || 0);
    const tFirst = Date.parse(first.t || 0);
    const tLast = Date.parse(lastH.t || 0);
    const dtSec = Math.max(1, Math.round((tLast - tFirst) / 1000));
    const db = Math.max(0, bLast - bFirst);
    blocksPerMin = Math.round((db / dtSec) * 60);
  } else if (indexedHead != null) {
    // Fallback: compute from last in-memory sample if history lacks recent points
    if (!lastSample) lastSample = { t: now, indexedHead: indexedHead || 0 };
    const deltaBlocks = Math.max(0, indexedHead - lastSample.indexedHead);
    const dtSec = Math.max(1, Math.round((now - lastSample.t) / 1000));
    const blocksPerSec = deltaBlocks / dtSec;
    blocksPerMin = Math.round(blocksPerSec * 60);
  }

  // Update in-memory sample for subsequent deltas (used only by fallback branch above)
  lastSample = { t: now, indexedHead: indexedHead != null ? indexedHead : (lastSample ? lastSample.indexedHead : 0) };

  // Throughput series: maintain fixed 60-second ring, appending current snapshot each tick
  lastTputSeries = [...lastTputSeries.slice(-59), { t: 0, blocks: blocksPerMin }]
    .map((d, i, a) => ({ ...d, t: i - (a.length - 1) }));

  // Errors from recent alerts in the last window
  lastAlerts = tailErrLog();
  const oneMinAgo = now - 60 * 1000;
  const errorsLastMin = lastAlerts.filter((a) => a.level === 'error' && a.ts >= oneMinAgo).length;
  lastErrSeries = [...lastErrSeries.slice(-59), { t: 0, errors: errorsLastMin }]
    .map((d, i, a) => ({ ...d, t: i - (a.length - 1) }));

  // Lag series from history + current chainHead if available
  // Lag series: maintain fixed 60-second ring based on current lag
  // Determine best-known chain head for lag calc
  let headAt = chainHeadTip != null ? chainHeadTip : (status && (Number(status.head) || Number(status.safeHead))) || null;
  if (headAt == null && lastSummary && typeof lastSummary.chainHead === 'number') headAt = lastSummary.chainHead;
  const lagNow = (headAt != null && indexedHead != null) ? Math.max(0, Number(headAt) - Number(indexedHead)) : 0;
  lastLagSeries = [...lastLagSeries.slice(-59), { t: 0, lag: lagNow }]
    .map((d, i, a) => ({ ...d, t: i - (a.length - 1) }));

  // Summary
  // Prefer RPC head; fallback to status file's head/safeHead if present.
  let chainHead = chainHeadTip;
  if (chainHead == null && status) {
    if (Number.isFinite(Number(status.head))) chainHead = Number(status.head);
    else if (Number.isFinite(Number(status.safeHead))) chainHead = Number(status.safeHead);
  }
  if (chainHead == null && lastSummary && typeof lastSummary.chainHead === 'number') {
    chainHead = lastSummary.chainHead;
  }
  const lag = chainHead != null && indexedHead != null ? Math.max(0, chainHead - indexedHead) : 0;
  // Chain head rate over ~last 60 seconds (per-minute)
  let chainBlocksPerMin = 0;
  if (typeof chainHead === 'number'){
    // push sample and trim
    chainSamples.push({ t: now, head: chainHead });
    const cutoff = now - 60_000;
    chainSamples = chainSamples.filter((s) => s.t >= cutoff);
    if (chainSamples.length >= 2) {
      const first = chainSamples[0];
      const lastS = chainSamples[chainSamples.length - 1];
      const dBlocks = Math.max(0, Number(lastS.head) - Number(first.head));
      const dtSec = Math.max(1, Math.round((lastS.t - first.t) / 1000));
      chainBlocksPerMin = Math.round((dBlocks / dtSec) * 60);
    }
  }
  // ETA: use effective catch-up rate (ingest - chain). If not positive, no ETA.
  const effectiveBpm = Math.max(0, (blocksPerMin|0) - (chainBlocksPerMin|0));
  const etaSec = (effectiveBpm > 0 && lag > 0)
    ? Math.round(lag / effectiveBpm) * 60
    : 0;

  // Expose a little freshness context for UI clarity
  const statusFreshSec = (function(){
    try {
      const s = getStatusSnapshotStable().status;
      const ts = s && s.updatedAt ? Date.parse(s.updatedAt) : null;
      if (ts && isFinite(ts)) return Math.round((now - ts) / 1000);
    } catch {}
    return null;
  })();

  // Optional chain metadata (prefer DB; fallback to status fields)
  const metaDb = readChainInfo() || {};
  const meta = { ...metaDb };
  try {
    if (!meta.chain_id && status && status.chainId != null) meta.chain_id = String(status.chainId);
    if (!meta.world_address && status && status.worldAddress) meta.world_address = String(status.worldAddress).toLowerCase();
    // Final fallback to decision log if still missing
    if ((!meta.chain_id || meta.chain_id === 'null' || meta.chain_id === '')) {
      if (DECISION_META && DECISION_META.chainId) meta.chain_id = String(DECISION_META.chainId);
    }
    if ((!meta.world_address || meta.world_address === 'null' || meta.world_address === '')) {
      if (DECISION_META && DECISION_META.worldAddress) meta.world_address = String(DECISION_META.worldAddress).toLowerCase();
    }
  } catch {}

  lastSummary = {
    chainName: 'Local Frontier (EVM)',
    rpcUrl: RPC_URL || 'n/a',
    mode: lag > 0 ? 'Catch-up' : 'Live',
    schemaVersion: 'v2',
  rpcSource,
    chainHead,
    indexedHead: indexedHead || 0,
  blocksPerMin: blocksPerMin || 0,
  chainBlocksPerMin,
    effectiveBlocksPerMin: effectiveBpm,
    errorsPerMin: errorsLastMin,
    reorgDepth: 0,
    queueDepth: lag,
    start: startTs,
    etaSec,
    netLatencyMs: lastRpcLatencyMs,
    rpcError: lastRpcError,
    rpcFreshSec: (lastRpcAt ? Math.round((now - lastRpcAt) / 1000) : null),
    rpcState: (function(){
      if (!RPC_URL) return 'disabled';
      if (lastRpcError) return 'error';
      if (!lastRpcAt) return 'stale';
      return (now - lastRpcAt) < 90_000 ? 'ok' : 'stale';
    })(),
  statusFreshSec: statusFreshSec,
  chainId: meta.chain_id || null,
  worldAddress: meta.world_address || null,
  };
  lastSummaryAt = now;
}

// Background sampler
setInterval(() => {
  computeSample();
}, 1000);
computeSample();

// Optional RPC poller (every 30s) if RPC_URL provided.
async function pollRpcOnce() {
  if (!RPC_URL) return;
  const t0 = Date.now();
  try {
    const payload = { jsonrpc: '2.0', id: 1, method: 'eth_blockNumber', params: [] };
    const res = await fetch(RPC_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const t1 = Date.now();
    lastRpcLatencyMs = t1 - t0;
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const j = await res.json();
    let hex = j && (j.result || j.blockNumber);
    if (typeof hex === 'string' && hex.startsWith('0x')) {
      chainHeadTip = parseInt(hex, 16);
  lastRpcError = null;
  lastRpcAt = Date.now();
    }
  } catch (e) {
    lastRpcError = String(e && e.message || e);
  }
}

if (typeof fetch === 'function' && RPC_URL) {
  pollRpcOnce();
  rpcPollTimer = setInterval(pollRpcOnce, 30_000);
}

function sendJson(res, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(200, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function serveStatic(req, res) {
  try {
    let p = url.parse(req.url).pathname || '/';
    // Default document
    if (p === '/') p = '/dashboard.html';
    // Normalize and sanitize path to avoid traversal and Windows root reset
    // 1) decode, 2) normalize, 3) remove leading slashes, 4) strip any remaining .. segments
    const decoded = decodeURIComponent(p);
    const normalized = path.normalize(decoded).replace(/^([/\\])+/, ''); // drop leading slashes
    const safeRel = normalized.replace(/\.\.(?:[/\\]|$)/g, '');
    const filePath = path.join(ROOT, safeRel);
    if (!filePath.startsWith(ROOT)) { res.writeHead(403); res.end('Forbidden'); return; }
    if (!fs.existsSync(filePath)) { res.writeHead(404); res.end('Not found'); return; }
    const ext = path.extname(filePath).toLowerCase();
    const ct = ext === '.html' ? 'text/html' : ext === '.js' ? 'text/javascript' : ext === '.css' ? 'text/css' : 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': ct, 'Cache-Control': 'no-store' });
    fs.createReadStream(filePath).on('error', () => { try { res.destroy(); } catch {} }).pipe(res);
  } catch {
    try { res.writeHead(500); res.end('error'); } catch {}
  }
}

const server = http.createServer(async (req, res) => {
  // Minimal access log for static hangs (sample only for root and dashboard.js)
  const pth = url.parse(req.url).pathname || '';
  if (pth === '/' || pth === '/dashboard.html' || pth.endsWith('dashboard.js')) {
    console.log('[metrics] http', req.method, pth);
  }
  const { pathname, query } = url.parse(req.url, true);
  if (pathname === '/api/health') {
  sendJson(res, { status: 'ok', startTs, uptimeSec: Math.round((Date.now() - startTs) / 1000), db: dbDriver ? dbDriver.dbPath : null, mode: lastSummary?.mode || 'Live', rpc: RPC_URL ? 'configured' : 'disabled', rpcSource });
    return;
  }
  if (pathname === '/api/summary') {
    // serve cached or compute if >1s old
    if (!lastSummary || Date.now() - lastSummaryAt > 1000) computeSample();
    sendJson(res, lastSummary || {});
    return;
  }
  if (pathname === '/api/proc') {
    try {
      const now = Date.now();
      const s = getStatusSnapshotStable().status || {};
      const ts = s && s.updatedAt ? Date.parse(s.updatedAt) : null;
      const updatedAgoSec = ts && isFinite(ts) ? Math.max(0, Math.round((now - ts)/1000)) : null;
      const head = (s && Number.isFinite(Number(s.head))) ? Number(s.head) : (lastSummary && lastSummary.chainHead);
      const idx = (s && s.cursor && Number.isFinite(Number(s.cursor.last_block_number))) ? Number(s.cursor.last_block_number) : (lastSummary && lastSummary.indexedHead);
      const lag = (head!=null && idx!=null) ? Math.max(0, Number(head) - Number(idx)) : null;
      const running = (updatedAgoSec!=null) ? (updatedAgoSec <= 120) : false;
  // Local-only server: allow control unconditionally to simplify operator flow
  sendJson(res, { running, updatedAgoSec, lag, allowControl: true });
    } catch { sendJson(res, { running:false, allowControl: !!process.env.ALLOW_CONTROL }); }
    return;
  }
  if (pathname === '/api/series/tput') {
    // Always return at least a short zero series to help charts render
    const out = (Array.isArray(lastTputSeries) && lastTputSeries.length)
      ? lastTputSeries : Array.from({ length: 10 }, (_, i) => ({ t: i - 9, blocks: 0 }));
    sendJson(res, out);
    return;
  }
  if (pathname === '/api/series/errors') {
    sendJson(res, lastErrSeries);
    return;
  }
  if (pathname === '/api/series/lag') {
    sendJson(res, lastLagSeries);
    return;
  }
  if (pathname === '/api/decode') {
    // Light-weight decode progress: read from STATUS_FILE and expose s.decode
    try {
      const s = getStatusSnapshotStable().status || {};
  const d = s && s.decode ? s.decode : lastDecodeGood;
  sendJson(res, d || {});
    } catch (e) {
      sendJson(res, {});
    }
    return;
  }
  if (pathname === '/api/decode-history') {
    try {
      const snap = getStatusSnapshotStable();
      sendJson(res, snap.decodeHist || []);
    } catch (e) {
      sendJson(res, []);
    }
    return;
  }
  if (pathname === '/api/shards') {
    sendJson(res, []);
    return;
  }
  if (pathname === '/api/alerts') {
    sendJson(res, lastAlerts);
    return;
  }
  if (pathname === '/api/control/start-ingest') {
    try {
      // Prepare minimal env so the ingester doesn't exit on chain/db mismatch
      const meta = readChainInfo() || {};
      const env = { ...process.env };
      env.WORLD_ADDRESS = (env.WORLD_ADDRESS || meta.world_address || '').toString();
      env.CHAIN_ID = (env.CHAIN_ID || meta.chain_id || '695569').toString();
  env.RPC_URL = env.RPC_URL || RPC_URL || (DECISION_META && DECISION_META.rpcUrl) || 'https://rpc.pyropechain.com';
      // Ensure explicit local paths (ingester has same defaults but make it explicit)
      env.LOCAL_DB_PATH = env.LOCAL_DB_PATH || path.resolve(REPO_ROOT, 'data/local-indexer.db');
      env.STATUS_PATH = env.STATUS_PATH || path.resolve(REPO_ROOT, 'data/local-indexer-status.json');
      env.HISTORY_PATH = env.HISTORY_PATH || path.resolve(REPO_ROOT, 'data/local-indexer-status-history.json');
      env.CONTROL_PATH = env.CONTROL_PATH || path.resolve(REPO_ROOT, 'data/local-indexer-control.json');
      env.PID_PATH = env.PID_PATH || path.resolve(REPO_ROOT, 'data/local-indexer-ingest.pid');
      // Reset control flags to allow run; clear stale PID
      try {
        fs.mkdirSync(path.resolve(REPO_ROOT, 'data'), { recursive: true });
        fs.writeFileSync(env.CONTROL_PATH, JSON.stringify({ paused:false, stop:false }));
      } catch {}
      try { if (fs.existsSync(env.PID_PATH)) fs.unlinkSync(env.PID_PATH); } catch {}

      let child;
      let via = 'unknown';
      if (process.platform === 'win32') {
        const ps1 = path.resolve(REPO_ROOT, 'tools/local-indexer/start_ingest.ps1');
        if (fs.existsSync(ps1)) {
          child = require('child_process').spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ps1], {
            cwd: REPO_ROOT,
            detached: true,
            stdio: 'ignore',
            env,
            windowsHide: true,
          });
          via = 'powershell';
        } else {
          // Fallback: spawn node with log redirection
          const nodeExe = process.execPath || 'node';
          const script = path.resolve(REPO_ROOT, 'tools/local-indexer/ingest_raw.js');
          const cmd = `${JSON.stringify(nodeExe)} ${JSON.stringify(script)} >> ${JSON.stringify(OUT_LOG)} 2>> ${JSON.stringify(ERR_LOG)}`;
          child = require('child_process').spawn(cmd, {
            cwd: REPO_ROOT,
            detached: true,
            stdio: 'ignore',
            env,
            shell: true,
            windowsHide: true,
          });
          via = 'node-shell';
        }
      } else {
        // Non-Windows
        const nodeExe = process.execPath || 'node';
        const script = path.resolve(REPO_ROOT, 'tools/local-indexer/ingest_raw.js');
        const cmd = `${JSON.stringify(nodeExe)} ${JSON.stringify(script)} >> ${JSON.stringify(OUT_LOG)} 2>> ${JSON.stringify(ERR_LOG)}`;
        child = require('child_process').spawn(cmd, {
          cwd: REPO_ROOT,
          detached: true,
          stdio: 'ignore',
          env,
          shell: true,
        });
        via = 'node-shell';
      }
      try { child && child.unref && child.unref(); } catch {}
      sendJson(res, {
        status:'started',
        via,
        pid: (child && child.pid) || null,
        used: {
          chainId: env.CHAIN_ID || null,
          worldAddress: env.WORLD_ADDRESS || null,
          rpcUrl: env.RPC_URL || null,
        },
      });
    } catch (e) {
      res.writeHead(500, { 'Content-Type':'application/json' });
      res.end(JSON.stringify({ error:String(e&&e.message||e) }));
    }
    return;
  }
  if (pathname === '/api/decoded-dataset') {
    try {
      const OUT_DB = process.env.DECODED_DB_PATH || path.resolve(REPO_ROOT, 'data/local-indexer-decoded.db');
      const exists = fs.existsSync(OUT_DB);
      let sizeBytes = 0, rows = null;
      if (exists) {
        try { sizeBytes = fs.statSync(OUT_DB).size; } catch {}
        // Try to open with better-sqlite3 for a quick row count; fallback to null if busy/missing
        try {
          // eslint-disable-next-line global-require
          const BetterSqlite3 = require('better-sqlite3');
          const odb = new BetterSqlite3(OUT_DB, { readonly: true, fileMustExist: true });
          try { odb.pragma('busy_timeout=1000'); } catch {}
          const r = odb.prepare('SELECT COUNT(1) AS c FROM decoded_events').get();
          rows = r && r.c || 0;
          try { odb.close(); } catch {}
        } catch {}
      }
      sendJson(res, { exists, path: exists ? OUT_DB : null, sizeBytes, rows });
    } catch (e) {
      sendJson(res, { exists:false });
    }
    return;
  }
  if (pathname === '/api/erc721') {
    try {
  const s = getStatusSnapshotStable().status || {};
      const d = s && s.decode721 ? s.decode721 : null;
      sendJson(res, d || {});
    } catch (e) {
      sendJson(res, {});
    }
    return;
  }
  // ERC-1155 progress
  if (pathname === '/api/erc1155') {
    try {
  const s = getStatusSnapshotStable().status || {};
      const d = s && s.decode1155 ? s.decode1155 : null;
      sendJson(res, d || {});
    } catch (e) {
      sendJson(res, {});
    }
    return;
  }
  if (pathname === '/api/mud') {
    try {
  const s = getStatusSnapshotStable().status || {};
      const d = s && s.decodeMud ? s.decodeMud : null;
      sendJson(res, d || {});
    } catch (e) {
      sendJson(res, {});
    }
    return;
  }
  if (pathname === '/api/mud-table-stats') {
    try {
  const OUT_DB = process.env.DECODED_DB_PATH || path.resolve(REPO_ROOT, 'data/local-indexer-decoded.db');
  if (!fs.existsSync(OUT_DB)) { sendJson(res, { exists:false }); return; }
  let db = openDecodedDb(true);
      if (!db) { sendJson(res, { exists:true, limited:true }); return; }
      const have = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='erc_mud_table_stats'").get();
      if (!have) { try { db.close(); } catch {}; sendJson(res, { exists:true, ready:false, tables:0, top:[] }); return; }
      const total = db.prepare('SELECT COUNT(1) AS c FROM erc_mud_table_stats').get().c|0;
      // Optional limit param (?limit=all or ?limit=500)
      let limit = 10;
      try {
        const q = query || {};
        if (q.limit === 'all') limit = 100000;
        else if (q.limit != null) {
          const n = parseInt(String(q.limit), 10);
          if (Number.isFinite(n) && n > 0) limit = Math.min(100000, n);
        }
      } catch {}
      const sql = `SELECT table_id, namespace, name, rows, unique_keys FROM erc_mud_table_stats ORDER BY rows DESC LIMIT ${limit}`;
      const top = db.prepare(sql).all();
      try { db.close(); } catch {}
      sendJson(res, { exists:true, ready:true, tables: total, returned: top.length, top });
    } catch (e) {
      sendJson(res, { exists:false });
    }
    return;
  }
  if (pathname === '/api/mud-latest') {
    try {
  // Serve recent cached snapshot if within TTL
  if (lastMudLatest && (Date.now() - lastMudLatestAt) < MUD_TTL_MS) {
    sendJson(res, lastMudLatest);
    return;
  }
  const OUT_DB = process.env.DECODED_DB_PATH || path.resolve(REPO_ROOT, 'data/local-indexer-decoded.db');
  if (!fs.existsSync(OUT_DB)) { sendJson(res, { exists:false }); return; }
  let db = openDecodedDb(true);
  if (!db) { sendJson(res, lastMudLatest ? { ...lastMudLatest, stale:true } : { exists:true, limited:true }); return; }
      const haveLatest = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='erc_mud_latest'").get();
      const haveValues = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='erc_mud_values'").get();
      const haveStats = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='erc_mud_table_stats'").get();
      const rLatest = haveLatest ? (db.prepare('SELECT COUNT(1) AS c, MAX(block_number) AS tip FROM erc_mud_latest').get() || { c:0, tip:0 }) : { c:0, tip:0 };
      const rValues = haveValues ? (db.prepare('SELECT COUNT(1) AS c FROM erc_mud_values').get() || { c:0 }) : { c:0 };
      // Helper to map Wave-1 names to typed table names (extended with value-typed tables)
      const nameToTyped = {
        Entity: 'mud_entity',
        OwnershipByObjec: 'mud_ownership',
        Role: 'mud_role',
        Characters: 'mud_characters',
        CharactersByAcco: 'mud_characters_by_acco',
        NetworkNodeByAss: 'mud_node_by_ass',
        NetworkNodeEnerg: 'mud_node_energy',
        SmartGateConfig: 'mud_smart_gate_config',
        AccessConfig: 'mud_access_config',
        Inventory: 'mud_inventory',
        Fuel: 'mud_fuel',
        DeployableState: 'mud_deployable_state',
      };
      let wave = [];
      try {
        const p = path.resolve(ROOT, 'mud_tables_wave1.json');
        const raw = fs.readFileSync(p, 'utf8');
        wave = JSON.parse(raw);
      } catch {}
      // Per-table counts for wave-1
      const per = [];
      let typedSum = 0;
      for (const t of (Array.isArray(wave)? wave : [])){
        let tableId = null;
        if (haveStats){
          try { const g = db.prepare('SELECT table_id FROM erc_mud_table_stats WHERE namespace=? AND name=?').get(t.namespace, t.name); tableId = g && g.table_id || null; } catch {}
        }
        if (!tableId){
          const toHex = (s)=> Buffer.from(String(s||''), 'utf8');
          const pad32 = (b)=> (b.length>=32? b.slice(0,32): Buffer.concat([b, Buffer.alloc(32-b.length)]));
          tableId = '0x' + Buffer.concat([pad32(toHex(t.namespace)), pad32(toHex(t.name))]).toString('hex');
        }
        let latest=0, values=0, tip=0, typed=0;
        if (haveLatest){ try { const r = db.prepare('SELECT COUNT(1) AS c, MAX(block_number) AS tip FROM erc_mud_latest WHERE table_id=?').get(tableId); latest = r&&r.c||0; tip = r&&r.tip||0; } catch {} }
        if (haveValues){ try { const r = db.prepare('SELECT COUNT(1) AS c FROM erc_mud_values WHERE table_id=?').get(tableId); values = r&&r.c||0; } catch {} }
        // Typed presence coverage (if corresponding typed table exists)
        try {
          const typedTable = nameToTyped[t.name];
          if (typedTable) {
            const haveTyped = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(typedTable);
            if (haveTyped) {
              const r = db.prepare(`SELECT COUNT(1) AS c FROM ${typedTable}`).get();
              typed = r && r.c || 0;
            }
          }
        } catch {}
        typedSum += typed|0;
        per.push({ namespace:t.namespace, name:t.name, tableId, latest, values, typed, tip });
      }
      try { db.close(); } catch {}
      const out = { exists:true, wave: per, totals: { latest: rLatest.c||0, values: rValues.c||0, typed: typedSum||0, tip: rLatest.tip||0 } };
      lastMudLatest = out; lastMudLatestAt = Date.now();
      sendJson(res, out);
    } catch (e) {
      // Fallback to last-good snapshot
      if (lastMudLatest && (Date.now() - lastMudLatestAt) < 15000) { sendJson(res, { ...lastMudLatest, stale:true }); }
      else sendJson(res, { exists:false });
    }
    return;
  }
  // Unified ECS: all tables with the same metrics shape as Wave-1 entries
  if (pathname === '/api/mud-ecs') {
    try {
      // Serve recent cached snapshot if within TTL
      if (lastMudEcs && (Date.now() - lastMudEcsAt) < MUD_TTL_MS) {
        sendJson(res, lastMudEcs);
        return;
      }
      const OUT_DB = process.env.DECODED_DB_PATH || path.resolve(REPO_ROOT, 'data/local-indexer-decoded.db');
      if (!fs.existsSync(OUT_DB)) { sendJson(res, { exists:false }); return; }
      let db = openDecodedDb(true);
      if (!db) { sendJson(res, lastMudEcs ? { ...lastMudEcs, stale:true } : { exists:true, limited:true }); return; }
      const haveStats = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='erc_mud_table_stats'").get();
      const haveLatest = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='erc_mud_latest'").get();
      const haveValues = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='erc_mud_values'").get();
      if (!haveStats) { try{ db.close(); }catch{}; sendJson(res, { exists:true, ready:false, items:[] }); return; }
      const q = query || {};
      let limit = 500;
      if (q.limit === 'all') limit = 100000;
      else if (q.limit != null) { const n = parseInt(String(q.limit),10); if (Number.isFinite(n) && n>0) limit = Math.min(100000, n); }
      const rows = db.prepare(`SELECT table_id, namespace, name FROM erc_mud_table_stats ORDER BY rows DESC LIMIT ${limit}`).all();
      // Typed table name mapping (best-effort)
      const nameToTyped = {
        Entity: 'mud_entity',
        OwnershipByObjec: 'mud_ownership',
        Role: 'mud_role',
        Characters: 'mud_characters',
        CharactersByAcco: 'mud_characters_by_acco',
        NetworkNodeByAss: 'mud_node_by_ass',
        NetworkNodeEnerg: 'mud_node_energy',
        SmartGateConfig: 'mud_smart_gate_config',
        AccessConfig: 'mud_access_config',
        Inventory: 'mud_inventory',
        Fuel: 'mud_fuel',
        DeployableState: 'mud_deployable_state',
      };
      const items = [];
      for (const r of rows){
        let latest=0, values=0, tip=0, typed=0;
        if (haveLatest){ try { const x = db.prepare('SELECT COUNT(1) AS c, MAX(block_number) AS tip FROM erc_mud_latest WHERE table_id=?').get(r.table_id); latest = x&&x.c||0; tip = x&&x.tip||0; } catch {} }
        if (haveValues){ try { const x = db.prepare('SELECT COUNT(1) AS c FROM erc_mud_values WHERE table_id=?').get(r.table_id); values = x&&x.c||0; } catch {} }
        try {
          const typedTable = nameToTyped[r.name];
          if (typedTable) {
            const haveTyped = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(typedTable);
            if (haveTyped) { const t = db.prepare(`SELECT COUNT(1) AS c FROM ${typedTable}`).get(); typed = t&&t.c||0; }
          }
        } catch {}
        items.push({ namespace: r.namespace, name: r.name, tableId: r.table_id, latest, values, typed, tip });
      }
      try { db.close(); } catch {}
      const resp = { exists:true, returned: items.length, items };
      lastMudEcs = resp; lastMudEcsAt = Date.now();
      sendJson(res, resp);
    } catch (e) {
      if (lastMudEcs && (Date.now() - lastMudEcsAt) < 15000) { sendJson(res, { ...lastMudEcs, stale:true }); }
      else sendJson(res, { exists:false });
    }
    return;
  }
  // Tables needing typed decoding: latest/value rows exist but typed==0
  if (pathname === '/api/mud-needs-decoding') {
    try {
      if (lastMudNeeds && (Date.now() - lastMudNeedsAt) < MUD_TTL_MS) { sendJson(res, lastMudNeeds); return; }
      const OUT_DB = process.env.DECODED_DB_PATH || path.resolve(REPO_ROOT, 'data/local-indexer-decoded.db');
      if (!fs.existsSync(OUT_DB)) { sendJson(res, { exists:false }); return; }
      let db = openDecodedDb(true);
      if (!db) { sendJson(res, lastMudNeeds ? { ...lastMudNeeds, stale:true } : { exists:true, limited:true }); return; }
      const haveStats = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='erc_mud_table_stats'").get();
      const haveLatest = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='erc_mud_latest'").get();
      const haveValues = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='erc_mud_values'").get();
      if (!haveStats) { try{ db.close(); }catch{}; sendJson(res, { exists:true, ready:false, items:[] }); return; }
      const q = query || {};
      let limit = 100; // default top 100
      if (q.limit === 'all') limit = 100000;
      else if (q.limit != null) { const n = parseInt(String(q.limit),10); if (Number.isFinite(n) && n>0) limit = Math.min(100000, n); }
      const rows = db.prepare(`SELECT table_id, namespace, name FROM erc_mud_table_stats ORDER BY rows DESC LIMIT ${limit}`).all();
      const nameToTyped = {
        Entity: 'mud_entity',
        OwnershipByObjec: 'mud_ownership',
        Role: 'mud_role',
        Characters: 'mud_characters',
        CharactersByAcco: 'mud_characters_by_acco',
        NetworkNodeByAss: 'mud_node_by_ass',
        NetworkNodeEnerg: 'mud_node_energy',
        SmartGateConfig: 'mud_smart_gate_config',
        AccessConfig: 'mud_access_config',
        Inventory: 'mud_inventory',
        Fuel: 'mud_fuel',
        DeployableState: 'mud_deployable_state',
      };
      const items = [];
      for (const r of rows){
        let latest=0, values=0, typed=0, tip=0;
        if (haveLatest){ try { const x = db.prepare('SELECT COUNT(1) AS c, MAX(block_number) AS tip FROM erc_mud_latest WHERE table_id=?').get(r.table_id); latest = x&&x.c||0; tip = x&&x.tip||0; } catch {} }
        if (haveValues){ try { const x = db.prepare('SELECT COUNT(1) AS c FROM erc_mud_values WHERE table_id=?').get(r.table_id); values = x&&x.c||0; } catch {} }
        if (latest>0 || values>0){
          try {
            const typedTable = nameToTyped[r.name];
            if (typedTable) {
              const haveTyped = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(typedTable);
              if (haveTyped) { const t = db.prepare(`SELECT COUNT(1) AS c FROM ${typedTable}`).get(); typed = t&&t.c||0; }
            }
          } catch {}
          if ((typed|0) === 0) {
            items.push({ namespace: r.namespace, name: r.name, tableId: r.table_id, latest, values, typed, tip });
          }
        }
      }
      // Sort items by (values or latest) desc so biggest gaps first
      items.sort((a,b)=> (Math.max(b.values|0, b.latest|0)) - (Math.max(a.values|0, a.latest|0)));
      try { db.close(); } catch {}
      const resp = { exists:true, returned: items.length, items };
      lastMudNeeds = resp; lastMudNeedsAt = Date.now();
      sendJson(res, resp);
    } catch (e) {
      if (lastMudNeeds && (Date.now() - lastMudNeedsAt) < 15000) { sendJson(res, { ...lastMudNeeds, stale:true }); }
      else sendJson(res, { exists:false });
    }
    return;
  }
  if (pathname === '/api/mud-typed') {
    try {
      const OUT_DB = process.env.DECODED_DB_PATH || path.resolve(REPO_ROOT, 'data/local-indexer-decoded.db');
      if (!fs.existsSync(OUT_DB)) { sendJson(res, { exists:false }); return; }
      let db = openDecodedDb(true);
      if (!db) { sendJson(res, lastMudTyped ? { ...lastMudTyped, stale:true } : { exists:true, limited:true }); return; }
      const haveLatest = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='erc_mud_latest'").get();
      const tip = haveLatest ? (db.prepare('SELECT MAX(block_number) AS tip FROM erc_mud_latest').get().tip|0) : 0;
      const q = query || {};
      let limit = 50;
      if (q.limit === 'all') limit = 100000;
      else if (q.limit != null) { const n = parseInt(String(q.limit),10); if (Number.isFinite(n) && n>0) limit = Math.min(100000,n); }
      const rows = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'mud_%' ORDER BY name ASC").all();
      const items = [];
      for (const r of rows){
        const name = r.name;
        // skip internal helper tables if any appear
        if (name === 'mud_entity' || name === 'mud_ownership' || name.startsWith('mud_')) {
          try {
            const cnt = db.prepare(`SELECT COUNT(1) AS c FROM ${name}`).get().c|0;
            items.push({ table: name, rows: cnt });
          } catch {}
        }
      }
      // Sort by rows desc and apply limit
      items.sort((a,b)=> (b.rows|0)-(a.rows|0));
      const out = items.slice(0, limit);
      try { db.close(); } catch {}
      const resp = { exists:true, tip, totalTables: items.length, returned: out.length, items: out };
      lastMudTyped = resp; lastMudTypedAt = Date.now();
      sendJson(res, resp);
    } catch (e) {
      if (lastMudTyped && (Date.now() - lastMudTypedAt) < 15000) { sendJson(res, { ...lastMudTyped, stale:true }); }
      else sendJson(res, { exists:false });
    }
    return;
  }
  if (pathname === '/api/erc20-stats') {
    try {
      const OUT_DB = process.env.DECODED_DB_PATH || path.resolve(REPO_ROOT, 'data/local-indexer-decoded.db');
      const exists = fs.existsSync(OUT_DB);
      if (!exists) { sendJson(res, { exists:false }); return; }
      const TRANSFER_SIG = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
      const APPROVAL_SIG = '0x8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925';
      const now = Date.now();
      const ttlMs = 300_000; // 5 minutes for heavy totals/top
      let db = openDecodedDb(true);
      if (!db) { sendJson(res, lastErc20 ? { exists:true, ...lastErc20, stale:true } : { exists:true, limited:true }); return; }
      const tip = db.prepare('SELECT MAX(block_number) AS m FROM decoded_events').get().m|0;
      const window = 10000;
      const recentTransfers = db.prepare('SELECT COUNT(1) AS c FROM decoded_events WHERE lower(topic0)=? AND block_number BETWEEN ? AND ?').get(TRANSFER_SIG, Math.max(0, tip-window+1), tip).c|0;
      const recentApprovals = db.prepare('SELECT COUNT(1) AS c FROM decoded_events WHERE lower(topic0)=? AND block_number BETWEEN ? AND ?').get(APPROVAL_SIG, Math.max(0, tip-window+1), tip).c|0;
      if (!lastErc20 || (now - lastErc20At) > ttlMs) {
        const totalTransfers = db.prepare('SELECT COUNT(1) AS c FROM decoded_events WHERE lower(topic0)=?').get(TRANSFER_SIG).c|0;
        const totalApprovals = db.prepare('SELECT COUNT(1) AS c FROM decoded_events WHERE lower(topic0)=?').get(APPROVAL_SIG).c|0;
        const topTokens = db.prepare('SELECT address AS token, COUNT(1) AS c FROM decoded_events WHERE lower(topic0)=? GROUP BY address ORDER BY c DESC LIMIT 5').all(TRANSFER_SIG);
        lastErc20 = { totalTransfers, totalApprovals, topTokens };
        lastErc20At = now;
      }
      try { db.close(); } catch {}
      sendJson(res, { exists:true, totalTransfers: lastErc20.totalTransfers, totalApprovals: lastErc20.totalApprovals, recent: { windowBlocks: window, transfers: recentTransfers, approvals: recentApprovals }, topTokens: lastErc20.topTokens });
    } catch (e) {
      sendJson(res, { exists:false });
    }
    return;
  }
  // World API (DLT) counts for dashboard card
  if (pathname === '/api/worldapi-stats') {
    try {
      if (!fs.existsSync(WORLD_API_META)) { sendJson(res, { exists:false, counts:{}, totalRows:0, updatedAt:null }); return; }
      const raw = readJsonSafe(WORLD_API_META) || {};
      const counts = (raw && typeof raw.counts === 'object') ? raw.counts : {};
      const baseKeys = ['solarsystems','tribes','types','fuels','smartassemblies','smartcharacters','killmails'];
      let totalRows = 0;
      for (const k of baseKeys){ const v = Number(counts[k]); if (Number.isFinite(v)) totalRows += v; }
      const updatedAt = raw.generatedAt || raw.updatedAt || null;
      sendJson(res, { exists:true, counts, totalRows, updatedAt, base: raw.base || null });
    } catch (e) {
      sendJson(res, { exists:false, counts:{}, totalRows:0 });
    }
    return;
  }
  // static
  serveStatic(req, res);
});

const HOST = process.env.HOST || '127.0.0.1';
try {
  server.on('error', (err) => {
    try {
      const p = path.resolve(REPO_ROOT, 'scratch/metrics_server.err.log');
      fs.mkdirSync(path.resolve(REPO_ROOT, 'scratch'), { recursive: true });
      fs.appendFileSync(p, `${new Date().toISOString()} server error: ${String(err && err.stack || err)}\n`);
    } catch {}
    // Exit so supervisor can restart on a new port or after cleanup
    try { dbDriver && dbDriver.close && dbDriver.close(); } catch {}
    process.exit(1);
  });
} catch {}
server.listen(PORT, HOST, () => {
  console.log(`[metrics] listening on http://${HOST}:${PORT}`);
});

process.on('SIGINT', () => { try { dbDriver && dbDriver.close && dbDriver.close(); } catch {} process.exit(0); });
process.on('uncaughtException', (err) => {
  try {
    const p = path.resolve(REPO_ROOT, 'scratch/metrics_server.err.log');
    fs.mkdirSync(path.resolve(REPO_ROOT, 'scratch'), { recursive: true });
    fs.appendFileSync(p, `${new Date().toISOString()} uncaughtException: ${String(err && err.stack || err)}\n`);
  } catch {}
  process.exit(1);
});
process.on('unhandledRejection', (reason) => {
  try {
    const p = path.resolve(REPO_ROOT, 'scratch/metrics_server.err.log');
    fs.mkdirSync(path.resolve(REPO_ROOT, 'scratch'), { recursive: true });
    fs.appendFileSync(p, `${new Date().toISOString()} unhandledRejection: ${String(reason && reason.stack || reason)}\n`);
  } catch {}
  // keep running; sample loop guards most errors
});
