/**
 * Ingestion throughput sampler
 * Polls /api/indexer-health?details=1 every N seconds for M points and reports rows/min.
 * Usage:
 *   node tools/ingest_sampler.js --base https://ef-map.pages.dev --interval 30 --points 5
 */
const args = process.argv.slice(2);
function getArg(name, def){
  const i = args.indexOf('--'+name);
  if(i>=0 && args[i+1]) return args[i+1];
  return def;
}
const base = (getArg('base', process.env.BASE||'https://ef-map.pages.dev')).replace(/\/$/, '');
const intervalSec = Math.max(5, parseInt(getArg('interval', process.env.INTERVAL||'30'),10)||30);
const points = Math.max(2, parseInt(getArg('points', process.env.POINTS||'5'),10)||5);

async function fetchJson(url){
  const r = await fetch(url, { headers:{ 'accept':'application/json' } });
  if(!r.ok){ throw new Error('HTTP '+r.status+' '+url); }
  const ct = r.headers.get('content-type')||'';
  if(!ct.includes('application/json')){
    const text = await r.text();
    throw new Error('Non-JSON from '+url+' head='+text.slice(0,60));
  }
  return r.json();
}

function nowIso(){ return new Date().toISOString(); }
function sleep(ms){ return new Promise(r=> setTimeout(r, ms)); }

async function getCombined(){
  const h = await fetchJson(base + '/api/indexer-health?details=1');
  const primary = Number(h?.archiver?.primaryCount||0);
  const archived = Number(h?.archiver?.archivedCount||0);
  const combined = primary + archived;
  return { t: Date.now(), primary, archived, combined };
}

async function quickLastRun(){
  try {
    const runs = await fetchJson(base + '/api/indexer-runs');
    const last = Array.isArray(runs?.runs) && runs.runs.length ? runs.runs[0] : null;
    if(!last) return null;
    const rows = Number(last.rows_added||0);
    const ms = Number(last.run_duration_ms||0);
    const rate = ms>0 ? Math.round((rows/(ms/1000))*60) : 0;
    return { rows, ms, rate };
  } catch {
    return null;
  }
}

(async ()=>{
  const quick = await quickLastRun();
  if(quick){
    console.log(`Quick estimate (last run): rows_added=${quick.rows} dur_ms=${quick.ms} => ~${quick.rate} rows/min`);
  } else {
    console.log('Quick estimate (last run): unavailable');
  }
  const samples = [];
  const start = await getCombined();
  samples.push(start);
  console.log(`[${nowIso()}] start combined=${start.combined} (primary=${start.primary} archived=${start.archived})`);
  for(let i=1;i<points;i++){
    await sleep(intervalSec*1000);
    const s = await getCombined();
    samples.push(s);
    console.log(`[${nowIso()}] sample ${i} combined=${s.combined}`);
  }
  const deltas = [];
  for(let i=1;i<samples.length;i++){
    const dt = (samples[i].t - samples[i-1].t)/1000; // seconds
    const d = samples[i].combined - samples[i-1].combined;
    const perMin = dt>0 ? (d/dt)*60 : 0;
    deltas.push({ i, seconds: dt, delta: d, rowsPerMin: perMin });
  }
  const totalSeconds = (samples[samples.length-1].t - samples[0].t)/1000;
  const totalDelta = samples[samples.length-1].combined - samples[0].combined;
  const overallPerMin = totalSeconds>0 ? (totalDelta/totalSeconds)*60 : 0;
  const perMinVals = deltas.map(d=> d.rowsPerMin);
  const avg = perMinVals.reduce((a,b)=>a+b,0) / (perMinVals.length||1);
  const sorted = [...perMinVals].sort((a,b)=> a-b);
  const med = sorted.length ? (sorted.length%2? sorted[(sorted.length-1)/2] : (sorted[sorted.length/2-1]+sorted[sorted.length/2])/2) : 0;
  const min = sorted.length ? sorted[0] : 0;
  const max = sorted.length ? sorted[sorted.length-1] : 0;
  const summary = {
    base,
    points: samples.length,
    intervalSec,
    totalSeconds: Math.round(totalSeconds),
    totalDelta,
    overallRowsPerMin: Math.round(overallPerMin),
    perInterval: deltas.map(d=> ({ i:d.i, seconds: Math.round(d.seconds), delta: d.delta, rowsPerMin: Math.round(d.rowsPerMin) })),
    stats: { min: Math.round(min), median: Math.round(med), avg: Math.round(avg), max: Math.round(max) }
  };
  console.log('--- summary ---');
  console.log(JSON.stringify(summary, null, 2));
  console.log(`Throughput: ~${Math.round(overallPerMin)} rows/min over ${Math.round(totalSeconds)}s (min/med/avg/max per-interval ${Math.round(min)}/${Math.round(med)}/${Math.round(avg)}/${Math.round(max)})`);
})().catch(e=>{ console.error('sampler_error', String(e)); process.exit(1); });
