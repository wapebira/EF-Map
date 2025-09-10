// Fetch and list all MUD tableIds registered by the world contract.
// Usage: node tools/list_mud_tables.js [--from <block>] [--to <block>]
// Requires: viem (installed) Node >=18

import { createPublicClient, http, decodeEventLog } from 'viem';

const RPC = process.env.PYROPE_RPC || 'https://rpc.pyropechain.com';
const WORLD = (process.env.WORLD_ADDRESS || '0x7085f3e652987f656fb8dee5aa6592197bb75de8').toLowerCase();
// Known deployment block discovered earlier (decision log)
const DEPLOY_BLOCK = 7288348n;

const args = process.argv.slice(2);
function argAfter(flag){ const i = args.indexOf(flag); return i>=0 ? args[i+1] : undefined; }
const fromArg = argAfter('--from');
const toArg = argAfter('--to');
const fromBlock = fromArg ? BigInt(fromArg) : DEPLOY_BLOCK;
const toBlock = toArg ? BigInt(toArg) : undefined;

// Minimal ABI (two possible event names)
const ABI = [
  { type:'event', name:'Store_RegisterTable', inputs:[
    { indexed:true, name:'tableId', type:'bytes32' },
    { indexed:false, name:'fieldLayout', type:'bytes32' },
    { indexed:false, name:'keySchema', type:'bytes32' },
    { indexed:false, name:'valueSchema', type:'bytes32' },
  ]},
  { type:'event', name:'RegisterTable', inputs:[
    { indexed:true, name:'tableId', type:'bytes32' },
    { indexed:false, name:'fieldLayout', type:'bytes32' },
    { indexed:false, name:'keySchema', type:'bytes32' },
    { indexed:false, name:'valueSchema', type:'bytes32' },
  ]},
];

const client = createPublicClient({ transport: http(RPC) });

function decodeTableId(id){
  // id is 32 bytes: first 16 namespace (null padded), next 16 name (null padded)
  const hex = id.toLowerCase();
  if(!hex.startsWith('0x') || hex.length !== 66) return { raw: id, namespace:'?', name:'?', error:'unexpected length'};
  const nsHex = hex.slice(2, 34); // 16 bytes = 32 hex chars
  const nameHex = hex.slice(34);
  function hexToAscii(h){
    let out='';
    for(let i=0;i<h.length;i+=2){
      const byte = parseInt(h.slice(i,i+2),16);
      if(byte === 0) break; // stop at first null
      if(byte >= 32 && byte <= 126) out += String.fromCharCode(byte);
    }
    return out;
  }
  return { raw:id, namespace:hexToAscii(nsHex), name:hexToAscii(nameHex) };
}

(async () => {
  const tableIds = new Set();
  const latestBlockHex = await client.getBlockNumber();
  const endBlock = toBlock ?? latestBlockHex;
  const CHUNK = 5_000n; // smaller chunk to reduce timeout risk
  for (let start = fromBlock; start <= endBlock; start += CHUNK + 1n) {
    const end = start + CHUNK > endBlock ? endBlock : start + CHUNK;
    try {
      const logs = await client.getLogs({ address: WORLD, fromBlock: start, toBlock: end });
      for (const log of logs) {
        for (const evt of ABI) {
          try {
            const parsed = decodeEventLog({ abi: [evt], data: log.data, topics: log.topics });
            if (parsed.eventName === 'Store_RegisterTable' || parsed.eventName === 'RegisterTable') {
              tableIds.add(parsed.args.tableId.toLowerCase());
            }
          } catch {}
        }
      }
  process.stderr.write(`Processed blocks ${start} - ${end} (tables: ${tableIds.size})\n`);
  // brief delay to avoid provider throttling
  await new Promise(r=>setTimeout(r, 150));
    } catch (err) {
      process.stderr.write(`Chunk failed ${start}-${end}: ${err?.message || err}\n`);
  // backoff then continue
  await new Promise(r=>setTimeout(r, 500));
    }
  }
  const decoded = [...tableIds].map(decodeTableId).sort((a,b)=> (a.namespace+a.name).localeCompare(b.namespace+b.name));
  const out = { world: WORLD, rpc: RPC, fromBlock: fromBlock.toString(), toBlock: endBlock.toString(), count: decoded.length, tables: decoded };
  console.log(JSON.stringify(out,null,2));
})();
