import os
import sys


def main() -> None:
    # Ensure project module path is available when executed inside the container
    # Ensure the directory that contains the 'worldapi' package is on sys.path
    # In the container, the code lives under /app/worldapi_pipeline
    if '/app/worldapi_pipeline' not in sys.path:
        sys.path.insert(0, '/app/worldapi_pipeline')

    try:
        from worldapi import worldapi_source  # type: ignore
    except Exception as e:
        print(f"[selcheck] import failed: {e}")
        return

    base = os.getenv('BASE_URL') or os.getenv('WORLDAPI_BASE_URL')
    print(f"[selcheck] base_url={base}")

    try:
        sel = worldapi_source(base_url=base)
    except Exception as e:
        print(f"[selcheck] worldapi_source error: {e}")
        return

    names: list[str] = []
    for r in sel:
        n = (
            getattr(r, 'name', None)
            or getattr(getattr(r, '__wrapped__', None), '__name__', None)
            or getattr(r, '__name__', None)
            or '?'
        )
        names.append(n)
    print("[selcheck] final_names=", names)


if __name__ == '__main__':
    main()
