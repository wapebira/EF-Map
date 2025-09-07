#!/usr/bin/env node
/**
 * Copy daily stats keys + current between two Cloudflare KV namespaces (same account).
 * Usage (env vars):
 *  CF_API_TOKEN, CF_ACCOUNT_ID (required)
 *  SRC_NS (source namespace id) 32 hex chars
 *  DEST_NS (destination namespace id) 32 hex chars
 *  START_DATE (inclusive, YYYY-MM-DD) optional
 *  END_DATE (inclusive, YYYY-MM-DD) optional
 *  DRY_RUN=true to simulate
 *
 * If START/END not provided, script enumerates source keys (prefix daily/) and copies all missing or differing.
 */
import fetch from 'node-fetch';

function req(name){ if(!process.env[name]){ console.error('Missing env', name); process.exit(1);} }
['CF_API_TOKEN','CF_ACCOUNT_ID','SRC_NS','DEST_NS'].forEach(req);
const { CF_API_TOKEN:TOKEN, CF_ACCOUNT_ID:ACCOUNT, SRC_NS, DEST_NS } = process.env;
const DRY = (process.env.DRY_RUN||'').toLowerCase()==='true';
const SDATE = process.env.START_DATE||''; const EDATE = process.env.END_DATE||'';
const headers = { 'Authorization':`Bearer ${TOKEN}` };

async function listDaily(ns){
  let cursor=null; const out=[];
  while(true){
    const q = new URLSearchParams({ prefix:'daily/', limit:'1000' }); if(cursor) q.set('cursor', cursor);
    const url=`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/storage/kv/namespaces/${ns}/keys?${q.toString()}`;
    const res=await fetch(url,{ headers }); if(!res.ok) throw new Error('List failed '+res.status);
    const j=await res.json(); (j.result||[]).forEach(k=> out.push(k.name));
    if(!j.result_info || !j.result_info.cursor) break; cursor=j.result_info.cursor;
  }
  return out.sort();
}
async function get(ns,key){ const url=`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/storage/kv/namespaces/${ns}/values/${encodeURIComponent(key)}`; const r=await fetch(url,{ headers }); if(r.status===404) return null; if(!r.ok) throw new Error('Get failed '+r.status); return await r.text(); }
async function put(ns,key,val){ if(DRY) return; const url=`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/storage/kv/namespaces/${ns}/values/${encodeURIComponent(key)}`; const r=await fetch(url,{ method:'PUT', headers:{...headers,'Content-Type':'application/json'}, body:val }); if(!r.ok) throw new Error('Put failed '+r.status); }

function within(dateStr){ if(SDATE && dateStr < SDATE) return false; if(EDATE && dateStr > EDATE) return false; return true; }

(async function main(){
  console.log('Copy daily stats', { SRC_NS, DEST_NS, DRY, SDATE:SDATE||null, EDATE:EDATE||null });
  const srcDaily = await listDaily(SRC_NS);
  const destDaily = await listDaily(DEST_NS);
  const destSet = new Set(destDaily);
  const toProcess = srcDaily.filter(k=> k.startsWith('daily/') && k.endsWith('.json'));
  let copied=0, skipped=0, updated=0;
  for(const key of toProcess){
    const date = key.slice(6,16); // daily/YYYY-MM-DD
    if(!within(date)) continue;
    const srcVal = await get(SRC_NS, key); if(!srcVal) continue;
    const destVal = destSet.has(key)? await get(DEST_NS,key): null;
    if(destVal === srcVal){ skipped++; continue; }
    if(destVal === null) copied++; else updated++;
    await put(DEST_NS,key,srcVal);
  }
  // Copy current
  const srcCurrent = await get(SRC_NS,'current'); if(srcCurrent){ const destCurrent = await get(DEST_NS,'current'); if(destCurrent!==srcCurrent){ await put(DEST_NS,'current',srcCurrent); if(destCurrent===null) copied++; else updated++; } else skipped++; }
  console.log('Done', { copied, updated, skipped, totalCandidate: toProcess.length });
})();
