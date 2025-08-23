import { getStore } from '@netlify/blobs';
import { randomUUID } from 'node:crypto';

// Classic Netlify Function handler for broader runtime compatibility.
export async function handler(event) {
  try {
    if (event.httpMethod !== 'POST') {
      return { statusCode: 405, body: 'Method Not Allowed' };
    }
    let body;
    try {
      body = event.body ? JSON.parse(event.body) : {};
    } catch {
      console.error('create-share invalid json body', event.body?.slice(0,200));
      return { statusCode: 400, body: 'Invalid JSON' };
    }
    const { data, preferId } = body || {};
    if (typeof data !== 'string' || !data.trim()) {
      console.error('create-share missing data field');
      return { statusCode: 400, body: 'Missing data' };
    }
    if (!data.startsWith('r1|')) {
      console.error('create-share invalid prefix', data.slice(0,10));
      return { statusCode: 400, body: 'Invalid share payload' };
    }
    const storeName = process.env.SHARE_STORE || 'shares';
    let store; let storeError;
    const siteID = process.env.BLOB_SITE_ID || process.env.NETLIFY_SITE_ID || process.env.SITE_ID;
    const token = process.env.BLOB_PAT || process.env.BLOBS_TOKEN;
    // Try explicit credential object form first
    if (siteID && token) {
      try { store = getStore({ name: storeName, siteID, token }); } catch (e) { storeError = e; }
      if (!store) {
        try { store = getStore(storeName, { siteID, token }); storeError = undefined; } catch (e2) { storeError = e2; }
      }
    }
    // Fallback to implicit environment if still no store
    if (!store) {
      try { store = getStore(storeName); storeError = undefined; } catch (e) { storeError = e; }
    }
    let memoryFallback = false;
    if (!store) {
      if (!globalThis.__SHARE_CACHE) globalThis.__SHARE_CACHE = new Map();
      memoryFallback = true;
    }
    const memorySet = (k,v,onlyIfNew)=>{ const c = globalThis.__SHARE_CACHE; if (onlyIfNew && c.has(k)) return { modified:false }; c.set(k,v); return { modified:true }; };
    if (!memoryFallback) {
      try { await store.set('diag_write_probe','1',{ onlyIfNew:true }); } catch (e) { console.error('create-share probe write failed', e); return { statusCode:500, body:'probe write failed: '+e.message+(storeError? ' (initial store error: '+storeError.message+')':'') }; }
    }
  let id = typeof preferId === 'string' ? preferId.slice(0, 16).replace(/[^A-Za-z0-9_-]/g, '') : '';
    if (!id) id = randomUUID().replace(/-/g, '').slice(0, 10);
    for (let attempts = 0; attempts < 3; attempts++) {
      let modified;
      try {
  if (memoryFallback) { modified = memorySet(id, data, true).modified; } else { const result = await store.set(id, data, { onlyIfNew: true }); modified = result.modified; }
      } catch (e) {
        console.error('create-share store.set error', id, e);
        return { statusCode: 500, body: 'store.set failed: ' + e.message + (memoryFallback? ' (memory fallback)':'' ) };
      }
      if (modified) {
        return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, ephemeral: memoryFallback }) };
      }
      id = randomUUID().replace(/-/g, '').slice(0, 10);
    }
    return { statusCode: 500, body: 'Could not allocate id' };
  } catch (err) {
    console.error('create-share error', err);
    return { statusCode: 500, body: 'Unhandled: ' + (err && err.message) };
  }
}

