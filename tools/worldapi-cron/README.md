# World API dlt Cron (Dockerized)

Runs the dlt-based World API pipeline on a fixed cadence using supercronic.

## Contents
- Dockerfile – Python 3.11 slim with supercronic, util-linux (flock), pg client
- cron.d/worldapi – schedule every 2 minutes
- run_pipeline.sh – wrapper with non-blocking lock and structured logs
- docker-compose.yml – attaches to the existing Postgres network and persists dlt state

## Prereqs
- The Postgres container is running on network `pg-indexer-reader_indexer-network` with alias `postgres` and credentials `user/password` on DB `postgres`.

## Build and run
```powershell
# From repo root
cd tools/worldapi-cron
docker compose build
docker compose up -d
# Tail logs
docker compose logs -f worldapi-cron
```

## Verify
- Logs show a tick every 2 minutes and either `done` or `skip overlap` lines
- In Grafana, world_api_dlt table counts advance
- Optional: inspect dlt state volume to confirm persistence

## Notes
- Adjust schedule in `cron.d/worldapi` if needed
- Pipeline entry is `/app/worldapi_pipeline/worldapi_pipeline.py` copied from `tools/worldapi-pipeline/worldapi/worldapi_pipeline`
- To change Postgres env, edit `docker-compose.yml`