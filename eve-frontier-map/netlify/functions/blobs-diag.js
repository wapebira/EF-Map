// List blob stores and basic environment info.
import { listStores, getStore } from '@netlify/blobs';

export async function handler() {
  try {
    let storesInfo = [];
    let listError;
    try {
      const { stores } = await listStores();
      storesInfo = stores;
    } catch (e) {
      listError = e.message;
    }
    // Try opening default store
    let testGet = 'ok';
    let manualTried = false;
    try {
      const s = getStore('shares');
      await s.get('nonexistent-key-for-diag');
    } catch (e) {
      const siteID = process.env.NETLIFY_SITE_ID || process.env.SITE_ID;
      const token = process.env.BLOBS_TOKEN;
      if (siteID && token) {
        manualTried = true;
        try {
          const s2 = getStore('shares', { siteID, token });
          await s2.get('nonexistent-key-for-diag');
          testGet = 'manual ok';
        } catch (e2) {
          testGet = 'manual getStore error: ' + e2.message;
        }
      } else {
        testGet = 'getStore error: ' + e.message;
      }
    }
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ node: process.versions.node, stores: storesInfo, listError, testGet, manualTried })
    };
  } catch (e) {
    return { statusCode: 500, body: 'unexpected: ' + (e && e.message) };
  }
}

