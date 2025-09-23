#!/usr/bin/env node
/**
 * KV Snapshot Freshness Checker
 * - Reads KV keys (default: smart_gate_links_v1, gate_access_snapshot_v1)
 * - Parses updatedAt and computes age in minutes
 * - Prints concise status lines and exits non‑zero if any key is stale
 *
 * Env:
 *   KV_NAMESPACE_ID or EF_SNAPSHOTS_NAMESPACE_ID (required unless --namespace-id passed)
 *   CLOUDFLARE_API_TOKEN optional (wrangler will use stored login if not provided)
 * Flags:
 *   --namespace-id <id>
 *   --remote (use Cloudflare API instead of local)
 *   --keys <k1,k2,...>
 *   --threshold <minutes> (default 5)
 *   --json (machine‑readable output)
  *   --watch <seconds> (poll interval; if provided, runs continuously)
 */
const cp = require('child_process');

function parseArgs() {
  const out = { remote: false, keys: ['smart_gate_links_v1', 'gate_access_snapshot_v1'], threshold: 5, json: false, watch: 0 };
  const argv = process.argv.slice(2);
  for (let i=0; i<argv.length; i++) {
    const a = argv[i];
    if (a === '--remote') out.remote = true;
    else if (a === '--json') out.json = true;
    else if (a === '--namespace-id' && argv[i+1]) { out.namespaceId = argv[++i]; }
    else if (a === '--keys' && argv[i+1]) { out.keys = argv[++i].split(',').map(s=>s.trim()).filter(Boolean); }
    else if (a === '--threshold' && argv[i+1]) { out.threshold = Number(argv[++i]) || out.threshold; }
    else if (a === '--watch' && argv[i+1]) { out.watch = Math.max(1, Number(argv[++i])||0); }
  }
  if (!out.namespaceId) out.namespaceId = process.env.KV_NAMESPACE_ID || process.env.EF_SNAPSHOTS_NAMESPACE_ID || '';
  if (!out.namespaceId) throw new Error('namespace id required (set KV_NAMESPACE_ID or pass --namespace-id)');
  return out;
}

function runWrangler(args, env) {
  const wrCmd = process.platform === 'win32' ? 'wrangler.cmd' : 'wrangler';
  return new Promise((resolve, reject) => {
    let attemptedExec = false;
    const tryExec = (err) => {
      if (attemptedExec) return reject(err);
      attemptedExec = true;
      // Fallback to exec with a quoted command string (helps on some Windows environments)
      const quote = (s)=>/\s/.test(s) ? `"${s.replace(/"/g,'\"')}"` : s;
      const cmdline = [wrCmd, ...args.map(quote)].join(' ');
      cp.exec(cmdline, { env }, (e, stdout, stderr) => {
        if (e) return reject(new Error('wrangler_exec_failed: ' + (stderr || String(e))));
        resolve(stdout);
      });
    };
    try {
      const p = cp.spawn(wrCmd, args, { env });
      let stdout = '';
      let stderr = '';
      p.stdout.on('data', d => { stdout += String(d); });
      p.stderr.on('data', d => { stderr += String(d); });
      p.on('error', tryExec);
      p.on('exit', code => {
        if (code === 0) resolve(stdout);
        else tryExec(new Error(`wrangler_exit_${code}: ${stderr || stdout}`));
      });
    } catch (e) {
      tryExec(e);
    }
  });
}

async function getKeyJson(nsId, key, remote) {
  const args = ['kv','key','get','--namespace-id', nsId, key];
  if (remote) args.push('--remote');
  const env = { ...process.env };
  const raw = await runWrangler(args, env);
  // Trim BOM if present, then parse JSON
  const txt = raw.replace(/^\uFEFF/, '').trim();
  try {
    return JSON.parse(txt);
  } catch (e) {
    // Attempt to find JSON blob in case output had extra noise
    const start = txt.indexOf('{');
    const end = txt.lastIndexOf('}');
    if (start >= 0 && end > start) {
      return JSON.parse(txt.slice(start, end+1));
    }
    throw e;
  }
}

function fmtAge(mins){ return (Math.round(mins*10)/10).toFixed(1); }

async function runOnce(cfg){
  const now = Date.now();
  const results = [];
  let staleCount = 0;
  for (const key of cfg.keys) {
    try {
      const j = await getKeyJson(cfg.namespaceId, key, cfg.remote);
      const updatedAt = j && j.updatedAt ? new Date(j.updatedAt).getTime() : NaN;
      const ageMin = isNaN(updatedAt) ? NaN : (now - updatedAt)/60000;
      const count = j && (Array.isArray(j.links) ? j.links.length : Array.isArray(j.rules) ? j.rules.length : undefined);
      const stale = !isNaN(ageMin) && ageMin > cfg.threshold;
      if (stale) staleCount++;
      results.push({ key, updatedAt: j.updatedAt || null, ageMin, count, stale });
    } catch (e) {
      results.push({ key, error: String(e) });
      staleCount++;
    }
  }
  return { results, staleCount };
}

function nowTime(){
  const d = new Date();
  const pad = (n)=>String(n).padStart(2,'0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

async function main(){
  const cfg = parseArgs();
  if (cfg.watch > 0) {
    // Continuous mode
    while (true) {
      try {
        const { results, staleCount } = await runOnce(cfg);
        if (cfg.json) {
          console.log(JSON.stringify({ t: Date.now(), namespaceId: cfg.namespaceId, threshold: cfg.threshold, results }, null, 2));
        } else {
          const prefix = `[${nowTime()}]`;
          for (const r of results) {
            if (r.error) { console.log(`${prefix} ${r.key}: ERROR ${r.error}`); }
            else {
              const ageStr = isNaN(r.ageMin) ? 'n/a' : `${fmtAge(r.ageMin)}m`;
              const cnt = r.count!=null ? `; count=${r.count}` : '';
              console.log(`${prefix} ${r.key}: updatedAt=${r.updatedAt} ; age=${ageStr}${cnt} ; ${r.stale? 'STALE':'OK'}`);
            }
          }
        }
      } catch (e) {
        console.error(`[${nowTime()}] check_failed:`, e.message || e);
      }
      await new Promise(res => setTimeout(res, cfg.watch * 1000));
    }
  } else {
    // One-shot
    const { results, staleCount } = await runOnce(cfg);
    if (cfg.json) {
      console.log(JSON.stringify({ namespaceId: cfg.namespaceId, threshold: cfg.threshold, results }, null, 2));
    } else {
      for (const r of results) {
        if (r.error) { console.log(`${r.key}: ERROR ${r.error}`); }
        else {
          const ageStr = isNaN(r.ageMin) ? 'n/a' : `${fmtAge(r.ageMin)}m`;
          const cnt = r.count!=null ? `; count=${r.count}` : '';
          console.log(`${r.key}: updatedAt=${r.updatedAt} ; age=${ageStr}${cnt} ; ${r.stale? 'STALE':'OK'}`);
        }
      }
    }
    process.exit(staleCount ? 2 : 0);
  }
}

main().catch(e=>{ console.error('check_kv_freshness_failed:', e); process.exit(1); });
