/**
 * Cloudflare KV adapter scaffold (Phase 1)
 * This is NOT yet wired into runtime logic. We only define a minimal interface
 * matching the subset we use from Netlify Blobs today via `_store.js`.
 * Future phases: implement shadow reads / dual writes behind flags.
 */

export interface SimpleKV {
  get(key: string): Promise<string | null>;
  put(key: string, value: string): Promise<void>;
  // list / delete intentionally omitted for now
}

// Runtime binding access. When executed inside a Worker environment the global
// object will expose bindings (e.g. env.EF_STATS). In the browser this remains undefined.
// We keep it very defensive so importing the module client-side is safe.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const globalAny: any = (globalThis as any);

export function getCfKvBinding(name: string): SimpleKV | undefined {
  try {
    const binding = globalAny?.__CF_WORKER_ENV__?.[name] || globalAny?.[name];
    if (!binding) return undefined;
    if (typeof binding.get !== 'function' || typeof binding.put !== 'function') return undefined;
    return binding as SimpleKV;
  } catch {
    return undefined;
  }
}

export function hasCfKv(): boolean {
  return !!getCfKvBinding('EF_STATS'); // probe one binding; presence implies others
}

// Placeholder no-op implementation (used locally until Worker runtime available)
export const noopKV: SimpleKV = {
  async get() { return null; },
  async put() { /* noop */ },
};
