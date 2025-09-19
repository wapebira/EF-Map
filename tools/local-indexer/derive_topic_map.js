#!/usr/bin/env node
/*
 Build a map of event topic0 -> { name, signature } from the provided ABI JSON.
*/
const fs = require('fs');
const path = require('path');
require('dotenv').config();
const { keccak_256 } = require('js-sha3');

const ABI_PATH = process.env.ABI_PATH || path.resolve(__dirname, '../../eve-frontier-map/public/world-abi.json');
const OUT_PATH = process.env.OUT_PATH || path.resolve(__dirname, '../../data/derived_topic_map.json');

function readJson(p){ return JSON.parse(fs.readFileSync(p,'utf8')); }

function signatureFor(ev){
  const name = ev.name || '';
  const types = (ev.inputs||[]).map(i=>i.type || 'bytes');
  return `${name}(${types.join(',')})`;
}

function main(){
  if (!fs.existsSync(ABI_PATH)) { console.error('Missing ABI at', ABI_PATH); process.exit(2); }
  const abi = readJson(ABI_PATH);
  let events = [];
  if (Array.isArray(abi)) events = abi.filter(x=>x && x.type === 'event');
  else if (abi && Array.isArray(abi.abi)) events = abi.abi.filter(x=>x && x.type === 'event');
  // Build map
  const out = {};
  for (const ev of events){
    const sig = signatureFor(ev);
    const hash = '0x' + keccak_256(sig);
    out[hash] = { name: ev.name, signature: sig };
  }
  // Augment with common ERC events if missing
  const commons = [
    ['Transfer(address,address,uint256)','Transfer'],
    ['Approval(address,address,uint256)','Approval']
  ];
  for (const [sig, name] of commons){
    const h = '0x' + keccak_256(sig);
    if (!out[h]) out[h] = { name, signature: sig };
  }
  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  fs.writeFileSync(OUT_PATH, JSON.stringify(out, null, 2));
  console.log(JSON.stringify({ status:'ok', events: Object.keys(out).length, out: OUT_PATH }));
}

main();
