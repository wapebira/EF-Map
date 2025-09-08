# EVE Frontier Map Frontend

This directory contains the client application: React + TypeScript + Vite, Three.js custom shaders, in‑browser SQLite (`sql.js`) and web workers for routing / optimization.

## Quick Start
```
npm install
npm run dev
# open http://localhost:5173
```

Production build:
```

```

The Worker scripts and KV bindings are defined at the repo root; build copies worker entries into `dist/`.

## Key Paths
* `src/App.tsx` – scene + global state wiring
* `src/utils/usage.ts` – single source of usage events
* `src/workers/` – routing / optimization logic off main thread
* `public/` – static assets (DB, wasm, media)

## Deployment
Production deploys are performed from repo root via Cloudflare Pages (`wrangler pages deploy`). This sub‑README is intentionally minimal; see root `README.md` for full architecture and data pipeline details.

## Notes
* Legacy `netlify/functions/` retained only for historical reference (no runtime use post‑cutover).
* UTF‑8 BOM stripping for stats snapshots handled server‑side (no client change needed).

Refer to the root README and `docs/decision-log.md` for deeper implementation notes.
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
