# Primordium PG Indexer – Pilot (Windows + Docker)

This document captures the setup, configuration, and operations for running the Primordium MUD Postgres-backed indexer locally, isolated from our existing indexer.

## Overview
- Components (Docker Compose):
  - **postgres (16)** – stores decoded chain state
  - **postgres-index-write** – Primordium store-indexer writer (reads RPC, writes to Postgres)
  - **postgres-query-read** – Node service on port 3001 (internal by default)
- Adapter: `tools/pg-adapter/server.js` bridges to Postgres and exposes health + summary for our dashboards.

## Prerequisites (Windows 11)
- BIOS virtualization enabled (AMD SVM / Intel VT-x)
- WSL2 with at least one distro (Ubuntu recommended)
- Docker Desktop (WSL2 backend)

Helpers we added:
- `tools/win/enable_wsl2_features.ps1` – enables Windows features required for WSL2
- `tools/win/start_docker_desktop.ps1` – launches Docker Desktop
- `tools/win/wait_for_docker_ready.ps1` – polls until the Docker engine is ready
- `tools/win/start_pg_indexer_stack.ps1` – builds/starts the Primordium stack

## Configure
The writer expects environment variables:
- `RPC_HTTP_URL` – chain RPC endpoint (e.g., `http://host.docker.internal:8545`)
- `DATABASE_URL` – fixed by compose to Postgres service (`postgres://user:password@postgres/postgres`)

Additional parameters we use/track (confirm for your network):
- `CHAIN_ID` – numeric EVM chain id
- `WORLD_ADDRESS` – deployed World contract (`0x...`)
- `START_BLOCK` – block to start decoding from

Tuning knobs (finality/throughput):
- `FOLLOW_BLOCK_TAG` – one of `latest` | `safe` | `finalized`. Controls which head the indexer chases. Use `finalized` for maximum stability; `safe` if supported and you need slightly fresher data with limited reorg exposure.
- `POLLING_INTERVAL` – milliseconds for the viem public client polling cadence. Lower for faster detection of new blocks; stay within RPC rate limits (e.g., 2000–4000 ms).
- `MAX_BLOCK_RANGE` – number of blocks per batch request when backfilling/catching up.

Note: The stock compose file does not include chain/world/startBlock values; many MUD indexers infer them from contracts/events. We provide them via environment variables and log for traceability once confirmed.

## Run
1. Start Docker Desktop and wait for the engine:
   - `tools/win/start_docker_desktop.ps1`
   - `tools/win/wait_for_docker_ready.ps1`
2. Launch the Primordium stack:
   - `tools/win/start_pg_indexer_stack.ps1`
   - Optional flags (override env to control indexing behavior):
     - `-RpcHttpUrl`, `-ChainId`, `-WorldAddress`, `-StartBlock`
     - `-FollowBlockTag latest|safe|finalized`
     - `-PollingIntervalMs <ms>` (e.g., `2000`)
     - `-MaxBlockRange <n>` (e.g., `500` or `1000` depending on your RPC)

   Example to target near-finality (~6 blocks behind on many networks):
   ```powershell
   tools/win/start_pg_indexer_stack.ps1 -FollowBlockTag finalized -PollingIntervalMs 2000 -MaxBlockRange 1000
   ```
3. Start the adapter pointing at Primordium Postgres:
   - `tools/pg-adapter/start_adapter.ps1 -Port 8850 -PgUrl "postgres://user:password@127.0.0.1:5432/postgres"`

## Verify
- Containers: `docker ps` (expect postgres + writer + reader)
- Adapter endpoints:
  - `http://127.0.0.1:8850/health` → `{ ok: true, db: 'up' }`
  - `http://127.0.0.1:8850/api/summary` → Postgres version and table count
- Writer logs (schema/init progress):
  - `docker logs pg-indexer-reader-postgres-index-write-1 --tail 200`

## Configure RPC / Network Parameters
Before indexing your world, confirm these values:
- `RPC_HTTP_URL`: `<your RPC>`
- `CHAIN_ID`: `<number>`
- `WORLD_ADDRESS`: `<0x…>`
- `START_BLOCK`: `<number>`

The `start_pg_indexer_stack.ps1` script accepts these parameters and writes a Docker Compose override that injects them as environment variables for the writer and reader services. You can also set them via `$env:` variables before running the script, but flags are preferred for repeatability.

## Rollback
- Stop adapter: `tools/pg-adapter/stop_adapter.ps1`
- Stop Primordium stack: `docker compose -f C:\primordium-indexer\indexer-main\packages\pg-indexer-reader\docker-compose.local.yml down -v`
- Our original local indexer remains unchanged; no schema/app changes were made.

## Next Steps
- Add a small override to compose (or env file) to persist RPC / CHAIN / WORLD / START_BLOCK.
- Expose additional adapter endpoints mirroring our metrics once schema is available.
- Gate full indexing behind user-confirmed parameters.
