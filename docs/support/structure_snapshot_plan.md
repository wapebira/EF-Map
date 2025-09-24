# Smart Assembly Snapshot Plan

Status: in progress (branch `feature/structure-overlays`) – exporter + `/api/structure-snapshot` worker endpoint live; frontend overlay pending.

This note captures the data model, current metrics, and proposed snapshot format for visualizing smart assemblies (network nodes, manufacturers, hangars, smart gates, turrets, SSUs) on the EF map.

## Data sources

All tables live in the `postgres://user:password@127.0.0.1:5432/postgres` database under schema `0x7085f3e652987f656fb8dee5aa6592197bb75de8` (additional schemas exist for historical snapshots but current cadence uses this one).

| Purpose | Table | Key columns |
|---------|-------|-------------|
| Assembly type metadata | `evefrontier__smart_assembly` | `smart_object_id`, `assembly_type` (values: `manufacturer`, `NWN`, `smart_hangar`, `SSU`, `ST`, `SG`) |
| Deployment status | `evefrontier__deployable_state` | `smart_object_id`, `current_state` (1 = unanchored, 2 = anchored/offline, 3 = online, 4 = destroyed), `updated_block_number` |
| Location | `evefrontier__location` | `smart_object_id`, `solar_system_id`, `x/y/z` (ignore rows with `solar_system_id = 0`) |
| Ownership | `evefrontier__ownership_by_object` | `smart_object_id`, `account` |
| Owner -> character | `evefrontier__characters_by_acco` | `account`, `smart_object_id` (character ID) |
| Character -> tribe | `evefrontier__characters` | `smart_object_id`, `tribe_id` |

Assumptions confirmed by operators:

- Status mapping: `1 = unanchored`, `2 = anchored`, `3 = online`, `4 = destroyed`.
- We retain unanchored rows for completeness but default UI filter will show online only. Rows with `solar_system_id = 0` are excluded from the snapshot.
- Tribe membership is stable enough to treat the latest `characters` row as authoritative.

## Current metrics (2025-09-24)

Queries executed via `docker exec pg-indexer-reader-postgres-1 psql ...` with `SET search_path`.

### Assemblies by type

| Type | Count |
|------|-------|
| manufacturer | 116,095 |
| smart_hangar | 16,388 |
| NWN (network node) | 7,253 |
| SSU (smart storage unit) | 5,392 |
| ST (smart turret) | 1,208 |
| SG (smart gate) | 267 |

Total tracked assemblies: **146,603**.

### Assemblies by status

| Status | Count | Description |
|--------|-------|-------------|
| 1 | 107,028 | unanchored (historical placements) |
| 2 | 30,916 | anchored / offline |
| 3 | 8,565 | online |
| 4 | 94 | destroyed |

### Status × type matrix

| Status | Type | Count |
|--------|------|-------|
| 1 | manufacturer | 91,682 |
| 1 | smart_hangar | 13,052 |
| 1 | NWN | 786 |
| 1 | SSU | 1,183 |
| 1 | ST | 287 |
| 1 | SG | 43 |
| 2 | manufacturer | 20,086 |
| 2 | smart_hangar | 2,832 |
| 2 | NWN | 4,985 |
| 2 | SSU | 2,600 |
| 2 | ST | 400 |
| 2 | SG | 14 |
| 3 | manufacturer | 4,297 |
| 3 | smart_hangar | 491 |
| 3 | NWN | 1,476 |
| 3 | SSU | 1,586 |
| 3 | ST | 510 |
| 3 | SG | 208 |
| 4 | manufacturer | 38 |
| 4 | smart_hangar | 13 |
| 4 | NWN | 6 |
| 4 | SSU | 24 |
| 4 | ST | 11 |
| 4 | SG | 2 |

Additional observations: 2,097 solar systems currently contain at least one assembly with a valid location (non-zero `solar_system_id`).

## Proposed snapshot schema

Snapshot key (KV): `structure_snapshot_v1` (subject to refinement). Stored as JSON with the following shape:

```jsonc
{
  "meta": {
    "generatedAt": "2025-09-24T12:00:00Z",
    "lastBlock": 8590123,
    "totalAssemblies": 146603,
    "statuses": { "1": 107028, "2": 30916, "3": 8565, "4": 94 },
    "types": { "manufacturer": 116095, "smart_hangar": 16388, "NWN": 7253, "SSU": 5392, "ST": 1208, "SG": 267 }
  },
  "systems": {
    "30001125": {
      "counts": {
        "manufacturer": { "1": 120, "2": 42, "3": 10 },
        "NWN": { "2": 3 },
        "SSU": { "3": 4 }
      },
      "tribes": {
        "1000167": {
          "manufacturer": { "3": 2 },
          "SSU": { "3": 4 }
        }
      }
    },
    "30014931": {
      "counts": { "manufacturer": { "2": 180, "3": 12 } },
      "tribes": {}
    }
  }
}
```

Guidelines:

- `systems` map is sparse; omit systems with zero assemblies.
- `counts[type][status] = total structures` for that (system, type, status) combination.
- `tribes[tribeId][type][status] = count` for user-filtered overlays. We only include tribes tied to at least one structure in that system to keep payload compact.
- Optionally include `owners` arrays if per-account filtering becomes necessary; for v1 we stick to counts to minimize size.

## Incremental update strategy

1. Track `last_processed_block` (persisted alongside the snapshot). Start with a full export, then only process `deployable_state` rows where `updated_block_number > last_processed_block`.
2. For each changed row:
   - Look up the matching `smart_assembly`, `deployable_state`, `location`, and ownership/tribe records.
   - Update in-memory aggregates for the relevant `(systemId, type, status, tribe)` buckets. If the status changed, decrement the old bucket and increment the new one.
3. Regenerate `meta` counters from the aggregate map to keep numbers consistent.
4. Write the merged snapshot back to KV (with `Cache-Control: max-age=120` for the worker response) and update `last_processed_block`.

To guard against drift, schedule a weekly full rebuild (same script with `--full` flag) that recomputes all buckets from scratch.

## Storage & cadence

- Estimated size: `systems` map has ≈2,100 entries. With counts only, JSON should stay under 5 MB (KV single-key limit is 25 MB). If growth pushes us near 10 MB, plan B is to shard by constellation (one KV key per constellation ID) and stream them in the client.
- Refresh cadence: **every 15 minutes** via snapshot exporter cron job (reuse the existing `tools/snapshot-exporter` framework). A weekly full rebuild ensures no drift from incremental logic.
- Worker endpoint: `/api/structure-snapshot` now serves the KV snapshot with `ETag` and public cache headers (`max-age=60`, `s-maxage=120`, `stale-while-revalidate=300`).

## UI + UX notes

- Default filter: status = online (3). Additional toggles for anchored (2), unanchored (1), destroyed (4).
- Multi-select chips for structure type and tribe. Consider a search box for tribes when list grows.
- Visualization options to prototype:
  1. **Density bar** above each star (height scaled by `log(count+1)`, color keyed by type).
  2. **Numeric badge** with the total count, using colored ring to indicate dominant type.
- Include a mini legend showing totals per selected filter and the snapshot timestamp.

## Next steps

1. ✅ Implement Node script under `tools/snapshot-exporter/` to materialize `structure_snapshot_v1` (supports `--dry-run`, `--full`, `--since-block` flags).
2. ✅ Extend Cloudflare worker `_worker.js` to serve the snapshot via `/api/structure-snapshot`.
3. Build `StructureOverlayPanel` in the frontend to load the snapshot, apply filters, and update the map layer.
4. Add instrumentation events (`structures_overlay_open`, `structures_filter_apply`, etc.) in `src/utils/usage.ts` once UI is in place.
5. After feature ships, update `docs/decision-log.md` with the rollout summary.
