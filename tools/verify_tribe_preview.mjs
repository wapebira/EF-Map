// Verify tribe fallbacks and coverage on a Cloudflare Pages preview
// Usage: node tools/verify_tribe_preview.mjs [baseUrl]
// Example: node tools/verify_tribe_preview.mjs https://feature-tribe-fallbacks.ef-map.pages.dev

const base = process.argv[2] || process.env.BASE_URL || 'https://feature-tribe-fallbacks.ef-map.pages.dev';

function groupCounts(items, pickId) {
  const map = new Map();
  for (const it of items) {
    const id = pickId(it) || 'UNKNOWN';
    map.set(id, (map.get(id) || 0) + 1);
  }
  return [...map.entries()].sort((a, b) => b[1] - a[1]);
}

function hasTribe(obj) {
  return (obj && obj.tribeId && String(obj.tribeId).length > 0)
    || (obj && Array.isArray(obj.tribes) && obj.tribes.length > 0);
}

function pickTribeId(obj) {
  if (!obj) return null;
  if (obj.tribeId != null && String(obj.tribeId).length > 0) return String(obj.tribeId);
  if (Array.isArray(obj.tribes) && obj.tribes.length > 0) return String(obj.tribes[0]);
  return null;
}

async function fetchJson(path) {
  const url = `${base}${path}${path.includes('?') ? '&' : '?'}force=1`;
  const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch (e) { throw new Error(`Non-JSON at ${url}. Status ${res.status}. First bytes: ${text.slice(0, 120)}`); }
  return { res, json };
}

(async () => {
  console.log(`Base URL: ${base}`);
  console.log('--- /api/smart-gate-links ---');
  const { res: r1, json: d1 } = await fetchJson('/api/smart-gate-links');
  console.log(`Status: ${r1.status}`);
  console.log(`X-Links-Source: ${r1.headers.get('x-links-source')}`);
  console.log(`X-Links-Filled-Tribes: ${r1.headers.get('x-links-filled-tribes')}`);
  console.log(`X-Links-Total: ${r1.headers.get('x-links-total')}`);
  const links = Array.isArray(d1.links) ? d1.links : [];
  const missingLinks = links.filter(l => !hasTribe(l));
  console.log(`Links total: ${links.length}; missing tribe: ${missingLinks.length}`);
  const topLinks = groupCounts(links, pickTribeId).slice(0, 10);
  console.log('Top 10 tribeId counts (id:count):');
  for (const [id, cnt] of topLinks) console.log(`${id}:${cnt}`);
  const has98000059 = topLinks.some(([id]) => id === '98000059') || groupCounts(links, pickTribeId).some(([id]) => id === '98000059');
  console.log(`Contains 98000059 among links: ${has98000059 ? 'yes' : 'no'}`);

  console.log('\n--- /api/gate-access ---');
  const { res: r2, json: d2 } = await fetchJson('/api/gate-access');
  console.log(`Status: ${r2.status}`);
  console.log(`X-Gates-ACL-Source: ${r2.headers.get('x-gates-acl-source')}`);
  console.log(`X-Gates-ACL-Normalized: ${r2.headers.get('x-gates-acl-normalized')}`);
  console.log(`X-Gates-ACL-Public: ${r2.headers.get('x-gates-acl-public')}`);
  console.log(`X-Gates-ACL-Total: ${r2.headers.get('x-gates-acl-total')}`);
  console.log(`X-Gates-ACL-Filled-Tribes: ${r2.headers.get('x-gates-acl-filled-tribes')}`);
  console.log(`X-Gates-ACL-Tribe-Total: ${r2.headers.get('x-gates-acl-tribe-total')}`);
  const rules = Array.isArray(d2.rules) ? d2.rules : [];
  const missingRules = rules.filter(l => !hasTribe(l));
  console.log(`Rules total: ${rules.length}; missing tribe: ${missingRules.length}`);
  const topRules = groupCounts(rules, pickTribeId).slice(0, 10);
  console.log('Top 10 ACL tribeId counts (id:count):');
  for (const [id, cnt] of topRules) console.log(`${id}:${cnt}`);
  const has98000059Acl = topRules.some(([id]) => id === '98000059') || groupCounts(rules, pickTribeId).some(([id]) => id === '98000059');
  console.log(`Contains 98000059 among ACL: ${has98000059Acl ? 'yes' : 'no'}`);

  // Exit code signals success if no missing tribe in either set
  if (missingLinks.length === 0 && missingRules.length === 0) {
    console.log('\nOK: No missing tribe fields in links or ACL.');
    process.exit(0);
  } else {
    console.log('\nWARN: Some items missing tribe fields.');
    process.exit(2);
  }
})().catch(err => {
  console.error('ERROR:', err.message);
  process.exit(1);
});
