// Unified Store event ingestion for organic tableId discovery.
// Usage: node tools/ingest_tables_from_store.js [--once] [--maxChunks N] [--chunkSize 3000]
// Scans MUD Store persistent + (optionally) ephemeral events; every unseen tableId is added
// to provisional set then finalized after confirmation depth.
// State file: scratch/store_tableIds_state.json
// This eliminates need for pre-scanning RegisterTable events.

import fs from 'fs';
import { keccak256, toBytes } from 'viem';

const RPC = process.env.PYROPE_RPC || 'https://rpc.pyropechain.com';
const WORLD = (process.env.WORLD_ADDRESS || '0x7085f3e652987f656fb8dee5aa6592197bb75de8').toLowerCase();
const DEPLOY_BLOCK = 7288348n;
const CONFIRM_DEPTH = BigInt(process.env.CONFIRM_DEPTH || 8);
const INCLUDE_EPHEMERAL = (process.env.INCLUDE_EPHEMERAL || 'true') !== 'false';
const STATE_PATH = 'scratch/store_tableIds_state.json';

// Core store events (topic0 hashes documented in decision log).
const EVENT_SIGNATURES = [
  'StoreSetRecord(bytes32,bytes32,bytes)',
  'StoreSetField(bytes32,bytes32,uint8,bytes)',
  'StoreDeleteRecord(bytes32,bytes32)'
];
if (INCLUDE_EPHEMERAL) {
  EVENT_SIGNATURES.push('StoreEphemeralRecord(bytes32,bytes32,bytes)');
  EVENT_SIGNATURES.push('StoreEphemeralRecordValue(bytes32,bytes32,uint8,bytes)');
}
const TOPICS = EVENT_SIGNATURES.map(s => keccak256(toBytes(new TextEncoder().encode(s))));

function hex(n){ return '0x'+n.toString(16); }
async function rpc(method, params){
  const res = await fetch(RPC, { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ jsonrpc:'2.0', id:1, method, params }) });
  if(!res.ok) throw new Error(`HTTP ${res.status}`);
  const j = await res.json();
  if(j.error) throw new Error(j.error.message);
  return j.result;
}
function loadState(){
  if(!fs.existsSync(STATE_PATH)) return { cursorBlock: Number(DEPLOY_BLOCK), provisional: [], finalized: [], lastHead: 0 };
  try { return JSON.parse(fs.readFileSync(STATE_PATH,'utf8')); } catch { return { cursorBlock: Number(DEPLOY_BLOCK), provisional: [], finalized: [], lastHead:0 }; }
}
function saveState(s){ fs.writeFileSync(STATE_PATH, JSON.stringify(s,null,2)); }
function decodeTableId(id){
  const h = id.toLowerCase(); if(!h.startsWith('0x')||h.length!==66) return { raw:id, namespace:'?', name:'?' };
  const nsHex = h.slice(2,34), nameHex=h.slice(34);
  const toAscii = hh=>{ let out=''; for(let i=0;i<hh.length;i+=2){ const b=parseInt(hh.slice(i,i+2),16); if(b===0) break; if(b>=32&&b<=126) out+=String.fromCharCode(b);} return out; };
  return { raw:id, namespace:toAscii(nsHex), name:toAscii(nameHex) };
}

async function step({ chunkSize, maxChunks }){
  const state = loadState();
  const latest = BigInt(await rpc('eth_blockNumber', []));
  state.lastHead = Number(latest);
  const finalizedHead = latest - CONFIRM_DEPTH;
  if(finalizedHead < DEPLOY_BLOCK){ console.log('Head too close to deployment; waiting.'); return; }
  let chunks = 0;
  while(BigInt(state.cursorBlock) <= finalizedHead && (!maxChunks || chunks < maxChunks)){
    const start = BigInt(state.cursorBlock);
    const end = (()=>{ const e = start + BigInt(chunkSize); return e > finalizedHead ? finalizedHead : e; })();
    // Multi-topic OR: fetch per topic to keep payload small (no address+[] OR supported).
    for(const topic of TOPICS){
      try {
        const logs = await rpc('eth_getLogs', [{ address: WORLD, topics:[topic], fromBlock: hex(start), toBlock: hex(end) }]);
        for(const log of logs){
          const tableId = log.topics[1]?.toLowerCase();
          if(!tableId) continue; // safety
          if(!state.provisional.find(t=>t.id===tableId) && !state.finalized.find(t=>t.id===tableId)){
            state.provisional.push({ id: tableId, block: Number(BigInt(log.blockNumber)) });
          }
        }
      } catch(e){
        process.stderr.write(`warn fetch ${start}-${end} topic=${topic.slice(0,10)} ${e.message}\n`);
      }
    }
    // Finalize any whose block now under finalizedHead.
    const keep = [];
    for(const t of state.provisional){
      if(BigInt(t.block) <= finalizedHead){ state.finalized.push(t); } else keep.push(t); }
    state.provisional = keep;
    state.cursorBlock = Number(end + 1n);
    chunks++;
    saveState(state);
    process.stderr.write(`chunk ${start}-${end} newFinal=${state.finalized.length} provisional=${state.provisional.length}\n`);
  }
  const decoded = state.finalized.map(t=> ({ ...decodeTableId(t.id), block: t.block }));
  decoded.sort((a,b)=> (a.namespace+a.name).localeCompare(b.namespace+b.name));
  console.log(JSON.stringify({ world: WORLD, confirmationDepth: Number(CONFIRM_DEPTH), eventsTopics: TOPICS.length, includeEphemeral: INCLUDE_EPHEMERAL, finalizedCount: decoded.length, tables: decoded, nextBlock: state.cursorBlock }, null, 2));
}

const ONCE = process.argv.includes('--once');
const maxChunksIdx = process.argv.indexOf('--maxChunks');
const maxChunks = maxChunksIdx>=0 ? parseInt(process.argv[maxChunksIdx+1]) : undefined;
const chunkSizeIdx = process.argv.indexOf('--chunkSize');
const chunkSize = chunkSizeIdx>=0 ? parseInt(process.argv[chunkSizeIdx+1]) : 3000;

(async () => {
  await step({ chunkSize, maxChunks });
  if(!ONCE){
    setInterval(()=> step({ chunkSize, maxChunks }).catch(e=>process.stderr.write('step error '+e.message+'\n')), 15000);
  }
})();
