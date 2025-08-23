import { getStore } from '@netlify/blobs';

export async function handler(event) {
  try {
    const params = new URLSearchParams(event.rawQuery || '');
    const id = params.get('id');
    if (!id) return { statusCode: 400, body: 'Missing id' };
    const storeName = process.env.SHARE_STORE || 'shares';
    const store = getStore(storeName);
    const value = await store.get(id);
    if (value === null) return { statusCode: 404, body: 'Not found' };
    return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data: value }) };
  } catch (err) {
    console.error('get-share error', err);
    return { statusCode: 500, body: 'Internal Error' };
  }
}

