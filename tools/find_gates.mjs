// Find gates by tribe id and/or gateId substring from the preview endpoint
// Usage:
//   node tools/find_gates.mjs [baseUrl] [--tribe 98000059] [--contains 28530]

const args = process.argv.slice(2);
let base = 'https://feature-tribe-fallbacks.ef-map.pages.dev';
let tribe = null;
let contains = null;
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a.startsWith('http')) base = a;
  else if (a === '--tribe') { tribe = String(args[++i] || ''); }
  else if (a === '--contains') { contains = String(args[++i] || ''); }
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
  const { json } = await fetchJson('/api/smart-gate-links');
  const links = Array.isArray(json.links) ? json.links : [];
  const gateMeta = json.gateMeta || {};

  const matches = links.filter(l => {
    const tid = pickTribeId(l);
    const tribeOk = tribe ? (tid === tribe) : true;
    const containsOk = contains ? (String(l.gateId || '').includes(contains)) : true;
    return tribeOk && containsOk;
  });

  console.log(`Base: ${base}`);
  console.log(`Filters -> tribe: ${tribe || '(any)'}; contains: ${contains || '(none)'}; matches: ${matches.length}`);
  for (const l of matches) {
    const meta = gateMeta[String(l.gateId)] || {};
    const owner = meta.owner || {};
    console.log(JSON.stringify({
      gateId: l.gateId,
      originSystemId: l.origin ?? l.originSystemId ?? null,
      destinationSystemId: l.destination ?? l.destinationSystemId ?? null,
      tribeId: pickTribeId(l),
      ownerTribeId: owner.tribeId || null,
      ownerCharacterId: owner.characterId || null
    }));
  }
})();
