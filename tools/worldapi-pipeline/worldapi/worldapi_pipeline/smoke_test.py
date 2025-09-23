import json
import dlt
from worldapi import worldapi_source

if __name__ == "__main__":
    # Prefer Postgres (credentials from .dlt/config.toml + secrets.toml); fall back to DuckDB only if PG init fails.
    try:
        pipeline = dlt.pipeline(
            pipeline_name="worldapi_pipeline",
            destination="postgres",
            dataset_name="world_api_dlt",
            progress="log",
        )
        print("[smoke] Using destination: postgres (world_api_dlt)")
    except Exception as e:
        print(f"[smoke][warn] Postgres init failed: {e}\n[smoke] Falling back to DuckDB (local file).")
        pipeline = dlt.pipeline(
            pipeline_name="worldapi_pipeline_local",
            destination="duckdb",
            dataset_name="world_api_dlt",
            progress="log",
        )
    source = worldapi_source()
    source.add_limit(5)
    info = pipeline.run(source)
    print(json.dumps(info, indent=2, default=str))
