// Incremental tableId discovery + persistence.
// Usage: node tools/ingest_tableids.js [--once] [--maxChunks N]
// Persists state in ./scratch/tableIds_state.json
// Confirmation depth: 8 (finalizes table registration only after depth satisfied)
// Includes ephemeral events (we track tableIds regardless of ephemerality; inclusion choice is for downstream filtering).

import { keccak256, toBytes } from 'viem';
import fs from 'fs';

const RPC = process.env.PYROPE_RPC || 'https://rpc.pyropechain.com';
const WORLD = (process.env.WORLD_ADDRESS || '0x7085f3e652987f656fb8dee5aa6592197bb75de8').toLowerCase();
const DEPLOY_BLOCK = 7288348n;
const CONFIRM_DEPTH = 8n;
const STATE_PATH = 'scratch/tableIds_state.json';

const REGISTER_SIGS = [
  'Store_RegisterTable(bytes32,bytes32,bytes32,bytes32)',
  'RegisterTable(bytes32,bytes32,bytes32,bytes32)'
];
const REGISTER_TOPICS = REGISTER_SIGS.map(s => keccak256(toBytes(new TextEncoder().encode(s))));

function hex(n){ return '0x'+n.toString(16); }
async function rpc(method, params){
  const res = await fetch(RPC, { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ jsonrpc:'2.0', id:1, method, params }) });
  if(!res.ok) throw new Error(`HTTP ${res.status}`); const j = await res.json(); if(j.error) throw new Error(j.error.message); return j.result; }

function loadState(){
  if(!fs.existsSync(STATE_PATH)) return { cursorBlock: DEPLOY_BLOCK, cursorLogIndex: 0, provisional: [], finalized: [], lastHead: 0 };
  try { return JSON.parse(fs.readFileSync(STATE_PATH,'utf8')); } catch { return { cursorBlock: DEPLOY_BLOCK, cursorLogIndex:0, provisional:[], finalized:[], lastHead:0 }; }
}
function saveState(s){ fs.writeFileSync(STATE_PATH, JSON.stringify(s,null,2)); }

function decodeTableId(id){
  const h = id.toLowerCase(); if(!h.startsWith('0x')||h.length!==66) return { raw:id, namespace:'?', name:'?' };
  const nsHex = h.slice(2,34), nameHex=h.slice(34);
  const toAscii = hh=>{ let out=''; for(let i=0;i<hh.length;i+=2){ const b=parseInt(hh.slice(i,i+2),16); if(b===0) break; if(b>=32&&b<=126) out+=String.fromCharCode(b);} return out; };
  return { raw:id, namespace:toAscii(nsHex), name:toAscii(nameHex) };
}

async function step(maxChunks){
  const state = loadState();
  const latest = BigInt(await rpc('eth_blockNumber', []));
  state.lastHead = Number(latest);
  const effectiveEnd = latest - CONFIRM_DEPTH; // do not process unfinalized blocks
  if(effectiveEnd < DEPLOY_BLOCK){ console.log('Head too close to deployment; waiting.'); return; }
  const CHUNK = 3000n;
  let chunks = 0;
  while(state.cursorBlock <= effectiveEnd && (!maxChunks || chunks < maxChunks)){
    const start = BigInt(state.cursorBlock);
    const end = start + CHUNK > effectiveEnd ? effectiveEnd : start + CHUNK;
    // fetch register logs per topic to reduce payload
    for(const topic of REGISTER_TOPICS){
      try {
        const logs = await rpc('eth_getLogs', [{ address: WORLD, topics:[topic], fromBlock: hex(start), toBlock: hex(end) }]);
        for(const log of logs){
          const blockNum = BigInt(log.blockNumber);
            const tableId = log.topics[1].toLowerCase();
            if(!state.provisional.find(t=>t.id===tableId) && !state.finalized.find(t=>t.id===tableId)){
              state.provisional.push({ id: tableId, block: Number(blockNum) });
            }
        }
      } catch(e){
        process.stderr.write(`warn register fetch ${start}-${end} ${e.message}\n`);
      }
    }
    // finalize any provisional whose block <= effectiveEnd
    const still = [];
    for(const t of state.provisional){
      if(BigInt(t.block) <= effectiveEnd){
        state.finalized.push(t);
      } else still.push(t);
    }
    state.provisional = still;
    state.cursorBlock = Number(end + 1n);
    chunks++;
    saveState(state);
    process.stderr.write(`chunk ${start}-${end} finalized=${state.finalized.length} provisional=${state.provisional.length}\n`);
  }
  // produce decoded output summary
  const decoded = state.finalized.map(t=> ({ ...decodeTableId(t.id), block: t.block }));
  decoded.sort((a,b)=> (a.namespace+a.name).localeCompare(b.namespace+b.name));
  console.log(JSON.stringify({ world:WORLD, confirmationDepth: Number(CONFIRM_DEPTH), finalizedCount: decoded.length, tables: decoded, nextBlock: state.cursorBlock }, null, 2));
}

const ONCE = process.argv.includes('--once');
const maxChunksFlag = process.argv.indexOf('--maxChunks');
const maxChunks = maxChunksFlag>=0 ? parseInt(process.argv[maxChunksFlag+1]) : undefined;

(async () => {
  await step(maxChunks);
  if(!ONCE){
    // poll head every 15s
    setInterval(()=> step(maxChunks).catch(e=>process.stderr.write('step error '+e.message+'\n')), 15000);
  }
})();
