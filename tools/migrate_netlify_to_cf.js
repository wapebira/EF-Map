#!/usr/bin/env node
/**
 * Netlify -> Cloudflare migration script (shares + stats snapshots).
 *
 * Requirements (env vars):
 *  NETLIFY_SITE_ID  (or BLOB_SITE_ID)
 *  NETLIFY_TOKEN    (Personal Access Token with Blobs read access)
 *  CF_ACCOUNT_ID
 *  CF_API_TOKEN (edit KV)
 *  CF_KV_SHARES_NAMESPACE_ID  (EF_SHARES id)
 *  CF_KV_STATS_NAMESPACE_ID   (EF_STATS id)
 *
 * Usage:
 *  node tools/migrate_netlify_to_cf.js --dry-run   (plan only)
 *  node tools/migrate_netlify_to_cf.js --force     (overwrite existing KV keys)
 *
 * Steps:
 * 1. List Netlify blob stores 'shares' and 'app-stats'.
 * 2. Copy keys to Cloudflare KV (skips existing unless --force).
 * 3. Verify sample subset (configurable).
 */
import crypto from 'crypto';
import { argv, exit } from 'process';
import fetch from 'node-fetch';

const NETLIFY_SITE_ID = process.env.NETLIFY_SITE_ID || process.env.BLOB_SITE_ID || process.env.SITE_ID;
const NETLIFY_TOKEN = process.env.NETLIFY_TOKEN || process.env.BLOB_PAT || process.env.BLOBS_TOKEN;
const CF_ACCOUNT_ID = process.env.CF_ACCOUNT_ID;
const CF_API_TOKEN = process.env.CF_API_TOKEN;
const NS_SHARES = process.env.CF_KV_SHARES_NAMESPACE_ID;
const NS_STATS = process.env.CF_KV_STATS_NAMESPACE_ID;

const DRY_RUN = argv.includes('--dry-run');
const FORCE = argv.includes('--force');
const SAMPLE = parseInt((process.env.MIGRATION_VERIFY_SAMPLE||'20'),10);

function reqAssert(cond,msg){ if(!cond){ console.error('Missing:', msg); exit(1);} }
reqAssert(NETLIFY_SITE_ID,'NETLIFY_SITE_ID');
reqAssert(NETLIFY_TOKEN,'NETLIFY_TOKEN');
reqAssert(CF_ACCOUNT_ID,'CF_ACCOUNT_ID');
reqAssert(CF_API_TOKEN,'CF_API_TOKEN');
reqAssert(NS_SHARES,'CF_KV_SHARES_NAMESPACE_ID');
reqAssert(NS_STATS,'CF_KV_STATS_NAMESPACE_ID');

const headersNetlify = { 'Authorization': `Bearer ${NETLIFY_TOKEN}` };

async function listNetlifyBlobs(store){
  const out=[]; let cursor='';
  while(true){
    const url = `https://api.netlify.com/api/v1/blobs/${NETLIFY_SITE_ID}/${store}?cursor=${cursor}`;
    const res = await fetch(url,{ headers: headersNetlify});
    if(!res.ok){ throw new Error(`List failed ${store} ${res.status}`); }
    const json = await res.json();
    for(const item of json.items||[]){ out.push(item); }
    if(!json.next_cursor) break; cursor = json.next_cursor;
  }
  return out; // each item: { key, size }
}

async function getNetlifyBlob(store, key){
  const url = `https://api.netlify.com/api/v1/blobs/${NETLIFY_SITE_ID}/${store}/${encodeURIComponent(key)}`;
  const res = await fetch(url,{ headers: headersNetlify });
  if(res.status === 404) return null;
  if(!res.ok) throw new Error('Get failed '+store+':'+key);
  return await res.text();
}

async function cfKVGet(ns, key){
  const url = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/storage/kv/namespaces/${ns}/values/${encodeURIComponent(key)}`;
  const res = await fetch(url,{ headers:{ 'Authorization':`Bearer ${CF_API_TOKEN}` }});
  if(res.status === 404) return null; if(!res.ok) throw new Error('CF get failed '+res.status);
  return await res.text();
}
async function cfKVPut(ns, key, value){
  if(DRY_RUN) return { skipped:true };
  const url = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/storage/kv/namespaces/${ns}/values/${encodeURIComponent(key)}`;
  const res = await fetch(url,{ method:'PUT', headers:{ 'Authorization':`Bearer ${CF_API_TOKEN}` }, body:value });
  if(!res.ok) throw new Error('CF put failed '+res.status);
  return { ok:true };
}

async function migrateStore(store, ns){
  console.log(`\n=== Migrating ${store} -> namespace ${ns} ===`);
  const list = await listNetlifyBlobs(store);
  console.log(`Found ${list.length} keys in Netlify ${store}`);
  let copied=0, skipped=0, failed=0; const errors=[];
  for(const item of list){
    const key = item.key;
    try {
      if(!FORCE){
        const existing = await cfKVGet(ns,key); if(existing !== null){ skipped++; continue; }
      }
      const val = await getNetlifyBlob(store,key);
      if(val === null){ skipped++; continue; }
      await cfKVPut(ns,key,val);
      copied++;
    } catch(e){ failed++; errors.push({ key, err:e.message }); }
  }
  console.log(`Done: copied=${copied} skipped=${skipped} failed=${failed}`);
  if(errors.length) console.log('Errors sample:', errors.slice(0,5));
  return { list, copied, skipped, failed };
}

async function verifySamples(sharesList){
  console.log(`\nVerifying up to ${SAMPLE} random share keys...`);
  const sample = [...sharesList].sort(()=>0.5-Math.random()).slice(0,SAMPLE);
  let mismatches=0;
  for(const item of sample){
    const key=item.key;
    const nVal = await getNetlifyBlob('shares',key);
    const cVal = await cfKVGet(NS_SHARES,key);
    if(nVal !== cVal){ mismatches++; console.warn('Mismatch', key, nVal?.length, cVal?.length); }
  }
  console.log(`Sample verification complete. mismatches=${mismatches}/${sample.length}`);
}

(async function main(){
  console.log('Starting migration', { DRY_RUN, FORCE });
  const sharesRes = await migrateStore('shares', NS_SHARES);
  const statsRes = await migrateStore('app-stats', NS_STATS);
  if(!DRY_RUN) await verifySamples(sharesRes.list);
  console.log('\nSummary:', { shares:sharesRes, stats:statsRes });
})();
