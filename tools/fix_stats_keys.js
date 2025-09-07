#!/usr/bin/env node
/**
 * Rename Cloudflare KV stats daily keys from daily/YYYY-MM-DD.json.json -> daily/YYYY-MM-DD.json
 * Safe / idempotent: skips if target exists with identical content.
 * Env: CF_ACCOUNT_ID, CF_API_TOKEN, CF_KV_STATS_NAMESPACE_ID
 */
import fetch from 'node-fetch';

const { CF_ACCOUNT_ID, CF_API_TOKEN, CF_KV_STATS_NAMESPACE_ID: NS } = process.env;
if(!CF_ACCOUNT_ID||!CF_API_TOKEN||!NS){ console.error('Missing env'); process.exit(1); }
const base = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/storage/kv/namespaces/${NS}`;
const headers = { 'Authorization': `Bearer ${CF_API_TOKEN}` };

async function listAll(){
  let cursor=null, keys=[]; while(true){
    const url = new URL(base + '/keys');
    url.searchParams.set('limit','1000');
    if(cursor) url.searchParams.set('cursor', cursor);
    const res = await fetch(url, { headers });
    if(!res.ok) throw new Error('List failed '+res.status);
    const j = await res.json(); if(!j.success) throw new Error('List not success');
    keys.push(...j.result.map(r=>r.name));
    if(j.result_info?.cursor) cursor=j.result_info.cursor; else break;
  }
  return keys;
}
async function get(key){
  const res = await fetch(base + '/values/' + encodeURIComponent(key), { headers });
  if(res.status===404) return null; if(!res.ok) throw new Error('Get failed '+res.status); return await res.text();
}
async function put(key,val){
  const res = await fetch(base + '/values/' + encodeURIComponent(key), { method:'PUT', headers:{...headers,'Content-Type':'application/json'}, body:val });
  if(!res.ok) throw new Error('Put failed '+res.status);
}
async function del(key){
  const res = await fetch(base + '/values/' + encodeURIComponent(key), { method:'DELETE', headers });
  if(!res.ok) throw new Error('Delete failed '+res.status);
}

(async function main(){
  try {
    const keys = await listAll();
    const targets = keys.filter(k=>/^daily\/\d{4}-\d{2}-\d{2}\.json\.json$/.test(k));
    if(!targets.length){ console.log('No malformed keys found.'); return; }
    console.log('Found malformed keys:', targets);
    let renamed=0, skipped=0;
    for(const k of targets){
      const newKey = k.replace(/\.json\.json$/, '.json');
      const val = await get(k); if(val===null){ console.warn('Missing original',k); continue; }
      const existing = await get(newKey);
      if(existing && existing === val){ console.log('Skip (already identical)', newKey); await del(k); skipped++; continue; }
      if(existing && existing !== val){ console.warn('Conflict: target exists different content', newKey); continue; }
      await put(newKey, val);
      await del(k);
      renamed++;
      console.log('Renamed', k, '->', newKey);
    }
    console.log('Done', { renamed, skipped });
  } catch(e){ console.error('Rename error', e); process.exit(1); }
})();
