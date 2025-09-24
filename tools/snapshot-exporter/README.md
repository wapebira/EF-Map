Snapshot Exporter – Smart Gates KV

Purpose: Publish smart gate links and access ACL snapshots to Cloudflare KV (EF_SNAPSHOTS) on a short cadence. Runs inside the `snapshot-exporter` container (cron via supercronic) or locally via Node.

Keys written:
- smart_gate_links_v1 → { updatedAt, links: [...] }
- gate_access_snapshot_v1 → { updatedAt, rules: [...] }
- structure_snapshot_v1 → { meta: {...}, systems: {...} }

Env vars (container or local):
- PGHOST, PGPORT, PGDATABASE, PGUSER, PGPASSWORD – Postgres (Primordium reader)
- EF_SNAPSHOTS_NAMESPACE_ID or KV_NAMESPACE_ID – Cloudflare KV namespace id (required when not DRY_RUN)
- CLOUDFLARE_API_TOKEN (preferred) or CF_API_TOKEN – API token for Wrangler
- FORCE_REMOTE=1 – Force Wrangler to use Cloudflare API (recommended in container)
- DRY_RUN=0|1 – Build but skip writes when 1
- ONLY_ONLINE=1 – Include only currently linked edges
- LOG_JSON=1 – Structured logs
- GATE_TRIBE_OVERRIDES=path/to/file.json – Optional manual overrides { "<gateId>": "<tribeId>" } applied last to fix edge cases while upstream data catches up

Local quick-checks:
- node tools/snapshot-exporter/check_kv_freshness.js --namespace-id <id> --remote
- node tools/kv_bump_snapshot_timestamp.js smart_gate_links_v1 (env EF_SNAPSHOTS_NAMESPACE_ID)
- node tools/snapshot-exporter/structure_snapshot_exporter.js --dry-run --out tmp_structure_snapshot.json

Docker Compose:
- See tools/worldapi-cron/docker-compose.yml (service: snapshot-exporter). Copy .env.sample to .env and fill CF token + namespace id.# Snapshot Exporter (Smart Gate Links)

Purpose: Periodically read smart gate link directions from the local Postgres (Primordium indexer output) and publish compact JSON snapshots to Cloudflare KV (EF_SNAPSHOTS):
- `smart_gate_links_v1` (links)
- `gate_access_snapshot_v1` (minimal ACL)

- Runs as a Docker container (Node 22 + supercronic) similar to `tools/worldapi-cron/*` jobs.
- No Cloudflare database is used; this only writes KV.
- Output JSON shape matches the site’s `/api/smart-gate-links` consumer:
  - Links: `{ "updatedAt": ISO8601, "links": [{ "gateId", "origin", "destination", "linked", "online", "cost", "tribeId?", "tribes?" }] }`
    - tribeId is included when exactly one tribe is mapped for the gate; if multiple, `tribes` (array of strings) is included instead.
  - ACL (minimal): `{ "updatedAt": ISO8601, "rules": [{ "gate_id", "fromSystemId", "toSystemId", "appliedSystemId", "isPublic", "tribeId?", "tribes?" }] }`
    - Added tribe fields are forward-compatible and ignored by current consumers if not used.

## Environment
- Postgres: `PGHOST`, `PGPORT`, `PGDATABASE`, `PGUSER`, `PGPASSWORD`
- Cloudflare: `CF_ACCOUNT_ID`, `CF_API_TOKEN`, `KV_NAMESPACE_ID` (EF_SNAPSHOTS namespace id)
- Behavior: `ONLY_ONLINE=1` (optional, default 1), `DRY_RUN=1` (optional), `LOG_JSON=1` (optional)

## Compose service
A service `snapshot-exporter` is added to `tools/worldapi-cron/docker-compose.yml` and shares the same external network as the reader.

Provide these variables (e.g., via a `.env` next to the compose file):
- `CF_ACCOUNT_ID=...`
- `CF_API_TOKEN=...`
- `EF_SNAPSHOTS_NAMESPACE_ID=...`
- (Optional) `SNAPSHOT_DRY_RUN=1` for smoke without KV writes

## Notes
- Schedule is `*/2 * * * *` by default (every 2 minutes). Adjust by editing `tools/snapshot-exporter/cron.d/snapshot-exporter` if needed.
- Override SQL via `GATE_SOURCE_SQL` if your source table/view name differs; expected columns: `gate_id, origin_system_id, destination_system_id, linked, online, traversal_cost, last_change_at`. The exporter will also attempt to read per-schema `evefrontier__smart_gate_config` to resolve `appliedSystemId`; missing table simply yields `isPublic=true` for those gates.
- Wrangler is installed in the container; secrets are passed as env vars (not embedded in the image).
- Owner/tribe discovery uses a flexible column scan (gate id aliases like `object_id`, `assembly_id`, `deployable_id`; account aliases like `owner_wallet`, `admin_address`, etc.) plus deterministic account→character→tribe mapping and DLT membership. If specific gates still miss attribution, use `GATE_TRIBE_OVERRIDES` temporarily.

## Structure snapshot exporter

`structure_snapshot_exporter.js` builds the `structure_snapshot_v1` payload used by the upcoming structures overlay:

- Aggregates smart assemblies by solar system, structure type, and deployable status.
- Adds optional tribe breakdowns for UI filtering.
- Stores compact metadata (`generatedAt`, `lastBlock`, total counts).

Run locally:

```
node tools/snapshot-exporter/structure_snapshot_exporter.js --dry-run --out tmp_structure_snapshot.json
```

Environment overrides:

- `STRUCTURE_SCHEMA` defaults to `0x7085f3e652987f656fb8dee5aa6592197bb75de8`.
- `STRUCTURE_*` table overrides mirror the source tables listed in `docs/support/structure_snapshot_plan.md`.

Current implementation performs a full rebuild each run; incremental mode will be layered on later once the snapshot is wired into cron.
