#!/usr/bin/env node
/*
 Backfill tribeId fallback in EF_SNAPSHOTS KV
 - Reads keys smart_gate_links_v1 and gate_access_snapshot_v1
 - Ensures every link/rule has tribe attribution, defaulting to '1000167' when missing
 - Preserves existing gateMeta; optionally injects owner.tribeId when missing

 Env:
  KV_NAMESPACE_ID (or EF_SNAPSHOTS_NAMESPACE_ID)
  CF_API_TOKEN (optional if wrangler login exists)
  REMOTE=1 (strongly recommended; otherwise local state)
  DRY_RUN=1 (do not write back)
*/
const cp = require('child_process');
const os = require('os');
const fs = require('fs');
const path = require('path');

function log(level, msg, extra){
  const j = process.env.LOG_JSON === '1';
  if(j){ console.log(JSON.stringify({ level, msg, ts: new Date().toISOString(), ...(extra||{}) })); }
  else { console.log(`[${level.toUpperCase()}] ${msg}` + (extra? ' '+JSON.stringify(extra):'')); }
}

async function wranglerGet(namespaceId, key, remote, env){
  const wr = process.platform === 'win32' ? 'wrangler.cmd' : 'wrangler';
  const args = ['kv','key','get', key, '--namespace-id', namespaceId];
  if(remote) args.push('--remote');
  try {
    return await new Promise((resolve, reject)=>{
      const p = cp.spawn(wr, args, { env });
      let out=''; let err='';
      p.stdout.on('data', d=> out += String(d));
      p.stderr.on('data', d=> err += String(d));
      p.on('exit', code=>{ if(code===0) resolve(out); else reject(new Error('wrangler_get_exit_'+code+': '+err)); });
      p.on('error', reject);
    });
  } catch (e) {
    if (process.platform === 'win32') {
      const quote = (s)=>/\s/.test(s) ? `"${s.replace(/"/g,'\\"')}"` : s;
      const cmdline = [wr, ...args.map(quote)].join(' ');
      return await new Promise((resolve, reject)=>{
        cp.exec(cmdline, { env }, (err, stdout, stderr)=>{
          if(err) return reject(new Error('wrangler_get_exec_failed: '+(stderr||String(err))));
          resolve(stdout);
        });
      });
    }
    throw e;
  }
}

async function wranglerPut(namespaceId, key, filePath, remote, env){
  const wr = process.platform === 'win32' ? 'wrangler.cmd' : 'wrangler';
  const args = ['kv','key','put', key, '--namespace-id', namespaceId, '--path', filePath];
  if(remote) args.push('--remote');
  try {
    return await new Promise((resolve, reject)=>{
      const p = cp.spawn(wr, args, { env });
      let err='';
      p.stderr.on('data', d=> err += String(d));
      p.on('exit', code=>{ if(code===0) resolve(); else reject(new Error('wrangler_put_exit_'+code+': '+err)); });
      p.on('error', reject);
    });
  } catch (e) {
    if (process.platform === 'win32') {
      const quote = (s)=>/\s/.test(s) ? `"${s.replace(/"/g,'\\"')}"` : s;
      const cmdline = [wr, ...args.map(quote)].join(' ');
      return await new Promise((resolve, reject)=>{
        cp.exec(cmdline, { env }, (err, stdout, stderr)=>{
          if(err) return reject(new Error('wrangler_put_exec_failed: '+(stderr||String(err))));
          resolve();
        });
      });
    }
    throw e;
  }
}

function fillTribeOnLinks(payload){
  const npc='1000167';
  let changed=0, total=0;
  for(const l of payload.links||[]){
    total++;
    const has = (l.tribeId) || (Array.isArray(l.tribes) && l.tribes.length>0);
    if(!has){ l.tribeId = npc; changed++; }
  }
  // Optional: reflect into gateMeta.owner if present but missing tribeId
  if(payload.gateMeta){
    for(const gid of Object.keys(payload.gateMeta)){
      const m = payload.gateMeta[gid];
      if(m && m.owner && !m.owner.tribeId){ m.owner.tribeId = npc; }
    }
  }
  return { changed, total };
}

function fillTribeOnRules(payload){
  const npc='1000167';
  let changed=0, total=0;
  for(const r of payload.rules||[]){
    total++;
    const has = (r.tribeId) || (Array.isArray(r.tribes) && r.tribes.length>0);
    if(!has){ r.tribeId = npc; changed++; }
  }
  return { changed, total };
}

async function main(){
  // Basic argv parsing for Windows-friendly invocation
  const argv = new Set(process.argv.slice(2));
  const getArgVal = (name) => {
    const idx = process.argv.indexOf(name);
    if (idx !== -1 && idx + 1 < process.argv.length) return process.argv[idx + 1];
    for (const a of process.argv.slice(2)) {
      if (a.startsWith(name + '=')) return a.substring(name.length + 1);
    }
    return null;
  };
  const namespaceId = getArgVal('--namespace-id') || process.env.KV_NAMESPACE_ID || process.env.EF_SNAPSHOTS_NAMESPACE_ID;
  if(!namespaceId) throw new Error('KV namespace id required (pass --namespace-id or set KV_NAMESPACE_ID/EF_SNAPSHOTS_NAMESPACE_ID)');
  const remote = argv.has('--remote') || process.env.REMOTE==='1' || process.env.CF_KV_REMOTE==='1' || process.env.FORCE_REMOTE==='1';
  // Allow explicit --write to override any DRY_RUN env and force writes
  const forceWrite = argv.has('--write') || argv.has('--force-write');
  const dry = forceWrite ? false : (argv.has('--dry-run') || argv.has('-n') || process.env.DRY_RUN==='1');
  const token = getArgVal('--token') || process.env.CF_API_TOKEN || process.env.CLOUDFLARE_API_TOKEN || '';
  const env = token ? { ...process.env, CLOUDFLARE_API_TOKEN: token } : { ...process.env };
  log('info','starting backfill',{ namespaceId, remote, dry, forceWrite });

  // Links
  const rawLinks = await wranglerGet(namespaceId, 'smart_gate_links_v1', remote, env);
  const linksPayload = JSON.parse(rawLinks);
  const beforeLinks = JSON.stringify(linksPayload).length;
  const chLinks = fillTribeOnLinks(linksPayload);
  const afterLinks = JSON.stringify(linksPayload).length;
  log('info','links processed', { changed: chLinks.changed, total: chLinks.total, bytesBefore: beforeLinks, bytesAfter: afterLinks });

  // Rules
  const rawRules = await wranglerGet(namespaceId, 'gate_access_snapshot_v1', remote, env);
  const rulesPayload = JSON.parse(rawRules);
  const beforeRules = JSON.stringify(rulesPayload).length;
  const chRules = fillTribeOnRules(rulesPayload);
  const afterRules = JSON.stringify(rulesPayload).length;
  log('info','rules processed', { changed: chRules.changed, total: chRules.total, bytesBefore: beforeRules, bytesAfter: afterRules });

  if(dry){
    log('info','DRY_RUN set; skipping KV write');
    return;
  }

  // Write back
  const tmp1 = path.join(os.tmpdir(), 'smart_gate_links_snapshot_backfilled.json');
  fs.writeFileSync(tmp1, JSON.stringify(linksPayload));
  await wranglerPut(namespaceId, 'smart_gate_links_v1', tmp1, remote, env);
  const tmp2 = path.join(os.tmpdir(), 'gate_access_snapshot_backfilled.json');
  fs.writeFileSync(tmp2, JSON.stringify(rulesPayload));
  await wranglerPut(namespaceId, 'gate_access_snapshot_v1', tmp2, remote, env);
  log('info','backfill complete',{ namespaceId });
}

main().catch(e=>{ log('error','backfill_failed',{ error: String(e) }); process.exit(1); });
