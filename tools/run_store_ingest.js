#!/usr/bin/env node
// Helper script to invoke remote preview store ingest avoiding PowerShell escaping issues.
// Usage: node tools/run_store_ingest.js [maxBlocks]
import fs from 'fs';

const PREVIEW_URL = 'https://indexer-preview.ef-map.pages.dev/api/indexer-ingest?openPreview=1';
const RPC = 'https://rpc.pyropechain.com';
const WORLD = '0x7085f3e652987f656fb8dee5aa6592197bb75de8';
const DEPLOY_BLOCK = 7288348;
const maxBlocks = Number(process.argv[2]||800);

const topicsPath = 'scratch/topics.json';
if(!fs.existsSync(topicsPath)){
  console.error('Missing topics file at', topicsPath);
  process.exit(1);
}
const topicsJson = JSON.parse(fs.readFileSync(topicsPath,'utf8'));
const topics = (topicsJson.events||[]).map(e=> e.topic0).slice(0,20);

const body = { mode:'store', rpc: RPC, world: WORLD, deployBlock: DEPLOY_BLOCK, maxBlocks, topics };

(async()=>{
  try {
    const resp = await fetch(PREVIEW_URL,{ method:'POST', headers:{ 'content-type':'application/json' }, body: JSON.stringify(body) });
    const txt = await resp.text();
    let parsed; try { parsed = JSON.parse(txt); } catch { parsed = { raw: txt }; }
    console.log('Ingest Response:', JSON.stringify(parsed,null,2));
  } catch(e){
    console.error('Ingest error', e);
    process.exit(2);
  }
})();
