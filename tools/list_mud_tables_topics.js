// Lightweight tableId enumerator using direct eth_getLogs with topic0 filter.
// Usage: node tools/list_mud_tables_topics.js [--from <block>] [--to <block>] [--chunk <size>]
// Event signatures covered: Store_RegisterTable(bytes32,bytes32,bytes32,bytes32) and RegisterTable(...)
// We filter by both possible topic0 hashes.

import { keccak256, toBytes } from 'viem';

const RPC = process.env.PYROPE_RPC || 'https://rpc.pyropechain.com';
const WORLD = (process.env.WORLD_ADDRESS || '0x7085f3e652987f656fb8dee5aa6592197bb75de8').toLowerCase();
const DEPLOY_BLOCK = 7288348n;

const args = process.argv.slice(2);
function argAfter(flag){ const i = args.indexOf(flag); return i>=0 ? args[i+1] : undefined; }
const fromBlock = argAfter('--from') ? BigInt(argAfter('--from')) : DEPLOY_BLOCK;
const toBlockArg = argAfter('--to') ? BigInt(argAfter('--to')) : undefined;
const chunk = argAfter('--chunk') ? BigInt(argAfter('--chunk')) : 4000n;

// Precompute topic0 values
const sigs = [
  'Store_RegisterTable(bytes32,bytes32,bytes32,bytes32)',
  'RegisterTable(bytes32,bytes32,bytes32,bytes32)'
];
const topics = sigs.map(s => keccak256(toBytes(new TextEncoder().encode(s))));

function hex(n){ return '0x'+n.toString(16); }

async function rpc(method, params){
  const res = await fetch(RPC, { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ jsonrpc:'2.0', id:1, method, params }) });
  if(!res.ok) throw new Error(`HTTP ${res.status}`);
  const j = await res.json();
  if(j.error) throw new Error(j.error.message || 'RPC error');
  return j.result;
}

function decodeTableId(id){
  const hex = id.toLowerCase();
  if(!hex.startsWith('0x') || hex.length !== 66) return { raw:id, namespace:'?', name:'?' };
  const ns = hex.slice(2,34); const nm = hex.slice(34);
  const toAscii = h=>{ let out=''; for(let i=0;i<h.length;i+=2){ const b=parseInt(h.slice(i,i+2),16); if(b===0) break; if(b>=32 && b<=126) out+=String.fromCharCode(b);} return out; };
  return { raw:id, namespace: toAscii(ns), name: toAscii(nm) };
}

(async () => {
  const latest = toBlockArg ?? BigInt(await rpc('eth_blockNumber', []));
  const tableIds = new Set();
  for(let start = fromBlock; start <= latest; start += chunk + 1n){
    const end = start + chunk > latest ? latest : start + chunk;
    for(const topic of topics){
      try {
        const logs = await rpc('eth_getLogs', [{ address: WORLD, topics:[topic], fromBlock: hex(start), toBlock: hex(end) }]);
        for(const log of logs){
          // first indexed topic after topic0 is tableId
          if(log.topics && log.topics.length > 1){ tableIds.add(log.topics[1].toLowerCase()); }
        }
      } catch(e){
        process.stderr.write(`warn chunk ${start}-${end} topic short: ${e.message}\n`);
        await new Promise(r=>setTimeout(r,250));
      }
    }
    process.stderr.write(`blocks ${start}-${end} tables=${tableIds.size}\n`);
    await new Promise(r=>setTimeout(r,150));
  }
  const decoded = [...tableIds].map(decodeTableId).sort((a,b)=>(a.namespace+a.name).localeCompare(b.namespace+b.name));
  console.log(JSON.stringify({ world:WORLD, fromBlock: fromBlock.toString(), toBlock: latest.toString(), count: decoded.length, tables: decoded }, null, 2));
})();
