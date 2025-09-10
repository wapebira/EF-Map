#!/usr/bin/env node
/**
 * Merge two daily stats JSON snapshots (old pre-cutover, new post-cutover) for a given date.
 * Strategy:
 *  1. Determine relationship using page_loads ratio.
 *     - If new.page_loads > old.page_loads (ratio > 1.15) treat snapshots as overlapping cumulative (new already includes old) -> use MAX per counter/sum.
 *     - Else if ratio < 0.15 treat as disjoint windows -> use SUM for counters & sums.
 *     - Else ambiguous -> default to MAX to avoid inflation (can override with --force=sum).
 *  2. For sums (time/LY aggregates) apply same rule.
 *  3. Produce report of per-key decisions when values differ.
 *
 * Usage: node tools/merge_daily_stats.js --old old.json --new new.json --out merged.json [--force=max|sum]
 */
const fs = require('fs');
const args = process.argv.slice(2);
function getArg(name){ const i = args.indexOf(name); return i>=0? args[i+1]: null; }
const oldPath = getArg('--old');
const newPath = getArg('--new');
const outPath = getArg('--out');
const force = getArg('--force');
if(!oldPath || !newPath || !outPath){ console.error('Missing required --old/--new/--out'); process.exit(1); }
function readJson(path){
  let buf = fs.readFileSync(path);
  // Detect UTF-16 LE BOM (FF FE) or UTF-16 BE (FE FF) and convert to UTF-8
  if(buf.length>2){
    if(buf[0]===0xFF && buf[1]===0xFE){
      // UTF-16 LE -> decode using UCS-2 then re-encode
      buf = Buffer.from(buf.toString('utf16le'),'utf8');
    } else if(buf[0]===0xFE && buf[1]===0xFF){
      buf = Buffer.from(buf.swap16().toString('utf16le'),'utf8');
    } else if(buf[0]===0xEF && buf[1]===0xBB && buf[2]===0xBF){
      buf = buf.slice(3); // strip UTF-8 BOM
    }
  }
  const txt = buf.toString('utf8').trim();
  return JSON.parse(txt);
}
const old = readJson(oldPath);
const nw = readJson(newPath);
function num(v){ return typeof v==='number' && isFinite(v)? v:0; }
const oPL = num(old.counters?.page_loads); const nPL = num(nw.counters?.page_loads);
let mode; const ratio = nPL && oPL? nPL / oPL : 0;
if(force==='sum') mode='sum';
else if(force==='max') mode='max';
else {
  // Dominance heuristic: if new >= old for >=90% of overlapping counter keys -> treat as cumulative (max). Otherwise treat as disjoint (sum).
  const oC = old.counters||{}; const nC = nw.counters||{};
  const keys = new Set([...Object.keys(oC), ...Object.keys(nC)]);
  let dominated=0, comparable=0, oldGreater=0, newGreater=0;
  for(const k of keys){ const ov=num(oC[k]); const nv=num(nC[k]); if(ov===nv) continue; comparable++; if(nv>ov){ newGreater++; } else if(ov>nv){ oldGreater++; } }
  if(ratio > 1.15){
    // If new dominates (>=90% of differing keys bigger) choose max else sum.
    mode = (newGreater && (newGreater/(newGreater+oldGreater)) >= 0.9) ? 'max' : 'sum';
  } else if(ratio < 0.15){
    mode='sum';
  } else {
    // ambiguous ratio: if both sides have at least 20% wins -> disjoint
    const totalDiff = newGreater+oldGreater;
    if(totalDiff>0 && newGreater/totalDiff >=0.2 && oldGreater/totalDiff >=0.2) mode='sum'; else mode='max';
  }
}
function mergeCounters(o, n){ const out={}; const keys = new Set([...Object.keys(o||{}), ...Object.keys(n||{})]);
  for(const k of keys){ const ov=num(o[k]); const nv=num(n[k]); out[k] = mode==='sum'? ov+nv : Math.max(ov,nv); }
  return out;
}
function mergeSums(o, n){ const out={}; const keys = new Set([...Object.keys(o||{}), ...Object.keys(n||{})]);
  for(const k of keys){ const ov=num(o[k]); const nv=num(n[k]); out[k] = mode==='sum'? ov+nv : Math.max(ov,nv); }
  return out;
}
const merged = {
  version: Math.max(num(old.version)||2, num(nw.version)||2, 2),
  date: nw.date || old.date,
  updatedAt: new Date().toISOString(),
  counters: mergeCounters(old.counters||{}, nw.counters||{}),
  sums: mergeSums(old.sums||{}, nw.sums||{})
};
const diffs=[]; for(const [k,v] of Object.entries(merged.counters)){ const ov=num(old.counters?.[k]); const nv=num(nw.counters?.[k]); if(v!==ov || v!==nv){ diffs.push({ key:k, old:ov, new:nv, merged:v }); } }
const sumDiffs=[]; for(const [k,v] of Object.entries(merged.sums)){ const ov=num(old.sums?.[k]); const nv=num(nw.sums?.[k]); if(v!==ov || v!==nv){ sumDiffs.push({ key:k, old:ov, new:nv, merged:v }); } }
fs.writeFileSync(outPath, JSON.stringify(merged));
const report = { mode, ratio, page_loads_old:oPL, page_loads_new:nPL, counters_changed:diffs.length, sums_changed:sumDiffs.length, sample_counter_diffs: diffs.slice(0,25), sample_sum_diffs: sumDiffs.slice(0,25) };
fs.writeFileSync(outPath.replace(/\.json$/,'_report.json'), JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));
