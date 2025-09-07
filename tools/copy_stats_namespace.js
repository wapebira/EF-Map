#!/usr/bin/env node
/**
 * Copy all stats keys (current + daily/*.json) from one KV namespace to another.
 * Environment variables:
 *  CF_ACCOUNT_ID - Cloudflare account ID
 *  CF_API_TOKEN  - API token with Workers KV Read & Write
 *  CF_KV_SRC_NAMESPACE_ID - source namespace ID (authoritative with data)
 *  CF_KV_DEST_NAMESPACE_ID - destination namespace ID (bound to Pages)
 *  DRY_RUN=1 to simulate
 */

const ACCOUNT = process.env.CF_ACCOUNT_ID || process.env.CLOUDFLARE_ACCOUNT_ID;
const TOKEN = process.env.CF_API_TOKEN || process.env.CLOUDFLARE_API_TOKEN;
const SRC = process.env.CF_KV_SRC_NAMESPACE_ID;
const DEST = process.env.CF_KV_DEST_NAMESPACE_ID;
const DRY = process.env.DRY_RUN === '1' || process.env.DRY_RUN === 'true';

if(!ACCOUNT || ACCOUNT.length < 30) throw new Error('Missing/invalid CF_ACCOUNT_ID');
if(!TOKEN || TOKEN.length < 30) throw new Error('Missing/invalid CF_API_TOKEN');
if(!SRC || !DEST) throw new Error('Need CF_KV_SRC_NAMESPACE_ID and CF_KV_DEST_NAMESPACE_ID');
if(SRC === DEST) { console.log('[copy] Source and destination namespaces are identical; nothing to do.'); process.exit(0); }

const API = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/storage/kv/namespaces`;

async function listAll(ns){
  let cursor=null; const keys=[];
  do {
    const url = new URL(`${API}/${ns}/keys`);
    if(cursor) url.searchParams.set('cursor', cursor);
    url.searchParams.set('limit','1000');
    const r = await fetch(url, { headers:{ Authorization:`Bearer ${TOKEN}` } });
    if(!r.ok){ throw new Error('List failed '+r.status+' '+await r.text()); }
    const j = await r.json();
    j.result.forEach(k=>{ if(k.name==='current'||k.name.startsWith('daily/')) keys.push(k.name); });
    cursor = j.result_info?.cursor && !j.result_info?.cursor_complete ? j.result_info.cursor : null;
  } while(cursor);
  return keys.sort();
}

async function getValue(ns, key){
  const r = await fetch(`${API}/${ns}/values/${encodeURIComponent(key)}`, { headers:{ Authorization:`Bearer ${TOKEN}` } });
  if(r.status === 404) return null;
  if(!r.ok) throw new Error('Get failed '+key+' '+r.status);
  return await r.text();
}

async function putValue(ns, key, value){
  const r = await fetch(`${API}/${ns}/values/${encodeURIComponent(key)}`, { method:'PUT', body:value, headers:{ Authorization:`Bearer ${TOKEN}` } });
  if(!r.ok) throw new Error('Put failed '+key+' '+r.status+' '+await r.text());
}

(async () => {
  console.log('[copy] Listing source keys...');
  const srcKeys = await listAll(SRC);
  console.log('[copy] Source keys:', srcKeys.length);
  if(srcKeys.length === 0){ console.log('[copy] No keys in source; aborting.'); return; }
  console.log('[copy] Listing destination keys...');
  const destKeys = new Set(await listAll(DEST));
  let copied=0, skipped=0;
  for(const k of srcKeys){
    if(destKeys.has(k)){ skipped++; continue; }
    const v = await getValue(SRC, k); if(v==null){ skipped++; continue; }
    if(!DRY){ await putValue(DEST, k, v); }
    copied++;
    if(copied % 10 === 0) console.log('[copy] Copied', copied, '...');
  }
  console.log('[copy] Complete', { copied, skipped, dry:DRY });
})();
