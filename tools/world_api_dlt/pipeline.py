"""
World API fast-cadence fetcher (no DB writes).

Fetches (collections, TTL-cached):
- /v2/solarsystems (Primodium V2 ID mapping)
- /v2/tribes
- /v2/types
- /v2/smartassemblies
- /v2/smartcharacters
- /v2/killmails

Rotating detail polling (change-only strategy over time):
- /v2/solarsystems/{id}
- /v2/tribes/{id}
- /v2/types/{id}        (daily cadence via rotation batch)
- /v2/smartcharacters/{address} (fast cadence via rotation batch)

Writes snapshots into scratch/world_api/*.json and maintains small state files:
- ids_*.json inventories (ID/address inventories with TTL)
- rotate_state.json (last index per entity for rotation)

Usage (Windows PowerShell):
	- tools/win/run_world_api_dlt_fast.ps1

Env:
	WORLD_API_BASE (default https://world-api-stillness.live.tech.evefrontier.com)
	WORLD_API_LIMIT_SOLARSYSTEMS (default 1000)
	WORLD_API_LIMIT_TRIBES (default 500)
	WORLD_API_LIMIT_TYPES (default 1000)
	# NOTE: fuels disabled (static; excluded to avoid dlt schema conflicts)
	WORLD_API_LIMIT_SMARTASSEMBLIES (default 1000)
	WORLD_API_LIMIT_SMARTCHARS (default 1000)
	WORLD_API_LIMIT_KILLMAILS (default 500)
	WORLD_API_TIMEOUT_MS (default 12000)
	WORLD_API_LIST_TTL_MIN (default 1440)  # minutes to keep ID list fresh before refresh
	WORLD_API_ROTATE_SOLARSYSTEMS (default 200) # detail polls per run
	WORLD_API_ROTATE_TRIBES (default 100)
	WORLD_API_ROTATE_TYPES (default 250)
	WORLD_API_ROTATE_SMARTCHARS (default 500)
	WORLD_API_DETAIL_THROTTLE_MS (default 0)   # sleep between detail requests
"""
from __future__ import annotations
import json, os, time, sys
from typing import Any, Dict, Iterable, List, Tuple
import urllib.request
import urllib.error

BASE = os.getenv("WORLD_API_BASE", "https://world-api-stillness.live.tech.evefrontier.com").rstrip("/")
LIMIT_SOL = int(os.getenv("WORLD_API_LIMIT_SOLARSYSTEMS", "1000"))
LIMIT_TRB = int(os.getenv("WORLD_API_LIMIT_TRIBES", "500"))
LIMIT_TYPES = int(os.getenv("WORLD_API_LIMIT_TYPES", "1000"))
LIMIT_FUELS = 0  # fuels disabled
LIMIT_SMARTASSEMBLIES = int(os.getenv("WORLD_API_LIMIT_SMARTASSEMBLIES", "1000"))
LIMIT_SMARTCHARS = int(os.getenv("WORLD_API_LIMIT_SMARTCHARS", "1000"))
LIMIT_KILLMAILS = int(os.getenv("WORLD_API_LIMIT_KILLMAILS", "500"))
TIMEOUT = int(os.getenv("WORLD_API_TIMEOUT_MS", "12000")) / 1000.0
POST_URL = os.getenv("WORKER_POST_URL", "").strip()  # optional: https://<env>/api/worldapi-update?openPreview=1
POST_TOKEN = os.getenv("WORKER_ADMIN_TOKEN", "").strip()
LIST_TTL_MIN = int(os.getenv("WORLD_API_LIST_TTL_MIN", "1440"))
ROTATE_SOL = int(os.getenv("WORLD_API_ROTATE_SOLARSYSTEMS", "200"))
ROTATE_TRB = int(os.getenv("WORLD_API_ROTATE_TRIBES", "100"))
ROTATE_TYPES = int(os.getenv("WORLD_API_ROTATE_TYPES", "250"))
ROTATE_SMARTCHARS = int(os.getenv("WORLD_API_ROTATE_SMARTCHARS", "500"))
DETAIL_THROTTLE = int(os.getenv("WORLD_API_DETAIL_THROTTLE_MS", "0")) / 1000.0

# Paths (filled in main once out_dir is resolved)
OUT_DIR = None  # type: ignore

def _out_path(name: str) -> str:
	assert OUT_DIR is not None
	return os.path.join(OUT_DIR, name)

def _http_get_json(path: str, params: Dict[str, Any] | None = None) -> Any:
	url = BASE + path
	if params:
		from urllib.parse import urlencode
		sep = "&" if ("?" in url) else "?"
		url = url + sep + urlencode(params)
	req = urllib.request.Request(url, headers={"Accept": "application/json"})
	with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
		data = resp.read()
		# handle BOM defensively
		if data and len(data) >= 3 and data[:3] == b"\xef\xbb\xbf":
			data = data[3:]
		return json.loads(data.decode("utf-8"))

def _paginated(endpoint: str, page_size: int) -> Iterable[List[Dict[str, Any]]]:
	page = 1
	while True:
		try:
			j = _http_get_json(endpoint, {"page": page, "limit": page_size})
		except urllib.error.HTTPError as e:
			raise RuntimeError(f"HTTP {e.code} for {endpoint} page {page}")
		except Exception as e:
			raise RuntimeError(f"Fetch failed for {endpoint} page {page}: {e}")
		items = j if isinstance(j, list) else (j.get("items") or j.get("data") or [])
		if not items:
			break
		yield items
		if len(items) < page_size:
			break
		page += 1

def fetch_solarsystems() -> List[Dict[str, Any]]:
	all_items: List[Dict[str, Any]] = []
	for chunk in _paginated("/v2/solarsystems", LIMIT_SOL):
		all_items.extend(chunk)
	return all_items

def fetch_tribes() -> List[Dict[str, Any]]:
	all_items: List[Dict[str, Any]] = []
	for chunk in _paginated("/v2/tribes", LIMIT_TRB):
		all_items.extend(chunk)
	return all_items

def fetch_types() -> List[Dict[str, Any]]:
	all_items: List[Dict[str, Any]] = []
	for chunk in _paginated("/v2/types", LIMIT_TYPES):
		all_items.extend(chunk)
	return all_items

def fetch_fuels() -> List[Dict[str, Any]]:
	# disabled: return empty list
	return []

def fetch_smartassemblies() -> List[Dict[str, Any]]:
	all_items: List[Dict[str, Any]] = []
	for chunk in _paginated("/v2/smartassemblies", LIMIT_SMARTASSEMBLIES):
		all_items.extend(chunk)
	return all_items

def fetch_smartcharacters() -> List[Dict[str, Any]]:
	all_items: List[Dict[str, Any]] = []
	for chunk in _paginated("/v2/smartcharacters", LIMIT_SMARTCHARS):
		all_items.extend(chunk)
	return all_items

def fetch_killmails() -> List[Dict[str, Any]]:
	all_items: List[Dict[str, Any]] = []
	for chunk in _paginated("/v2/killmails", LIMIT_KILLMAILS):
		all_items.extend(chunk)
	return all_items

def _now_iso() -> str:
	return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())

def _file_age_minutes(path: str) -> float:
	try:
		st = os.stat(path)
		return max(0.0, (time.time() - st.st_mtime) / 60.0)
	except FileNotFoundError:
		return 1e9

def _load_json(path: str, default: Any) -> Any:
	try:
		with open(path, "r", encoding="utf-8") as f:
			return json.load(f)
	except Exception:
		return default

def _save_json(path: str, obj: Any) -> None:
	tmp = path + ".tmp"
	with open(tmp, "w", encoding="utf-8") as f:
		json.dump(obj, f, ensure_ascii=False)
	os.replace(tmp, path)

def _ensure_dir(p: str) -> None:
	if not os.path.isdir(p):
		os.makedirs(p, exist_ok=True)

def _ensure_outdir(p: str) -> None:
	global OUT_DIR
	OUT_DIR = os.path.normpath(p)
	_ensure_dir(OUT_DIR)
	_ensure_dir(os.path.join(OUT_DIR, "detail"))

def _refresh_id_list(entity: str, items: List[Dict[str, Any]], id_field: str) -> List[Any]:
	ids = []
	for it in items:
		if id_field in it:
			ids.append(it[id_field])
	_save_json(_out_path(f"ids_{entity}.json"), {"ids": ids, "updatedAt": _now_iso(), "count": len(ids)})
	return ids

def _get_ids_with_ttl(entity: str, fetch_fn, id_field: str, limit_hint: int) -> Tuple[List[Any], bool]:
	"""Return (ids, refreshed) where refreshed=True if we just fetched from API."""
	ids_path = _out_path(f"ids_{entity}.json")
	# If stale or missing, fetch full list (paged)
	if _file_age_minutes(ids_path) > LIST_TTL_MIN:
		items = fetch_fn()
		ids = _refresh_id_list(entity, items, id_field)
		# Optional: store raw snapshot for operator visibility
		raw_path = _out_path(f"raw_{entity}.json")
		_save_json(raw_path, items)
		return ids, True
	data = _load_json(ids_path, {"ids": []})
	ids = list(data.get("ids", []))
	return ids, False

def _sleep_throttle():
	if DETAIL_THROTTLE > 0:
		time.sleep(DETAIL_THROTTLE)

def fetch_solarsystem_detail(sys_id: Any) -> Dict[str, Any]:
	return _http_get_json(f"/v2/solarsystems/{sys_id}")

def fetch_tribe_detail(tribe_id: Any) -> Dict[str, Any]:
	return _http_get_json(f"/v2/tribes/{tribe_id}")

def fetch_type_detail(type_id: Any) -> Dict[str, Any]:
	return _http_get_json(f"/v2/types/{type_id}")

def fetch_smartchar_detail(address: Any) -> Dict[str, Any]:
	return _http_get_json(f"/v2/smartcharacters/{address}")

def _rotate(entity: str, ids: List[Any], batch: int, fetch_detail_fn) -> Dict[str, Any]:
	"""Poll a rotating slice of ids and return stats: { polled, ok, errors }.
	Updates rotate_state.json with next start index.
	"""
	state_path = _out_path("rotate_state.json")
	state = _load_json(state_path, {})
	cur = int(state.get(entity, 0) or 0)
	n = len(ids)
	if n == 0 or batch <= 0:
		return {"polled": 0, "ok": 0, "errors": 0}
	# Bound batch to n
	batch = min(batch, n)
	ok = 0
	errors = 0
	polled = 0
	# Compute slice [cur, cur+batch) with wrap
	idxs = list(range(cur, cur + batch))
	for k in idxs:
		i = k % n
		idv = ids[i]
		try:
			_ = fetch_detail_fn(idv)
			ok += 1
		except Exception:
			errors += 1
		polled += 1
		_sleep_throttle()
	# Advance cursor
	state[entity] = (cur + batch) % n
	_save_json(state_path, state)
	# Store a tiny log for this run
	_save_json(_out_path(f"detail/last_{entity}.json"), {"ts": _now_iso(), "start": cur, "batch": batch, "n": n, "ok": ok, "errors": errors})
	return {"polled": polled, "ok": ok, "errors": errors}

def _atomic_write_json(path: str, obj: Any) -> None:
	tmp = path + ".tmp"
	with open(tmp, "w", encoding="utf-8") as f:
		json.dump(obj, f, ensure_ascii=False)
	os.replace(tmp, path)

def main(argv: List[str]) -> int:
	out_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)), "..", "scratch", "world_api")
	_ensure_outdir(out_dir)

	t0 = time.time()

	# Load or refresh ID inventories (TTL-based)
	sol_ids, sol_refreshed = _get_ids_with_ttl("solarsystems", fetch_solarsystems, "id", LIMIT_SOL)
	trb_ids, trb_refreshed = _get_ids_with_ttl("tribes", fetch_tribes, "id", LIMIT_TRB)
	typ_ids, typ_refreshed = _get_ids_with_ttl("types", fetch_types, "id", LIMIT_TYPES)
	sch_ids, sch_refreshed = _get_ids_with_ttl("smartcharacters", fetch_smartcharacters, "address", LIMIT_SMARTCHARS)

	# Collections that we only count (no details): smartassemblies, killmails (fuels disabled)
	fuels_items = []  # fuels disabled
	smartassemblies_items = []
	killmails_items = []
	try:
		smartassemblies_items = fetch_smartassemblies()
	except Exception:
		smartassemblies_items = []
	try:
		killmails_items = fetch_killmails()
	except Exception:
		killmails_items = []

	# If we refreshed inventories this run, also write the full raw snapshots (done in _get_ids_with_ttl)
	# Perform rotating detail polling
	sol_detail_stats = _rotate("solarsystems", sol_ids, ROTATE_SOL, fetch_solarsystem_detail)
	trb_detail_stats = _rotate("tribes", trb_ids, ROTATE_TRB, fetch_tribe_detail)
	typ_detail_stats = _rotate("types", typ_ids, ROTATE_TYPES, fetch_type_detail)
	sch_detail_stats = _rotate("smartcharacters", sch_ids, ROTATE_SMARTCHARS, fetch_smartchar_detail)

	meta = {
		"base": BASE,
		"limits": {
			"solarsystems": LIMIT_SOL,
			"tribes": LIMIT_TRB,
			"types": LIMIT_TYPES,
			# "fuels": LIMIT_FUELS,  # disabled
			"smartassemblies": LIMIT_SMARTASSEMBLIES,
			"smartcharacters": LIMIT_SMARTCHARS,
			"killmails": LIMIT_KILLMAILS,
		},
		"generatedAt": _now_iso(),
		"durMs": int((time.time() - t0) * 1000),
		"counts": {
			# inventories (unique total known)
			"solarsystems": len(sol_ids),
			"tribes": len(trb_ids),
			"types": len(typ_ids),
			"smartcharacters": len(sch_ids),
			# pure collection counts (fetched this run)
			# "fuels": len(fuels_items),  # disabled
			"smartassemblies": len(smartassemblies_items),
			"killmails": len(killmails_items),
			# details polled in this run
			"solarsystems_detail_polled": sol_detail_stats.get("polled", 0),
			"solarsystems_detail_ok": sol_detail_stats.get("ok", 0),
			"solarsystems_detail_err": sol_detail_stats.get("errors", 0),
			"tribes_detail_polled": trb_detail_stats.get("polled", 0),
			"tribes_detail_ok": trb_detail_stats.get("ok", 0),
			"tribes_detail_err": trb_detail_stats.get("errors", 0),
			"types_detail_polled": typ_detail_stats.get("polled", 0),
			"types_detail_ok": typ_detail_stats.get("ok", 0),
			"types_detail_err": typ_detail_stats.get("errors", 0),
			"smartcharacters_detail_polled": sch_detail_stats.get("polled", 0),
			"smartcharacters_detail_ok": sch_detail_stats.get("ok", 0),
			"smartcharacters_detail_err": sch_detail_stats.get("errors", 0),
		},
		"refreshed": {
			"solarsystems": sol_refreshed,
			"tribes": trb_refreshed,
			"types": typ_refreshed,
			"smartcharacters": sch_refreshed,
		},
	}

	_atomic_write_json(_out_path("meta.json"), meta)
	print(json.dumps(meta))

	# Optional: POST counts to worker for dashboard
	if POST_URL:
		try:
			payload = json.dumps({"counts": meta["counts"], "base": BASE, "updatedAt": meta["generatedAt"]}).encode("utf-8")
			req = urllib.request.Request(POST_URL, data=payload, headers={"Content-Type": "application/json"})
			if POST_TOKEN:
				req.add_header("X-Indexer-Admin", POST_TOKEN)
			with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
				_ = resp.read()  # ignore body
		except Exception as e:
			print(f"warn: post_failed: {e}", file=sys.stderr)
	return 0

if __name__ == "__main__":
	raise SystemExit(main(sys.argv))

