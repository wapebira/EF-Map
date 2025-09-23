import os
import json
import time
from datetime import datetime, timezone

import psycopg


def write_heartbeat(
    *,
    ok: bool,
    pipeline_name: str,
    dataset_name: str,
    resources: list[str],
    started_at_ts: float,
    finished_at_ts: float | None = None,
    extra: dict | None = None,
) -> None:
    """
    Insert a minimal heartbeat row into Postgres to make job freshness visible in Grafana.

    Table: <dataset_name>.ingest_heartbeat
    Columns:
      pipeline_name text
      resources_json text
      ok boolean
      started_at timestamptz
      finished_at timestamptz
      duration_ms bigint
      extra_json text
    """
    schema = dataset_name or os.getenv("DATASET_NAME", "world_api_dlt")

    pg_host = os.getenv("POSTGRES_HOST", os.getenv("DESTINATION__POSTGRES__CREDENTIALS__HOST", "localhost"))
    pg_port = int(os.getenv("POSTGRES_PORT", os.getenv("DESTINATION__POSTGRES__CREDENTIALS__PORT", "5432")))
    pg_db = os.getenv("POSTGRES_DB", os.getenv("DESTINATION__POSTGRES__CREDENTIALS__DATABASE", "postgres"))
    pg_user = os.getenv("POSTGRES_USER", os.getenv("DESTINATION__POSTGRES__CREDENTIALS__USERNAME", "user"))
    pg_pass = os.getenv("POSTGRES_PASSWORD", os.getenv("DESTINATION__POSTGRES__CREDENTIALS__PASSWORD", "password"))

    started_at = datetime.fromtimestamp(started_at_ts, tz=timezone.utc)
    finished_ts = finished_at_ts if finished_at_ts is not None else time.time()
    finished_at = datetime.fromtimestamp(finished_ts, tz=timezone.utc)
    duration_ms = int(round((finished_ts - started_at_ts) * 1000))

    resources_json = json.dumps(resources or [])
    extra_json = json.dumps(extra or {})

    ddl = f"""
    CREATE TABLE IF NOT EXISTS {schema}.ingest_heartbeat (
      pipeline_name text NOT NULL,
      resources_json text NOT NULL,
      ok boolean NOT NULL,
      started_at timestamptz NOT NULL,
      finished_at timestamptz NOT NULL,
      duration_ms bigint NOT NULL,
      extra_json text NULL
    );
    """
    dml = f"""
    INSERT INTO {schema}.ingest_heartbeat
      (pipeline_name, resources_json, ok, started_at, finished_at, duration_ms, extra_json)
    VALUES (%s, %s, %s, %s, %s, %s, %s);
    """

    try:
        with psycopg.connect(host=pg_host, port=pg_port, dbname=pg_db, user=pg_user, password=pg_pass) as conn:
            with conn.cursor() as cur:
                cur.execute(ddl)
                cur.execute(
                    dml,
                    (
                        pipeline_name,
                        resources_json,
                        bool(ok),
                        started_at,
                        finished_at,
                        duration_ms,
                        extra_json,
                    ),
                )
                conn.commit()
                try:
                    print(f"[heartbeat] wrote row schema={schema} ok={ok} resources={len(resources or [])} duration_ms={duration_ms}")
                except Exception:
                    pass
    except Exception as e:
        # Heartbeat should never crash the job; log to stdout for visibility
        try:
            print(f"[heartbeat] write failed: {e}")
        except Exception:
            pass
