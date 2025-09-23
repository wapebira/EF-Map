#!/usr/bin/env node
/**
 * KV Snapshot Timestamp Bumper
 * - Reads a KV JSON key, sets updatedAt to now (ISO8601), and writes it back
 * - Intended for emergency freshness bumps or to verify write permissions.
 *
 * Usage:
 *   node tools/kv_bump_snapshot_timestamp.js <key>
 *   env:
 *     KV_NAMESPACE_ID (required)
 *     CF_API_TOKEN (optional; else Wrangler login context)
 *     REMOTE=1 to pass --remote to wrangler
 *     DRY_RUN=1 to print only
 */
const cp = require('child_process');
const os = require('os');
const fs = require('fs');
const path = require('path');

async function kvGetText(nsId, key, remote){
  const args = ['kv','key','get', '--namespace-id', nsId, key, '--text'];
  if (remote) args.push('--remote');
  const wrCmd = process.platform === 'win32' ? 'wrangler.cmd' : 'wrangler';
  // Try spawn, then fallback to exec on Windows
  try {
    return await new Promise((resolve, reject)=>{
      let out=''; let err='';
      const p = cp.spawn(wrCmd, args, { env: process.env });
      p.stdout.on('data', d=> out += String(d));
      p.stderr.on('data', d=> err += String(d));
      p.on('error', reject);
      p.on('exit', code => code===0 ? resolve(out) : reject(new Error(err||('wrangler_exit_'+code))));
    });
  } catch (e) {
    if (process.platform === 'win32'){
      const quote = (s)=>/\s/.test(s) ? `"${s.replace(/"/g,'\"')}"` : s;
      const cmdline = [wrCmd, ...args.map(quote)].join(' ');
      return await new Promise((resolve, reject)=>{
        cp.exec(cmdline, { env: process.env }, (err, stdout, stderr)=>{
          if (err) return reject(new Error(stderr||String(err)));
          resolve(String(stdout||''));
        });
      });
    }
    throw e;
  }
}

async function kvPutPath(nsId, key, filePath, remote){
  const args = ['kv','key','put', key, '--namespace-id', nsId, '--path', filePath];
  if (remote) args.push('--remote');
  const wrCmd = process.platform === 'win32' ? 'wrangler.cmd' : 'wrangler';
  const env = process.env.CF_API_TOKEN ? { ...process.env, CLOUDFLARE_API_TOKEN: process.env.CF_API_TOKEN } : { ...process.env };
  try {
    await new Promise((resolve, reject)=>{
      let err='';
      const p = cp.spawn(wrCmd, args, { env });
      p.stderr.on('data', d=> err += String(d));
      p.on('error', reject);
      p.on('exit', code => code===0 ? resolve() : reject(new Error(err||('wrangler_exit_'+code))));
    });
  } catch (e) {
    if (process.platform === 'win32'){
      const quote = (s)=>/\s/.test(s) ? `"${s.replace(/"/g,'\"')}"` : s;
      const cmdline = [wrCmd, ...args.map(quote)].join(' ');
      await new Promise((resolve, reject)=>{
        cp.exec(cmdline, { env }, (err, stdout, stderr)=>{
          if (err) return reject(new Error(stderr||String(err)));
          resolve();
        });
      });
    } else {
      throw e;
    }
  }
}

async function main(){
  const key = process.argv[2];
  if (!key) { console.error('Usage: node tools/kv_bump_snapshot_timestamp.js <key>'); process.exit(2); }
  const nsId = process.env.KV_NAMESPACE_ID || process.env.EF_SNAPSHOTS_NAMESPACE_ID;
  if (!nsId) { console.error('KV_NAMESPACE_ID env required'); process.exit(2); }
  const remote = process.env.REMOTE==='1' || process.env.CF_KV_REMOTE==='1' || process.env.CF_PAGES_REMOTE==='1';
  const dry = process.env.DRY_RUN==='1';

  let text = await kvGetText(nsId, key, remote);
  // Strip any leading BOMs and junk before first '{'
  if (text) {
    // remove all starting BOM chars
    while (text.length && text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
    // Slice to JSON object region: first '{' to last '}'
    const firstBrace = text.indexOf('{');
    const lastBrace = text.lastIndexOf('}');
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      text = text.slice(firstBrace, lastBrace + 1);
    } else if (firstBrace > 0) {
      // Fallback to just trimming start if we cannot find last brace safely
      text = text.slice(firstBrace);
    }
    // remove any residual BOMs anywhere in string
    text = text.replace(/\uFEFF/g, '');
  }
  const nowIso = new Date().toISOString();
  let tmp = path.join(os.tmpdir(), 'kv_bump_'+key+'.json');
  try {
    let json = JSON.parse(text);
    json.updatedAt = nowIso;
    fs.writeFileSync(tmp, JSON.stringify(json));
  } catch(e){
    // Fallback: regex replace updatedAt in raw text
    // Ensure we operate on the sliced JSON segment if possible
    let t = text;
    if (typeof t !== 'string' || !t.length) {
      console.error('Empty text payload; cannot replace.');
      process.exit(2);
    }
    const replaced = t.replace(/"updatedAt"\s*:\s*"[^"]+"/, `"updatedAt":"${nowIso}"`);
    if (replaced === text) {
      console.error('Could not find updatedAt field to replace in text mode.');
      process.exit(2);
    }
    fs.writeFileSync(tmp, replaced);
  }
  if (dry) {
    console.log(JSON.stringify({ key, nsId, updatedAt: nowIso, remote, dry: true }));
    return;
  }
  await kvPutPath(nsId, key, tmp, remote);
  console.log(JSON.stringify({ key, nsId, updatedAt: nowIso, remote, dry: false }));
}

main().catch(e=>{ console.error(e.stack||String(e)); process.exit(1); });
