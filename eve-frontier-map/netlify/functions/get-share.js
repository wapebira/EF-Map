import { getStore } from '@netlify/blobs';

export async function handler(event) {
  try {
    const params = new URLSearchParams(event.rawQuery || '');
    const id = params.get('id');
    if (!id) return { statusCode: 400, body: 'Missing id' };
    const storeName = process.env.SHARE_STORE || 'shares';
    let store; let storeError;
    const siteID = process.env.BLOB_SITE_ID || process.env.NETLIFY_SITE_ID || process.env.SITE_ID;
    const token = process.env.BLOB_PAT || process.env.BLOBS_TOKEN;
    if (siteID && token) {
      try { store = getStore({ name: storeName, siteID, token }); } catch (e) { storeError = e; }
      if (!store) {
        try { store = getStore(storeName, { siteID, token }); storeError = undefined; } catch (e2) { storeError = e2; }
      }
    }
    if (!store) {
      try { store = getStore(storeName); storeError = undefined; } catch (e) { storeError = e; }
    }
    if (!store) {
      return { statusCode: 500, body: 'Blobs unavailable (no persistent store). ' + (storeError? storeError.message : '') };
    }
    try {
      const value = await store.get(id);
      if (value === null) return { statusCode:404, body:'Not found' };
      return { statusCode:200, headers:{ 'Content-Type':'application/json' }, body: JSON.stringify({ data: value }) };
    } catch (e) {
      return { statusCode:500, body:'store.get failed: '+e.message };
    }
  } catch (err) {
    console.error('get-share error', err);
    return { statusCode: 500, body: 'Internal Error' };
  }
}

