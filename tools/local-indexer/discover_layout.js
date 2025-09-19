#!/usr/bin/env node
/*
 Cross-reference inventory topic0s with known topics from topic_map.json (frontend) and emit a summary.
*/
const fs = require('fs');
const path = require('path');
require('dotenv').config();

// Support CLI flags: --inventory, --topic-map, --out
const argv = process.argv.slice(2);
function getFlag(name, fallback){
  const ix = argv.findIndex(a=>a === `--${name}`);
  if (ix >= 0 && argv[ix+1]) return path.resolve(process.cwd(), argv[ix+1]);
  return fallback;
}
const INVENTORY_PATH = getFlag('inventory', process.env.INVENTORY_PATH || path.resolve(__dirname, '../../data/inventory.json'));
const TOPIC_MAP_PATH = getFlag('topic-map', process.env.TOPIC_MAP_PATH || path.resolve(__dirname, '../../eve-frontier-map/public/topic_map.json'));
const OUT_PATH = getFlag('out', process.env.OUT_PATH || path.resolve(__dirname, '../../data/discovered_topics.json'));

function readJson(p){ return JSON.parse(fs.readFileSync(p,'utf8')); }

function main(){
  if (!fs.existsSync(INVENTORY_PATH)) {
    console.error('Missing inventory at', INVENTORY_PATH, 'Run: npm run local:inventory');
    process.exit(2);
  }
  if (!fs.existsSync(TOPIC_MAP_PATH)) {
    console.error('Missing topic_map.json at', TOPIC_MAP_PATH);
    process.exit(2);
  }
  const inv = readJson(INVENTORY_PATH);
  const topicMap = readJson(TOPIC_MAP_PATH);
  const knownByHash = new Map();
  for (const [hash, info] of Object.entries(topicMap)) {
    knownByHash.set(hash.toLowerCase(), info);
  }

  const rows = (inv.top?.topic0s)||[];
  const mapped = []; const unknown = [];
  for (const r of rows) {
    const h = (r.t||'').toLowerCase();
    const info = knownByHash.get(h) || null;
    if (info) mapped.push({ t:h, c:r.c, name:info.name||null, signature:info.signature||null });
    else unknown.push({ t:h, c:r.c });
  }
  const out = { totalTopics: rows.length, mapped: mapped.length, unknown: unknown.length, topMapped: mapped.slice(0, 50), topUnknown: unknown.slice(0, 50) };
  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  fs.writeFileSync(OUT_PATH, JSON.stringify(out, null, 2));
  console.log(JSON.stringify({ status:'ok', out: OUT_PATH, mapped: mapped.length, unknown: unknown.length }));
}

main();
