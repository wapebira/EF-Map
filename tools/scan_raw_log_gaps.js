#!/usr/bin/env node
/**
 * Gap scanner: samples block ranges comparing expected log count (chain) vs stored (raw_logs / raw_logs_new).
 * Usage: node tools/scan_raw_log_gaps.js --rpc <url> --world <addr> --from <startBlock> --to <endBlock> \
 *        [--step 10000] [--shadow] [--post <baseUrl>] [--confirmDepth 8]
 * If --post provided, POSTs each segment result to /api/indexer-gap-report.
 */
const fetch = global.fetch;
function arg(k, def){ const i=process.argv.indexOf('--'+k); if(i!==-1 && i+1<process.argv.length) return process.argv[i+1]; return def; }
function flag(k){ return process.argv.includes('--'+k); }
(async function(){
  const RPC = arg('rpc'); const WORLD=(arg('world')||'').toLowerCase();
  const fromBlk = parseInt(arg('from','0'),10); const toBlk = parseInt(arg('to','0'),10);
  const step = parseInt(arg('step','5000'),10);
  const base = arg('post');
  const shadow = flag('shadow');
  const confirmDepth = BigInt(arg('confirmDepth','8'));
  if(!RPC||!WORLD||!Number.isInteger(fromBlk)||!Number.isInteger(toBlk)||toBlk<fromBlk){
    console.error('Args: --rpc <url> --world <addr> --from <block> --to <block> [--step N] [--post baseUrl] [--shadow]');
    process.exit(1);
  }
  async function rpc(method, params){
    const r = await fetch(RPC,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})});
    if(!r.ok) throw new Error('rpc_http_'+r.status); const j=await r.json(); if(j.error) throw new Error('rpc_'+j.error.message); return j.result; }
  let latestHex; try { latestHex = await rpc('eth_blockNumber',[]);} catch(e){ console.error('head_fetch_failed',e); process.exit(2);} const latest=BigInt(latestHex);
  const finalizedHead = Number(latest - confirmDepth);
  let from=fromBlk; const rows=[];
  while(from <= toBlk){
    const segTo = Math.min(toBlk, from + step - 1, finalizedHead);
    // Expected = on-chain log count for address in range (eth_getLogs)
    let chainLogs=[]; try { chainLogs = await rpc('eth_getLogs',[{ address: WORLD, fromBlock:'0x'+from.toString(16), toBlock:'0x'+segTo.toString(16) }]); } catch(e){ console.error('segment_rpc_error', from, segTo, e.message); }
    const expected = chainLogs.length;
    let stored=0;
    if(base){
      try {
        const q = `${base}/api/indexer-rawlogs-range?from=${from}&to=${segTo}${shadow?'&shadow=1':''}`;
        const rr = await fetch(q); const jj = await rr.json(); if(jj && jj.count!=null) stored = jj.count; else console.error('bad_range_resp', jj);
      } catch(e){ console.error('range_fetch_err', e.message); }
    }
    const missing = expected - stored;
    const row = { from_block: from, to_block: segTo, expected_logs: expected, found_logs: stored, missing_logs: missing, shadow, finalizedHead };
    rows.push(row);
    if(base){
      try { await fetch(base+'/api/indexer-gap-report',{ method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ from, to:segTo, expected, found:stored, missing, notes: shadow? 'shadow_scan':'' }) }); } catch(e){ console.error('post_gap_failed', e.message); }
    }
    console.log(JSON.stringify(row));
    from = segTo + 1;
  }
  console.log(JSON.stringify({ summary:true, segments: rows.length, total_expected: rows.reduce((a,b)=>a+b.expected_logs,0), total_found: rows.reduce((a,b)=>a+b.found_logs,0), total_missing: rows.reduce((a,b)=>a+b.missing_logs,0) }));
})();
