// Unified key-value store accessor (Netlify Blobs now, Cloudflare KV/D1 future)
// Usage (inside a function):
//   import { getKVStore } from './_store.js';
//   const store = await getKVStore('shares');
//   await store.set('key','value');
// Design goals:
// - Single place to adapt credentials / bindings when migrating from Netlify to Cloudflare.
// - Memory fallback for local dev parity (mirrors existing ad‑hoc patterns in other functions).
// - Minimal surface: { get(key), set(key, value), delete?(key) optional }.
// - Future: support Cloudflare KV via env binding (e.g., env.SHARES) or Durable Object proxy.

import { getStore as getNetlifyStore } from '@netlify/blobs';

// Internal in-memory map fallback (per name) for local dev without credentials.
const MEMORY_STORES = new Map();

/**
 * Obtain a KV-like store.
 * Strategy order:
 *  1. Netlify explicit credentials (siteID + token)
 *  2. Netlify implicit env
 *  3. (Future) Cloudflare KV binding (if globalThis.__CF_ENV && __CF_ENV[name])
 *  4. In-memory ephemeral Map (dev only)
 */
export async function getKVStore(name){
  // Cloudflare Workers style (placeholder – will activate when migrated)
  // If executed in a Cloudflare Worker environment, a global env object would be passed differently.
  // We keep a reserved hook: if globalThis.__CF_KV && globalThis.__CF_KV[name] present, wrap it.
  try {
    if(globalThis.__CF_KV && globalThis.__CF_KV[name]){
      const kv = globalThis.__CF_KV[name];
      return {
        async get(key){ return await kv.get(key); },
        async set(key, value){ await kv.put(key, value); },
        async delete(key){ try { await kv.delete(key); } catch {} }
      };
    }
  } catch {/* ignore */}

  // Netlify credential strategy (mirrors patterns in existing functions)
  let store; let storeError;
  const siteID = process.env.BLOB_SITE_ID || process.env.NETLIFY_SITE_ID || process.env.SITE_ID;
  const token = process.env.BLOB_PAT || process.env.BLOBS_TOKEN;
  if(siteID && token){
    try { store = getNetlifyStore({ name, siteID, token }); } catch(e){ storeError = e; }
    if(!store){ try { store = getNetlifyStore(name, { siteID, token }); storeError = undefined; } catch(e2){ storeError = e2; } }
  }
  if(!store){ try { store = getNetlifyStore(name); storeError = undefined; } catch(e){ storeError = e; } }

  if(store){
    return {
      async get(key){ return await store.get(key); },
      async set(key, value){ return await store.set(key, value); },
      async delete(key){ try { await store.delete?.(key); } catch {/* optional */} }
    };
  }

  // Memory fallback
  if(!MEMORY_STORES.has(name)) MEMORY_STORES.set(name, new Map());
  const mem = MEMORY_STORES.get(name);
  return {
    ephemeral: true,
    async get(key){ return mem.has(key) ? mem.get(key) : null; },
    async set(key, value){ mem.set(key, value); },
    async delete(key){ mem.delete(key); }
  };
}

// Helper wrappers matching existing ad-hoc usage patterns
export async function getStatsStore(){ return getKVStore(process.env.STATS_STORE || 'app-stats'); }
export async function getShareStore(){ return getKVStore(process.env.SHARE_STORE || 'shares'); }

// NOTE: Existing functions (create-share, get-share, usage-event, stats) can be
// incrementally migrated to use these helpers. New persistence code should *only*
// import from this file to ease Cloudflare migration.
