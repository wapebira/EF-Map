#!/usr/bin/env node
// Build consolidated topic/function selector map + ABI hash.
// Usage: node tools/build_topic_map.js --abiDir data/world_abi --out data/world_abi
// Outputs: topic_map.json (events + functions + meta)

const fs = require('fs');
const path = require('path');
const { keccak_256 } = require('js-sha3');

function parseArgs(){
  const args = process.argv.slice(2); const out={};
  for(let i=0;i<args.length;i++){ const a=args[i]; if(a.startsWith('--')) out[a.slice(2)] = (args[i+1] && !args[i+1].startsWith('--'))? args[++i] : '1'; }
  return out;
}

function stableStringify(obj){
  if(Array.isArray(obj)) return '['+obj.map(stableStringify).join(',')+']';
  if(obj && typeof obj === 'object'){
    return '{'+Object.keys(obj).sort().map(k=>JSON.stringify(k)+':'+stableStringify(obj[k])).join(',')+'}';
  }
  return JSON.stringify(obj);
}

function main(){
  const { abiDir='data/world_abi', out=abiDir } = parseArgs();
  const rawPath = path.join(abiDir,'world_abi_raw.json');
  const eventsPath = path.join(abiDir,'world_abi_events.json');
  const functionsPath = path.join(abiDir,'world_abi_functions.json');
  if(!fs.existsSync(rawPath)) { console.error('Missing', rawPath); process.exit(1); }
  const abi = JSON.parse(fs.readFileSync(rawPath,'utf8'));
  const events = fs.existsSync(eventsPath)? JSON.parse(fs.readFileSync(eventsPath,'utf8')) : {};
  const functions = fs.existsSync(functionsPath)? JSON.parse(fs.readFileSync(functionsPath,'utf8')) : {};
  // Deterministic hash of full ABI object (order-insensitive) for versioning.
  const abiHash = '0x'+keccak_256(stableStringify(abi));
  const meta = { generatedAt: new Date().toISOString(), abiHash, eventCount: Object.keys(events).length, functionCount: Object.keys(functions).length };
  const combined = { meta, events, functions };
  const outFile = path.join(out,'topic_map.json');
  fs.writeFileSync(outFile, JSON.stringify(combined,null,2));
  console.log('[build_topic_map] Wrote', outFile, 'hash', abiHash);
}

main();
