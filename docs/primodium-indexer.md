# Primodium PG Indexer – Pilot (Windows + Docker)

This document captures the setup, configuration, and operations for running the Primodium MUD Postgres-backed indexer locally, isolated from our existing indexer.

## Overview
- Components (compose):
  - postgres (16): stores decoded chain state
  - postgres-index-write (store-indexer writer): reads RPC and writes to Postgres
  - postgres-query-read (reader): Node service on port 3001 (internal by default)
- Adapter: `tools/pg-adapter/server.js` bridges to Postgres and exposes health + summary for our dashboards.

## Prereqs (Windows 11)
- BIOS virtualization enabled (AMD SVM/Intel VT-x)
- WSL2 and a distro (Ubuntu)
- Docker Desktop (WSL2 backend)

Helpers we added:
- `tools/win/enable_wsl2_features.ps1` – enables Windows features for WSL2
- `tools/win/start_docker_desktop.ps1` – launches Docker Desktop
- `tools/win/wait_for_docker_ready.ps1` – polls until engine is ready
- `tools/win/start_pg_indexer_stack.ps1` – builds/starts the Primodium stack

## Configure
The writer expects environment variables:
- `RPC_HTTP_URL` – chain RPC endpoint (e.g., http://host.docker.internal:8545)
- `DATABASE_URL` – fixed by compose to Postgres service (`postgres://user:password@postgres/postgres`)

Additional parameters we use/track (to be confirmed for your network):
- `CHAIN_ID` – numeric EVM chain id
- `WORLD_ADDRESS` – deployed World contract (0x...)
- `START_BLOCK` – block to start decoding from

Note: The stock compose doesnt include chain/world/startBlock; many MUD indexers infer from contracts/events. We will pass them via environment and log them for traceability once confirmed.

## Run
1) Start Docker Desktop and wait for engine:
   - `tools/win/start_docker_desktop.ps1`
   - `tools/win/wait_for_docker_ready.ps1`
2) Launch Primodium stack:
   - `tools/win/start_pg_indexer_stack.ps1`
3) Start adapter pointing at Primodium Postgres:
   - `tools/pg-adapter/start_adapter.ps1 -Port 8850 -PgUrl "postgres://user:password@127.0.0.1:5432/postgres"`

## Verify
- Containers: `docker ps` (postgres + writer + reader)
- Adapter:
  - `http://127.0.0.1:8850/health` → `{ ok:true, db:'up' }`
  - `http://127.0.0.1:8850/api/summary` → shows Postgres version and table count
- Writer logs (schema/init progress):
  - `docker logs pg-indexer-reader-postgres-index-write-1 --tail 200`

## Configure RPC/Network Parameters
Before indexing your world, confirm these values:
- RPC_HTTP_URL: <your RPC>
- CHAIN_ID: <number>
- WORLD_ADDRESS: <0x...>
- START_BLOCK: <number>

Well extend `start_pg_indexer_stack.ps1` to accept these and inject them as compose overrides. Until then:
- Set RPC (per-session):
  - PowerShell: `$env:RPC_HTTP_URL='http://host.docker.internal:8545'`
- Then rerun the stack script so the writer picks it up.

## Rollback
- Stop adapter: `tools/pg-adapter/stop_adapter.ps1`
- Stop Primodium stack: `docker compose -f C:\primodium-indexer\indexer-main\packages\pg-indexer-reader\docker-compose.local.yml down -v`
- Our original local indexer remains unchanged; no schema/app changes were made.

## Next Steps
- Add a small override to compose (or env file) to persist RPC/CHAIN/WORLD/START_BLOCK.
- Expose additional adapter endpoints mirroring our metrics once schema is available.
- Gate full indexing behind user-confirmed parameters.
