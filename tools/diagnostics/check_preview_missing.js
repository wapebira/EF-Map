/**
 * Quick preview verifier for Smart Gate tribes.
 * Usage:
 *   node tools/diagnostics/check_preview_missing.js [url] [targetGateId]
 * Defaults:
 *   url → current preview alias with cache bypass & ts
 *   targetGateId → known problematic gate id (from operator notes)
 */

const DEFAULT_URL = `https://feature-safe-wip-2025-09-19-ikpg.ef-map.pages.dev/api/smart-gate-links?force=1&ts=${Date.now()}`;
const DEFAULT_GATE_ID = '63994086827917643456569397617352518577262080062173992510601782164513069228530';

async function main(){
  const url = process.argv[2] || DEFAULT_URL;
  const targetGateId = process.argv[3] || DEFAULT_GATE_ID;
  const resp = await fetch(url, { cache: 'no-store' });
  if(!resp.ok){
    console.error('HTTP', resp.status, await resp.text().catch(()=>''));
    process.exit(2);
  }
  const data = await resp.json();
  const links = Array.isArray(data?.links) ? data.links : [];
  const missing = links.filter(l => !l?.tribeId && !(Array.isArray(l?.tribes) && l.tribes.length>0)).length;
  const sampleMissing = links.find(l => !l?.tribeId && !(Array.isArray(l?.tribes) && l.tribes.length>0)) || null;
  const target = links.find(l => String(l?.gateId||'') === targetGateId) || null;
  const out = {
    total: links.length,
    missing,
    sampleMissing: sampleMissing ? {
      gateId: String(sampleMissing.gateId||''),
      origin: sampleMissing.origin||null,
      destination: sampleMissing.destination||null
    } : null,
    targetGate: target ? {
      gateId: String(target.gateId||''),
      tribeId: target.tribeId||null,
      tribes: Array.isArray(target.tribes)? target.tribes : undefined,
      origin: target.origin||null,
      destination: target.destination||null
    } : null,
    source: resp.headers.get('X-Links-Source')||null,
    etag: resp.headers.get('ETag')||null
  };
  console.log(JSON.stringify(out, null, 2));
}

main().catch(e=>{ console.error('checker_failed:', e); process.exit(1); });
