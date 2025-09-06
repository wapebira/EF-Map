import { getStatsStore } from './_store.js';

const STORE_NAME = process.env.STATS_STORE || 'app-stats';

// store retrieval handled by abstraction

export async function handler(event){
  try {
    const store = await getStatsStore();
    if(!store) return { statusCode:500, body:'Storage unavailable' };
    let raw = await store.get('current');
    if(raw===null){
      raw = JSON.stringify({ version:1, updatedAt:new Date().toISOString(), counters:{}, sums:{} });
    }
    // Optional history param ?history=7 (days, inclusive of today)
    let history = [];
    const url = new URL(event?.rawUrl || 'http://local');
    const histParam = url.searchParams.get('history');
    let histDays = 0;
  // Allow larger window (up to 120 days) so client can derive weekly/monthly aggregates without extra round trips.
  if(histParam){ histDays = Math.min(120, Math.max(1, parseInt(histParam,10)||0)); }
    if(histDays>0){
      const today = new Date();
      for(let i=0;i<histDays;i++){
        const d = new Date(today.getTime() - i*86400000).toISOString().slice(0,10);
        const key = 'daily/' + d + '.json';
        const dr = await store.get(key);
        if(dr){ try { history.push(JSON.parse(dr)); } catch {/* ignore */} }
      }
      history.reverse(); // chronological
    }
  const current = JSON.parse(raw);
  return { statusCode:200, headers:{ 'Content-Type':'application/json', 'Cache-Control':'no-store' }, body: JSON.stringify({ current, history }) };
  } catch(e){
    console.error('stats error', e);
    return { statusCode:500, body:'Internal Error' };
  }
}
