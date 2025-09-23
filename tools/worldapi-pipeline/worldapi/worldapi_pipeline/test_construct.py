from worldapi import worldapi_source

def main():
    s = worldapi_source()
    try:
        resources = list(getattr(s, 'resources'))
    except Exception:
        resources = list(s)
    names = [getattr(r, 'name', type(r).__name__) for r in resources]
    print('resource_count', len(resources))
    print('first_resources', names[:8])

if __name__ == '__main__':
    main()
