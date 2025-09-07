#!/usr/bin/env node
/**
 * Remove duplicate daily stats keys that have an accidental double .json suffix.
 * Env vars:
 *  CF_ACCOUNT_ID
 *  CF_API_TOKEN
 *  CF_KV_NAMESPACE_ID (single) OR CF_KV_NAMESPACE_IDS (comma-separated list)
 *  DRY_RUN=1 to simulate deletions
 */
const ACCOUNT = process.env.CF_ACCOUNT_ID || process.env.CLOUDFLARE_ACCOUNT_ID;
const TOKEN = process.env.CF_API_TOKEN || process.env.CLOUDFLARE_API_TOKEN;
const NS_SINGLE = process.env.CF_KV_NAMESPACE_ID;
const NS_MULTI = process.env.CF_KV_NAMESPACE_IDS;
const DRY = process.env.DRY_RUN === '1' || process.env.DRY_RUN === 'true';
if(!ACCOUNT || ACCOUNT.length < 30) throw new Error('Missing/invalid CF_ACCOUNT_ID');
if(!TOKEN || TOKEN.length < 30) throw new Error('Missing/invalid CF_API_TOKEN');
const namespaces = (NS_MULTI? NS_MULTI.split(',').map(s=>s.trim()).filter(Boolean):[]).concat(NS_SINGLE? [NS_SINGLE]:[]);
if(namespaces.length===0) throw new Error('Provide CF_KV_NAMESPACE_ID or CF_KV_NAMESPACE_IDS');
const API = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/storage/kv/namespaces`;

async function listDaily(ns){
  let cursor=null; const keys=[];
  do {
    const url = new URL(`${API}/${ns}/keys`);
    if(cursor) url.searchParams.set('cursor', cursor);
    url.searchParams.set('limit','1000');
    url.searchParams.set('prefix','daily/');
    const r = await fetch(url,{ headers:{ Authorization:`Bearer ${TOKEN}` } });
    if(!r.ok) throw new Error('List failed '+ns+' '+r.status);
    const j = await r.json();
    j.result.forEach(k=> keys.push(k.name));
    cursor = j.result_info?.cursor && !j.result_info?.cursor_complete ? j.result_info.cursor : null;
  } while(cursor);
  return keys;
}
async function del(ns,key){
  const r = await fetch(`${API}/${ns}/values/${encodeURIComponent(key)}`, { method:'DELETE', headers:{ Authorization:`Bearer ${TOKEN}` } });
  if(r.status===404) return 'missing';
  if(!r.ok) throw new Error('Delete failed '+key+' '+r.status);
  return 'deleted';
}
(async()=>{
  for(const ns of namespaces){
    console.log(`[*] Namespace ${ns} scanning...`);
    const all = await listDaily(ns);
    const dupes = all.filter(k=>/\.json\.json$/.test(k));
    if(!dupes.length){ console.log('    No duplicates'); continue; }
    console.log('    Found duplicate keys:', dupes.length); let removed=0, errors=[];
    if(DRY){ console.log('    DRY_RUN=1; would delete:', dupes); continue; }
    for(const k of dupes){ try { await del(ns,k); removed++; } catch(e){ errors.push({ key:k, message:String(e) }); } }
    console.log('    Removed', removed, 'duplicates', errors.length? 'Errors:'+JSON.stringify(errors):'');
  }
})();
