#!/usr/bin/env node
/**
 * Diagnose Cloudflare KV bindings & daily stats keys.
 * Uses CF API token (account scope) to:
 *  1. List all KV namespaces (filter to those containing 'EF' or provided FILTER env).
 *  2. For target namespace (by explicit CF_KV_STATS_NAMESPACE_ID or the one matching wrangler.jsonc EF_STATS id),
 *     list keys with prefix 'daily/' and show a concise summary.
 *  3. Optionally fetch one sample key (oldest) to confirm JSON parse.
 *
 * Env Vars:
 *  CF_API_TOKEN (required)
 *  CF_ACCOUNT_ID (required)
 *  CF_KV_STATS_NAMESPACE_ID (optional override) OR the script will attempt to read wrangler.jsonc
 *  FILTER (optional substring to filter namespace titles)
 *  LIMIT (optional max keys to list; default 200)
 *
 * Output: JSON-ish console logs summarizing state.
 */
import fs from 'fs';
import path from 'path';
import fetch from 'node-fetch';

function envReq(name){ if(!process.env[name]){ console.error('Missing env', name); process.exit(1);} }
envReq('CF_API_TOKEN');
envReq('CF_ACCOUNT_ID');

const ACCOUNT = process.env.CF_ACCOUNT_ID;
const TOKEN = process.env.CF_API_TOKEN;
const OVERRIDE_NS = process.env.CF_KV_STATS_NAMESPACE_ID || '';
const FILTER = (process.env.FILTER||'').toLowerCase();
const LIMIT = parseInt(process.env.LIMIT||'200',10);

const headers = { 'Authorization': `Bearer ${TOKEN}` };

async function cf(path, init){
  const url = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}${path}`;
  const res = await fetch(url, { ...init, headers:{...headers, ...(init&&init.headers)} });
  if(!res.ok){ const body=await res.text().catch(()=>'<no body>'); throw new Error(`CF ${path} failed ${res.status} ${body.slice(0,180)}`); }
  return res.json();
}

function readWranglerId(){
  try {
    const wranglerPath = path.join(process.cwd(), 'wrangler.jsonc');
    const txt = fs.readFileSync(wranglerPath,'utf8');
      // Simple JSONC parse: extract kv_namespaces array and locate object with binding "EF_STATS"
      const kvBlockMatch = txt.match(/"kv_namespaces"\s*:\s*\[(.*?)]/s);
      if(kvBlockMatch){
        const block = kvBlockMatch[1];
        const objRegex = /\{[^}]*\}/g; let m;
        while((m = objRegex.exec(block))){
          if(/"binding"\s*:\s*"EF_STATS"/.test(m[0])){
            const idMatch = m[0].match(/"id"\s*:\s*"([a-f0-9]{32})"/i);
            if(idMatch) return idMatch[1];
          }
        }
      }
  } catch {}
  return null;
}

(async function main(){
  console.log('--- Diagnose Cloudflare KV (Stats) ---');
  const statsIdFromWrangler = readWranglerId();
  console.log('wrangler EF_STATS id:', statsIdFromWrangler||'(not found)');
  const namespaces = await cf('/storage/kv/namespaces');
  const list = (namespaces.result||namespaces) || [];
  const filtered = list.filter(ns=>{ if(!FILTER) return true; return (ns.title||'').toLowerCase().includes(FILTER); });
  console.log('Namespaces (filtered):', filtered.map(ns=>({ id:ns.id, title:ns.title })));
  let targetId = OVERRIDE_NS || statsIdFromWrangler;
  if(!targetId){ console.error('No target namespace id determined (set CF_KV_STATS_NAMESPACE_ID)'); process.exit(1); }
  const targetMeta = list.find(ns=> ns.id === targetId);
  if(!targetMeta){ console.error('Target namespace id not in account list:', targetId); process.exit(1); }
  console.log('Target:', { id: targetId, title: targetMeta.title });
  // List keys with pagination
  let cursor=null; const keys=[];
  while(true){
    const q = new URLSearchParams({ prefix:'daily/', limit: '1000' });
    if(cursor) q.set('cursor', cursor);
    const r = await cf(`/storage/kv/namespaces/${targetId}/keys?${q.toString()}`);
    (r.result||[]).forEach(k=>{ keys.push(k.name); });
    if(!r.result_info || !r.result_info.cursor) break;
    cursor = r.result_info.cursor;
    if(keys.length >= LIMIT) break;
  }
  keys.sort();
  const limited = keys.slice(0, LIMIT);
  console.log('Daily key count (prefix daily/):', keys.length);
  console.log('Daily keys (first up to LIMIT):', limited);
  if(keys.length){
    const oldest = limited[0];
    console.log('Fetching oldest daily key:', oldest);
    const valRes = await fetch(`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/storage/kv/namespaces/${targetId}/values/${encodeURIComponent(oldest)}`, { headers });
    if(valRes.ok){ const txt=await valRes.text(); try { const parsed=JSON.parse(txt); console.log('Oldest value snapshot keys example counters:', Object.keys(parsed.counters||{}).slice(0,10)); } catch { console.log('Could not parse JSON value (truncated):', txt.slice(0,120)); } }
  }
  // Also show if 'current' exists
  const currentRes = await fetch(`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/storage/kv/namespaces/${targetId}/values/current`, { headers });
  console.log('current key status:', currentRes.status);
})();
