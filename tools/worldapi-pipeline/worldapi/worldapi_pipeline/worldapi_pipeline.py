import os
import sys
import time
import logging
import inspect
import dlt

from worldapi import worldapi_source
from heartbeat import write_heartbeat


if __name__ == "__main__":
    # Reduce log verbosity: silence dlt INFO pagination chatter in cron logs
    try:
        logging.getLogger("dlt").setLevel(logging.WARNING)
        logging.getLogger("httpx").setLevel(logging.WARNING)
    except Exception:
        pass
    # Make name/dataset configurable so we can run multiple pipelines safely in parallel
    PIPELINE_NAME = os.getenv("PIPELINE_NAME", "worldapi_pipeline")
    DATASET_NAME = os.getenv("DATASET_NAME", "world_api_dlt")

    print(f"[debug] starting pipeline name={PIPELINE_NAME} dataset={DATASET_NAME}", flush=True)
    try:
        print(f"[debug] cwd={os.getcwd()}", flush=True)
        print(f"[debug] sys.path[0:5]={[p for p in sys.path[0:5]]}", flush=True)
    except Exception:
        pass
    started_ts = time.time()

    # Optional safety: clear any previous incomplete load packages to avoid schema artifacts
    try:
        dlt.pipeline(pipeline_name=PIPELINE_NAME, destination='postgres', dataset_name=DATASET_NAME)._wipe_working_folder()  # type: ignore[attr-defined]
        print("[debug] wiped temporary working folder for pipeline")
    except Exception:
        pass

    pipeline = dlt.pipeline(
        pipeline_name=PIPELINE_NAME,
        destination='postgres',
        dataset_name=DATASET_NAME,
        progress=None,
        export_schema_path="schemas/export"
    )

    # Show env allow/deny upfront
    try:
        print(f"[debug] FORCE_ALLOW_RESOURCES={os.getenv('FORCE_ALLOW_RESOURCES','').strip()} FORCE_DENY_RESOURCES={os.getenv('FORCE_DENY_RESOURCES','').strip()}", flush=True)
    except Exception:
        pass

    # Resolve worldapi module location for sanity
    try:
        import worldapi as _worldapi_mod  # type: ignore
        print(f"[debug] worldapi module file={inspect.getfile(_worldapi_mod)}", flush=True)
    except Exception:
        pass

    source = worldapi_source()

    # Debug: list configured resource names to verify expected set
    try:
        # DltSource is iterable: yields resources
        resource_iter = getattr(source, 'resources', None)  # type: ignore[attr-defined]
        if resource_iter is None:
            resource_iter = source  # fallback to iterating the source itself
        resource_names = [getattr(r, 'name', str(r)) for r in resource_iter]
    except Exception:
        resource_names = []
    print("[debug] worldapi_source resources:", resource_names, flush=True)

    # Run the pipeline
    ok = True
    resources_for_hb = resource_names
    # Safeguard: if FORCE_ALLOW_RESOURCES is set but nothing was selected, abort to avoid empty runs
    try:
        if os.getenv('FORCE_ALLOW_RESOURCES', '').strip() and not resource_names:
            print("[error] FORCE_ALLOW_RESOURCES set but selection is empty – aborting run", flush=True)
            raise SystemExit(2)
    except Exception:
        pass
    try:
        info = pipeline.run(source)
        print(info, flush=True)
    except Exception as e:
        ok = False
        print(f"[error] pipeline.run failed: {e}")
        raise
    finally:
        try:
            write_heartbeat(
                ok=ok,
                pipeline_name=PIPELINE_NAME,
                dataset_name=DATASET_NAME,
                resources=resources_for_hb,
                started_at_ts=started_ts,
            )
        except Exception:
            pass

