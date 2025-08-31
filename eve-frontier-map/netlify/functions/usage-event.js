import { getStore } from '@netlify/blobs';

// Allowed event types and their mapped counter keys / sum keys
const EVENT_MAP = {
  p2p_route: { counters: ['p2p_routes'] },
  scout_baseline: { counters: ['scout_baselines'], sum: { key: 'scout_collected_systems_sum', countKey: 'scout_collected_systems_count', valueField: 'collectedSystems' }, extraCounters: (b)=> b.planetFilterOn ? ['planet_filter_baselines'] : [] },
  scout_opt_start: { counters: ['scout_optimizations'] },
  share_created: { counters: ['routes_shared'] },
  share_resolved: { counters: ['shared_resolved'] },
  referral_click: { counters: ['referral_clicks'] },
  theme_blue: { counters: ['theme_blue'] },
  theme_orange: { counters: ['theme_orange'] },
  baseline_error: { counters: ['baseline_errors'] },
  stall_restart: { counters: ['stall_restarts'] },
  p2p_route_time: { sum: { key: 'p2p_route_time_ms_sum', countKey: 'p2p_route_time_count', valueField: 'ms' } },
  scout_baseline_time: { sum: { key: 'scout_baseline_time_ms_sum', countKey: 'scout_baseline_time_count', valueField: 'ms' } },
  scout_opt_session_time: { sum: { key: 'scout_opt_session_time_ms_sum', countKey: 'scout_opt_session_time_count', valueField: 'ms' } },
  feature_flags: { countersDynamic: (b)=> {
    const arr = [];
    if(b.waypoints) arr.push('waypoints_used');
    if(b.avoid) arr.push('avoid_used');
    if(b.waypointOpt) arr.push('waypoint_opt_used');
    if(b.returnToStart) arr.push('return_to_start');
    if(b.gateReachable) arr.push('gate_reachable');
    return arr;
  } }
};

const STORE_NAME = process.env.STATS_STORE || 'app-stats';

async function getStatsStore(){
  let store; let storeError;
  const siteID = process.env.BLOB_SITE_ID || process.env.NETLIFY_SITE_ID || process.env.SITE_ID;
  const token = process.env.BLOB_PAT || process.env.BLOBS_TOKEN;
  if(siteID && token){
    try { store = getStore({ name: STORE_NAME, siteID, token }); } catch(e) { storeError = e; }
    if(!store){ try { store = getStore(STORE_NAME, { siteID, token }); storeError = undefined; } catch(e2){ storeError = e2; } }
  }
  if(!store){ try { store = getStore(STORE_NAME); storeError = undefined; } catch(e) { storeError = e; } }
  return store;
}

async function loadSnapshot(store, key){
  let raw = await store.get(key);
  if(raw===null){
    if(key === 'current') return { version:1, updatedAt:new Date().toISOString(), counters:{}, sums:{} };
    // daily snapshot
    return { version:1, date: key.startsWith('daily/') ? key.slice(6) : undefined, updatedAt:new Date().toISOString(), counters:{}, sums:{} };
  }
  try { return JSON.parse(raw); } catch { return { version:1, updatedAt:new Date().toISOString(), counters:{}, sums:{} }; }
}

function applyEvent(snapshot, evt){
  const def = EVENT_MAP[evt.type];
  if(!def) return false;
  snapshot.updatedAt = new Date().toISOString();
  if(def.counters){ def.counters.forEach(k=>{ snapshot.counters[k] = (snapshot.counters[k]||0)+1; }); }
  if(def.extraCounters){ (def.extraCounters(evt.body||{})||[]).forEach(k=>{ snapshot.counters[k] = (snapshot.counters[k]||0)+1; }); }
  if(def.countersDynamic){ (def.countersDynamic(evt.body||{})||[]).forEach(k=>{ snapshot.counters[k] = (snapshot.counters[k]||0)+1; }); }
  if(def.sum){ const v = Number(evt.body?.[def.sum.valueField]); if(isFinite(v) && v>=0){ snapshot.sums[def.sum.key] = (snapshot.sums[def.sum.key]||0)+v; snapshot.sums[def.sum.countKey] = (snapshot.sums[def.sum.countKey]||0)+1; } }
  return true;
}

export async function handler(event){
  try {
    if(event.httpMethod !== 'POST') return { statusCode:405, body:'Method Not Allowed' };
    let body={};
    try { body = event.body ? JSON.parse(event.body) : {}; } catch { return { statusCode:400, body:'Invalid JSON' }; }
    const { type } = body;
    if(typeof type !== 'string'){ return { statusCode:400, body:'Missing type' }; }
    if(!EVENT_MAP[type]) return { statusCode:400, body:'Unknown event type' };
  const store = await getStatsStore(); if(!store) return { statusCode:500, body:'Storage unavailable' };
  // Load global snapshot
  const snapshot = await loadSnapshot(store, 'current');
  // Load today's daily snapshot
  const day = new Date().toISOString().slice(0,10);
  const dailyKey = 'daily/' + day + '.json';
  const daily = await loadSnapshot(store, dailyKey);
  const applied = applyEvent(snapshot, { type, body });
  if(applied) applyEvent(daily, { type, body });
  if(!applied) return { statusCode:400, body:'Rejected' };
  await store.set('current', JSON.stringify(snapshot));
  await store.set(dailyKey, JSON.stringify(daily));
    return { statusCode:204 };
  } catch(e){
    console.error('usage-event error', e);
    return { statusCode:500, body:'Internal Error' };
  }
}
