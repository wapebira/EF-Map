// Post a single usage event to a target and report before/after counter values
// Usage: node tools/poke_usage_event.js

const targets = [
  { name: 'prod', base: 'https://ef-map.com' },
  { name: 'preview', base: 'https://stats-today-fix.ef-map.pages.dev' },
];

const EVENT = { type: 'ui_hide' }; // low-signal counter

async function getCurrent(base){
  const r = await fetch(base + '/api/stats?history=0');
  const j = await r.json();
  return j.current && j.current.counters || {};
}

async function postEvent(base, body){
  const r = await fetch(base + '/api/usage-event', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });
  return r.status;
}

(async () => {
  for(const t of targets){
    try {
      const before = await getCurrent(t.base);
      const status = await postEvent(t.base, EVENT);
      // Small delay to allow KV write to settle
      await new Promise(r=>setTimeout(r, 800));
      const after = await getCurrent(t.base);
      const key = 'ui_hide';
      console.log(JSON.stringify({ name: t.name, postStatus: status, before: before[key]||0, after: after[key]||0, delta: (after[key]||0) - (before[key]||0) }));
    } catch(e){
      console.error(JSON.stringify({ name: t.name, error: String(e.message||e) }));
    }
  }
})();
