import os
import sys

# Ensure package path
BASE_DIR = os.path.dirname(__file__)
if BASE_DIR not in sys.path:
    sys.path.insert(0, BASE_DIR)

from worldapi import worldapi_source  # noqa: E402


def main() -> int:
    src = worldapi_source()
    res = getattr(src, "resources", src)
    names = [getattr(r, "name", str(r)) for r in res]
    print("SELECTED=", names)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
