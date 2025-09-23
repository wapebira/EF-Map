# Decision Log (Legacy / Archived on 2025-09-23)

This file contains entries not directly relevant to the current setup (Primordium indexer + World API via Docker, Postgres, Grafana, Cloudflare website/KV).
They are preserved for historical context: legacy Cloudflare D1 indexer, cron/scheduled ingestion, raw_logs/store_all/decode, shadow/gap scan, ABI/topic-map, and Netlify-era notes.

## 2025-09-20 – SIWE auth endpoints + 7-day sliding TTL
- Goal: Introduce Sign-In with Ethereum (SIWE-lite) endpoints with a 7-day sliding session window and prepare an authorized-gates API (public-only fallback initially).
- Files: `worker.js`
- Diff: ~250 LoC added (auth helpers, /api/auth/* routes, /api/authorized-gates stub)
- Risk: medium (new Worker routes + cookie handling; isolated from core rendering and data schemas)
- Gates: typecheck N/A (JS), build N/A (root worker is plain JS), smoke: to be verified on Pages preview
- Details: Session cookie `EFSESS` is HttpOnly, Secure, SameSite=Lax; refreshed approximately hourly on activity, extending expiry up to 7 days since last activity. Nonce tokens are HMAC-signed, 10 min TTL. Server HMAC key from `SIWE_HMAC_SECRET` (fallback to admin token on preview; ephemeral dev secret otherwise).
- Follow-ups: Wire client Connect/Sign, expose session badge, enable Authorized-only overlay mode; evolve authorized-gates to per-user derivation via RPC.