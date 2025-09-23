Indexer Legacy Docs (Archived)

These documents were part of the earlier "standalone/D1 indexer" path and are now archived for historical reference. The current architecture uses:

- Cloudflare Pages + Worker with KV-first reads for snapshots (EF_SNAPSHOTS)
- Local Postgres + exporter for snapshot generation (no D1 in production reads)
- Cloudflare KV for usage stats (daily-only) and share links

Files in this folder are not actively maintained. See `docs/decision-log.md` for current decisions and `docs/initiatives/DATA_EXPOSURE_PLAN.md` for the ongoing snapshot-first approach.
