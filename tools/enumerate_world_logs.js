#!/usr/bin/env node
// Enumerate all logs for a contract address over a block range (no topic filter) in chunks.
// Aggregates topic0 counts and prints first/last occurrence blocks per topic.
// Usage: node tools/enumerate_world_logs.js --rpc <url> --world 0x... --from <startBlock> --to <endBlock> [--chunk 500]

function arg(name, def){
  const i = process.argv.indexOf('--'+name);
  if(i!==-1 && i+1 < process.argv.length) return process.argv[i+1];
  const kv = process.argv.find(a=> a.startsWith('--'+name+'='));
  if(kv) return kv.split('=')[1];
  return def;
}

const rpc = arg('rpc');
const world = (arg('world','')||'').toLowerCase();
const fromBlock = BigInt(arg('from','0'));
const toBlock = BigInt(arg('to','0'));
const chunkSize = BigInt(arg('chunk','500'));
if(!rpc || !world || !fromBlock || !toBlock){
  console.error('Missing required args: --rpc --world --from --to');
  process.exit(1);
}
if(fromBlock > toBlock){ console.error('from > to'); process.exit(1); }

async function rpcCall(method, params){
  const r = await fetch(rpc,{ method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ jsonrpc:'2.0', id:1, method, params }) });
  if(!r.ok) throw new Error('rpc_http_'+r.status);
  const j = await r.json(); if(j.error) throw new Error('rpc_'+j.error.message);
  return j.result;
}

function hex(n){ return '0x'+n.toString(16); }

async function main(){
  console.log(JSON.stringify({ action:'enumerate_start', rpc, world, from:Number(fromBlock), to:Number(toBlock), chunk:Number(chunkSize) }));
  const topics = new Map(); // topic0 -> { count, first, last }
  let totalLogs=0; let errors=0;
  let cur = fromBlock;
  while(cur <= toBlock){
    const end = cur + chunkSize - 1n <= toBlock ? cur + chunkSize - 1n : toBlock;
    try {
      const logs = await rpcCall('eth_getLogs',[{ address: world, fromBlock: hex(cur), toBlock: hex(end) }]);
      for(const log of logs){
        totalLogs++;
        const t0 = (log.topics && log.topics[0])? log.topics[0].toLowerCase(): '0x';
        const bn = Number(BigInt(log.blockNumber));
        const rec = topics.get(t0) || { count:0, first:bn, last:bn };
        rec.count++; if(bn < rec.first) rec.first = bn; if(bn > rec.last) rec.last = bn;
        topics.set(t0, rec);
      }
    } catch(e){ errors++; console.error('range_error', String(e)); }
    cur = end + 1n;
  }
  const summary = Array.from(topics.entries()).map(([topic0, data])=> ({ topic0, ...data }))
    .sort((a,b)=> b.count - a.count);
  console.log(JSON.stringify({ action:'enumerate_complete', totalLogs, uniqueTopics: summary.length, errors, summary }, null, 2));
}

main().catch(e=> { console.error('fatal', e); process.exit(1); });
