import os
import json
import dlt

from worldapi import worldapi_source


def main():
    # Optional cap to keep a quick, bounded run (applies across selected resources)
    try:
        max_records = int(os.environ.get("MAX_RECORDS", "500"))
    except Exception:
        max_records = 500

    # Initialize pipeline to Postgres (credentials resolved via .dlt/config.toml + env)
    pipeline = dlt.pipeline(
        pipeline_name="worldapi_pipeline",
        destination="postgres",
        dataset_name="world_api_dlt",
        progress="log",
        export_schema_path="schemas/export",
    )

    # Build source and apply a total record cap to speed up materialization
    src = worldapi_source()
    if max_records > 0:
        src = src.add_limit(max_records)

    # Debug: list available resource names
    try:
        names = [getattr(r, "name", str(r)) for r in src.resources]  # type: ignore[attr-defined]
    except Exception:
        names = [getattr(r, "name", str(r)) for r in src]
    print("[debug] available resources:", names)

    # Select only killmails collection using with_resources
    wanted = ("get_v_2_killmails",)
    try:
        subset = src.with_resources(*wanted)  # type: ignore[attr-defined]
    except Exception:
        subset = None

    if subset is None:
        raise SystemExit("No killmails resources found via with_resources; verify worldapi_source configuration.")

    # Run ingestion for the selected resources only
    info = pipeline.run(subset)
    print(json.dumps(info, indent=2, default=str))


if __name__ == "__main__":
    # Optional safety: wipe temp working folder to avoid stale schema artifacts
    try:
        dlt.pipeline(pipeline_name="worldapi_pipeline", destination="postgres", dataset_name="world_api_dlt")._wipe_working_folder()  # type: ignore[attr-defined]
        print("[debug] wiped temporary working folder for pipeline")
    except Exception:
        pass
    main()
