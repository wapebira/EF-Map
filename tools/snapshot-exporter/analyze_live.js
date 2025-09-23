#!/usr/bin/env node
// Analyze live snapshots downloaded to tmp_live_links.json and tmp_live_acl.json
const fs = require('fs');

function readJson(path){
  const txt = fs.readFileSync(path, 'utf8').replace(/^\uFEFF/, '').trim();
  return JSON.parse(txt);
}

function topN(mapObj, n){
  const arr = Array.from(mapObj.entries());
  arr.sort((a,b)=> b[1]-a[1]);
  return arr.slice(0, n);
}

function main(){
  const linksPath = process.argv[2] || 'tmp_live_links.json';
  const aclPath = process.argv[3] || 'tmp_live_acl.json';
  const suffix = process.argv[4] || '28530';

  const links = readJson(linksPath);
  const acl = readJson(aclPath);

  const counts = new Map();
  for(const l of links.links||[]){
    const t = l.tribeId || (Array.isArray(l.tribes) && l.tribes[0]) || 'none';
    counts.set(t, (counts.get(t)||0)+1);
  }
  const top = topN(counts, 10).map(([tribeId, count])=>({ tribeId, count }));

  const matches = (links.links||[]).filter(l=> String(l.gateId||'').endsWith(suffix));
  const aclIndex = new Map();
  for(const r of (acl.rules||[])) aclIndex.set(String(r.gate_id), r);

  const details = matches.map(l=>{
    const r = aclIndex.get(String(l.gateId));
    return {
      gateId: l.gateId,
      tribeId: l.tribeId || (Array.isArray(l.tribes) && l.tribes[0]) || null,
      origin: l.origin,
      destination: l.destination,
      acl: r ? { appliedSystemId: r.appliedSystemId, isPublic: !!r.isPublic, fromSystemId: r.fromSystemId, toSystemId: r.toSystemId } : null
    };
  });

  const out = {
    updatedAt: links.updatedAt,
    total: (links.links||[]).length,
    topTribes: top,
    defaultCount: counts.get('1000167')||0,
    gateSuffix: suffix,
    matches: details
  };
  console.log(JSON.stringify(out, null, 2));
}

main();
