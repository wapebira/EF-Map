# Dynamic Structures Field Mapping (v1 Freeze)

Status: v1 FROZEN (pending implementation)  
Scope: Maps D1 schema columns (draft in `docs/archive/d1/d1_schema_draft.sql`) to World API payload fields and anticipated chain (MUD Store) table/event sources. This acts as the contract for the initial migration. Any change after this point requires a migration bump (v2) and decision-log entry.

## Legend
- API: World HTTP API (`/v2/...` endpoints)
- CHAIN: On-chain MUD Store table or decoded event (future streaming layer)
- DERIVED: Computed from other stored values (not directly from a single source field)
- CONST: Static literal
- TBD: Not yet sourced; placeholder (must not block initial migration if nullable/defaulted)

## 1. Table: world_version
| Column | Source | Mapping | Notes |
|--------|--------|---------|-------|
| id | D1 AUTOINC | DERIVED | Primary key |
| version_number | Internal counter | DERIVED | Increment on detected wipe |
| world_address | API `/config`.contracts.world.address | API | Verified each bootstrap cycle |
| contracts_version | API `/config`.contractsVersion | API | Empty string permissible |
| cycle_start | Indexer runtime | DERIVED | Null until first cycle begins |
| started_at | D1 default | DERIVED | Insert timestamp |
| archived_at | On wipe | DERIVED | Set when superseded |

## 2. Table: smart_assembly
| Column | Source | Mapping | Notes |
|--------|--------|---------|-------|
| id | API smartassemblies item.id | API | String or numeric cast to text |
| world_version | FK | DERIVED | Current active world_version.id |
| type | API item.type | API | Raw type enum (SmartGate, etc.) |
| state | API item.state | API | unanchored|anchored|online|offline|destroyed |
| name | API item.name? | API/TBD | If not present leave '' |
| system_id | API item.solarSystem.id | API | Keep numeric ID |
| owner_address | API item.owner.address | API | Wallet; case preserved |
| owner_name | API item.owner.name? | API/TBD | Empty if missing |
| type_id | API item.typeDetails.id? or subtype id | API/TBD | Optional numeric reference |
| energy_usage | API item.energyUsage? | API/TBD | Default 0 if absent |
| hash | Internal | DERIVED | sha1 canonical concat of selected fields |
| last_seen_at | Indexer runtime | DERIVED | Upsert timestamp |
| updated_at | API item.updatedAt? | API/TBD | Null if not provided |

Canonical hash input (v1): `id|type|state|system_id|owner_address|gate.destinationId|gate.linked|gate.isParentNodeOnline` (omit undefined segments).

## 3. Table: smart_gate_direction
| Column | Source | Mapping | Notes |
|--------|--------|---------|-------|
| gate_id | smart_assembly.id where type=SmartGate | DERIVED | FK |
| world_version | world_version.id | DERIVED | FK |
| origin_system_id | API item.solarSystem.id | API | Direction #1 origin |
| destination_system_id | API item.gate.destinationId | API | Direction #1 destination |
| linked | API item.gate.linked | API | bool |
| online | API item.state=='online' AND item.gate.isParentNodeOnline | DERIVED | Parent node flag approximates network availability |
| traversal_cost | CONST 0 | CONST | Placeholder future fee model |
| last_change_at | Indexer runtime | DERIVED | Updated when any of: linked/online/origin/destination changes |

Mirror reverse direction row (destination->origin) rule (v1): Insert only if API semantics guarantee bidirectional traversal when linked=true. If later asymmetry appears, logic shifts to chain event introspection; until then we set both directions with identical fields.

## 4. Table: gate_acl
(Deferred population in v1 – schema present; no ingestion until explicit source discovered.)
| Column | Source | Mapping | Notes |
|--------|--------|---------|-------|
| gate_id | N/A | TBD | Hold until whitelist explicit |
| world_version | N/A | TBD |  |
| wallet_address | N/A | TBD |  |
| access_level | N/A | TBD | Defaults to 'allow' when used |
| expires_at | N/A | TBD |  |
| added_at | N/A | TBD |  |

## 5. Table: gate_access_cache
| Column | Source | Mapping | Notes |
|--------|--------|---------|-------|
| gate_id | smart_assembly.id | DERIVED | FK |
| world_version | world_version.id | DERIVED | FK |
| visibility_class | Heuristic (public/tribe/owner_private/restricted) | DERIVED | Based on contract config (future) else fallback classification rules |
| tribe_id | API owner.smartCharacter.tribeId OR character record | API/DERIVED | Only when visibility_class='tribe' |
| direction_origin_system_id | smart_gate_direction.origin_system_id | DERIVED | Optional until directional ACL needed |
| direction_destination_system_id | smart_gate_direction.destination_system_id | DERIVED |  |
| snapshot_version | adjacency_snapshot_meta.snapshot_version | DERIVED | Consistency binding |
| computed_at | runtime | DERIVED | Timestamp |

Initial heuristic (v1): All gates default visibility_class='public'. Owner-specific queries filter by owner_address; tribe-specific classification postponed until contract predicate extraction (v2).

## 6. Table: structure_generic
| Column | Source | Mapping | Notes |
|--------|--------|---------|-------|
| id | smart_assembly.id (non-gate) | DERIVED | FK |
| world_version | world_version.id | DERIVED |  |
| visibility | Heuristic | DERIVED | Start 'public' |
| org_id | API item.owner.tribeId? | API/TBD | Null if absent |
| meta_json | Raw filtered subset of API item | API | JSON string (pruned keys) |

## 7. Table: adjacency_snapshot_meta
| Column | Source | Mapping | Notes |
|--------|--------|---------|-------|
| id | D1 AUTOINC | DERIVED |  |
| world_version | world_version.id | DERIVED |  |
| snapshot_version | Monotonic builder | DERIVED | Increment on published edge change set |
| gate_edge_count | Count of edges in snapshot | DERIVED | After build |
| published_at | D1 default | DERIVED |  |
| build_duration_ms | Builder timing | DERIVED |  |
| coalesced_events | Event batch size | DERIVED |  |

## 8. Table: indexer_run
| Column | Source | Mapping | Notes |
|--------|--------|---------|-------|
| id | D1 AUTOINC | DERIVED |  |
| world_version | world_version.id | DERIVED |  |
| run_started_at | D1 default | DERIVED |  |
| run_finished_at | runtime | DERIVED | Set end-of-run |
| mode | runtime (poll|event|reconcile) | DERIVED |  |
| assemblies_scanned | runtime | DERIVED | Count this run |
| rows_added | runtime | DERIVED |  |
| rows_updated | runtime | DERIVED |  |
| rows_removed | runtime | DERIVED |  |
| gate_edges_rebuilt | runtime | DERIVED |  |
| snapshot_version | adjacency_snapshot_meta.snapshot_version | DERIVED | Null if no publish |
| error_count | runtime | DERIVED |  |
| notes | runtime | DERIVED | Diagnostic text |

## 9. Future: gate_state_history (commented)
If enabled:
| Column | Source | Mapping | Notes |
|--------|--------|---------|-------|
| gate_id | smart_assembly.id | DERIVED |  |
| world_version | world_version.id | DERIVED |  |
| from_state | Previous state | DERIVED |  |
| to_state | API / event state | API/CHAIN |  |
| changed_at | Event timestamp or ingestion time | CHAIN/API |  |

## 10. Derivation & Validation Rules
- ONLINE gate criteria: `smart_assembly.state == 'online'` AND (if present) `gate.isParentNodeOnline == true`.
- Destroyed removal: state='destroyed' -> keep row (audit) but mark smart_gate_direction.online=false.
- Missing in full scan (two consecutive) -> mark logically removed (rows_removed++), optional soft delete strategy TBD.
- Reverse direction insertion: done simultaneously; direction pair considered a single logical gate edge set for change detection.
- Hash change detection triggers: any of state, system_id, destinationId, linked, owner_address changes.

## 11. Migration v1 Scope
Includes tables: world_version, smart_assembly, smart_gate_direction, gate_access_cache (empty placeholder rows allowed), adjacency_snapshot_meta, indexer_run, structure_generic. Excludes population of gate_acl & gate_state_history.

## 12. Change Control
Any column addition/removal or semantic alteration requires:
1. New mapping doc section (v2) appended below (do not rewrite v1 rows).
2. Decision log entry summarizing diffs & migration steps.
3. Forward-compatible code path (old columns tolerated until migration applied).

---
Prepared: 2025-09-07
