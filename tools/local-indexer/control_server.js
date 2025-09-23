/*
 Lightweight control server to start/monitor local ingester.
 Purpose: decouple Start button from the main metrics server restarts.
 Endpoints (with CORS):
  - GET /proc -> { running, updatedAgoSec, lag }
  - POST /start -> { status: 'started' }
*/
/* eslint-disable no-console */
const http = require('http');
const url = require('url');
const path = require('path');
const fs = require('fs');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const HOST = process.env.CONTROL_HOST || '127.0.0.1';
const PORT = Number(process.env.CONTROL_PORT || 8799);

const STATUS_FILE = process.env.STATUS_PATH || path.resolve(REPO_ROOT, 'data/local-indexer-status.json');
const HISTORY_FILE = process.env.HISTORY_PATH || path.resolve(REPO_ROOT, 'data/local-indexer-status-history.json');
const CONTROL_PATH = process.env.CONTROL_PATH || path.resolve(REPO_ROOT, 'data/local-indexer-control.json');
const PID_PATH = process.env.PID_PATH || path.resolve(REPO_ROOT, 'data/local-indexer-ingest.pid');
const OUT_LOG = process.env.OUT_LOG || path.resolve(REPO_ROOT, 'data/ingest_raw.out.log');
const ERR_LOG = process.env.ERR_LOG || path.resolve(REPO_ROOT, 'data/ingest_raw.err.log');

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function sendJson(res, obj, code = 200) {
  cors(res);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}

function readJsonSafe(p) {
  try { if (!fs.existsSync(p)) return null; return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; }
}

function getProc() {
  const now = Date.now();
  const s = readJsonSafe(STATUS_FILE) || {};
  const ts = s && s.updatedAt ? Date.parse(s.updatedAt) : null;
  const updatedAgoSec = ts && isFinite(ts) ? Math.max(0, Math.round((now - ts) / 1000)) : null;
  const head = Number.isFinite(Number(s.head)) ? Number(s.head) : null;
  const idx = s && s.cursor && Number.isFinite(Number(s.cursor.last_block_number)) ? Number(s.cursor.last_block_number) : null;
  const lag = head != null && idx != null ? Math.max(0, head - idx) : null;
  const running = updatedAgoSec != null ? (updatedAgoSec <= 120) : false;
  return { running, updatedAgoSec, lag };
}

function computeSummary() {
  const now = Date.now();
  const s = readJsonSafe(STATUS_FILE) || {};
  const h = readJsonSafe(HISTORY_FILE) || [];
  let indexedHead = null;
  if (s && s.cursor && Number.isFinite(Number(s.cursor.last_block_number))) indexedHead = Number(s.cursor.last_block_number);
  if (indexedHead == null && Array.isArray(h) && h.length) indexedHead = Number(h[h.length - 1].block || 0);
  const chainHead = Number.isFinite(Number(s.head)) ? Number(s.head) : (Number.isFinite(Number(s.safeHead)) ? Number(s.safeHead) : null);
  // Compute blocks per minute over up to 5 minutes of history
  let blocksPerMin = 0;
  if (Array.isArray(h) && h.length >= 2) {
    const cutoff = now - 5 * 60_000;
    const recent = h.filter(r => { const t = Date.parse(r.t || 0); return Number.isFinite(t) && t >= cutoff; });
    if (recent.length >= 2) {
      const a = recent[0], b = recent[recent.length - 1];
      const db = Math.max(0, Number(b.block || 0) - Number(a.block || 0));
      const dtSec = Math.max(1, Math.round((Date.parse(b.t || 0) - Date.parse(a.t || 0)) / 1000));
      blocksPerMin = Math.round((db / dtSec) * 60);
    }
  }
  const lag = (chainHead != null && indexedHead != null) ? Math.max(0, chainHead - indexedHead) : 0;
  const statusFreshSec = (function(){ try { const ts = s && s.updatedAt ? Date.parse(s.updatedAt) : null; return ts ? Math.round((now - ts)/1000) : null; } catch { return null; } })();
  return {
    chainName: 'Local Frontier (EVM)',
    rpcUrl: process.env.RPC_URL || 'n/a',
    rpcSource: process.env.RPC_URL ? 'env' : 'disabled',
    chainHead: chainHead,
    indexedHead: indexedHead || 0,
    blocksPerMin: blocksPerMin || 0,
    chainBlocksPerMin: 0,
    effectiveBlocksPerMin: blocksPerMin || 0,
    errorsPerMin: 0,
    reorgDepth: 0,
    queueDepth: lag,
    start: now,
    etaSec: 0,
    netLatencyMs: null,
    rpcError: null,
    rpcFreshSec: null,
    rpcState: 'disabled',
    statusFreshSec,
  };
}

async function startIngest() {
  // Ensure control flags reset and pid cleared
  try { fs.mkdirSync(path.resolve(REPO_ROOT, 'data'), { recursive: true }); } catch {}
  try { fs.writeFileSync(CONTROL_PATH, JSON.stringify({ paused: false, stop: false })); } catch {}
  try { if (fs.existsSync(PID_PATH)) fs.unlinkSync(PID_PATH); } catch {}

  const env = { ...process.env };
  // Defaults that the ingester expects; safe fallbacks
  if (!env.RPC_URL || env.RPC_URL === 'True' || env.RPC_URL === 'true') env.RPC_URL = 'https://rpc.pyropechain.com';
  if (!env.CHAIN_ID) env.CHAIN_ID = '695569';
  if (!env.WORLD_ADDRESS) env.WORLD_ADDRESS = '0x7085f3e652987f656fB8dEE5aA6592197Bb75de8';
  env.LOCAL_DB_PATH = env.LOCAL_DB_PATH || path.resolve(REPO_ROOT, 'data/local-indexer.db');
  env.STATUS_PATH = STATUS_FILE;
  env.HISTORY_PATH = HISTORY_FILE;
  env.CONTROL_PATH = CONTROL_PATH;
  env.PID_PATH = PID_PATH;

  let child = null;
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
    } else {
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
    }
  } else {
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
  }
  try { child && child.unref && child.unref(); } catch {}
  return { status: 'started' };
}

const server = http.createServer(async (req, res) => {
  cors(res);
  const { pathname } = url.parse(req.url, true);
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
  if (req.method === 'GET' && pathname === '/proc') {
    return sendJson(res, getProc());
  }
  if (req.method === 'POST' && (pathname === '/start' || pathname === '/control/start-ingest')) {
    try {
      const r = await startIngest();
      return sendJson(res, r);
    } catch (e) {
      return sendJson(res, { error: String(e && e.message || e) }, 500);
    }
  }
  if (req.method === 'GET' && pathname === '/summary') {
    return sendJson(res, computeSummary());
  }
  if (req.method === 'GET' && (pathname === '/' || pathname === '/index.html')) {
    cors(res);
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(`<html><head><title>Local Indexer Control</title></head><body>
      <h3>Local Indexer Control</h3>
      <ul>
        <li>POST <code>/start</code></li>
        <li>GET <code>/proc</code></li>
        <li>GET <code>/health</code></li>
      </ul>
    </body></html>`);
    return;
  }
  if (req.method === 'GET' && pathname === '/health') {
    return sendJson(res, { status: 'ok' });
  }
  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not found');
});

server.listen(PORT, HOST, () => {
  console.log(`[control] listening on http://${HOST}:${PORT}`);
});
