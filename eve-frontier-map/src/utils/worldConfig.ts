// Lightweight client-side loader for worlds.json
// Caches the parsed JSON and provides accessor for a specific chain id.

export interface WorldDeployInfo {
  address: string;
  blockNumber: number | null;
}

let _cache: Record<string, WorldDeployInfo> | null = null;
let _inFlight: Promise<Record<string, WorldDeployInfo>> | null = null;

async function loadAll(): Promise<Record<string, WorldDeployInfo>> {
  if (_cache) return _cache;
  if (_inFlight) return _inFlight;
  _inFlight = fetch('/worlds.json', { cache: 'no-cache' })
    .then(async (r) => {
      if (!r.ok) throw new Error(`Failed to load worlds.json: ${r.status}`);
      const json = await r.json();
      _cache = json;
      return json;
    })
    .finally(() => {
      _inFlight = null;
    });
  return _inFlight;
}

export async function getWorldDeploy(chainId: number | string): Promise<WorldDeployInfo | null> {
  const all = await loadAll();
  const key = String(chainId);
  return all[key] || null;
}

export function clearWorldDeployCache() {
  _cache = null;
}
