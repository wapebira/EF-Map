#!/usr/bin/env node
// Diagnostic script: probe MUD Store event topics across a block range
// Usage: node tools/diagnose_store_logs.js --rpc https://rpc.pyropechain.com --world 0x... \
//        --from 7288348 --to 7289348 --topics-file scratch/topics.json
// It performs two scans per topic:
//  (A) address constrained (world)  (B) no address filter
// Summarizes counts, distinct addresses actually emitting, first/last block per topic.

const fs = require('fs');

function arg(name, def){
  const i = process.argv.indexOf('--'+name);
  if(i!==-1 && i+1 < process.argv.length) return process.argv[i+1];
  const flagIndex = process.argv.findIndex(a=> a.startsWith('--'+name+'='));
  if(flagIndex!==-1){ return process.argv[flagIndex].split('=')[1]; }
  return def;
}

const rpc = arg('rpc');
const world = (arg('world','')||'').toLowerCase();
const fromBlock = BigInt(arg('from','0'));
const toBlock = BigInt(arg('to','0'));
const topicsFile = arg('topics-file','scratch/topics.json');
let topics=null;
try { const txt = fs.readFileSync(topicsFile,'utf8'); const j=JSON.parse(txt); if(Array.isArray(j)) topics=j; else if(Array.isArray(j.events)) topics=j.events.map(e=> e.topic0); } catch(e){
  console.error('Failed to read topics file', e.message); process.exit(1);
}
if(!rpc || !world || !fromBlock || !toBlock || !topics){
  console.error('Missing required args. --rpc --world --from --to --topics-file');
  process.exit(1);
}
if(fromBlock > toBlock){
  console.error('from block > to block'); process.exit(1);
}

async function rpcCall(method, params){
  const res = await fetch(rpc,{ method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ jsonrpc:'2.0', id:1, method, params }) });
  if(!res.ok){ throw new Error('rpc_http_'+res.status); }
  const j = await res.json(); if(j.error) throw new Error('rpc_'+j.error.message);
  return j.result;
}

function hex(n){ return '0x'+n.toString(16); }

async function main(){
  console.log(JSON.stringify({ action:'diagnose_start', rpc, world, from:Number(fromBlock), to:Number(toBlock), topics }, null, 2));
  const summary = [];
  for(const topic of topics){
    const range = { fromBlock: hex(fromBlock), toBlock: hex(toBlock) };
    let withAddrLogs=[]; let anyAddrLogs=[];
    try { withAddrLogs = await rpcCall('eth_getLogs',[ { address: world, topics:[topic], ...range } ]); } catch(e){ console.error('withAddr error', topic, e.message); }
    try { anyAddrLogs = await rpcCall('eth_getLogs',[ { topics:[topic], ...range } ]); } catch(e){ console.error('noAddr error', topic, e.message); }
    const distinctAddresses = Array.from(new Set(anyAddrLogs.map(l=> l.address?.toLowerCase())));
    const worldCount = withAddrLogs.length;
    const totalCount = anyAddrLogs.length;
    const otherAddrs = distinctAddresses.filter(a=> a !== world);
    function firstLast(logs){
      if(!logs.length) return null;
      const blocks = logs.map(l=> Number(BigInt(l.blockNumber))).sort((a,b)=>a-b);
      return { first: blocks[0], last: blocks[blocks.length-1] };
    }
    summary.push({ topic, worldCount, totalCount, distinctAddresses: distinctAddresses.length, otherAddresses: otherAddrs.slice(0,10), blocksWorld: firstLast(withAddrLogs), blocksAny: firstLast(anyAddrLogs) });
  }
  console.log(JSON.stringify({ action:'diagnose_complete', from:Number(fromBlock), to:Number(toBlock), summary }, null, 2));
}

main().catch(e=>{ console.error('fatal', e); process.exit(1); });
