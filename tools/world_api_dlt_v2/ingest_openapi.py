#!/usr/bin/env python3
"""
EF-Map – World API dlt/OpenAPI Ingestion (scaffold)
- Reads endpoints from config (YAML/JSON)
- Fetches pages incrementally and writes to Postgres (psycopg2/sqlalchemy optional)
- Targets schema: world_api_dlt

This is a minimal, dependency-light scaffold to replace the legacy pipeline.
It does not include dlt; instead, it uses requests and psycopg2 directly to stay simple.

Assumptions:
- PostgreSQL connection via env vars (PGHOST, PGUSER, PGPASSWORD, PGDATABASE, PGPORT)
- Endpoints return JSON arrays or objects with a top-level list field.
- Idempotent upsert by a configured primary key where possible.
"""

import os
import sys
import json
import time
import typing as t
from dataclasses import dataclass

try:
    import requests
except ImportError:
    print("Missing dependency: requests. Install with 'pip install requests'", file=sys.stderr)
    sys.exit(2)

try:
    import psycopg2
    from psycopg2.extras import execute_values
except ImportError:
    psycopg2 = None  # Allow dry-run without DB

@dataclass
class Endpoint:
    name: str
    url: str
    method: str = "GET"
    items_path: t.Optional[str] = None  # None => root is the list
    pk: t.Optional[str] = None          # primary key field for upsert
    table: t.Optional[str] = None       # table name in world_api_dlt
    headers: t.Optional[dict] = None
    params: t.Optional[dict] = None

SCHEMA = "world_api_dlt"


def env(name: str, default: t.Optional[str] = None) -> t.Optional[str]:
    v = os.environ.get(name)
    return v if v is not None else default


def load_config(path: str) -> dict:
    with open(path, 'r', encoding='utf-8') as f:
        raw = f.read()
        if path.endswith('.json'):
            return json.loads(raw)
        try:
            import yaml  # optional
            return yaml.safe_load(raw)  # type: ignore
        except Exception:
            return json.loads(raw)


def ensure_schema_and_table(conn, table: str, sample_row: dict, pk: t.Optional[str]):
    cols = []
    for k, v in sample_row.items():
        if isinstance(v, bool):
            col = f'"{k}" boolean'
        elif isinstance(v, int):
            col = f'"{k}" bigint'
        elif isinstance(v, float):
            col = f'"{k}" double precision'
        elif v is None:
            col = f'"{k}" text'
        else:
            col = f'"{k}" text'
        cols.append(col)
    pk_sql = f", PRIMARY KEY (\"{pk}\")" if pk else ""
    ddl = f"CREATE SCHEMA IF NOT EXISTS {SCHEMA}; CREATE TABLE IF NOT EXISTS {SCHEMA}.\"{table}\" ({', '.join(cols)}{pk_sql});"
    with conn.cursor() as cur:
        cur.execute(ddl)
    conn.commit()


def upsert_rows(conn, table: str, rows: list[dict], pk: t.Optional[str]):
    if not rows:
        return
    # Align columns across rows
    keys = sorted({k for r in rows for k in r.keys()})
    values = [[r.get(k) for k in keys] for r in rows]
    cols_sql = ", ".join([f'"{k}"' for k in keys])
    table_sql = f'{SCHEMA}."{table}"'

    if pk and psycopg2:
        conflict = f'("{pk}")'
        set_list = ", ".join([f'"{k}" = EXCLUDED."{k}"' for k in keys if k != pk])
        sql = f"INSERT INTO {table_sql} ({cols_sql}) VALUES %s ON CONFLICT {conflict} DO UPDATE SET {set_list};"
        with conn.cursor() as cur:
            execute_values(cur, sql, values)
        conn.commit()
    elif psycopg2:
        # No PK – append only
        sql = f"INSERT INTO {table_sql} ({cols_sql}) VALUES %s;"
        with conn.cursor() as cur:
            execute_values(cur, sql, values)
        conn.commit()
    else:
        print(f"[DRY-RUN] Would insert {len(rows)} rows into {table_sql}")


def materialize(endpoint: Endpoint, session: requests.Session, conn):
    print(f"Fetching {endpoint.name} -> {endpoint.url}")
    resp = session.request(endpoint.method, endpoint.url, headers=endpoint.headers, params=endpoint.params, timeout=60)
    resp.raise_for_status()
    data = resp.json()
    if endpoint.items_path:
        for part in endpoint.items_path.split('.'):
            if isinstance(data, dict):
                data = data.get(part, [])
    items = data if isinstance(data, list) else [data]
    if not items:
        print(f"No items for {endpoint.name}")
        return
    # Ensure table exists based on first row
    if psycopg2 and conn:
        ensure_schema_and_table(conn, endpoint.table or endpoint.name, items[0], endpoint.pk)
        upsert_rows(conn, endpoint.table or endpoint.name, items, endpoint.pk)
    else:
        print(f"[DRY-RUN] {endpoint.name}: {len(items)} rows")


def main(argv: list[str]) -> int:
    if len(argv) < 2:
        print("Usage: ingest_openapi.py <config.(yaml|json)>")
        return 2
    cfg = load_config(argv[1])

    endpoints_cfg = cfg.get('endpoints', [])
    endpoints: list[Endpoint] = []
    for e in endpoints_cfg:
        endpoints.append(Endpoint(
            name=e['name'],
            url=e['url'],
            method=e.get('method', 'GET'),
            items_path=e.get('items_path'),
            pk=e.get('pk'),
            table=e.get('table'),
            headers=e.get('headers'),
            params=e.get('params'),
        ))

    conn = None
    if psycopg2:
        try:
            conn = psycopg2.connect(
                host=env('PGHOST', '127.0.0.1'),
                user=env('PGUSER', 'postgres'),
                password=env('PGPASSWORD', ''),
                dbname=env('PGDATABASE', 'postgres'),
                port=int(env('PGPORT', '5432')),
            )
        except Exception as e:
            print(f"[WARN] DB connect failed: {e}; continuing in DRY-RUN mode", file=sys.stderr)
            conn = None

    with requests.Session() as session:
        for ep in endpoints:
            try:
                materialize(ep, session, conn)
                time.sleep(0.2)
            except Exception as e:
                print(f"[ERROR] {ep.name}: {e}", file=sys.stderr)

    if conn:
        conn.close()
    return 0


if __name__ == '__main__':
    raise SystemExit(main(sys.argv))
