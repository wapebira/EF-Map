# Legacy Archive

This directory holds deprecated or historical assets that are no longer used at runtime.

What’s here now:
- netlify/functions/ – Legacy Netlify Function handlers (create-share, get-share, stats, usage-event, health, blobs-diag, _store helper). These are retained for provenance only. The app has no client fallback to Netlify after Cloudflare cutover.
- netlify/netlify.toml – Root Netlify config (historical).
- netlify/eve-frontier-map/netlify.toml – App-scoped Netlify config (historical).

Current backend: Cloudflare Pages + Worker + KV only. Do not modify these files or reintroduce Netlify paths in the client. If you need runtime behavior, implement it in the Cloudflare Worker instead.

Removal plan: After a short observation window, these may be deleted entirely. See docs/decision-log.md for the migration history and cleanup status.
