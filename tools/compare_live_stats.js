#!/usr/bin/env node
/**
 * Compare live /api/stats history (via a provided URL) with KV namespace daily keys.
 * Ensures frontend sees same count available in KV.
 *
 * Env Vars:
 *  CF_API_TOKEN, CF_ACCOUNT_ID (required)
 *  CF_KV_STATS_NAMESPACE_ID (target namespace id) OR auto-detect via wrangler.jsonc
 *  LIVE_STATS_URL (e.g. https://your-domain/api/stats?history=30 )
 *  HISTORY_DAYS (fallback if URL missing history param; default 8)
 */
import fs from 'fs';
import path from 'path';
import fetch from 'node-fetch';

function reqEnv(n){ if(!process.env[n]){ console.error('Missing env', n); process.exit(1);} }
reqEnv('CF_API_TOKEN');
reqEnv('CF_ACCOUNT_ID');
if(!process.env.LIVE_STATS_URL){ console.error('Missing env LIVE_STATS_URL'); process.exit(1); }

const ACCOUNT = process.env.CF_ACCOUNT_ID;
const TOKEN = process.env.CF_API_TOKEN;
const NS = process.env.CF_KV_STATS_NAMESPACE_ID || detectId();
const HISTORY_DAYS = parseInt(process.env.HISTORY_DAYS||'8',10);
const LIVE_URL = new URL(process.env.LIVE_STATS_URL);
if(!LIVE_URL.searchParams.get('history')) LIVE_URL.searchParams.set('history', HISTORY_DAYS.toString());

function detectId(){
  try { const txt = fs.readFileSync(path.join(process.cwd(),'wrangler.jsonc'),'utf8'); const m = txt.match(/"binding"\s*:\s*"EF_STATS"[\s\S]*?"id"\s*:\s*"([a-f0-9]{32})"/i); if(m) return m[1]; } catch{}; return null; }
if(!NS){ console.error('Could not determine EF_STATS namespace id'); process.exit(1); }

const headers = { 'Authorization':`Bearer ${TOKEN}` };
async function listDaily(){
  let cursor=null; const out=[]; while(true){ const q=new URLSearchParams({ prefix:'daily/', limit:'1000' }); if(cursor) q.set('cursor',cursor); const url=`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/storage/kv/namespaces/${NS}/keys?${q.toString()}`; const r=await fetch(url,{ headers }); if(!r.ok) throw new Error('KV list failed '+r.status); const j=await r.json(); (j.result||[]).forEach(k=> out.push(k.name)); if(!j.result_info||!j.result_info.cursor) break; cursor=j.result_info.cursor; }
  return out.filter(k=>k.startsWith('daily/')).sort();
}

(async function main(){
  console.log('--- Compare Live Stats vs KV ---');
  console.log('KV namespace id:', NS);
  const kvKeys = await listDaily();
  console.log('KV daily key count:', kvKeys.length);
  console.log('KV daily range:', kvKeys[0], '->', kvKeys[kvKeys.length-1]);
  const liveRes = await fetch(LIVE_URL.toString()); if(!liveRes.ok){ console.error('Live fetch failed', liveRes.status); process.exit(1);} const liveJson = await liveRes.json();
  const liveHistory = Array.isArray(liveJson.history)? liveJson.history: [];
  console.log('Live history length:', liveHistory.length);
  // Collect dates from live history
  const liveDates = liveHistory.map(h=> (h.date? h.date.replace(/\.json$/,''): (h.updatedAt||'').slice(0,10)) ).sort();
  console.log('Live history range:', liveDates[0], '->', liveDates[liveDates.length-1]);
  // Diff
  const kvDates = kvKeys.map(k=> k.slice(6,16));
  const missingInLive = kvDates.filter(d=> !liveDates.includes(d));
  const extraInLive = liveDates.filter(d=> !kvDates.includes(d));
  console.log('Missing in live (expected none):', missingInLive);
  console.log('Extra in live (unexpected):', extraInLive);
  if(missingInLive.length===0 && extraInLive.length===0){ console.log('OK: Live history aligns with KV'); } else { console.log('Mismatch detected'); }
})();
