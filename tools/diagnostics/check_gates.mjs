#!/usr/bin/env node
// Quick check for specific gateIds in /api/smart-gate-links and gateMeta.owner

const host = process.argv[2] || 'https://feature-smart-gate-preview.ef-map.pages.dev';
const gateIds = process.argv.slice(3);
if (!gateIds.length) {
  console.error('Usage: node tools/diagnostics/check_gates.mjs <baseUrl> <gateId1> <gateId2> ...');
  process.exit(2);
}

async function main() {
  const url = host.replace(/\/$/, '') + '/api/smart-gate-links';
  const r = await fetch(url, { headers: { 'Accept': 'application/json' } });
  const src = r.headers.get('X-Links-Source');
  const filled = r.headers.get('X-Links-Filled-Tribes');
  const etag = r.headers.get('ETag');
  if (!r.ok) throw new Error('HTTP '+r.status);
  const json = await r.json();
  const out = { url, status: r.status, etag, source: src, filled, total: json.links?.length || 0, gates: [] };
  for (const id of gateIds) {
    const link = json.links.find(l => l.gateId === id);
    const meta = (json.gateMeta && json.gateMeta[id]) || null;
    out.gates.push({ gateId: id, link, owner: meta?.owner || null, status: meta?.status || null });
  }
  console.log(JSON.stringify(out, null, 2));
}

main().catch(e=>{ console.error('ERROR', String(e)); process.exit(1); });
