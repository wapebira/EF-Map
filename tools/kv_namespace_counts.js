#!/usr/bin/env node
/**
 * List all KV namespaces and provide approximate key counts (up to a scan limit per namespace) to aid cleanup.
 * Env: CF_API_TOKEN, CF_ACCOUNT_ID (required)
 * Optional: PREFIX (only count keys starting with), LIMIT_PER_NS (default 5000)
 */
import fetch from 'node-fetch';
function req(n){ if(!process.env[n]){ console.error('Missing env', n); process.exit(1);} }
req('CF_API_TOKEN'); req('CF_ACCOUNT_ID');
const { CF_API_TOKEN, CF_ACCOUNT_ID } = process.env;
const PREFIX = process.env.PREFIX||'';
const LIMIT = parseInt(process.env.LIMIT_PER_NS||'5000',10);
const headers = { 'Authorization':`Bearer ${CF_API_TOKEN}` };

async function listNamespaces(){
  const url=`https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/storage/kv/namespaces`; const r=await fetch(url,{ headers }); if(!r.ok) throw new Error('List namespaces failed '+r.status); const j=await r.json(); return j.result||[];
}
async function countKeys(ns){
  let cursor=null; let count=0; let first=null; let last=null; while(true){ const q=new URLSearchParams({ limit:'1000' }); if(PREFIX) q.set('prefix', PREFIX); if(cursor) q.set('cursor', cursor); const url=`https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/storage/kv/namespaces/${ns.id}/keys?${q.toString()}`; const r=await fetch(url,{ headers }); if(!r.ok) throw new Error('List keys failed '+r.status); const j=await r.json(); const arr=j.result||[]; if(arr.length){ if(!first) first=arr[0].name; last=arr[arr.length-1].name; } count+=arr.length; if(count>=LIMIT) break; if(!j.result_info || !j.result_info.cursor) break; cursor=j.result_info.cursor; }
  return { count, first, last, truncated: count>=LIMIT };
}
(async function main(){
  console.log('--- KV Namespace Key Counts ---');
  const namespaces = await listNamespaces();
  for(const ns of namespaces){
    try { const stats = await countKeys(ns); console.log(`${ns.title||'(no title)'} ${ns.id} -> count=${stats.count}${stats.truncated?' (truncated)':''} first=${stats.first||''} last=${stats.last||''}`); } catch(e){ console.error('Error ns', ns.id, e.message); }
  }
})();
