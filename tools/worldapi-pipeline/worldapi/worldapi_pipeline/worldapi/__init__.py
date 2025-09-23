from typing import List, Dict, Tuple
from decimal import Decimal
import math
import os
import time

import httpx
import psycopg

import dlt
from dlt.extract.source import DltResource
from rest_api import rest_api_source
from rest_api.typing import RESTAPIConfig


@dlt.source(name="worldapi", max_table_nesting=1)
def worldapi_source(
    base_url: str = dlt.config.value,
) -> List[DltResource]:
    # Note: Python ints are arbitrary precision, but warehouses often default to INT64.
    # We explicitly declare large coordinate columns as DECIMAL(38,0) to avoid overflow
    # in DuckDB/Postgres while preserving numeric semantics. We also cast values to
    # Decimal during extraction so inference matches the declared type.

    def cast_coordinates_to_decimal(row):
        """
        Recursively walk the row and cast any dict with key "location" containing
        integer x/y/z to Decimal so warehouses use DECIMAL(38,0) instead of BIGINT.
        Works for both top-level and nested objects (e.g., solarSystem.location).
        """
        def _walk(obj):
            if isinstance(obj, dict):
                # If this dict has a location sub-dict, cast its coords
                loc = obj.get("location")
                if isinstance(loc, dict):
                    for k in ("x", "y", "z"):
                        v = loc.get(k)
                        if isinstance(v, int):
                            loc[k] = Decimal(v)
                # Continue walking nested dicts/lists
                for k, v in obj.items():
                    obj[k] = _walk(v)
                return obj
            if isinstance(obj, list):
                return [_walk(v) for v in obj]
            return obj

        return _walk(row)

    MAX_I64 = 2**63 - 1

    def _coerce_ints(obj):
        # Recursively coerce Python ints that exceed 64-bit to strings to avoid writer errors
        if isinstance(obj, dict):
            return {k: _coerce_ints(v) for k, v in obj.items()}
        if isinstance(obj, list):
            return [_coerce_ints(v) for v in obj]
        if isinstance(obj, int) and (obj > MAX_I64 or obj < -MAX_I64 - 1):
            return str(obj)
        return obj

    def coerce_bigints(row):
        return _coerce_ints(row)

    def prune_smartassembly(row):
        """Return only top-level scalar fields to avoid nested column conflicts.

        Any nested dicts/lists are dropped so the table remains flat and stable.
        """
        if not isinstance(row, dict):
            return row
        return {k: v for k, v in row.items() if not isinstance(v, (dict, list))}

    # Helper: cadence gating
    def _get_env_int(name: str, default: int) -> int:
        try:
            return int(os.getenv(name, str(default)))
        except Exception:
            return default

    def _is_due(interval_min: int, offset_min: int) -> bool:
        """Return True if the current UTC minute falls on the interval bucket with the given offset.
        interval<=0 disables the resource.
        """
        if interval_min <= 0:
            return False
        now_min = int(time.time() // 60)
        return (now_min - offset_min) % max(interval_min, 1) == 0

    # Defaults (minutes) + env overrides
    CADENCE_DEFAULTS: Dict[str, Tuple[int, int]] = {
        # name: (interval_min, offset_min)
        "get_health": (_get_env_int("HEALTH_INTERVAL_MIN", 60), _get_env_int("HEALTH_OFFSET_MIN", 0)),
        "get_config": (_get_env_int("CONFIG_INTERVAL_MIN", 60), _get_env_int("CONFIG_OFFSET_MIN", 30)),
        "get_v_2_solarsystems": (_get_env_int("SOLARSYSTEMS_INTERVAL_MIN", 1440), _get_env_int("SOLARSYSTEMS_OFFSET_MIN", 10)),
        "get_v_2_solarsystems_details": (_get_env_int("SOLARSYSTEMS_DETAILS_INTERVAL_MIN", 1440), _get_env_int("SOLARSYSTEMS_DETAILS_OFFSET_MIN", 12)),
        "get_v_2_types": (_get_env_int("TYPES_INTERVAL_MIN", 1440), _get_env_int("TYPES_OFFSET_MIN", 20)),
        "get_v_2_tribes": (_get_env_int("TRIBES_INTERVAL_MIN", 180), _get_env_int("TRIBES_OFFSET_MIN", 5)),
        "get_v_2_tribes_details": (_get_env_int("TRIBES_DETAILS_INTERVAL_MIN", 180), _get_env_int("TRIBES_DETAILS_OFFSET_MIN", 7)),
        "get_v_2_smartcharacters": (_get_env_int("SMARTCHARACTERS_INTERVAL_MIN", 15), _get_env_int("SMARTCHARACTERS_OFFSET_MIN", 1)),
        "get_v_2_smartcharacters_details": (_get_env_int("SMARTCHARACTERS_DETAILS_INTERVAL_MIN", 15), _get_env_int("SMARTCHARACTERS_DETAILS_OFFSET_MIN", 3)),
        "get_v_2_smartassemblies_flat": (_get_env_int("SMARTASSEMBLIES_FLAT_INTERVAL_MIN", 2), _get_env_int("SMARTASSEMBLIES_FLAT_OFFSET_MIN", 0)),
        "get_v_2_smartassemblies_details": (_get_env_int("SMARTASSEMBLIES_DETAILS_INTERVAL_MIN", 10), _get_env_int("SMARTASSEMBLIES_DETAILS_OFFSET_MIN", 2)),
        # custom resource (added later): get_v_2_killmails
    }

    # Parent-child dependencies: only run child if parent is also due (simple first pass)
    PARENT_DEP: Dict[str, str] = {
        "get_v_2_solarsystems_details": "get_v_2_solarsystems",
        "get_v_2_tribes_details": "get_v_2_tribes",
        "get_v_2_smartcharacters_details": "get_v_2_smartcharacters",
        "get_v_2_smartassemblies_details": "get_v_2_smartassemblies_flat",
    }

    source_config: RESTAPIConfig = {
        "client": {
            "base_url": base_url,
        },
        "resources": [
            {
                "name": "get_health",
                "table_name": "health",
                "endpoint": {"path": "/health"},
                "write_disposition": "replace",
            },
            {
                "name": "get_config",
                "table_name": "config",
                "endpoint": {"path": "/config"},
                "write_disposition": "replace",
            },
            # killmails implemented below as a custom resource (tail-only)
            {
                "name": "get_v_2_solarsystems",
                "table_name": "solarsystem",
                "endpoint": {
                    "path": "/v2/solarsystems",
                    "paginator": {
                        "type": "offset",
                        "limit": 100,
                        "offset_param": "offset",
                        "limit_param": "limit",
                        "total_path": "$.metadata.total",
                    },
                    "data_selector": "data",
                },
                "primary_key": "id",
                "write_disposition": "merge",
                "columns": {
                    "location__x": {"data_type": "decimal", "precision": 38, "scale": 0},
                    "location__y": {"data_type": "decimal", "precision": 38, "scale": 0},
                    "location__z": {"data_type": "decimal", "precision": 38, "scale": 0},
                },
                "processing_steps": [{"map": cast_coordinates_to_decimal}, {"map": coerce_bigints}],
            },
            {
                "name": "get_v_2_solarsystems_details",
                "table_name": "solarsystems_details",
                "endpoint": {
                    "path": "/v2/solarsystems/{id}",
                    "params": {
                        "id": {
                            "type": "resolve",
                            "resource": "get_v_2_solarsystems",
                            "field": "id"
                        }
                    },
                },
                "primary_key": "id",
                "write_disposition": "merge",
                "processing_steps": [{"map": cast_coordinates_to_decimal}, {"map": coerce_bigints}],
            },
            {
                "name": "get_v_2_types",
                "table_name": "type",
                "endpoint": {
                    "path": "/v2/types",
                    "paginator": {
                        "type": "offset",
                        "limit": 100,
                        "offset_param": "offset",
                        "limit_param": "limit",
                        "total_path": "$.metadata.total",
                    },
                    "data_selector": "data",
                },
                "primary_key": "id",
                "write_disposition": "merge",
                "processing_steps": [{"map": coerce_bigints}],
            },
            {
                "name": "get_v_2_tribes",
                "table_name": "tribe",
                "endpoint": {
                    "path": "/v2/tribes",
                    "paginator": {
                        "type": "offset",
                        "limit": 100,
                        "offset_param": "offset",
                        "limit_param": "limit",
                        "total_path": "$.metadata.total",
                    },
                    "data_selector": "data",
                },
                "primary_key": "id",
                "write_disposition": "merge",
                "processing_steps": [{"map": coerce_bigints}],
            },
            {
                "name": "get_v_2_tribes_details",
                "table_name": "tribes_details",
                "endpoint": {
                    "path": "/v2/tribes/{id}",
                    "params": {
                        "id": {
                            "type": "resolve",
                            "resource": "get_v_2_tribes",
                            "field": "id"
                        }
                    },
                },
                "primary_key": "id",
                "write_disposition": "merge",
                "processing_steps": [{"map": coerce_bigints}],
            },
            {
                "name": "get_v_2_smartcharacters",
                "table_name": "smartcharacter",
                "endpoint": {
                    "path": "/v2/smartcharacters",
                    "paginator": {
                        "type": "offset",
                        "limit": 10,
                        "offset_param": "offset",
                        "limit_param": "limit",
                        "total_path": "$.metadata.total",
                    },
                    "data_selector": "data",
                },
                "primary_key": "id",
                "write_disposition": "merge",
                "processing_steps": [{"map": coerce_bigints}],
            },
            {
                "name": "get_v_2_smartcharacters_details",
                "table_name": "smartcharacters_details",
                "endpoint": {
                    "path": "/v2/smartcharacters/{address}",
                    "params": {
                        "address": {
                            "type": "resolve",
                            "resource": "get_v_2_smartcharacters",
                            "field": "address"
                        }
                    },
                },
                "primary_key": "address",
                "write_disposition": "merge",
                "processing_steps": [{"map": coerce_bigints}],
            },
            # flat list for top-level fields and id resolution
            {
                "name": "get_v_2_smartassemblies_flat",
                "table_name": "smartassembly_flat",
                "endpoint": {
                    "path": "/v2/smartassemblies",
                    "paginator": {
                        "type": "offset",
                        "limit": 10,
                        "offset_param": "offset",
                        "limit_param": "limit",
                        "total_path": "$.metadata.total",
                    },
                    "data_selector": "data",
                },
                "primary_key": "id",
                "columns": {
                    "id": {"data_type": "text"},
                    "energy_usage": {"data_type": "bigint"},
                    "type_id": {"data_type": "bigint"},
                },
                "write_disposition": "replace",
                "processing_steps": [
                    {"map": prune_smartassembly},
                    {"map": coerce_bigints}
                ],
            },
            # details by id with coordinate casting
            {
                "name": "get_v_2_smartassemblies_details",
                # Write detailed records into the typed smartassembly table
                # so downstream joins (map edges, Grafana) can rely on a single
                # canonical table instead of a separate raw details table.
                "table_name": "smartassembly",
                "endpoint": {
                    "path": "/v2/smartassemblies/{id}",
                    "params": {
                        "id": {
                            "type": "resolve",
                            "resource": "get_v_2_smartassemblies_flat",
                            "field": "id"
                        }
                    }
                },
                "primary_key": "id",
                "write_disposition": "merge",
                "columns": {
                    # Location lives under solar_system.location in details payload
                    # Ensure coordinates are stored as DECIMAL(38,0) to avoid BIGINT overflow
                    "solar_system__location__x": {"data_type": "decimal", "precision": 38, "scale": 0},
                    "solar_system__location__y": {"data_type": "decimal", "precision": 38, "scale": 0},
                    "solar_system__location__z": {"data_type": "decimal", "precision": 38, "scale": 0}
                },
                "processing_steps": [
                    {"map": cast_coordinates_to_decimal},
                    {"map": coerce_bigints}
                ]
            },
        ],
    }

    # NOTE: We no longer mutate source_config based on FORCE_ALLOW_RESOURCES/force deny here.
    # Doing so at config time pruned resources (including parents) from the registry,
    # which prevented the later allowlist expansion from adding required parents and
    # could yield an empty final selection. Instead, we keep the full registry intact
    # and apply allow/deny overrides at the end, after cadence gating.
    # (Left here for visibility; intentionally not filtering source_config.)
    cfg_allow_env = os.getenv("FORCE_ALLOW_RESOURCES", "").strip()
    cfg_deny_env = os.getenv("FORCE_DENY_RESOURCES", "").strip()
    if cfg_allow_env:
        try:
            allow_set = {s.strip() for s in cfg_allow_env.split(',') if s.strip()}
            print("[cadence] cfg-allow observed (no-op at config stage):", sorted(allow_set))
        except Exception:
            pass
    if cfg_deny_env:
        try:
            deny_set = {s.strip() for s in cfg_deny_env.split(',') if s.strip()}
            print("[cadence] cfg-deny observed (no-op at config stage):", sorted(deny_set))
        except Exception:
            pass

    # Build resources from the generic REST config first
    rest_resources_obj = rest_api_source(source_config)
    # Coerce to a flat list of DltResource without triggering extraction. Iterating
    # the DltSource yields rows immediately, so prefer the declarative .resources when available.
    resources_attr = getattr(rest_resources_obj, "resources", None)
    if resources_attr is not None:
        rest_resources_list = list(resources_attr)
    elif isinstance(rest_resources_obj, dict):
        rest_resources_list = list(rest_resources_obj.values())
    else:
        rest_resources_list = list(rest_resources_obj)  # type: ignore[arg-type]

    # Filter by cadence gating
    name_to_res: Dict[str, DltResource] = {getattr(r, "name", ""): r for r in rest_resources_list}

    # Determine which are due now
    due_names: List[str] = []
    for name in name_to_res.keys():
        interval, offset = CADENCE_DEFAULTS.get(name, (_get_env_int(f"{name.upper()}_INTERVAL_MIN", 1440), 0))
        if _is_due(interval, offset):
            # Enforce parent dependency: only include child if parent also due
            parent = PARENT_DEP.get(name)
            if parent:
                p_interval, p_offset = CADENCE_DEFAULTS.get(parent, (_get_env_int(f"{parent.upper()}_INTERVAL_MIN", 1440), 0))
                if _is_due(p_interval, p_offset):
                    due_names.append(name)
                    if parent not in due_names:
                        due_names.append(parent)
                # else: parent not due; skip child this tick
            else:
                due_names.append(name)

    # Deduplicate and keep original declaration order
    filtered_resources: List[DltResource] = []
    seen = set()
    for r in rest_resources_list:
        n = getattr(r, "name", "")
        if n in due_names and n not in seen:
            filtered_resources.append(r)
            seen.add(n)

    # Implement tail-only killmails with stateful last_seen id and a safety cap on old pages
    @dlt.resource(
        name="get_v_2_killmails",
        table_name="killmails",
        primary_key="id",
        write_disposition="merge",
    )
    def get_v_2_killmails():
        """
        Tail-only pagination for /v2/killmails using limit+offset (not page):
        - Fetches newest items starting at offset=0 and advancing by limit.
        - Yields only items with id > last_seen_id kept in pipeline state.
        - In incremental mode, stops when a page yields no new items (with a cursor).
        - On the first-ever run without a cursor, caps historical scan by max_old_pages
          unless explicit backfill is enabled.

        Env overrides:
        - KILLMAILS_PAGE_SIZE (default 10)
        - KILLMAILS_MAX_OLD_PAGES (default 60)
        - KILLMAILS_BACKFILL (default 0): when truthy and backfill not yet done in state,
          perform a one-time historical backfill scanning many pages and then set
          state.killmails_backfill_done=1
        - KILLMAILS_BACKFILL_MAX_PAGES (default 1000): cap pages scanned in backfill mode
        """
        page_size = int(os.getenv("KILLMAILS_PAGE_SIZE", "10"))
        max_old_pages = int(os.getenv("KILLMAILS_MAX_OLD_PAGES", "60"))
        backfill_env = (os.getenv("KILLMAILS_BACKFILL", "0") or "").strip().lower()
        backfill_enabled = backfill_env in ("1", "true", "yes", "on")
        backfill_max_pages = int(os.getenv("KILLMAILS_BACKFILL_MAX_PAGES", "1000"))
        page_delay_ms = int(os.getenv("KILLMAILS_PAGE_DELAY_MS", "100"))
        replay_pages = max(int(os.getenv("KILLMAILS_REPLAY_PAGES", "20")), 0)

        client = httpx.Client(base_url=base_url, timeout=30.0)
        try:
            # Optional guarded reset: when KILLMAILS_FORCE_RESET is truthy, clear cursor/backfill flags
            try:
                reset_env = (os.getenv("KILLMAILS_FORCE_RESET", "0") or "").strip().lower()
                if reset_env in ("1", "true", "yes", "on"):
                    s = dlt.state()
                    if "killmails_last_seen_id" in s:
                        del s["killmails_last_seen_id"]
                    if "killmails_backfill_done" in s:
                        del s["killmails_backfill_done"]
                    print("[killmails] resetting state via KILLMAILS_FORCE_RESET")
            except Exception:
                pass

            # Fetch metadata to obtain total (offset-based)
            meta_resp = client.get("/v2/killmails", params={"limit": page_size, "offset": 0})
            meta_resp.raise_for_status()
            meta_json = meta_resp.json() or {}
            total = int(((meta_json.get("metadata") or {}).get("total")) or 0)
            # Compute the last offset (older items) if needed
            last_offset = max((math.ceil(total / page_size) - 1) * page_size, 0)

            # Determine ordering by sampling first and last pages
            # Heuristic: whichever page has a higher max(id) is considered "newest"
            first_items = (meta_json.get("data") or [])
            first_max_id = max((int(it.get("id")) for it in first_items if isinstance(it.get("id"), (int, str)) and str(it.get("id")).isdigit()), default=-1)
            last_page_json = {}
            last_max_id = -1
            if total > 0:
                try:
                    last_resp = client.get("/v2/killmails", params={"limit": page_size, "offset": last_offset})
                    last_resp.raise_for_status()
                    last_page_json = last_resp.json() or {}
                    last_items = (last_page_json.get("data") or [])
                    last_max_id = max((int(it.get("id")) for it in last_items if isinstance(it.get("id"), (int, str)) and str(it.get("id")).isdigit()), default=-1)
                except Exception:
                    pass

            newest_at_start = first_max_id >= last_max_id
            try:
                print(f"[killmails] order_detect: newest_at_start={newest_at_start} first_max_id={first_max_id} last_max_id={last_max_id} total={total} page_size={page_size}")
            except Exception:
                pass

            state = dlt.state()
            last_seen_id = state.get("killmails_last_seen_id")
            backfill_done = bool(state.get("killmails_backfill_done"))

            # One-time backfill mode: ignore last_seen filter, scan deeper once, then mark done
            if backfill_enabled and not backfill_done:
                print(f"[killmails] backfill enabled: scanning up to {backfill_max_pages} pages of size {page_size}")
                pages_scanned = 0
                new_max_id = last_seen_id or 0
                if newest_at_start:
                    for page_idx in range(backfill_max_pages):
                        offset = page_idx * page_size
                        if offset > last_offset:
                            break
                        resp = client.get("/v2/killmails", params={"limit": page_size, "offset": offset})
                        resp.raise_for_status()
                        j = resp.json() or {}
                        items = (j.get("data") or [])
                        if not items:
                            break
                        for it in items:
                            it = coerce_bigints(it)
                            it_id = it.get("id")
                            try:
                                it_id_int = int(it_id)
                            except Exception:
                                it_id_int = None
                            if it_id_int is not None:
                                new_max_id = max(new_max_id, it_id_int)
                            yield it
                        pages_scanned += 1
                        if page_delay_ms > 0:
                            time.sleep(page_delay_ms / 1000.0)
                else:
                    for page_idx in range(backfill_max_pages):
                        offset = max(last_offset - page_idx * page_size, 0)
                        resp = client.get("/v2/killmails", params={"limit": page_size, "offset": offset})
                        resp.raise_for_status()
                        j = resp.json() or {}
                        items = (j.get("data") or [])
                        if not items:
                            break
                        for it in items:
                            it = coerce_bigints(it)
                            it_id = it.get("id")
                            try:
                                it_id_int = int(it_id)
                            except Exception:
                                it_id_int = None
                            if it_id_int is not None:
                                new_max_id = max(new_max_id, it_id_int)
                            yield it
                        pages_scanned += 1
                        if page_delay_ms > 0:
                            time.sleep(page_delay_ms / 1000.0)
                        if offset == 0:
                            break
                if new_max_id and (last_seen_id is None or new_max_id > last_seen_id):
                    state["killmails_last_seen_id"] = new_max_id
                state["killmails_backfill_done"] = 1
                print(f"[killmails] backfill done: pages_scanned={pages_scanned}, new_max_id={new_max_id}")
                return

            # Normal tail-only incremental mode
            pages_scanned = 0
            new_max_id = last_seen_id or 0

            # Safety cap for incremental backward scans
            tail_scan_cap = int(os.getenv("KILLMAILS_TAIL_MAX_PAGES", "20"))

            if newest_at_start:
                # Newest are at offset=0; scan forward
                page_idx = 0
                while True:
                    offset = page_idx * page_size
                    if last_seen_id is None and pages_scanned >= max_old_pages:
                        break
                    if offset > last_offset:
                        break
                    resp = client.get("/v2/killmails", params={"limit": page_size, "offset": offset})
                    resp.raise_for_status()
                    j = resp.json() or {}
                    items = (j.get("data") or [])
                    if not items:
                        break

                    any_new = False
                    for it in items:
                        it = coerce_bigints(it)
                        it_id = it.get("id")
                        try:
                            it_id_int = int(it_id)
                        except Exception:
                            it_id_int = None

                        if last_seen_id is None or (it_id_int is not None and it_id_int > last_seen_id):
                            any_new = True
                            if it_id_int is not None:
                                new_max_id = max(new_max_id, it_id_int)
                            yield it

                    pages_scanned += 1
                    if page_delay_ms > 0:
                        time.sleep(page_delay_ms / 1000.0)
                    page_idx += 1
                    if last_seen_id is not None and not any_new:
                        break
            else:
                # Newest are at the end; scan backward from last_offset
                page_idx = 0
                while True:
                    if last_seen_id is None and pages_scanned >= max_old_pages:
                        break
                    if page_idx >= tail_scan_cap and last_seen_id is not None:
                        break
                    offset = max(last_offset - page_idx * page_size, 0)
                    resp = client.get("/v2/killmails", params={"limit": page_size, "offset": offset})
                    resp.raise_for_status()
                    j = resp.json() or {}
                    items = (j.get("data") or [])
                    if not items:
                        break

                    any_new = False
                    for it in items:
                        it = coerce_bigints(it)
                        it_id = it.get("id")
                        try:
                            it_id_int = int(it_id)
                        except Exception:
                            it_id_int = None
                        if last_seen_id is None or (it_id_int is not None and it_id_int > last_seen_id):
                            any_new = True
                            if it_id_int is not None:
                                new_max_id = max(new_max_id, it_id_int)
                            yield it

                    pages_scanned += 1
                    if page_delay_ms > 0:
                        time.sleep(page_delay_ms / 1000.0)
                    page_idx += 1
                    # Stop once a whole page yields no new items (common tail condition)
                    if last_seen_id is not None and not any_new:
                        break
                    if offset == 0:
                        break

            if last_seen_id is not None and replay_pages > 0:
                replay_limit = min(replay_pages, 5000 // max(page_size, 1))
                for replay_idx in range(replay_limit):
                    offset = (
                        replay_idx * page_size
                        if newest_at_start
                        else max(last_offset - replay_idx * page_size, 0)
                    )
                    try:
                        resp = client.get(
                            "/v2/killmails",
                            params={"limit": page_size, "offset": offset},
                        )
                        resp.raise_for_status()
                        replay_data = (resp.json() or {}).get("data") or []
                    except Exception as e:
                        try:
                            print(f"[killmails] replay fetch error offset={offset}: {e}")
                        except Exception:
                            pass
                        break
                    if not replay_data:
                        break
                    yielded = False
                    for item in replay_data:
                        item = coerce_bigints(item)
                        item_id = item.get("id")
                        try:
                            item_id_int = int(item_id)
                        except Exception:
                            item_id_int = None
                        if item_id_int is None or item_id_int > last_seen_id:
                            continue
                        yielded = True
                        yield item
                    if newest_at_start:
                        if offset >= last_offset:
                            break
                    else:
                        if offset == 0:
                            break
                    if not yielded:
                        break

            if new_max_id and (last_seen_id is None or new_max_id > last_seen_id):
                state["killmails_last_seen_id"] = new_max_id
        finally:
            client.close()

    # Return combined list with the custom tail-only killmails resource
    # Apply cadence gating to killmails too
    km_interval = _get_env_int("KILLMAILS_INTERVAL_MIN", 2)
    km_offset = _get_env_int("KILLMAILS_OFFSET_MIN", 0)

    selected = [*filtered_resources]
    # Only consider cadence-driven killmails when no allowlist override is set later.
    # We'll gate this again after overrides; for now keep candidate list minimal.
    if not os.getenv("FORCE_ALLOW_RESOURCES") and _is_due(km_interval, km_offset):
        selected.append(get_v_2_killmails)

    # Smartassemblies flat â€“ tail-only list scanner to avoid full replace of 130k+ items
    # Fetches only the first N pages (assumed newest) and merges into the flat table.
    # This keeps the ID set fresh without long-running full scans.
    @dlt.resource(
        name="get_v_2_smartassemblies_flat_tail",
        table_name="smartassembly_flat",
        primary_key="id",
        write_disposition="merge",
    )
    def get_v_2_smartassemblies_flat_tail():
        page_size = int(os.getenv("SSA_PAGE_SIZE", "10"))
        max_pages = int(os.getenv("SSA_MAX_PAGES", "50"))
        page_delay_ms = int(os.getenv("SSA_PAGE_DELAY_MS", "100"))

        client = httpx.Client(base_url=base_url, timeout=30.0)
        try:
            # Probe first page to verify shape and detect total
            try:
                meta_resp = client.get("/v2/smartassemblies", params={"limit": page_size, "offset": 0})
                meta_resp.raise_for_status()
                meta_json = meta_resp.json() or {}
                total = int(((meta_json.get("metadata") or {}).get("total")) or 0)
                try:
                    print(f"[ssa-flat] tail scan: total={total} page_size={page_size} max_pages={max_pages}")
                except Exception:
                    pass
            except Exception as e:
                try:
                    print(f"[ssa-flat] probe failed: {e}")
                except Exception:
                    pass
                return

            last_offset = 0
            if page_size > 0:
                pages_total = math.ceil(total / page_size)
                last_offset = max((pages_total - 1) * page_size, 0)

            def _max_numeric_id(items):
                return max(
                    (
                        int(it.get("id"))
                        for it in items
                        if isinstance(it, dict)
                        and isinstance(it.get("id"), (int, str))
                        and str(it.get("id")).isdigit()
                    ),
                    default=-1,
                )

            first_items = (meta_json.get("data") or [])
            first_max_id = _max_numeric_id(first_items)
            last_max_id = first_max_id
            if total > page_size and last_offset > 0:
                try:
                    tail_resp = client.get("/v2/smartassemblies", params={"limit": page_size, "offset": last_offset})
                    tail_resp.raise_for_status()
                    tail_json = tail_resp.json() or {}
                    last_max_id = _max_numeric_id(tail_json.get("data") or [])
                except Exception as e:
                    try:
                        print(f"[ssa-flat] tail probe failed offset={last_offset}: {e}")
                    except Exception:
                        pass

            newest_at_start = first_max_id >= last_max_id
            try:
                print(
                    f"[ssa-flat] order_detect newest_at_start={newest_at_start} first_max_id={first_max_id} last_max_id={last_max_id} last_offset={last_offset}"
                )
            except Exception:
                pass

            seen_ids: set[str] = set()
            empty_streak = 0

            if newest_at_start:
                for page_idx in range(max_pages):
                    offset = page_idx * page_size
                    if total and offset >= total:
                        break
                    try:
                        resp = client.get("/v2/smartassemblies", params={"limit": page_size, "offset": offset})
                        resp.raise_for_status()
                        j = resp.json() or {}
                        items = (j.get("data") or [])
                        if not items:
                            empty_streak += 1
                            if empty_streak >= 2:
                                break
                            if page_delay_ms > 0:
                                time.sleep(page_delay_ms / 1000.0)
                            continue
                        empty_streak = 0
                        for it in items:
                            if isinstance(it, dict):
                                raw_id = it.get("id")
                                if raw_id in seen_ids:
                                    continue
                                if raw_id is not None:
                                    seen_ids.add(raw_id)
                            it = prune_smartassembly(it)
                            it = coerce_bigints(it)
                            yield it
                        if page_delay_ms > 0:
                            time.sleep(page_delay_ms / 1000.0)
                    except Exception as e:
                        try:
                            print(f"[ssa-flat] page error offset={offset}: {e}")
                        except Exception:
                            pass
                        continue
            else:
                for page_idx in range(max_pages):
                    offset = max(last_offset - page_idx * page_size, 0)
                    try:
                        resp = client.get("/v2/smartassemblies", params={"limit": page_size, "offset": offset})
                        resp.raise_for_status()
                        j = resp.json() or {}
                        items = (j.get("data") or [])
                        if not items:
                            empty_streak += 1
                            if empty_streak >= 2:
                                break
                            if page_delay_ms > 0:
                                time.sleep(page_delay_ms / 1000.0)
                            if offset == 0:
                                break
                            continue
                        empty_streak = 0
                        for it in items:
                            if isinstance(it, dict):
                                raw_id = it.get("id")
                                if raw_id in seen_ids:
                                    continue
                                if raw_id is not None:
                                    seen_ids.add(raw_id)
                            it = prune_smartassembly(it)
                            it = coerce_bigints(it)
                            yield it
                        if page_delay_ms > 0:
                            time.sleep(page_delay_ms / 1000.0)
                    except Exception as e:
                        try:
                            print(f"[ssa-flat] page error offset={offset}: {e}")
                        except Exception:
                            pass
                        if offset == 0:
                            break
                        continue
                    if offset == 0:
                        break
        finally:
            client.close()

    # Smartassemblies details (batch) â€“ fetch IDs missing from the typed table via Postgres join
    # Then retrieve details per id and yield into the canonical 'smartassembly' table.
    @dlt.resource(
        name="get_v_2_smartassemblies_details_batch",
        table_name="smartassembly",
        primary_key="id",
        write_disposition="merge",
    )
    def get_v_2_smartassemblies_details_batch():
        batch_size = int(os.getenv("SMARTASSEMBLIES_BATCH_SIZE", "200"))
        schema = os.getenv("DATASET_NAME", "world_api_dlt")
        pg_host = os.getenv("POSTGRES_HOST", os.getenv("DESTINATION__POSTGRES__CREDENTIALS__HOST", "localhost"))
        pg_port = int(os.getenv("POSTGRES_PORT", os.getenv("DESTINATION__POSTGRES__CREDENTIALS__PORT", "5432")))
        pg_db = os.getenv("POSTGRES_DB", os.getenv("DESTINATION__POSTGRES__CREDENTIALS__DATABASE", "postgres"))
        pg_user = os.getenv("POSTGRES_USER", os.getenv("DESTINATION__POSTGRES__CREDENTIALS__USERNAME", "user"))
        pg_pass = os.getenv("POSTGRES_PASSWORD", os.getenv("DESTINATION__POSTGRES__CREDENTIALS__PASSWORD", "password"))

        # Query a small set of missing IDs each tick
        sql = f"""
            SELECT f.id
            FROM {schema}.smartassembly_flat f
            LEFT JOIN {schema}.smartassembly s ON s.id = f.id
            WHERE s.id IS NULL
            ORDER BY f.id
            LIMIT %s
        """

        ids: List[str] = []
        conn = None
        try:
            conn = psycopg.connect(host=pg_host, port=pg_port, dbname=pg_db, user=pg_user, password=pg_pass)
            with conn.cursor() as cur:
                cur.execute(sql, (batch_size,))
                rows = cur.fetchall() or []
                ids = [str(r[0]) for r in rows if r and r[0] is not None]
        except Exception as e:
            try:
                print(f"[ssa-batch] DB query failed: {e}")
            except Exception:
                pass
        finally:
            try:
                if conn is not None:
                    conn.close()
            except Exception:
                pass

        if not ids:
            try:
                print("[tribe-members] no tribe ids selected this tick")
            except Exception:
                pass
            return

        client = httpx.Client(base_url=base_url, timeout=30.0)
        item_delay_ms = int(os.getenv("SMARTASSEMBLIES_DETAILS_DELAY_MS", "50"))
        try:
            for sid in ids:
                try:
                    resp = client.get(f"/v2/smartassemblies/{sid}")
                    resp.raise_for_status()
                    item = resp.json() or {}
                    # Ensure coordinate decimals and bigint coercion
                    item = cast_coordinates_to_decimal(item)
                    item = coerce_bigints(item)
                    yield item
                    if item_delay_ms > 0:
                        time.sleep(item_delay_ms / 1000.0)
                except Exception as e:
                    try:
                        print(f"[ssa-batch] fetch error id={sid}: {e}")
                    except Exception:
                        pass
        finally:
            client.close()

    # Smartcharacters details (batch) â€“ fetch addresses missing from details table
    @dlt.resource(
        name="get_v_2_smartcharacters_details_batch",
        table_name="smartcharacters_details",
        primary_key="address",
        write_disposition="merge",
    )
    def get_v_2_smartcharacters_details_batch():
        batch_size = int(os.getenv("SMARTCHARACTERS_BATCH_SIZE", "200"))
        item_delay_ms = int(os.getenv("SMARTCHARACTERS_DETAILS_DELAY_MS", "50"))
        schema = os.getenv("DATASET_NAME", "world_api_dlt")
        pg_host = os.getenv("POSTGRES_HOST", os.getenv("DESTINATION__POSTGRES__CREDENTIALS__HOST", "localhost"))
        pg_port = int(os.getenv("POSTGRES_PORT", os.getenv("DESTINATION__POSTGRES__CREDENTIALS__PORT", "5432")))
        pg_db = os.getenv("POSTGRES_DB", os.getenv("DESTINATION__POSTGRES__CREDENTIALS__DATABASE", "postgres"))
        pg_user = os.getenv("POSTGRES_USER", os.getenv("DESTINATION__POSTGRES__CREDENTIALS__USERNAME", "user"))
        pg_pass = os.getenv("POSTGRES_PASSWORD", os.getenv("DESTINATION__POSTGRES__CREDENTIALS__PASSWORD", "password"))

        sql = f"""
            SELECT c.address
            FROM {schema}.smartcharacter c
            LEFT JOIN {schema}.smartcharacters_details d ON d.address = c.address
            WHERE d.address IS NULL
            ORDER BY c.address
            LIMIT %s
        """

        addresses: List[str] = []
        conn = None
        try:
            conn = psycopg.connect(host=pg_host, port=pg_port, dbname=pg_db, user=pg_user, password=pg_pass)
            with conn.cursor() as cur:
                cur.execute(sql, (batch_size,))
                rows = cur.fetchall() or []
                addresses = [str(r[0]) for r in rows if r and r[0] is not None]
        except Exception as e:
            try:
                print(f"[sch-batch] DB query failed: {e}")
            except Exception:
                pass
        finally:
            try:
                if conn is not None:
                    conn.close()
            except Exception:
                pass

        if not addresses:
            return

        client = httpx.Client(base_url=base_url, timeout=30.0)
        try:
            for addr in addresses:
                try:
                    resp = client.get(f"/v2/smartcharacters/{addr}")
                    resp.raise_for_status()
                    item = resp.json() or {}
                    item = coerce_bigints(item)
                    yield item
                    if item_delay_ms > 0:
                        time.sleep(item_delay_ms / 1000.0)
                except Exception as e:
                    try:
                        print(f"[sch-batch] fetch error address={addr}: {e}")
                    except Exception:
                        pass
        finally:
            client.close()

    # Tribes details (batch)
    @dlt.resource(
        name="get_v_2_tribes_details_batch",
        table_name="tribes_details",
        primary_key="id",
        write_disposition="merge",
    )
    def get_v_2_tribes_details_batch():
        batch_size = int(os.getenv("TRIBES_BATCH_SIZE", "200"))
        item_delay_ms = int(os.getenv("TRIBES_DETAILS_DELAY_MS", "50"))
        schema = os.getenv("DATASET_NAME", "world_api_dlt")
        pg_host = os.getenv("POSTGRES_HOST", os.getenv("DESTINATION__POSTGRES__CREDENTIALS__HOST", "localhost"))
        pg_port = int(os.getenv("POSTGRES_PORT", os.getenv("DESTINATION__POSTGRES__CREDENTIALS__PORT", "5432")))
        pg_db = os.getenv("POSTGRES_DB", os.getenv("DESTINATION__POSTGRES__CREDENTIALS__DATABASE", "postgres"))
        pg_user = os.getenv("POSTGRES_USER", os.getenv("DESTINATION__POSTGRES__CREDENTIALS__USERNAME", "user"))
        pg_pass = os.getenv("POSTGRES_PASSWORD", os.getenv("DESTINATION__POSTGRES__CREDENTIALS__PASSWORD", "password"))

        # Select a batch of tribe ids that still need details. On first run the
        # tribes_details table may not exist yet; probe for existence and avoid
        # referencing it in SQL until dlt creates it via the first writes.
        sql_missing = f"""
            SELECT t.id
            FROM {schema}.tribe t
            ORDER BY t.id
            LIMIT %s
        """
        sql_with_join = f"""
            SELECT t.id
            FROM {schema}.tribe t
            LEFT JOIN {schema}.tribes_details d ON d.id = t.id
            WHERE d.id IS NULL
            ORDER BY t.id
            LIMIT %s
        """

        ids: List[int] = []
        conn = None
        try:
            conn = psycopg.connect(host=pg_host, port=pg_port, dbname=pg_db, user=pg_user, password=pg_pass)
            with conn.cursor() as cur:
                # Determine if details table exists; fall back if not
                details_exists = False
                try:
                    cur.execute(
                        """
                        SELECT 1
                        FROM information_schema.tables
                        WHERE table_schema = %s AND table_name = 'tribes_details'
                        LIMIT 1
                        """,
                        (schema,)
                    )
                    details_exists = cur.fetchone() is not None
                except Exception:
                    details_exists = False
                try:
                    print(f"[tribe-batch] details_exists={details_exists} (schema={schema})")
                except Exception:
                    pass

                query = sql_with_join if details_exists else sql_missing
                cur.execute(query, (batch_size,))
                rows = cur.fetchall() or []
                ids = [int(r[0]) for r in rows if r and r[0] is not None]
                try:
                    if ids:
                        path = "join" if details_exists else "fallback"
                        print(f"[tribe-batch] selected {len(ids)} tribe ids via {path}; range=({ids[0]}..{ids[-1]})")
                    else:
                        print("[tribe-batch] selected 0 tribe ids this tick")
                except Exception:
                    pass
        except Exception as e:
            try:
                print(f"[tribe-batch] DB query failed: {e}")
            except Exception:
                pass
        finally:
            try:
                if conn is not None:
                    conn.close()
            except Exception:
                pass

        if not ids:
            return

        client = httpx.Client(base_url=base_url, timeout=30.0)
        try:
            for tid in ids:
                try:
                    resp = client.get(f"/v2/tribes/{tid}")
                    resp.raise_for_status()
                    item = resp.json() or {}
                    item = coerce_bigints(item)
                    yield item
                    if item_delay_ms > 0:
                        time.sleep(item_delay_ms / 1000.0)
                except Exception as e:
                    try:
                        print(f"[tribe-batch] fetch error id={tid}: {e}")
                    except Exception:
                        pass
        finally:
            client.close()

    # Tribe members (canonical) â€“ build tribe_member from tribe details payload
    @dlt.resource(
        name="get_v_2_tribe_members_batch",
        table_name="tribe_member",
        primary_key=("tribe_id", "address"),
        write_disposition="merge",
    )
    def get_v_2_tribe_members_batch():
        batch_size = int(os.getenv("TRIBES_BATCH_SIZE", "200"))
        item_delay_ms = int(os.getenv("TRIBES_DETAILS_DELAY_MS", "50"))
        schema = os.getenv("DATASET_NAME", "world_api_dlt")
        pg_host = os.getenv("POSTGRES_HOST", os.getenv("DESTINATION__POSTGRES__CREDENTIALS__HOST", "localhost"))
        pg_port = int(os.getenv("POSTGRES_PORT", os.getenv("DESTINATION__POSTGRES__CREDENTIALS__PORT", "5432")))
        pg_db = os.getenv("POSTGRES_DB", os.getenv("DESTINATION__POSTGRES__CREDENTIALS__DATABASE", "postgres"))
        pg_user = os.getenv("POSTGRES_USER", os.getenv("DESTINATION__POSTGRES__CREDENTIALS__USERNAME", "user"))
        pg_pass = os.getenv("POSTGRES_PASSWORD", os.getenv("DESTINATION__POSTGRES__CREDENTIALS__PASSWORD", "password"))

        # Use a simple stateful cursor over tribe ids to avoid duplicates and avoid depending on tribe_member existence
        ids: List[int] = []
        conn = None
        try:
            last_id = 0
            try:
                st = dlt.state()
                last_id = int(st.get("tribe_members_last_id", 0) or 0)
            except Exception:
                last_id = 0

            # Early diagnostic: log resolved connection targets and last_id
            try:
                print(f"[tribe-members] state last_id={last_id} batch_size={batch_size} schema={schema} db={pg_db} host={pg_host}:{pg_port} user={pg_user}")
            except Exception:
                pass

            conn = psycopg.connect(host=pg_host, port=pg_port, dbname=pg_db, user=pg_user, password=pg_pass)
            with conn.cursor() as cur:
                # Table stats diagnostic
                try:
                    cur.execute(f"SELECT COUNT(*), MIN(id), MAX(id) FROM {schema}.tribe")
                    _c, _mn, _mx = cur.fetchone() or (None, None, None)
                    print(f"[tribe-members] tribe table stats: count={_c} min={_mn} max={_mx}")
                except Exception as e:
                    try:
                        print(f"[tribe-members] stats query failed: {e}")
                    except Exception:
                        pass
                # First try taking ids strictly greater than last processed id
                sql_main = f"""
                    SELECT t.id
                    FROM {schema}.tribe t
                    WHERE t.id > %s
                    ORDER BY t.id
                    LIMIT %s
                """
                cur.execute(sql_main, (last_id, batch_size))
                rows = cur.fetchall() or []
                if not rows and last_id > 0:
                    # Wrap-around to the beginning to continuously cycle
                    sql_wrap = f"""
                        SELECT t.id
                        FROM {schema}.tribe t
                        WHERE t.id > 0
                        ORDER BY t.id
                        LIMIT %s
                    """
                    cur.execute(sql_wrap, (batch_size,))
                    rows = cur.fetchall() or []
                ids = [int(r[0]) for r in rows if r and r[0] is not None]
                # Selection diagnostic
                try:
                    if ids:
                        print(f"[tribe-members] selected {len(ids)} ids; range=({ids[0]}..{ids[-1]})")
                    else:
                        print(f"[tribe-members] selected 0 ids after queries; last_id={last_id}")
                except Exception:
                    pass
        except Exception as e:
            try:
                print(f"[tribe-members] DB query failed: {e}")
            except Exception:
                pass
        finally:
            try:
                if conn is not None:
                    conn.close()
            except Exception:
                pass

        if not ids:
            # No ids to process; exit early after diagnostics
            return

        def _extract_members(tribe_id: int, item: dict) -> List[dict]:
            members: List[dict] = []
            if not isinstance(item, dict):
                return members
            # Try common container keys for membership arrays
            containers = []
            for key in ("members", "characters", "smartcharacters", "smart_characters"):
                arr = item.get(key)
                if isinstance(arr, list) and arr:
                    containers.append(arr)
            for arr in containers:
                for m in arr:
                    if not isinstance(m, dict):
                        continue
                    address = m.get("address") or m.get("character_address") or m.get("id")
                    name = m.get("name") or m.get("character_name")
                    character_id = m.get("character_id")
                    role = m.get("role")
                    joined_at = m.get("joined_at") or m.get("joinedAt")
                    row = {
                        "tribe_id": tribe_id,
                        "address": str(address) if address is not None else None,
                        "character_id": int(character_id) if isinstance(character_id, (int,)) else (int(character_id) if isinstance(character_id, str) and character_id.isdigit() else None),
                        "name": name,
                        "role": role,
                        "joined_at": joined_at,
                    }
                    # Only accept rows with a usable address or character_id
                    if row["address"] or row["character_id"] is not None:
                        members.append(coerce_bigints(row))
            return members

        client = httpx.Client(base_url=base_url, timeout=30.0)
        try:
            new_last_id = None
            try:
                print(f"[tribe-members] processing {len(ids)} tribe ids; range=({ids[0]}..{ids[-1]})")
            except Exception:
                pass
            for tid in ids:
                try:
                    resp = client.get(f"/v2/tribes/{tid}")
                    resp.raise_for_status()
                    item = resp.json() or {}
                    item = coerce_bigints(item)
                    extracted = _extract_members(tid, item)
                    try:
                        print(f"[tribe-members] tribe {tid}: extracted {len(extracted)} members")
                    except Exception:
                        pass
                    for m in extracted:
                        yield m
                    if item_delay_ms > 0:
                        time.sleep(item_delay_ms / 1000.0)
                except Exception as e:
                    try:
                        print(f"[tribe-members] fetch/parse error id={tid}: {e}")
                    except Exception:
                        pass
                # Track the highest id we attempted
                try:
                    if new_last_id is None or tid > new_last_id:
                        new_last_id = tid
                except Exception:
                    pass
        finally:
            client.close()

        # Persist state cursor even if no rows yielded (so we progress)
        try:
            if ids:
                st = dlt.state()
                st["tribe_members_last_id"] = max(ids)
        except Exception:
            pass

    # Solarsystems details (batch)
    @dlt.resource(
        name="get_v_2_solarsystems_details_batch",
        table_name="solarsystems_details",
        primary_key="id",
        write_disposition="merge",
    )
    def get_v_2_solarsystems_details_batch():
        batch_size = int(os.getenv("SOLARSYSTEMS_BATCH_SIZE", "500"))
        item_delay_ms = int(os.getenv("SOLARSYSTEMS_DETAILS_DELAY_MS", "50"))
        schema = os.getenv("DATASET_NAME", "world_api_dlt")
        pg_host = os.getenv("POSTGRES_HOST", os.getenv("DESTINATION__POSTGRES__CREDENTIALS__HOST", "localhost"))
        pg_port = int(os.getenv("POSTGRES_PORT", os.getenv("DESTINATION__POSTGRES__CREDENTIALS__PORT", "5432")))
        pg_db = os.getenv("POSTGRES_DB", os.getenv("DESTINATION__POSTGRES__CREDENTIALS__DATABASE", "postgres"))
        pg_user = os.getenv("POSTGRES_USER", os.getenv("DESTINATION__POSTGRES__CREDENTIALS__USERNAME", "user"))
        pg_pass = os.getenv("POSTGRES_PASSWORD", os.getenv("DESTINATION__POSTGRES__CREDENTIALS__PASSWORD", "password"))

        sql = f"""
            SELECT s.id
            FROM {schema}.solarsystem s
            LEFT JOIN {schema}.solarsystems_details d ON d.id = s.id
            WHERE d.id IS NULL
            ORDER BY s.id
            LIMIT %s
        """

        ids: List[int] = []
        conn = None
        try:
            conn = psycopg.connect(host=pg_host, port=pg_port, dbname=pg_db, user=pg_user, password=pg_pass)
            with conn.cursor() as cur:
                cur.execute(sql, (batch_size,))
                rows = cur.fetchall() or []
                ids = [int(r[0]) for r in rows if r and r[0] is not None]
        except Exception as e:
            try:
                print(f"[solarsystem-batch] DB query failed: {e}")
            except Exception:
                pass
        finally:
            try:
                if conn is not None:
                    conn.close()
            except Exception:
                pass

        if not ids:
            return

        client = httpx.Client(base_url=base_url, timeout=30.0)
        try:
            for sid in ids:
                try:
                    resp = client.get(f"/v2/solarsystems/{sid}")
                    resp.raise_for_status()
                    item = resp.json() or {}
                    item = cast_coordinates_to_decimal(item)
                    item = coerce_bigints(item)
                    yield item
                    if item_delay_ms > 0:
                        time.sleep(item_delay_ms / 1000.0)
                except Exception as e:
                    try:
                        print(f"[solarsystem-batch] fetch error id={sid}: {e}")
                    except Exception:
                        pass
        finally:
            client.close()

    # Optional allow/deny overrides via env (comma-separated resource names)
    allow_env = os.getenv("FORCE_ALLOW_RESOURCES", "").strip()
    deny_env = os.getenv("FORCE_DENY_RESOURCES", "").strip()

    # Debug: pre-override list
    try:
        print("[cadence] pre-override:", [getattr(r, 'name', '?') for r in selected])
    except Exception:
        pass

    # If allowlist is provided, treat it as a hard override: run exactly those resources,
    # bypassing cadence gating. Also, if an allowed child has a declared parent in PARENT_DEP,
    # include the parent too (if present among configured resources).
    if allow_env:
        # Preserve user-declared order while deduplicating
        allow_entries = [s.strip() for s in allow_env.split(',') if s.strip()]
        allow_list: List[str] = []
        for name in allow_entries:
            if name not in allow_list:
                allow_list.append(name)

        registry: Dict[str, DltResource] = {}

        def _register_resource(res: DltResource) -> None:
            res_name = getattr(res, 'name', None)
            if not res_name:
                wrapped = getattr(res, '__wrapped__', None)
                res_name = getattr(wrapped, '__name__', None)
            if res_name:
                registry[res_name] = res

        # Primary REST-generated resources
        resources_attr = getattr(rest_resources_obj, 'resources', None)
        if isinstance(resources_attr, dict):
            for key, res in resources_attr.items():
                registry[key] = res
                _register_resource(res)
        elif resources_attr is not None:
            for res in resources_attr:
                _register_resource(res)
        else:
            for res in rest_resources_list:
                _register_resource(res)

        # Custom callables exposed by this module
        _register_resource(get_v_2_killmails)  # type: ignore[arg-type]
        _register_resource(get_v_2_smartassemblies_details_batch)  # type: ignore[arg-type]
        _register_resource(get_v_2_smartassemblies_flat_tail)  # type: ignore[arg-type]
        _register_resource(get_v_2_smartcharacters_details_batch)  # type: ignore[arg-type]
        _register_resource(get_v_2_tribes_details_batch)  # type: ignore[arg-type]
        _register_resource(get_v_2_solarsystems_details_batch)  # type: ignore[arg-type]
        _register_resource(get_v_2_tribe_members_batch)  # type: ignore[arg-type]

        selected = [registry[name] for name in allow_list if name in registry]

        if not selected:
            try:
                missing = [name for name in allow_list if name not in registry]
                if missing:
                    print("[cadence] allowlist unresolved:", missing)
            except Exception:
                pass

        try:
            print("[cadence] allowlist override:", allow_list)
        except Exception:
            pass

    if deny_env:
        deny_set = {s.strip() for s in deny_env.split(',') if s.strip()}
        selected = [r for r in selected if getattr(r, 'name', '') not in deny_set]
        try:
            print("[cadence] denylist applied:", sorted(deny_set))
        except Exception:
            pass

    # Final selection
    try:
        print("[cadence] final:", [getattr(r, 'name', '?') for r in selected])
    except Exception:
        pass

    return selected


