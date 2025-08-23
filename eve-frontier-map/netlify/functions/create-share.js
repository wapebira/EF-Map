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
    let store;
    try {
      store = getStore(storeName);
    } catch (e) {
      console.error('create-share failed to getStore', storeName, e);
      return { statusCode: 500, body: 'getStore failed: ' + e.message };
    }
    // Probe write
    try {
      await store.set('diag_write_probe', '1', { onlyIfNew: true });
    } catch (e) {
      console.error('create-share probe write failed', e);
      return { statusCode: 500, body: 'probe write failed: ' + e.message };
    }
    let id = typeof preferId === 'string' ? preferId.slice(0, 16).replace(/[^A-Za-z0-9_-]/g, '') : '';
    if (!id) id = randomUUID().replace(/-/g, '').slice(0, 10);
    for (let attempts = 0; attempts < 3; attempts++) {
      let modified;
      try {
        const result = await store.set(id, data, { onlyIfNew: true });
        modified = result.modified;
      } catch (e) {
        console.error('create-share store.set error', id, e);
        return { statusCode: 500, body: 'store.set failed: ' + e.message };
      }
      if (modified) {
        return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) };
      }
      id = randomUUID().replace(/-/g, '').slice(0, 10);
    }
    return { statusCode: 500, body: 'Could not allocate id' };
  } catch (err) {
    console.error('create-share error', err);
    return { statusCode: 500, body: 'Unhandled: ' + (err && err.message) };
  }
}

