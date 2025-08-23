import { getStore } from '@netlify/blobs';

export async function handler(event) {
  try {
    const params = new URLSearchParams(event.rawQuery || '');
    const id = params.get('id');
    if (!id) return { statusCode: 400, body: 'Missing id' };
    const storeName = process.env.SHARE_STORE || 'shares';
    let store;
    let storeError;
    try {
      store = getStore(storeName);
    } catch (e) {
      storeError = e;
      const siteID = process.env.BLOB_SITE_ID || process.env.NETLIFY_SITE_ID || process.env.SITE_ID;
      const token = process.env.BLOB_PAT || process.env.BLOBS_TOKEN;
      if (siteID && token) {
        try {
          store = getStore(storeName, { siteID, token });
          storeError = undefined;
        } catch (e2) {
          // Try object signature variant
            try {
              store = getStore({ name: storeName, siteID, token });
              storeError = undefined;
            } catch (e3) {
              storeError = e3;
            }
        }
      }
    }
    if (!store) {
      // In-memory fallback lookup (unlikely to hit because different lambda instance)
  const cache = globalThis.__SHARE_CACHE;
      if (cache && cache.has(id)) {
        return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data: cache.get(id), ephemeral: true }) };
      }
      return { statusCode: 500, body: 'Blobs unavailable (no persistent store). Enable Netlify Blobs for short links.' + (storeError? ' '+storeError.message:'') };
    }
    let value = null;
    try {
      value = await store.get(id);
    } catch (e) {
      return { statusCode: 500, body: 'store.get failed: ' + e.message };
    }
    if (value === null) return { statusCode: 404, body: 'Not found' };
    return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data: value }) };
  } catch (err) {
    console.error('get-share error', err);
    return { statusCode: 500, body: 'Internal Error' };
  }
}

