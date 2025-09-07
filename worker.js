// Cloudflare Worker – Option A sandbox implementation
// Provides /api/create-share, /api/get-share, /api/usage-event, /api/stats
// Uses KV namespaces bound as EF_SHARES, EF_STATS (wrangler.jsonc).
// This is a simplified port of Netlify functions for visual validation.

// Share creation (random id)
async function handleCreateShare(req, env){
  if(req.method !== 'POST') return json({ error:'Method Not Allowed' }, 405);
  let body; try { body = req.headers.get('content-type')?.includes('application/json') ? await req.json() : {}; } catch { return json({ error:'Invalid JSON' },400); }
  const { data, preferId } = body || {};
  if(typeof data !== 'string' || !data.trim()) return json({ error:'Missing data' },400);
  if(!data.startsWith('r1|')) return json({ error:'Invalid share payload' },400);
  let id = typeof preferId === 'string' ? preferId.slice(0,16).replace(/[^A-Za-z0-9_-]/g,'') : '';
  if(!id) id = crypto.randomUUID().replace(/-/g,'').slice(0,10);
  for(let attempts=0; attempts<5; attempts++){
    const existing = await env.EF_SHARES.get(id);
    if(existing !== null){ id = crypto.randomUUID().replace(/-/g,'').slice(0,10); continue; }
    await env.EF_SHARES.put(id, data);
    return json({ id });
  }
  return json({ error:'Could not allocate id' },500);
}

async function handleGetShare(url, env){
  const id = url.searchParams.get('id');
  if(!id) return json({ error:'Missing id' },400);
  const value = await env.EF_SHARES.get(id);
  if(value === null) return json({ error:'Not found' },404);
  return json({ data:value });
}

// ---- Usage / Stats (simplified port) ----
const SCHEMA_VERSION = 2;
const EVENT_MAP = new Map(Object.entries({
  share_created: { counters:['routes_shared'] },
  share_resolved: { counters:['shared_resolved'] },
  // Minimal subset for sandbox visual test; extend later with full list
  page_load: { counters:['page_loads'] }
}));

function upgradeSnapshot(s){
  if(!s.version || s.version < SCHEMA_VERSION){
    if(s.sums){ delete s.sums.scout_baseline_time_ms_sum; delete s.sums.scout_baseline_time_count; }
    s.version = SCHEMA_VERSION;
  }
}

async function loadSnapshot(kv, key){
  const raw = await kv.get(key);
  if(!raw){
    if(key==='current') return { version:1, updatedAt:new Date().toISOString(), counters:{}, sums:{} };
    return { version:1, updatedAt:new Date().toISOString(), counters:{}, sums:{}, date:key.startsWith('daily/')? key.slice(6) : undefined };
  }
  try { return JSON.parse(raw); } catch { return { version:1, updatedAt:new Date().toISOString(), counters:{}, sums:{} }; }
}

function applyEvent(s, type, body){
  const def = EVENT_MAP.get(type); if(!def) return false; s.updatedAt = new Date().toISOString();
  if(def.counters) def.counters.forEach(k=>{ s.counters[k]=(s.counters[k]||0)+1; });
  return true;
}

async function handleUsageEvent(req, env){
  if(req.method !== 'POST') return new Response('Method Not Allowed',{ status:405 });
  let body={}; try { body = req.headers.get('content-type')?.includes('application/json') ? await req.json() : {}; } catch { return new Response('Invalid JSON',{ status:400 }); }
  const { type } = body;
  // For sandbox: silently accept unknown event types (Netlify still holds full set in prod).
  if(typeof type !== 'string') return new Response('Missing type',{ status:400 });
  const known = EVENT_MAP.has(type);
  const current = await loadSnapshot(env.EF_STATS, 'current'); upgradeSnapshot(current);
  const day = new Date().toISOString().slice(0,10);
  const dailyKey = 'daily/' + day + '.json';
  const daily = await loadSnapshot(env.EF_STATS, dailyKey); upgradeSnapshot(daily);
  if(known){
    if(!applyEvent(current,type,body) || !applyEvent(daily,type,body)) return new Response('Rejected',{ status:400 });
    await env.EF_STATS.put('current', JSON.stringify(current));
    await env.EF_STATS.put(dailyKey, JSON.stringify(daily));
  }
  return new Response(null,{ status:204 });
}

async function handleStats(url, env){
  let raw = await env.EF_STATS.get('current');
  if(!raw) raw = JSON.stringify({ version:1, updatedAt:new Date().toISOString(), counters:{}, sums:{} });
  const histParam = url.searchParams.get('history');
  let history=[]; let histDays=0; if(histParam){ histDays = Math.min(30, Math.max(1, parseInt(histParam,10)||0)); }
  if(histDays>0){
    const today = new Date();
    for(let i=0;i<histDays;i++){
      const d = new Date(today.getTime()-i*86400000).toISOString().slice(0,10);
      const key = 'daily/'+d+'.json';
      const dr = await env.EF_STATS.get(key); if(dr){ try { history.push(JSON.parse(dr)); } catch{} }
    }
    history.reverse();
  }
  return json({ current: JSON.parse(raw), history });
}

function json(obj, status=200){ return new Response(JSON.stringify(obj), { status, headers:{ 'Content-Type':'application/json','Cache-Control':'no-store' } }); }

export default {
  async fetch(req, env, ctx){
    const url = new URL(req.url);
    const p = url.pathname;
  // Support both /api/* and Netlify-style /.netlify/functions/* paths for the frontend without code changes.
  if(p === '/api/create-share' || p === '/.netlify/functions/create-share') return handleCreateShare(req, env);
  if(p === '/api/get-share' || p === '/.netlify/functions/get-share') return handleGetShare(url, env);
  if(p === '/api/usage-event' || p === '/.netlify/functions/usage-event') return handleUsageEvent(req, env);
  if(p === '/api/stats' || p === '/.netlify/functions/stats') return handleStats(url, env);
    // Fallback to assets (static site) – will serve SPA.
    return env.ASSETS.fetch(req);
  }
};
