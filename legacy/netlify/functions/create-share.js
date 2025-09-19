import { randomUUID } from 'node:crypto';
import { getShareStore } from './_store.js';

// Short share creation: stores compressed route state under a random id.
export async function handler(event) {
  try {
    if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };
    let body; try { body = event.body ? JSON.parse(event.body) : {}; } catch { return { statusCode:400, body:'Invalid JSON' }; }
    const { data, preferId } = body || {};
    if (typeof data !== 'string' || !data.trim()) return { statusCode:400, body:'Missing data' };
    if (!data.startsWith('r1|')) return { statusCode:400, body:'Invalid share payload' };
    const store = await getShareStore();
    let id = typeof preferId === 'string' ? preferId.slice(0,16).replace(/[^A-Za-z0-9_-]/g,'') : '';
    if(!id) id = randomUUID().replace(/-/g,'').slice(0,10);
    for(let attempts=0; attempts<5; attempts++){
      try {
        const existing = await store.get(id);
        if(existing !== null){ id = randomUUID().replace(/-/g,'').slice(0,10); continue; }
        await store.set(id, data);
        return { statusCode:200, headers:{ 'Content-Type':'application/json' }, body: JSON.stringify({ id, ephemeral: !!store.ephemeral }) };
      } catch(e){
        console.error('create-share store op error', id, e);
        return { statusCode:500, body:'store op failed: '+e.message+(store.ephemeral?' (memory fallback)':'') };
      }
    }
    return { statusCode:500, body:'Could not allocate id after retries' };
  } catch(err){
    console.error('create-share error', err);
    return { statusCode:500, body:'Unhandled: '+ (err && err.message) };
  }
}

