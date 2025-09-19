World API – Fast Cadence Fetcher

Purpose
- Fetch lightweight World API resources at a faster cadence to support near-real-time enrichment without touching chain/RPC indexing.
- Fast set now includes collections and rotating details for: solarsystems, tribes, types, fuels, smartassemblies, smartcharacters, killmails.

Outputs
- JSON snapshots written under scratch/world_api/ (created if missing):
	- scratch/world_api/raw_*.json for collections refreshed on TTL
	- scratch/world_api/ids_*.json (inventories with updatedAt + count)
	- scratch/world_api/detail/last_*.json (most recent rotation batch summary)
	- scratch/world_api/rotate_state.json (rotation cursors)
	- scratch/world_api/meta.json (counts + metadata)

Configuration
- Env vars (defaults shown):
	- WORLD_API_BASE=https://world-api-stillness.live.tech.evefrontier.com
	- WORLD_API_TIMEOUT_MS=12000
	- WORLD_API_LIST_TTL_MIN=1440
	- Limits: WORLD_API_LIMIT_SOLARSYSTEMS=1000, WORLD_API_LIMIT_TRIBES=500, WORLD_API_LIMIT_TYPES=1000, WORLD_API_LIMIT_FUELS=500, WORLD_API_LIMIT_SMARTASSEMBLIES=1000, WORLD_API_LIMIT_SMARTCHARS=1000, WORLD_API_LIMIT_KILLMAILS=500
	- Rotation batch sizes: WORLD_API_ROTATE_SOLARSYSTEMS=200, WORLD_API_ROTATE_TRIBES=100, WORLD_API_ROTATE_TYPES=250, WORLD_API_ROTATE_SMARTCHARS=500
	- WORLD_API_DETAIL_THROTTLE_MS=0 (sleep between detail requests)

Run (Windows PowerShell)
- Fast cadence (all currently supported collections + rotations):
	- tools/win/run_world_api_dlt_fast.ps1

Push counts to dashboard (optional)
- Set WORKER_POST_URL to your worker endpoint (e.g., https://<your-site>/api/worldapi-update?openPreview=1)
- Set WORKER_ADMIN_TOKEN if your worker requires X-Indexer-Admin
- Or pass via runner:
	- tools/win/run_world_api_dlt_fast.ps1 -WorkerPostUrl "https://<your-site>/api/worldapi-update?openPreview=1" -WorkerAdminToken "<token>"

Automate on Windows (optional)
- Create a scheduled task that runs the fast fetch every N minutes (defaults to 5):
	- tools/win/schedule_world_api_dlt.ps1 -Register -EveryMinutes 5
	- To remove the task later: tools/win/schedule_world_api_dlt.ps1 -Remove

Notes
- This script uses simple HTTP pagination heuristics (page & limit). If the API switches to cursor-based pagination, we will adapt here.
- No DB writes occur; outputs are consumable by the indexer enrichment step.
- Safe to run repeatedly; files are overwritten atomically (write temp file then rename).

