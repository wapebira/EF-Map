import os
import sys
import logging
import inspect


def main() -> None:
    # Reduce noisy INFO logs from dlt/httpx so our markers are visible
    try:
        logging.getLogger("dlt").setLevel(logging.WARNING)
        logging.getLogger("httpx").setLevel(logging.WARNING)
    except Exception:
        pass

    try:
        print("[debug] stub: selection introspection starting", flush=True)
        print(f"[debug] stub: cwd={os.getcwd()}", flush=True)
        print(f"[debug] stub: sys.path[0:5]={[p for p in sys.path[0:5]]}", flush=True)
        print(
            f"[debug] stub: FORCE_ALLOW_RESOURCES={os.getenv('FORCE_ALLOW_RESOURCES','').strip()} FORCE_DENY_RESOURCES={os.getenv('FORCE_DENY_RESOURCES','').strip()}",
            flush=True,
        )
    except Exception:
        pass

    # Import worldapi source and print module location for sanity
    try:
        import worldapi as _worldapi_mod  # type: ignore
        print(f"[debug] stub: worldapi module file={inspect.getfile(_worldapi_mod)}", flush=True)
    except Exception:
        pass

    try:
        from worldapi import worldapi_source  # type: ignore
        src = worldapi_source()
        # Iterate source/resources to get names; tolerate various dlt versions
        res_iter = getattr(src, "resources", None)
        if res_iter is None:
            res_iter = src
        names = [getattr(r, "name", str(r)) for r in res_iter]
        print("[debug] stub: worldapi_source resources:", names, flush=True)
    except Exception as e:
        print(f"[debug] stub: selection introspection failed: {e}", flush=True)


if __name__ == "__main__":
    main()
