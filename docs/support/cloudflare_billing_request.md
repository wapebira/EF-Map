# Cloudflare Billing Support Request – Unexpected D1/KV Usage (Hobby Project EF‑Map)

> **Context (2025-09 D1 spike):** This template documents a one-off billing request after an experimental D1 ingestion job unexpectedly generated large reads/writes. If you reuse it, update the timeline and root-cause sections to match the new incident—or replace the intro entirely if the issue is unrelated to D1. The Workers KV references remain accurate, but current production workloads primarily rely on KV-backed snapshots instead of D1.

Hello Cloudflare Billing Team,

I’m requesting help with an unexpected spike in usage-derived charges on my Cloudflare account. I’m an individual hobbyist building a non-commercial map project and, while iterating with an LLM assistant (“vibe coding”), I unintentionally triggered a large volume of D1 and KV reads/writes. As soon as I realized, I immediately paused all activity. I’m concerned I won’t be able to afford the upcoming invoice and would appreciate your help.

## Account / Project
- Account ID: b61eb4a65fe01c9539b9f43b5434c10d
- Project: Cloudflare Pages site “ef-map”
- URL: https://ef-map.pages.dev
- Services involved: Pages + Worker (API routes), Workers KV (EF_STATS, EF_SHARES), D1 (ef_index + archives)

## Timeline (UTC)
- 2025-09-08 to 2025-09-11: Iteration on an ingestion/indexer feature (backfilling on-chain logs into D1 with KV metrics). I underestimated the operational cost.
- 2025-09-11: Detected elevated usage and immediately paused all DB/KV activity (see Verification below). Preparing a local/offline indexing workflow to avoid future cloud write/read bursts.

## Current Status (Paused)
- Production worker now returns paused status and avoids D1/KV calls:
  - GET https://ef-map.pages.dev/api/indexer-health?details=1 → `{ "status": "paused" }`
  - GET https://ef-map.pages.dev/api/indexer-env → `{ "status": "paused" }`
- Recent deploy that applied the pause: https://494cf965.ef-map.pages.dev

## Root Cause (Operator Error)
- I was experimenting quickly with an LLM assistant and didn’t fully appreciate the volume of reads/writes the steps would generate on D1 and KV.
- There was no malicious intent or traffic spike from users—just my own background processing while I prototyped.

## Remediation / Prevention Steps
- Paused all indexer/database operations via env flags (PAUSE_DB=1; cron disabled).
- Documented the pause and the incident in the repo decision log for auditability.
- Authenticated writes will remain disabled while I transition to a local indexing pipeline.
- Implemented a plan to run heavy processing locally and only publish compact static artifacts to Pages (see doc summary below). I will also enable usage alerts/budgets where possible.

## Request
- If possible, I’m requesting a goodwill credit or one-time adjustment to reduce the unexpected charges.
- If the charges must stand, I’m requesting an installment/payment plan so that I can pay them over time.
- I’d also appreciate any guidance on enabling usage caps/alerts specific to D1 and Workers KV to prevent recurrence.

## Evidence / References
- Project: https://ef-map.pages.dev
- Decision log entry noting the production pause: repo docs “Pause DB/KV activity (production deploy)” (dated 2025-09-11).
- Local/offline indexing plan committed: docs/archive/local-indexer/LOCAL_INDEXER_PLAN.md (outlines move away from cloud-side ingestion to avoid costs).
- I’m happy to provide additional timestamps, deployment IDs, or logs if needed.

Thank you for considering this request—I sincerely appreciate any assistance. Please let me know if there’s any more information I can provide.

— Operator of EF‑Map (individual hobby project)
