// Simple HTTP probe for endpoints; prints status, content-type, and a brief JSON summary
// Usage: node tools/probe_endpoints.js

const targets = [
  { name: 'prod-stats', url: 'https://ef-map.com/api/stats?history=7&debug=1' },
  { name: 'preview-stats', url: 'https://stats-today-fix.ef-map.pages.dev/api/stats?history=7&debug=1' },
  { name: 'prod-list', url: 'https://ef-map.com/api/list-stats' },
  { name: 'preview-list', url: 'https://stats-today-fix.ef-map.pages.dev/api/list-stats' },
];

const todayUTC = new Date().toISOString().slice(0,10);

async function probe(url){
  const r = await fetch(url, { redirect: 'manual' });
  const ct = r.headers.get('content-type') || '';
  const body = await r.text();
  return { status: r.status, ct, body };
}

function summarize(name, { status, ct, body }){
  const head = body.slice(0, 200).replace(/\s+/g,' ').trim();
  let json=null; try { json = JSON.parse(body); } catch {}
  const out = { name, status, ct, head };
  if(json && json.history && Array.isArray(json.history)){
    const dates = json.history.map(h => String(h.date || (h.updatedAt ? String(h.updatedAt).slice(0,10) : '')).replace(/\.json$/,'')).filter(Boolean);
    out.historyCount = dates.length;
    out.historyHasToday = dates.includes(todayUTC);
    out.historyLast = dates.slice(-3);
  }
  if(json && json.debug && json.debug.foundDailyKeys){
    out.dailyKeysLast = json.debug.foundDailyKeys.slice(-3);
  }
  if(json && json.daily && Array.isArray(json.daily)){
    out.dailyListLast = json.daily.slice(-3);
  }
  return out;
}

(async () => {
  for (const t of targets){
    try {
      const res = await probe(t.url);
      const sum = summarize(t.name, res);
      console.log(JSON.stringify(sum));
    } catch (e){
      console.error(JSON.stringify({ name: t.name, error: String(e.message||e) }));
    }
  }
})();
