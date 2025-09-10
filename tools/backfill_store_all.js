#!/usr/bin/env node
/*
 backfill_store_all.js
 Incrementally invokes /api/indexer-ingest (mode=store_all) until cursor catches up to finalized head.

 Usage:
   node tools/backfill_store_all.js --base https://<preview>.pages.dev \
     --rpc https://rpc.pyropechain.com \
     --world 0x7085f3e652987f656fB8dEE5aA6592197Bb75de8 \
     --deployBlock 7288348 \
     --rowCap 60000 --maxBlocksStart 1500

 Options:
   --base             Base URL of deployed Pages preview (required)
   --rpc              JSON-RPC endpoint (required unless set via PYROPE_RPC env)
   --world            World contract address (required unless WORLD_ADDRESS env)
   --deployBlock      Deployment/start block (required unless DEPLOY_BLOCK env)
   --startBlock       Override start (default: deployment block or cursor+1)
   --rowCap           Per-run insertion cap (default 50000; upper bound 200000)
   --maxBlocksStart   Initial block window size (default 1500)
   --maxBlocksCeil    Upper bound for adaptive window (default 8000)
   --scaleEvery       Increase window after this many successful runs (default 4)
   --scaleFactor      Multiplier when scaling window (default 1.5)
   --sleepMs          Delay between runs (default 150)
   --tail             After catching up keep polling every tailSleepMs (default 6000)
   --tailSleepMs      Interval for tail polling (default 6000)
   --dryRun           Compute plan only, don't POST ingest
   --verbose          Extra logging

 Strategy:
   - Query health for current cursor (if any).
   - Loop POST /api/indexer-ingest?openPreview=1 with JSON body specifying mode, rpc, world, deployBlock, maxBlocks, rowCap.
   - Adaptive window growth: after N consecutive non-error runs that consumed full window (range.from..range.to) AND inserted < rowCap, enlarge up to ceiling.
   - Stops when status up_to_date (unless --tail).
*/

// Parse args: supports --key=value or --key value (next token)
const rawArgv = process.argv.slice(2);
const args = {};
for(let i=0;i<rawArgv.length;i++){
  const tok = rawArgv[i];
  if(!tok.startsWith('--')) continue;
  const eq = tok.indexOf('=');
  if(eq>2){
    const k = tok.slice(2,eq); const v = tok.slice(eq+1); args[k]=v;
  } else {
    const k = tok.slice(2);
    const next = rawArgv[i+1];
    if(next && !next.startsWith('--')){ args[k]=next; i++; } else { args[k]='true'; }
  }
}
function num(name, def){ const v=args[name]; if(v===undefined) return def; const n=Number(v); return isFinite(n)? n: def; }
function bool(name){ return ['1','true','yes','on'].includes(String(args[name]||'').toLowerCase()); }

const base = args.base || process.env.BACKFILL_BASE;
if(!base) { console.error('Missing --base'); process.exit(1); }
const rpc = args.rpc || process.env.PYROPE_RPC;
if(!rpc){ console.error('Missing --rpc'); process.exit(1); }
const world = (args.world || process.env.WORLD_ADDRESS || '').toLowerCase();
if(!world){ console.error('Missing --world'); process.exit(1); }
const deployBlock = Number(args.deployBlock || process.env.DEPLOY_BLOCK);
if(!deployBlock || !Number.isInteger(deployBlock)){ console.error('Missing/invalid --deployBlock'); process.exit(1); }
const dryRun = bool('dryRun');
const verbose = bool('verbose');
let maxBlocks = num('maxBlocksStart',1500);
// If previous attempts are failing early (user observation), allow optional lower safe ceiling via --safeMax
const safeMax = num('safeMax', 1200);
if(maxBlocks > safeMax) {
  console.log(`Adjusting initial maxBlocks from ${maxBlocks} down to safeMax ${safeMax} (override with --safeMax)`);
  maxBlocks = safeMax;
}
const maxBlocksCeil = num('maxBlocksCeil', 8000);
const scaleEvery = num('scaleEvery',4);
const scaleFactor = Number(args.scaleFactor||1.5);
const rowCap = Math.min(num('rowCap',50000), 200000);
const sleepMs = num('sleepMs',150);
const tailMode = bool('tail');
const tailSleepMs = num('tailSleepMs',6000);
let consecFull=0; let run=0;
// Cumulative metrics
let cumulativeBlocks=0; // total block span requested (range.to-range.from+1)
let cumulativeInserted=0; // total logs inserted (as reported by worker)
let cumulativeAttempted=0; // total logs attempted loop-side
let firstStartTs=null; // timestamp of very first run
let lastHeadFinalized=null; // latest finalized head observed
let lastCursorBlock=null; // last cursor block after run
let lastEta=null; // ms ETA estimate
let consecutiveErrors=0; // consecutive ingest error responses
const MIN_WINDOW = num('minBlocks', 200); // floor for adaptive shrink
const ERROR_SHRINK_FACTOR = 0.5; // halve window on repeated 500s
const ERROR_SHRINK_THRESHOLD = 2; // after N consecutive errors shrink
const ERROR_BACKOFF_MS = num('errorBackoffMs', 4000);
const MAX_CONSEC_ERRORS_EXIT = num('maxConsecErrorsExit', 30); // safety to avoid infinite failing loop

// Segment adaptation (applies only if segmentBlocks supplied)
let segmentBlocks = args.segmentBlocks ? Number(args.segmentBlocks) : null;
const SEGMENT_MIN = num('segmentMin', 200);
const SEGMENT_SHRINK_THRESHOLD = num('segmentShrinkThreshold', 3); // consecutive segment failures before shrink
let segmentErrorStreak = 0;
const SEGMENT_SHRINK_FACTOR = 0.5;
const SEGMENT_GROW_FACTOR = 1.25;
const SEGMENT_GROW_OK_STREAK = num('segmentGrowOkStreak', 6);
let segmentOkStreak = 0;

async function sleep(ms){ return new Promise(r=>setTimeout(r,ms)); }
async function fetchJson(url, opts){ const r = await fetch(url, opts); const text= await r.text(); try { return { ok:r.ok, status:r.status, json: JSON.parse(text) }; } catch { return { ok:r.ok, status:r.status, text }; } }

// Health helper (ensure no trailing slash)
async function getHealth(){ return fetchJson(base.replace(/\/$/, '') + '/api/indexer-health?details=1'); }
async function ingest(maxBlocksArg){
  const body = { mode:'store_all', rpc, world, deployBlock, maxBlocks: maxBlocksArg, rowCap };
  if(segmentBlocks && Number.isFinite(segmentBlocks) && segmentBlocks>0){ body.segmentBlocks = Math.floor(segmentBlocks); }
  if(args.startBlock) body.startBlock = Number(args.startBlock);
  return fetchJson(base.replace(/\/$/,'') + '/api/indexer-ingest?openPreview=1', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify(body) });
}

(async ()=>{
  console.log('Backfill start', { base, world, deployBlock, rowCap, maxBlocksInitial:maxBlocks, dryRun });
  if(dryRun){ const h = await getHealth(); console.log('Health (dryRun):', h.json); process.exit(0); }
  while(true){
    run++;
    const t0=Date.now();
    const res = await ingest(maxBlocks);
    const dt=Date.now()-t0;
    if(!res.ok){
      consecutiveErrors++;
      console.error('HTTP error ingest', res.status, res.json||res.text);
      if(consecutiveErrors % ERROR_SHRINK_THRESHOLD === 0 && maxBlocks > MIN_WINDOW){
        const newWin = Math.max(MIN_WINDOW, Math.floor(maxBlocks * ERROR_SHRINK_FACTOR));
        if(newWin < maxBlocks){ console.log(`Shrink (http) window ${maxBlocks} -> ${newWin}`); maxBlocks = newWin; }
      }
      if(consecutiveErrors >= MAX_CONSEC_ERRORS_EXIT){
        console.error(`Too many consecutive HTTP errors (${consecutiveErrors}) exiting.`);
        process.exit(2);
      }
      await sleep(ERROR_BACKOFF_MS);
      continue;
    }
    const j = res.json;
    if(j && j.error){
      consecutiveErrors++;
      const isSegErr = /segment_error/i.test(j.message||'');
      const is500 = /rpc_http_500/i.test(j.message||'');
      console.log(`[${run}] ERROR ${j.error} msg=${j.message||''} window=${maxBlocks} segBlocks=${segmentBlocks||'-'} consecutiveErrors=${consecutiveErrors}`);
      if(isSegErr || is500){
        // Shrink main window first
        if(consecutiveErrors >= ERROR_SHRINK_THRESHOLD && maxBlocks > MIN_WINDOW){
          const newWin = Math.max(MIN_WINDOW, Math.floor(maxBlocks * ERROR_SHRINK_FACTOR));
          if(newWin < maxBlocks){ console.log(`Shrinking window due to repeated errors: ${maxBlocks} -> ${newWin}`); maxBlocks = newWin; }
        }
        // Adapt segment size
        if(segmentBlocks){
          segmentErrorStreak++;
          segmentOkStreak = 0;
          if(segmentErrorStreak >= SEGMENT_SHRINK_THRESHOLD && segmentBlocks > SEGMENT_MIN){
            const newSeg = Math.max(SEGMENT_MIN, Math.floor(segmentBlocks * SEGMENT_SHRINK_FACTOR));
            if(newSeg < segmentBlocks){
              console.log(`Segment shrink ${segmentBlocks} -> ${newSeg} (errors streak=${segmentErrorStreak})`);
              segmentBlocks = newSeg;
              segmentErrorStreak = 0; // reset after shrink
            }
          }
        }
      }
      if(consecutiveErrors >= MAX_CONSEC_ERRORS_EXIT){
        console.error(`Too many consecutive logical errors (${consecutiveErrors}) exiting.`);
        process.exit(3);
      }
      await sleep(ERROR_BACKOFF_MS);
      continue; // skip success path
    } else {
      consecutiveErrors = 0; segmentErrorStreak = 0; if(segmentBlocks) segmentOkStreak++;
      if(segmentBlocks && segmentOkStreak && segmentOkStreak % SEGMENT_GROW_OK_STREAK === 0){
        const grown = Math.floor(segmentBlocks * SEGMENT_GROW_FACTOR);
        // Do not exceed current maxBlocks window
        if(grown > segmentBlocks && grown <= maxBlocks){
          console.log(`Segment grow ${segmentBlocks} -> ${grown} after ${segmentOkStreak} clean segments`);
          segmentBlocks = grown;
        }
      }
    }
    if(!firstStartTs) firstStartTs = Date.now();
    if(j.range){
      const span = (j.range.to - j.range.from + 1);
      cumulativeBlocks += span;
      lastCursorBlock = j.cursor?.last_block_number ?? lastCursorBlock;
      lastHeadFinalized = Math.max(lastHeadFinalized||0, j.range.to);
    }
    cumulativeInserted += (j.inserted||0);
    cumulativeAttempted += (j.attempted||0);

    // Fetch health occasionally (every 5 runs) to refine head / cursor & compute ETA
    if(run===1 || run % 5 === 0){
      try {
        const h = await getHealth();
        if(h.ok && h.json?.cursor){ lastCursorBlock = h.json.cursor.last_block_number; }
      } catch {}
    }

    // Estimate blocks remaining & ETA (ms)
    let blocksRemaining=null; let blocksPerSec=null; let logsPerBlock=null; let logsPerSec=null; let etaMs=null; let progressPct=null;
    if(lastCursorBlock!=null && lastHeadFinalized!=null){
      blocksRemaining = Math.max(0, lastHeadFinalized - lastCursorBlock);
      const elapsedMs = Date.now() - firstStartTs;
      if(elapsedMs > 0 && cumulativeBlocks>0){
        blocksPerSec = (cumulativeBlocks / (elapsedMs/1000));
      }
      if(elapsedMs > 0 && cumulativeInserted>0){
        logsPerSec = (cumulativeInserted / (elapsedMs/1000));
      }
      if(cumulativeBlocks>0){
        logsPerBlock = cumulativeInserted / cumulativeBlocks;
      }
      if(blocksPerSec && blocksPerSec>0){
        etaMs = blocksRemaining / blocksPerSec * 1000;
        lastEta = etaMs;
      }
      if(lastHeadFinalized>0){
        progressPct = ((lastCursorBlock - (deployBlock||0)) / (lastHeadFinalized - (deployBlock||0)+1))*100;
      }
    }

    const baseLine = `[${run}] ${j.status} range ${j.range? j.range.from+'-'+j.range.to:'-'} inserted=${j.inserted||0} attempted=${j.attempted||0} window=${maxBlocks} dt=${dt}ms`;
    let metricsLine='';
    if(blocksPerSec){ metricsLine += ` blk/s=${blocksPerSec.toFixed(1)}`; }
    if(logsPerSec){ metricsLine += ` logs/s=${logsPerSec.toFixed(1)}`; }
    if(logsPerBlock){ metricsLine += ` logs/block=${logsPerBlock.toFixed(2)}`; }
    if(blocksRemaining!=null){ metricsLine += ` remBlocks=${blocksRemaining}`; }
    if(progressPct!=null){ metricsLine += ` progress=${progressPct.toFixed(2)}%`; }
    if(etaMs!=null){
      const mins = etaMs/60000; const hrs = mins/60;
      if(hrs > 2) metricsLine += ` ETA≈${hrs.toFixed(1)}h`; else if(mins>2) metricsLine += ` ETA≈${mins.toFixed(1)}m`; else metricsLine += ` ETA≈${(etaMs/1000).toFixed(0)}s`;
    }
    if(verbose) console.log('Run', run, j, { blocksPerSec, logsPerSec, logsPerBlock, blocksRemaining, etaMs });
    else console.log(baseLine + metricsLine);
    if(j.status==='up_to_date'){
      if(tailMode){ await sleep(tailSleepMs); continue; }
      console.log('Caught up (finalized head).');
      break;
    }
    if(j.status!=='ok'){ await sleep(1000); continue; }
    // Adaptive scaling: if full window consumed (cursor advanced to 'to'), inserted < rowCap (no cap hit), scale every N runs.
    const fullWindow = j.range && (j.range.to - j.range.from + 1) >= maxBlocks;
    const notCapped = (j.inserted||0) < rowCap;
    if(fullWindow && notCapped){ consecFull++; } else { consecFull=0; }
    if(consecFull && consecFull % scaleEvery === 0){
      const newWin = Math.min(Math.round(maxBlocks * scaleFactor), maxBlocksCeil);
      if(newWin > maxBlocks){ console.log(`Scaling window ${maxBlocks} -> ${newWin}`); maxBlocks = newWin; }
    }
    await sleep(sleepMs);
  }
})();
