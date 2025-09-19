// Minimal Postgres-backed adapter exposing health and placeholder summary endpoints.
// Isolated from existing local-indexer. Safe to run without a DB (health degrades gracefully).
const http = require('http');
const url = require('url');
const { Client } = require('pg');

const PORT = parseInt(process.env.PG_ADAPTER_PORT || '8850', 10);
const PG_URL = process.env.PG_URL || 'postgres://postgres:postgres@127.0.0.1:5432/ef_indexer';
const START_TS = Date.now();

function withPg(timeoutMs = 2000) {
  // Create a short-lived client with timeout-protected connect/query cycle
  const client = new Client({ connectionString: PG_URL });
  let timer;
  return {
    async run(query, params) {
      try {
        const to = new Promise((_, rej) => {
          timer = setTimeout(() => rej(new Error('pg:timeout')), timeoutMs);
        });
        await Promise.race([client.connect(), to]);
        const res = await Promise.race([client.query(query, params), to]);
        return res;
      } finally {
        clearTimeout(timer);
        try { await client.end(); } catch {}
      }
    }
  };
}

async function health() {
  try {
    const pg = withPg(1500);
    const res = await pg.run('SELECT 1 as ok');
    return { ok: true, db: 'up', rows: res?.rowCount ?? 0, t: Date.now() };
  } catch (e) {
    return { ok: true, db: 'down', err: String(e?.message || e), t: Date.now() };
  }
}

async function summary() {
  // Try to surface a few generic facts without assuming schema
  const out = { ok: true, startedAt: START_TS, now: Date.now(), connected: false };
  try {
    const pg = withPg(2500);
    const ver = await pg.run('select version()');
    out.connected = true;
    out.version = ver?.rows?.[0]?.version || null;
    // Count tables in public schema for a coarse sanity check
    const r = await withPg(2500).run(
      `select count(*)::int as tables from information_schema.tables where table_schema = 'public'`
    );
    out.publicTables = r?.rows?.[0]?.tables ?? 0;
  } catch (e) {
    out.err = String(e?.message || e);
  }
  return out;
}

function notFound(res) {
  res.statusCode = 404;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({ ok: false, error: 'not_found' }));
}

const server = http.createServer(async (req, res) => {
  const parsed = url.parse(req.url || '', true);
  const path = parsed.pathname || '/';
  try {
    if (path === '/health') {
      const h = await health();
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(h));
      return;
    }
    if (path === '/api/summary') {
      const s = await summary();
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(s));
      return;
    }
    // Placeholder for future endpoints that mirror existing metrics_server ones
    // e.g., /api/mud, /api/mud-typed, etc. to be implemented once schema confirmed
    return notFound(res);
  } catch (e) {
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ ok: false, error: String(e?.message || e) }));
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[pg-adapter] listening http://127.0.0.1:${PORT}`);
});
