import os
import sys
import types


def main() -> None:
    # Stub the rest_api module before importing worldapi to avoid heavy init
    if 'rest_api' not in sys.modules:
        rest_api_mod = types.ModuleType('rest_api')
        def _rest_api_source(cfg):  # noqa: ANN001
            # Return an empty iterable; worldapi_source will still add custom resources
            return []
        rest_api_mod.rest_api_source = _rest_api_source  # type: ignore[attr-defined]
        sys.modules['rest_api'] = rest_api_mod
        # Also provide rest_api.typing with a placeholder RESTAPIConfig
        typing_mod = types.ModuleType('rest_api.typing')
        class RESTAPIConfig(dict):  # minimal placeholder to satisfy type import
            pass
        typing_mod.RESTAPIConfig = RESTAPIConfig  # type: ignore[attr-defined]
        sys.modules['rest_api.typing'] = typing_mod

    # Ensure the code path is importable
    if '/app/worldapi_pipeline' not in sys.path:
        sys.path.insert(0, '/app/worldapi_pipeline')

    try:
        from worldapi import worldapi_source  # type: ignore
    except Exception as e:  # pragma: no cover - diagnostic
        print(f"[selcheck-stub] import failed: {e}")
        return

    base = os.getenv('BASE_URL') or os.getenv('WORLDAPI_BASE_URL')
    print(f"[selcheck-stub] base_url={base}")

    try:
        sel = worldapi_source(base_url=base)
    except Exception as e:  # pragma: no cover - diagnostic
        print(f"[selcheck-stub] source error: {e}")
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
    print('[selcheck-stub] final_names=', names)


if __name__ == '__main__':
    main()
