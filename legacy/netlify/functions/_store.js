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

// Phase 1: optional Cloudflare adapter flag (inactive by default)
// Phase 2: shadow read flag (parallel Cloudflare get + drift counters; still serves Netlify result)
const CF_ADAPTER_ENABLED = (process.env.CF_ADAPTER_ENABLE || '').toLowerCase() === 'true';
const CF_SHADOW_READ_ENABLED = (process.env.CF_SHADOW_READ_ENABLE || '').toLowerCase() === 'true';

// Shadow metrics (process lifetime only – NOT persisted). Exposed via getShadowMetrics().
const shadowMetrics = {
  reads: 0,
  cfMiss: 0,      // Cloudflare had no value while primary had one
  nlMiss: 0,      // Netlify had no value while Cloudflare had one (unexpected in P2)
  matches: 0,
  mismatches: 0,
  lastMismatchSamples: [] // up to last 5 sample keys for diagnostics
};

export function getShadowMetrics(){ return shadowMetrics; }

// Dev convenience: if adapter flags enabled but no Cloudflare binding injected by runtime,
// create an ephemeral in-process mock for 'shares' & 'app-stats' so shadow path exercises.
// This runs once at import time; production build unaffected (NODE_ENV check guards warning only).
if(CF_ADAPTER_ENABLED){
  if(!globalThis.__CF_KV){ globalThis.__CF_KV = {}; }
  // Only add if missing so a real binding (Wrangler/Worker) isn't overridden.
  const ensureMock = (ns)=>{
    if(!globalThis.__CF_KV[ns]){
      const map = new Map();
      globalThis.__CF_KV[ns] = {
        async get(key){ return map.has(key) ? map.get(key) : null; },
        async put(key, value){ map.set(key, value); },
        async delete(key){ map.delete(key); }
      };
      if(process.env.NODE_ENV !== 'production') console.log(`[cf-adapter mock] Injected mock Cloudflare KV namespace "${ns}"`);
    }
  };
  ensureMock(process.env.SHARE_STORE || 'shares');
  ensureMock(process.env.STATS_STORE || 'app-stats');
}

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
  // Cloudflare adapter path (flag + binding presence)
  if(CF_ADAPTER_ENABLED){
    try {
      if(globalThis.__CF_KV && globalThis.__CF_KV[name]){
        const kv = globalThis.__CF_KV[name];
        return {
          provider: 'cloudflare',
          async get(key){ return await kv.get(key); },
          async set(key, value){ await kv.put(key, value); },
          async delete(key){ try { await kv.delete(key); } catch {/* ignore */} }
        };
      } else if(process.env.NODE_ENV !== 'production') {
        // Dev visibility: flag enabled but no binding
        console.warn(`[cf-adapter] CF_ADAPTER_ENABLE=true but no Cloudflare KV binding for namespace "${name}". Falling back to Netlify / memory.`);
      }
    } catch(e){ if(process.env.NODE_ENV !== 'production') console.warn('[cf-adapter] error probing Cloudflare KV', e); }
  }

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
    // If shadow reads enabled and Cloudflare adapter active we still build primary store now; we wrap below.
    const primary = {
      provider: 'netlify',
      async get(key){ return await store.get(key); },
      async set(key, value){ return await store.set(key, value); },
      async delete(key){ try { await store.delete?.(key); } catch {/* optional */} }
    };

    // Shadow read wrapper: serve primary result, opportunistically fetch CF copy & compare.
    if(CF_SHADOW_READ_ENABLED && CF_ADAPTER_ENABLED){
      // Acquire potential CF namespace (best-effort) – reuse probe logic above but *only* for reads.
      let cfKV;
      try { if(globalThis.__CF_KV && globalThis.__CF_KV[name]) cfKV = globalThis.__CF_KV[name]; } catch {}
      if(cfKV){
        return {
            ...primary,
            async get(key){
              const nlPromise = primary.get(key);
              let cfValuePromise;
              try { cfValuePromise = cfKV.get(key); } catch { /* ignore */ }
              const nlValue = await nlPromise; // always await primary first for latency
              if(cfValuePromise){
                // Fire & forget comparison (do not delay response)
                cfValuePromise.then(cfValue => {
                  try {
                    shadowMetrics.reads++;
                    if(nlValue == null && cfValue == null){ /* both miss */ return; }
                    if(nlValue == null && cfValue != null){ shadowMetrics.nlMiss++; return; }
                    if(nlValue != null && cfValue == null){ shadowMetrics.cfMiss++; return; }
                    // Both non-null – attempt structured comparison when JSON
                    let same = nlValue === cfValue;
                    if(!same){
                      // Try JSON parse if both look like JSON objects/arrays
                      if(typeof nlValue === 'string' && typeof cfValue === 'string' && nlValue.length && cfValue.length){
                        if(/[\[{]/.test(nlValue[0]) && /[\[{]/.test(cfValue[0])){
                          try {
                            const a = JSON.parse(nlValue);
                            const b = JSON.parse(cfValue);
                            same = JSON.stringify(a) === JSON.stringify(b);
                          } catch {/* parse failure falls back to string compare result */}
                        }
                      }
                    }
                    if(same){ shadowMetrics.matches++; }
                    else {
                      shadowMetrics.mismatches++;
                      if(shadowMetrics.lastMismatchSamples.length >= 5) shadowMetrics.lastMismatchSamples.shift();
                      shadowMetrics.lastMismatchSamples.push(`${name}:${key}`);
                      if(process.env.NODE_ENV !== 'production'){
                        console.warn('[shadow-read mismatch]', { namespace: name, key, nlLen: nlValue?.length, cfLen: cfValue?.length });
                      }
                    }
                  } catch {/* swallow all shadow errors */}
                });
              }
              return nlValue;
            },
            async set(key, value){ return primary.set(key, value); },
            async delete(key){ return primary.delete(key); }
        };
      }
    }
    return primary;
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
