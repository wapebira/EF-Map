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
    let attempts = [];
    try {
      const s = getStore('shares');
      await s.get('nonexistent-key-for-diag');
    } catch (e) {
      const siteID = process.env.BLOB_SITE_ID || process.env.NETLIFY_SITE_ID || process.env.SITE_ID;
      const token = process.env.BLOB_PAT || process.env.BLOBS_TOKEN;
      if (siteID && token) {
        manualTried = true;
        try {
          attempts.push('two-arg');
          const s2 = getStore('shares', { siteID, token });
          await s2.get('nonexistent-key-for-diag');
          testGet = 'manual ok (two-arg)';
        } catch (e2) {
          // Try object signature variant
          try {
            attempts.push('object-arg');
            const s3 = getStore({ name: 'shares', siteID, token });
            await s3.get('nonexistent-key-for-diag');
            testGet = 'manual ok (object-arg)';
          } catch (e3) {
            testGet = 'manual getStore error: ' + e2.message + ' | object-arg error: ' + e3.message;
          }
        }
      } else {
        testGet = 'getStore error: ' + e.message + ' (no env vars)';
      }
    }
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ node: process.versions.node, stores: storesInfo, listError, testGet, manualTried, attempts, env: {
        hasBLOB_SITE_ID: Boolean(process.env.BLOB_SITE_ID),
        hasBLOB_PAT: Boolean(process.env.BLOB_PAT),
        hasNETLIFY_SITE_ID: Boolean(process.env.NETLIFY_SITE_ID)
      } })
    };
  } catch (e) {
    return { statusCode: 500, body: 'unexpected: ' + (e && e.message) };
  }
}

