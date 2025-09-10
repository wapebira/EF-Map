#!/usr/bin/env node
// One-off store ingestion trigger.
// Usage:
//   node tools/store_ingest_once.js --endpoint http://127.0.0.1:8787 --rpc https://rpcpyropchain.com --world 0x7085f3e652987f656fB8dEE5aA6592197Bb75de8 --deploy 7288348 --maxBlocks 2000
// Optional: --topicsFile tools/mud_event_topics.json (expects JSON array of topic0 strings)
// If no topicsFile provided, requires --topics <comma-separated-hashes>

const fs = require('fs');

function parseArgs(){
  const args = process.argv.slice(2); const out={};
  for(let i=0;i<args.length;i++){
    const a=args[i];
    if(a.startsWith('--')){
      const k=a.slice(2);
      const v = (i+1<args.length && !args[i+1].startsWith('--')) ? args[++i] : 'true';
      out[k]=v;
    }
  }
  return out;
}

(async()=>{
  const a=parseArgs();
  const endpoint = a.endpoint || 'http://127.0.0.1:8787';
  const rpc = a.rpc;
  const world = (a.world||'').toLowerCase();
  const deployBlock = parseInt(a.deploy||a.deployBlock||'0',10);
  const maxBlocks = parseInt(a.maxBlocks||'3000',10);
  if(!rpc||!world||!deployBlock){
    console.error('Missing required --rpc, --world, --deploy');
    process.exit(1);
  }
  let topics=[];
  if(a.topicsFile){
    try { topics = JSON.parse(fs.readFileSync(a.topicsFile,'utf8')); } catch(e){ console.error('Failed reading topicsFile:', e.message); process.exit(1);}  
  } else if(a.topics){
    topics = a.topics.split(',').map(s=>s.trim()).filter(Boolean);
  }
  if(!topics.length){
    console.error('No topics provided. Use --topicsFile or --topics');
    process.exit(1);
  }
  const body={ mode:'store', rpc, world, deployBlock, maxBlocks, topics };
  const url = endpoint.replace(/\/$/,'') + '/api/indexer-ingest';
  console.log('POST', url, 'blocks<=', maxBlocks, 'topics', topics.length);
  try {
    const res = await fetch(url,{ method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify(body) });
    const txt = await res.text();
    console.log('Status', res.status);
    console.log(txt);
  } catch(e){
    console.error('Request failed', e);
    process.exit(1);
  }
})();
