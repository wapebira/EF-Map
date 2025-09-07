#!/usr/bin/env node
/**
 * Mirror Netlify stats (current + daily history) into Cloudflare KV by calling the public Netlify stats function.
 * Rewritten in CommonJS (no ESM import) so it runs without package.json type=module and without node-fetch.
 *
 * Required env vars (unless DRY_RUN=true, then CF_* can be omitted):
 *  NETLIFY_STATS_URL  e.g. https://ef-map.com/.netlify/functions/stats?history=120
 *  CF_ACCOUNT_ID
 *  CF_API_TOKEN
 *  CF_KV_STATS_NAMESPACE_ID
 * Optional:
 *  HISTORY_DAYS (default 30, max 120)
 *  DRY_RUN=true (simulate; skip Cloudflare writes & CF env validation)
 *
 * Output: summary { writes, skips, dry }
 */
const crypto = require('crypto');
// Node 18+ has global fetch; guard just in case
if (typeof fetch !== 'function') {
  console.error('Global fetch not available in this Node version. Use Node 18+.');
  process.exit(1);
}

const NETLIFY_STATS_URL = process.env.NETLIFY_STATS_URL;
const CF_ACCOUNT_ID = process.env.CF_ACCOUNT_ID;
const CF_API_TOKEN = process.env.CF_API_TOKEN;
const NS_STATS = process.env.CF_KV_STATS_NAMESPACE_ID;
const HISTORY_DAYS = Math.min(120, parseInt(process.env.HISTORY_DAYS || '30', 10));
const DRY = (process.env.DRY_RUN || '').toLowerCase() === 'true';

function req(name, val) {
  if (!val) { console.error('Missing env', name); process.exit(1); }
}
req('NETLIFY_STATS_URL', NETLIFY_STATS_URL);
if (!DRY) {
  req('CF_ACCOUNT_ID', CF_ACCOUNT_ID);
  req('CF_API_TOKEN', CF_API_TOKEN);
  req('CF_KV_STATS_NAMESPACE_ID', NS_STATS);
}

const cfHeaders = CF_API_TOKEN ? { 'Authorization': `Bearer ${CF_API_TOKEN}` } : {};

async function cfGet(key) {
  if (DRY) return null; // treat as missing so we report would-write
  const url = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/storage/kv/namespaces/${NS_STATS}/values/${encodeURIComponent(key)}`;
  const res = await fetch(url, { headers: cfHeaders });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error('CF get failed ' + res.status);
  return await res.text();
}
async function sleep(ms){ return new Promise(r=>setTimeout(r,ms)); }
async function cfPut(key, value) {
  if (DRY) return { dry: true };
  const url = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/storage/kv/namespaces/${NS_STATS}/values/${encodeURIComponent(key)}`;
  let attempt = 0; const max = 5;
  while (true) {
    const res = await fetch(url, { method: 'PUT', headers: { ...cfHeaders, 'Content-Type': 'application/json' }, body: value });
    if (res.ok) return { ok: true };
    if (res.status !== 429 && res.status !== 503) {
      const body = await res.text().catch(() => '<no body>');
      throw new Error('CF put failed ' + res.status + ' ' + body.slice(0, 200));
    }
    attempt++;
    if (attempt >= max) {
      const body = await res.text().catch(() => '<no body>');
      throw new Error('CF put failed after retries ' + res.status + ' ' + body.slice(0, 200));
    }
    const delay = 300 * Math.pow(2, attempt - 1);
    console.warn(`Rate limited (status ${res.status}) on key ${key}, retrying in ${delay}ms (attempt ${attempt}/${max})`);
    await sleep(delay);
  }
}

function hash(s){ return crypto.createHash('sha1').update(s).digest('hex').slice(0,10); }

(async function main() {
  try {
    const url = new URL(NETLIFY_STATS_URL);
    if (!url.searchParams.get('history')) url.searchParams.set('history', HISTORY_DAYS.toString());
    console.log('[mirror] Fetching Netlify stats from', url.toString());
    const res = await fetch(url.toString());
    if (!res.ok) { console.error('Fetch failed', res.status); process.exit(1); }
    const json = await res.json();
    if (!json || !json.current) { console.error('Unexpected stats payload'); process.exit(1); }
    let writes = 0, skips = 0;
    const currentStr = JSON.stringify(json.current);
    const existingCurrent = await cfGet('current');
    if (existingCurrent !== currentStr) { await cfPut('current', currentStr); writes++; } else { skips++; }
    if (Array.isArray(json.history)) {
      for (const h of json.history) {
        const date = h.date || (h.updatedAt || '').slice(0, 10);
        if (!date) continue;
        const key = 'daily/' + date + '.json';
        const hStr = JSON.stringify(h);
        const existing = await cfGet(key);
        if (existing !== hStr) { await cfPut(key, hStr); writes++; } else { skips++; }
      }
    }
    console.log('[mirror] Complete', { writes, skips, dry: DRY });
  } catch (err) {
    console.error('[mirror] ERROR', err.message);
    process.exit(1);
  }
})();
