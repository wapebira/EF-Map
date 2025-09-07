#!/usr/bin/env node
/**
 * compare_stats.js
 * Fetch Netlify (production) vs Cloudflare (sandbox) stats snapshots and compute drift.
 *
 * Env Vars:
 *  NETLIFY_STATS_URL   (e.g. https://<netlify-site>/.netlify/functions/stats)
 *  CLOUDFLARE_STATS_URL (e.g. https://<cf-sandbox-domain>/api/stats)
 *  HISTORY_DAYS (optional, default 0 -> current only)
 *  DRIFT_WARN (fraction, default 0.05)
 *
 * Output:
 *  JSON summary to stdout plus human-readable table.
 */
import fetch from 'node-fetch';

const netlifyUrl = process.env.NETLIFY_STATS_URL;
const cfUrl = process.env.CLOUDFLARE_STATS_URL;
if(!netlifyUrl || !cfUrl){
  console.error('Missing NETLIFY_STATS_URL or CLOUDFLARE_STATS_URL');
  process.exit(1);
}
const days = parseInt(process.env.HISTORY_DAYS||'0',10);
const driftWarn = parseFloat(process.env.DRIFT_WARN||'0.05');

function pct(a,b){ if(b===0) return a===0?0:1; return Math.abs(a-b)/Math.max(b,1); }

async function fetchStats(base){
  const url = days>0? `${base}?history=${days}`: base;
  const res = await fetch(url);
  if(!res.ok){ throw new Error('Fetch failed '+base+' '+res.status); }
  return await res.json();
}

function compareSection(aMap,bMap,label){
  const keys = new Set([...Object.keys(aMap||{}), ...Object.keys(bMap||{})]);
  const rows=[]; let maxDrift=0; let offenders=0;
  for(const k of [...keys].sort()){
    const av = aMap[k]||0; const bv = bMap[k]||0; const d = pct(av,bv);
    if(d>maxDrift) maxDrift=d; if(d>driftWarn) offenders++;
    rows.push({ key:k, netlify:av, cloudflare:bv, drift:d });
  }
  return { label, maxDrift, offenders, rows };
}

(async function main(){
  const [netlify, cf] = await Promise.all([fetchStats(netlifyUrl), fetchStats(cfUrl)]);
  const currentCompCounters = compareSection(netlify.current?.counters||{}, cf.current?.counters||{}, 'counters');
  const currentCompSums = compareSection(netlify.current?.sums||{}, cf.current?.sums||{}, 'sums');
  const summary = {
    compared: new Date().toISOString(),
    thresholds: { driftWarn },
    sections: {
      counters: { maxDrift: currentCompCounters.maxDrift, offenders: currentCompCounters.offenders },
      sums: { maxDrift: currentCompSums.maxDrift, offenders: currentCompSums.offenders }
    }
  };
  console.log(JSON.stringify(summary,null,2));
  function fmt(p){ return (p*100).toFixed(2)+'%'; }
  console.log('\nCounters: max drift', fmt(currentCompCounters.maxDrift), 'offenders', currentCompCounters.offenders);
  console.log('Sums:     max drift', fmt(currentCompSums.maxDrift), 'offenders', currentCompSums.offenders);
  if(currentCompCounters.offenders||currentCompSums.offenders){
    console.log('\nDrift offenders >', fmt(driftWarn), ' (first 15):');
    const offenders=[...currentCompCounters.rows, ...currentCompSums.rows]
      .filter(r=>r.drift>driftWarn)
      .sort((a,b)=>b.drift-a.drift)
      .slice(0,15);
    for(const r of offenders){
      console.log(r.key.padEnd(32), r.netlify.toString().padStart(6), r.cloudflare.toString().padStart(6), fmt(r.drift));
    }
  }
})();
