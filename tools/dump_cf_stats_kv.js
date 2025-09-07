#!/usr/bin/env node
/**
 * Dump Cloudflare KV stats namespace (EF_STATS) for verification.
 * Requires env: CF_ACCOUNT_ID, CF_API_TOKEN, CF_KV_STATS_NAMESPACE_ID
 * Output: prints key list (filtered to current + daily/*.json), fetches each, writes combined file dump_cf_stats_<timestamp>.json
 */
import fs from 'fs';
import path from 'path';
import fetch from 'node-fetch';

const CF_ACCOUNT_ID = process.env.CF_ACCOUNT_ID;
const CF_API_TOKEN = process.env.CF_API_TOKEN;
const NS = process.env.CF_KV_STATS_NAMESPACE_ID;
if(!CF_ACCOUNT_ID||!CF_API_TOKEN||!NS){
  console.error('Missing required env (CF_ACCOUNT_ID / CF_API_TOKEN / CF_KV_STATS_NAMESPACE_ID).');
  process.exit(1);
}

const headers = { 'Authorization': `Bearer ${CF_API_TOKEN}` };

async function listAllKeys(prefix){
  let cursor=null; const keys=[];
  while(true){
    const url = new URL(`https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/storage/kv/namespaces/${NS}/keys`);
    if(prefix) url.searchParams.set('prefix', prefix);
    if(cursor) url.searchParams.set('cursor', cursor);
    url.searchParams.set('limit','1000');
    const res = await fetch(url.toString(), { headers });
    if(!res.ok){ throw new Error('List failed '+res.status); }
    const json = await res.json();
    if(!json.success) throw new Error('List response not success');
    for(const k of json.result){ keys.push(k.name); }
    if(json.result_info && json.result_info.cursor){ cursor = json.result_info.cursor; } else break;
  }
  return keys;
}

async function getValue(key){
  const url = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/storage/kv/namespaces/${NS}/values/${encodeURIComponent(key)}`;
  const res = await fetch(url, { headers });
  if(res.status===404) return null;
  if(!res.ok) throw new Error('Get failed '+res.status);
  return await res.text();
}

(async function main(){
  try {
    console.log('Listing stats keys...');
    const all = await listAllKeys('');
    const filtered = all.filter(k=> k==='current' || k.startsWith('daily/')); // narrow
    filtered.sort();
    console.log('Found keys:', filtered.length, filtered);
    const snapshots=[]; let missing=0;
    for(const k of filtered){
      const raw = await getValue(k);
      if(raw===null){ missing++; continue; }
      try { const json = JSON.parse(raw); snapshots.push({ key:k, ...json }); }
      catch { snapshots.push({ key:k, raw }); }
    }
    const out = { generatedAt: new Date().toISOString(), namespace: NS, keyCount: filtered.length, missing, snapshots };
    const fname = path.join(process.cwd(), `dump_cf_stats_${Date.now()}.json`);
    fs.writeFileSync(fname, JSON.stringify(out,null,2));
    console.log('Dump written:', fname);
    // Print concise summary of daily coverage
    const days = snapshots.filter(s=> s.key.startsWith('daily/')).map(s=> s.key.slice(6).replace('.json','')).sort();
    console.log('Daily dates:', days.join(', '));
    if(snapshots.length){
      const sample = snapshots.find(s=> s.key.startsWith('daily/'));
      if(sample){
        const counters = Object.keys(sample.counters||{}).slice(0,10);
        console.log('Sample counters from one day:', counters);
      }
    }
  } catch(e){
    console.error('Dump error', e);
    process.exit(1);
  }
})();
