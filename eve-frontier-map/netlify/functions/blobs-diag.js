// List blob stores and basic environment info.
import { listStores, getStore } from '@netlify/blobs';

export async function handler() {
  try {
    let storesInfo = [];
    try {
      const { stores } = await listStores();
      storesInfo = stores;
    } catch (e) {
      return { statusCode: 500, body: 'listStores error: ' + (e && e.message) };
    }
    // Try opening default store
    let testGet = 'ok';
    try {
      const s = getStore('shares');
      await s.get('nonexistent-key-for-diag');
    } catch (e) {
      testGet = 'getStore error: ' + e.message;
    }
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ node: process.versions.node, stores: storesInfo, testGet })
    };
  } catch (e) {
    return { statusCode: 500, body: 'unexpected: ' + (e && e.message) };
  }
}

