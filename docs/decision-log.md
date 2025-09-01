## 2025-09-01 – Init storage abstraction & decision log
- Goal: Introduce unified KV store accessor to decouple Netlify-specific blobs from future Cloudflare KV/D1 migration; seed decision log.
- Files: `netlify/functions/_store.js`, `docs/decision-log.md`
- Diff: +~130 LoC added
- Risk: low (new file, no existing code modified)
- Gates: typecheck N/A (JS utility only) | build unaffected | smoke unaffected
- Follow-ups: Migrate individual functions to use `_store.js`; add Cloudflare binding adapter when platform token `MIGRATE STORAGE OK` provided.

## 2025-09-01 – Refactor functions to unified store abstraction
- Goal: Remove duplicated blob credential logic; centralize persistence access for upcoming Cloudflare migration.
- Files: `create-share.js`, `get-share.js`, `usage-event.js`, `stats.js`, `_store.js` (ephemeral flag), `docs/decision-log.md`
- Diff: ~-160 LoC (dup removal) / +35 LoC (ephemeral flag & new calls)
- Risk: low (no business logic change; same API surface)
- Gates: typecheck ✅ (TS unaffected) | build ✅ | smoke pending (share create/get, usage event POST, stats fetch)
- Follow-ups: Later swap internals in `_store.js` for Cloudflare KV; add optional retries & instrumentation.
