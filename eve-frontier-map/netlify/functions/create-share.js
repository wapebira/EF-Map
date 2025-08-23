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
      return { statusCode: 400, body: 'Invalid JSON' };
    }
    const { data, preferId } = body || {};
    if (typeof data !== 'string' || !data.trim()) {
      return { statusCode: 400, body: 'Missing data' };
    }
    if (!data.startsWith('r1|')) {
      return { statusCode: 400, body: 'Invalid share payload' };
    }
    const storeName = process.env.SHARE_STORE || 'shares';
    const store = getStore(storeName);
    let id = typeof preferId === 'string' ? preferId.slice(0, 16).replace(/[^A-Za-z0-9_-]/g, '') : '';
    if (!id) id = randomUUID().replace(/-/g, '').slice(0, 10);
    for (let attempts = 0; attempts < 3; attempts++) {
      const { modified } = await store.set(id, data, { onlyIfNew: true });
      if (modified) {
        return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) };
      }
      id = randomUUID().replace(/-/g, '').slice(0, 10);
    }
    return { statusCode: 500, body: 'Could not allocate id' };
  } catch (err) {
    console.error('create-share error', err);
    return { statusCode: 500, body: 'Internal Error' };
  }
}
