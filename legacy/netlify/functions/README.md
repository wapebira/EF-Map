# Legacy Netlify Functions (Deprecated)

This directory is retained temporarily for historical reference following the full cutover to **Cloudflare Pages + Worker + KV** (Phase 4 complete). The app no longer calls these functions at runtime; all share, stats, and usage endpoints now resolve exclusively via `/api/*` on the Cloudflare Worker.

Do NOT add new code here. Pending CLEANUP phase will remove this directory once the stability window closes.

Current authoritative persistence & metrics stack:
- Shares: Cloudflare KV (`EF_SHARES`)
- Stats / Usage: Cloudflare KV (`EF_STATS`) (+ daily JSON snapshots)
- Future Dynamic Structures / Indexer: Cloudflare D1 (planned / scaffolding present)

If you need to review prior implementation details (e.g., EVENT_MAP evolution, store abstraction history) before removal, consult these legacy files now. After cleanup they will be deleted and only the decision log + migration plan (historical) will preserve rationale.

For active development:
- Worker logic: root `worker.js` / `_worker.js` (copied to `dist/_worker.js` during build)
- Usage events whitelist: Worker EVENT_MAP (not these legacy scripts)

Questions or uncertainty: see `docs/decision-log.md` entry "Cloudflare Cutover Documentation Refresh" (2025-09-08) for context.

(End)
