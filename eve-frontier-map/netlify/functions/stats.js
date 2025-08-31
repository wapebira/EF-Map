import { getStore } from '@netlify/blobs';

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
    if(histParam){ histDays = Math.min(31, Math.max(1, parseInt(histParam,10)||0)); }
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
    return { statusCode:200, headers:{ 'Content-Type':'application/json', 'Cache-Control':'no-store' }, body: JSON.stringify({ current: JSON.parse(raw), history }) };
  } catch(e){
    console.error('stats error', e);
    return { statusCode:500, body:'Internal Error' };
  }
}
