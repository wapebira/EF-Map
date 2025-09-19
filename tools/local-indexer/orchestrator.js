#!/usr/bin/env node
/*
 Auto Orchestrator for Local Indexer (Windows-friendly)
 - Starts and supervises: status_server, metrics_server, control_server, ingest_raw, decode_apply
 - Restarts crashed processes with exponential backoff (per-process)
 - Health checks:
    status  -> GET http://127.0.0.1:8731/api/health
    metrics -> GET http://127.0.0.1:8733/api/health
    control -> GET http://127.0.0.1:8799/health
    ingest  -> STATUS_PATH.updatedAt freshness
    decode  -> DECODE_STATUS_PATH.updatedAt freshness
 - Clean exit: kills children on SIGINT/SIGTERM
*/
/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
const net = require('net');

const ROOT = path.resolve(__dirname, '../../');
const DATA = path.join(ROOT, 'data');
const SCRATCH = path.join(ROOT, 'scratch');
try { fs.mkdirSync(DATA, { recursive: true }); } catch {}
try { fs.mkdirSync(SCRATCH, { recursive: true }); } catch {}

const STATUS_PATH = process.env.STATUS_PATH || path.join(DATA, 'local-indexer-status.json');
const HISTORY_PATH = process.env.HISTORY_PATH || path.join(DATA, 'local-indexer-status-history.json');
const DECODE_STATUS_PATH = process.env.DECODE_STATUS_PATH || path.join(DATA, 'local-indexer-decode-status.json');
const PID_INGEST = process.env.PID_PATH || path.join(DATA, 'local-indexer-ingest.pid');
const PID_DECODE = process.env.DECODE_PID_PATH || path.join(DATA, 'local-indexer-decode.pid');
const PID_ORCH = path.join(DATA, 'local-indexer-orchestrator.pid');
const METRICS_PORT_FILE = path.join(SCRATCH, 'metrics_port.json');

const PORT_STATUS = Number(process.env.STATUS_PORT || 8736);
let PORT_METRICS = Number(process.env.METRICS_PORT || process.env.PORT || 8733);
try {
  // Load persisted port if present
  const mp = JSON.parse(fs.readFileSync(METRICS_PORT_FILE, 'utf8'));
  if (mp && Number.isFinite(Number(mp.port))) PORT_METRICS = Number(mp.port);
} catch {}
function persistMetricsPort(port){ try { fs.mkdirSync(SCRATCH, { recursive: true }); fs.writeFileSync(METRICS_PORT_FILE, JSON.stringify({ port })); } catch {} }
const PORT_CONTROL = Number(process.env.CONTROL_PORT || 8799);

// Write orchestrator PID for easy stop
try { fs.writeFileSync(PID_ORCH, String(process.pid)); } catch {}

function nowIso() { return new Date().toISOString(); }
function readJson(p, fb) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fb; } }
function isFreshIso(iso, maxAgeMs) {
  try { const t = Date.parse(iso); return Number.isFinite(t) && (Date.now() - t) <= maxAgeMs; } catch { return false; }
}
function httpGetJson(url) {
  return new Promise((resolve) => {
    try {
      const req = http.get(url, { headers: { 'cache-control': 'no-cache' } }, (res) => {
        let buf = '';
        res.on('data', (d) => { buf += d.toString('utf8'); });
        res.on('end', () => {
          try { resolve(JSON.parse(buf || '{}')); } catch { resolve(null); }
        });
      });
      req.on('error', () => resolve(null));
      req.setTimeout(2000, () => { try { req.destroy(); } catch {} resolve(null); });
    } catch { resolve(null); }
  });
}

// Generic supervised process
class SupervisedProc {
  constructor(name, startFn, healthFn, opts = {}) {
    this.name = name;
    this.startFn = startFn;
    this.healthFn = healthFn;
    this.backoffMs = 500; // start small
    this.maxBackoffMs = 15000;
    this.proc = null;
    this.stopped = false;
    this.opts = opts;
  this.graceMs = Number(opts.graceMs || 5000); // ignore health failures shortly after start
    this.lastStartAt = 0;
    this.restarting = false; // true when a restart has been scheduled
    this.restartTimer = null; // active timer handle for a pending restart
    this.starting = false; // prevent concurrent start() calls
  // Restart rate limiting (simple rolling window)
  this.restartHistory = []; // array of timestamps when restart scheduled
  this.maxRestartsPerMin = Number(opts.maxRestartsPerMin || 30);
  this.onRestartHook = typeof opts.onRestart === 'function' ? opts.onRestart : null;
  // Require N consecutive failed health checks before restart (to avoid transient blips)
  this.failThreshold = Number(opts.failThreshold || 1);
  this.failCount = 0;
  }
  log(msg) { try { fs.appendFileSync(path.join(SCRATCH, 'orchestrator.log'), `${nowIso()} [${this.name}] ${msg}\n`); } catch {} }
  async start() {
    if (this.stopped) return;
    // Avoid concurrent starts or starting while an instance is alive
    if (this.starting) { this.log('start skipped (already starting)'); return; }
    // Treat a process with exitCode === null as still running; don't double-spawn
    if (this.proc && this.proc.exitCode === null) { this.log('start skipped (already running)'); return; }
    try {
      this.starting = true;
      this.proc = await this.startFn();
      this.log(`started pid=${this.proc && this.proc.pid}`);
      this.backoffMs = 500; // reset on success
      this.lastStartAt = Date.now();
      this.restarting = false; // clear restart intent now that we've (re)started
      if (this.restartTimer) { try { clearTimeout(this.restartTimer); } catch {} this.restartTimer = null; }
      if (this.proc && this.proc.on) {
        this.proc.on('exit', (code, signal) => {
          this.log(`exit code=${code} signal=${signal}`);
          // Only schedule a restart if we didn't already plan one
          if (!this.stopped && !this.restarting) this.scheduleRestart();
          // Clear current handle to allow subsequent start
          this.proc = null;
        });
        this.proc.on('error', (e) => { this.log(`error ${e && e.message}`); });
      }
    } catch (e) {
      this.log(`start error: ${e && e.message}`);
      this.scheduleRestart();
    } finally {
      this.starting = false;
    }
  }
  scheduleRestart() {
    if (this.stopped) return;
    // De-dupe pending restarts
    if (this.restartTimer) { this.log('restart already scheduled'); return; }
    // Rate limit: if too many restarts in last minute, back off to maxBackoffMs and log
    const now = Date.now();
    this.restartHistory = this.restartHistory.filter((t) => now - t < 60_000);
    if (this.restartHistory.length >= this.maxRestartsPerMin) {
      this.log(`restart rate high (${this.restartHistory.length}/min), backing off to ${this.maxBackoffMs} ms`);
    }
    const ms = Math.min(this.maxBackoffMs, this.backoffMs);
    this.backoffMs = Math.min(this.maxBackoffMs, Math.round(ms * 1.7));
    this.restarting = true;
    this.log(`restart in ${ms} ms`);
  // Allow proc-specific side effects on restart (e.g., rotate ports for metrics)
  try { this.onRestartHook && this.onRestartHook({ when: now, countMin: this.restartHistory.length }); } catch {}
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null;
      this.restarting = false; // will be set true again by restart() if called explicitly
      this.restartHistory.push(Date.now());
      this.start();
    }, ms);
  }
  async check() {
    if (this.stopped) return;
    try {
      // Skip health during initial grace window after start to allow servers to bind/listen
      if (this.lastStartAt && (Date.now() - this.lastStartAt) < this.graceMs) return;
      // Skip health checks while starting or restarting to avoid flapping
      if (this.starting || this.restarting) return;
      const ok = await this.healthFn();
      if (!ok) {
        this.failCount += 1;
        if (this.failCount >= this.failThreshold) {
          this.log(`health FAILED x${this.failCount}, restarting`);
          this.failCount = 0;
          this.restart();
        } else {
          this.log(`health soft-fail x${this.failCount}/${this.failThreshold}`);
        }
      } else {
        // Reset on success
        if (this.failCount !== 0) this.failCount = 0;
      }
    } catch {
      this.log('health threw, restarting');
      this.restart();
    }
  }
  restart() {
    if (this.stopped) return;
    if (this.restarting) { this.log('restart skipped (already restarting)'); return; }
    this.restarting = true;
    try { if (this.proc && !this.proc.killed) this.proc.kill('SIGTERM'); } catch {}
    this.scheduleRestart();
  }
  stop() {
    this.stopped = true;
    if (this.restartTimer) { try { clearTimeout(this.restartTimer); } catch {} this.restartTimer = null; }
    try { if (this.proc && !this.proc.killed) this.proc.kill('SIGTERM'); } catch {}
  }
}

// Start functions
function startStatus() {
  const env = { ...process.env, STATUS_PORT: String(PORT_STATUS) };
  const p = spawn(process.execPath || 'node', [path.join(ROOT, 'tools/local-indexer/status_server.js')], {
    cwd: ROOT, env, stdio: 'ignore'
  });
  return p;
}
async function healthStatus() {
  const j = await httpGetJson(`http://127.0.0.1:${PORT_STATUS}/api/health`);
  return !!(j && j.ok === true);
}

function startMetrics() {
  // Persist current port so external probes know where to look
  persistMetricsPort(PORT_METRICS);
  const env = { ...process.env, PORT: String(PORT_METRICS), STATUS_FILE: STATUS_PATH };
  // Provide explicit decoded DB path default to avoid module confusion
  env.DECODED_DB_PATH = env.DECODED_DB_PATH || path.join(DATA, 'local-indexer-decoded.db');
  // Capture metrics server logs for diagnostics
  let stdio = 'ignore';
  try {
    const outPath = path.join(SCRATCH, 'metrics_server.out.log');
    const errPath = path.join(SCRATCH, 'metrics_server.err.log');
    const outFd = fs.openSync(outPath, 'a');
    const errFd = fs.openSync(errPath, 'a');
    stdio = ['ignore', outFd, errFd];
  } catch {}
  const args = [path.join(ROOT, 'tools/local-indexer/metrics_server.js'), '--port', String(PORT_METRICS)];
  try {
    const p = spawn(process.execPath || 'node', args, { cwd: ROOT, env, stdio, windowsHide: true });
    return p;
  } catch (e) {
    try { fs.appendFileSync(path.join(SCRATCH, 'orchestrator.log'), `${nowIso()} [metrics] spawn error ${e && e.message}\n`); } catch {}
    throw e;
  }
}
async function healthMetrics() {
  // Always read latest persisted port (in case it rotated)
  try { const mp = JSON.parse(fs.readFileSync(METRICS_PORT_FILE, 'utf8')); if (mp && Number.isFinite(Number(mp.port))) PORT_METRICS = Number(mp.port); } catch {}
  const j = await httpGetJson(`http://127.0.0.1:${PORT_METRICS}/api/health`);
  return !!(j && j.status === 'ok');
}

function startControl() {
  const env = { ...process.env, CONTROL_PORT: String(PORT_CONTROL) };
  const p = spawn(process.execPath || 'node', [path.join(ROOT, 'tools/local-indexer/control_server.js')], {
    cwd: ROOT, env, stdio: 'ignore'
  });
  return p;
}
async function healthControl() {
  const j = await httpGetJson(`http://127.0.0.1:${PORT_CONTROL}/health`);
  return !!(j && j.status === 'ok');
}

function startIngest() {
  // Always spawn the Node ingestor directly so we keep the real child handle
  // (Using a launcher script causes the child to exit immediately and triggers respawn loops)
  const env = { ...process.env };
  const p = spawn(process.execPath || 'node', [path.join(ROOT, 'tools/local-indexer/ingest_raw.js')], {
    cwd: ROOT,
    env,
    stdio: 'ignore',
    windowsHide: true,
  });
  return p;
}
async function healthIngest() {
  const s = readJson(STATUS_PATH, null);
  const fresh = s && s.updatedAt && isFreshIso(s.updatedAt, 120_000);
  return !!fresh;
}

function startDecode() {
  // Start only if local DB exists to avoid immediate fail
  const dbPath = process.env.LOCAL_DB_PATH || path.join(DATA, 'local-indexer.db');
  if (!fs.existsSync(dbPath)) return null;
  const env = { ...process.env };
  // Ensure paths are explicit for decode process
  env.LOCAL_DB_PATH = env.LOCAL_DB_PATH || dbPath;
  env.DECODE_STATUS_PATH = env.DECODE_STATUS_PATH || DECODE_STATUS_PATH;
  env.STATUS_PATH = env.STATUS_PATH || STATUS_PATH;
  env.DECODE_HISTORY_PATH = env.DECODE_HISTORY_PATH || path.join(DATA, 'local-indexer-decode-history.json');
  env.DECODE_PID_PATH = env.DECODE_PID_PATH || PID_DECODE;
  const p = spawn(process.execPath || 'node', [path.join(ROOT, 'tools/local-indexer/decode_apply.js')], { cwd: ROOT, stdio: 'ignore', env });
  return p;
}
async function healthDecode() {
  const s = readJson(DECODE_STATUS_PATH, null);
  if (!s) return false;
  // If decode finished, consider it healthy; otherwise require recent update
  if (s.state && String(s.state).startsWith('decode_') && String(s.state).includes('done')) return true;
  const fresh = s.updatedAt && isFreshIso(s.updatedAt, 60_000);
  return !!fresh;
}

// Procs
const procs = {
  status: new SupervisedProc('status', startStatus, healthStatus, { graceMs: 7000 }),
  metrics: new SupervisedProc('metrics', startMetrics, healthMetrics, {
  graceMs: 20000,
  failThreshold: 2,
    onRestart: ({ countMin }) => {
      // If flapping a lot, rotate metrics port among a small pool
      try {
        const pool = [8733, 8734, 8735];
        const idx = pool.indexOf(PORT_METRICS);
    if (countMin >= 3) {
          const next = pool[(idx >= 0 ? (idx + 1) % pool.length : 0)];
          if (next !== PORT_METRICS) {
            PORT_METRICS = next;
            persistMetricsPort(PORT_METRICS);
            fs.appendFileSync(path.join(SCRATCH, 'orchestrator.log'), `${nowIso()} [metrics] rotating port to ${PORT_METRICS} due to flapping\n`);
            // also reset backoff to try faster on new port
            procs.metrics.backoffMs = 500;
          }
        }
      } catch {}
    },
  }),
  control: new SupervisedProc('control', startControl, healthControl, { graceMs: 7000 }),
  ingest: new SupervisedProc('ingest', startIngest, healthIngest, { graceMs: 20000 }),
  decode: new SupervisedProc('decode', startDecode, healthDecode, { graceMs: 20000 }),
};

async function main() {
  // Safety gate: require explicit enable to avoid accidental runaway
  if (String(process.env.ORCH_ENABLE||'0') !== '1') {
    console.error('[orch] disabled (set ORCH_ENABLE=1 to run)');
    return;
  }
  console.log(`[orch] starting at ${nowIso()} (pid ${process.pid})`);
  // Start core services first
  await procs.status.start();
  await procs.metrics.start();
  await procs.control.start();
  // Start ingest next; give it a moment to create files
  await procs.ingest.start();
  // Stagger decode a bit to avoid DB lock surge at exact startup
  setTimeout(() => { procs.decode.start(); }, 2000);

  // Health loop
  setInterval(() => {
    procs.status.check();
    procs.metrics.check();
    procs.control.check();
    procs.ingest.check();
    procs.decode.check();
  }, 3000);

  // Minimal HTTP health for orchestrator itself
  const srv = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://localhost');
    if (u.pathname === '/health') {
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      res.end(JSON.stringify({ ok: true, pid: process.pid, t: nowIso() }));
      return;
    }
    if (u.pathname === '/status') {
      const s = { ports: { status: PORT_STATUS, metrics: PORT_METRICS, control: PORT_CONTROL } };
      for (const k of Object.keys(procs)) s[k] = !!(procs[k].proc && !procs[k].proc.killed);
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      res.end(JSON.stringify(s));
      return;
    }
    res.writeHead(404); res.end('not found');
  });
  srv.listen(Number(process.env.ORCH_PORT || 8798), '127.0.0.1', () => {
    console.log(`[orch] health on http://127.0.0.1:${process.env.ORCH_PORT || 8798}`);
  });

  // Cleanup on exit
  function cleanup() {
    try { fs.unlinkSync(PID_ORCH); } catch {}
    Object.values(procs).forEach((p) => { try { p.stop(); } catch {} });
    setTimeout(() => process.exit(0), 200);
  }
  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);
}

main().catch((e) => { console.error('[orch] fatal', e && e.stack || e); process.exit(1); });
