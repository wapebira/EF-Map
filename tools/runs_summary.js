#!/usr/bin/env node
/*
 Summarize recent /api/indexer-runs for quick error scan and last-run rate.
 Usage:
   node tools/runs_summary.js --base https://ef-map.pages.dev [--limit 15]
*/

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, arr) => {
    if (a.startsWith('--')) acc.push([a.replace(/^--/, ''), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : '1']);
    return acc;
  }, [])
);

const base = args.base || 'https://ef-map.pages.dev';
const limit = parseInt(args.limit || '15', 10);

(async () => {
  try {
    const res = await fetch(`${base}/api/indexer-runs`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const active = Array.isArray(data.active) ? data.active : [];
    const runs = Array.isArray(data.runs) ? data.runs : [];
    const recent = runs.slice(0, limit);

    const errKeywords = ['error','failed','param_limit','rpc_timeout','batch_insert_failed','too many api requests','1101','unhandled'];
    let errCount = 0;
    const errSamples = [];
    for (const r of recent) {
      const note = (r.notes || '').toString();
      const status = (r.status || '').toString();
      let hit = false;
      if (/error|failed/i.test(status)) hit = true;
      if (!hit) {
        const lower = note.toLowerCase();
        if (errKeywords.some(k => lower.includes(k))) hit = true;
      }
      if (hit) {
        errCount++;
        if (errSamples.length < 5) errSamples.push({ id: r.id, status: r.status, notes: r.notes });
      }
    }

    const last = runs[0];
    let rowsPerMin = 0;
    if (last && last.run_duration_ms > 0) {
      rowsPerMin = Math.round((Number(last.rows_added || 0) / (Number(last.run_duration_ms) / 1000)) * 60);
    }

    const out = {
      base,
      last_run_id: last?.id ?? null,
      rows_added: Number(last?.rows_added ?? 0),
      run_duration_ms: Number(last?.run_duration_ms ?? 0),
      rows_per_min: rowsPerMin,
      err_runs_in_recent: errCount,
      err_samples: errSamples,
      active_count: active.length,
      sampled_recent: recent.length
    };
    console.log(JSON.stringify(out, null, 2));
  } catch (e) {
    console.error(JSON.stringify({ base, error: String(e) }));
    process.exit(1);
  }
})();
