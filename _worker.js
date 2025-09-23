// Cloudflare Pages Edge Worker – thin re-export of root worker to avoid code drift
// See decision log 2025-09-07 for consolidation rationale.
export * from './worker.js';
export { default } from './worker.js';
