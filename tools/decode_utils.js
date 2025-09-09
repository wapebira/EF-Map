// Utilities for ABI signature hashing & simple log decoding helpers.
// No external deps except js-sha3 (already a devDependency).
const { keccak_256 } = require('js-sha3');

function eventSignatureHash(name, inputs){
  // inputs: array of { type }
  const sig = `${name}(${inputs.map(i=>i.type).join(',')})`;
  const hash = '0x'+keccak_256(sig);
  return { signature: sig, topic0: hash };
}

function functionSelector(name, inputs){
  const sig = `${name}(${inputs.map(i=>i.type).join(',')})`;
  const hash = keccak_256(sig).slice(0,8);
  return { signature: sig, selector: '0x'+hash };
}

function buildEventMap(abi){
  const map = {};
  for(const item of abi){
    if(item.type === 'event'){
      const { topic0 } = eventSignatureHash(item.name, item.inputs||[]);
      map[topic0] = { name: item.name, inputs: item.inputs||[], anonymous: !!item.anonymous };
    }
  }
  return map;
}

function buildFunctionMap(abi){
  const map = {};
  for(const item of abi){
    if(item.type === 'function'){
      const { selector } = functionSelector(item.name, item.inputs||[]);
      map[selector] = { name: item.name, inputs: item.inputs||[], outputs: item.outputs||[], stateMutability: item.stateMutability||'' };
    }
  }
  return map;
}

function summarizeAbi(abi){
  const events = abi.filter(a=>a.type==='event').length;
  const funcs = abi.filter(a=>a.type==='function').length;
  return { events, functions: funcs };
}

function nowIso(){ return new Date().toISOString(); }

module.exports = { eventSignatureHash, functionSelector, buildEventMap, buildFunctionMap, summarizeAbi, nowIso };
