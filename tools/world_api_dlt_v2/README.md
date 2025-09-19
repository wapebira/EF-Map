EF-Map – World API dlt/OpenAPI Ingestion (scaffold)

What this is:
- A minimal ingestion script (ingest_openapi.py) that fetches one-shot JSON endpoints and upserts into Postgres schema world_api_dlt.
- Dependency-light (requests + psycopg2). If psycopg2 is missing, it runs in DRY-RUN and prints what it would insert.

Prereqs:
- Python 3.10+
- pip install requests psycopg2-binary (optional if you want DB writes)
- A Postgres DB (local) and env vars: PGHOST, PGUSER, PGPASSWORD, PGDATABASE, PGPORT

Setup:
1) Copy config.example.yaml to config.yaml and edit URLs/fields.
2) Install deps:
   - pip install requests psycopg2-binary pyyaml
3) Run (DRY-RUN if DB connect fails):
   - python tools/world_api_dlt_v2/ingest_openapi.py tools/world_api_dlt_v2/config.yaml

Schema:
- Tables are created under schema world_api_dlt if they don’t exist.
- Column types are inferred coarsely (bool/int/float/text).
- If pk is provided, upsert is used; otherwise insert-append.

Notes:
- This is a scaffold to replace legacy world_api_dlt pipeline; extend with paging/auth as needed.
- For paging, add a next-page loop using Link headers or page params.
