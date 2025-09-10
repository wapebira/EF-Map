#!/usr/bin/env node
// Fetch World ABI (remote or local file) and derive event/function maps.
// Usage (remote): node tools/fetch_world_abi.js --chain 695569 --world 0x... --out data/world_abi
// Usage (local file already downloaded): node tools/fetch_world_abi.js --file eve-frontier-map/public/world-abi.json --out data/world_abi
// Produces: world_abi_raw.json, world_abi_events.json, world_abi_functions.json, world_abi_summary.json

const fs = require('fs');
const path = require('path');
const { buildEventMap, buildFunctionMap, summarizeAbi, nowIso } = require('./decode_utils.js');

function parseArgs(){
  const args = process.argv.slice(2);
  const out = {};
  for(let i=0;i<args.length;i++){
    const a = args[i];
    if(a.startsWith('--')){ out[a.slice(2)] = args[i+1] && !args[i+1].startsWith('--') ? args[++i] : '1'; }
  }
  return out;
}

async function main(){
  const { chain='695569', world, out='data/world_abi', file } = parseArgs();
  let sourceDesc = '';
  let root;
  if(file){
    sourceDesc = `file:${file}`;
    const raw = fs.readFileSync(file,'utf8');
    try { root = JSON.parse(raw); } catch(e){ console.error('Failed to parse JSON file', e.message); process.exit(1); }
  } else {
    if(!world){ console.error('Missing --world (or provide --file)'); process.exit(1); }
    const url = `https://explorer.mud.dev/api/world-abi?chainId=${chain}&worldAddress=${world}`;
    sourceDesc = url;
    console.log('[fetch_world_abi] GET', url);
    const res = await fetch(url);
    if(!res.ok){ console.error('Fetch failed', res.status); process.exit(2); }
    try { root = await res.json(); } catch(e){ console.error('Invalid JSON', e.message); process.exit(2); }
  }

  // Accept either array directly or object with .abi property (array) or object with nested .result/.data style wrappers.
  let abi = null;
  if(Array.isArray(root)) abi = root;
  else if(root && Array.isArray(root.abi)) abi = root.abi;
  else if(root && root.result && Array.isArray(root.result.abi)) abi = root.result.abi;
  else if(root && root.data && Array.isArray(root.data.abi)) abi = root.data.abi;

  if(!abi){
    console.error('Could not locate ABI array in payload keys (looked at root, .abi, .result.abi, .data.abi).');
    const sampleKeys = root && typeof root==='object' ? Object.keys(root).slice(0,20) : [];
    console.error('Top-level keys:', sampleKeys.join(','));
    process.exit(3);
  }

  const events = buildEventMap(abi);
  const functions = buildFunctionMap(abi);
  const summary = { chain, world: world||'(from file)', source: sourceDesc, fetchedAt: nowIso(), ...summarizeAbi(abi) };
  fs.mkdirSync(out, { recursive:true });
  fs.writeFileSync(path.join(out,'world_abi_raw.json'), JSON.stringify(abi, null, 2));
  fs.writeFileSync(path.join(out,'world_abi_events.json'), JSON.stringify(events, null, 2));
  fs.writeFileSync(path.join(out,'world_abi_functions.json'), JSON.stringify(functions, null, 2));
  fs.writeFileSync(path.join(out,'world_abi_summary.json'), JSON.stringify(summary, null, 2));
  console.log('[fetch_world_abi] Source', sourceDesc);
  console.log('[fetch_world_abi] Wrote', Object.keys(events).length, 'events and', Object.keys(functions).length, 'functions to', out);
}

main().catch(e=>{ console.error('Fatal', e); process.exit(10); });
