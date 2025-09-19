# Agents Context – EF-Map

Purpose: Provide persistent, high-signal context and guardrails for agent mode in this repository. VS Code will automatically ingest this file (1.104+). Keep it short and link out for depth.

## Project quick facts
- What: EVE Frontier interactive map + data tools
- Frontend: `eve-frontier-map/` (React + TypeScript + Vite); served on Cloudflare Pages + Worker
- Backend: Cloudflare Worker with KV (shares + anonymous usage stats). No Netlify fallbacks (post-cutover)
- Data: Preprocessing scripts (Python) produce SQLite/JSON consumed by the app; local chain indexing via Primordium pg-indexer; Grafana (localhost:3000) is the canonical dashboard

Useful entry points:
- High-level rules and patterns: `.github/copilot-instructions.md`
- Operational decisions (newest first): `docs/decision-log.md`
- Cloudflare migration status & plan: `docs/archive/migration/MIGRATION_PLAN.md`, `docs/archive/migration/migration_status.json`
- Frontend root: `eve-frontier-map/` (see `src/App.tsx`, `src/utils/usage.ts`)
- Cloudflare Worker (API, KV, routing): `_worker.js` (+ any sibling worker files)

## Agent operating rules (must follow)
1) Prefer smallest safe change; don’t refactor broadly without explicit approval.
2) Cloudflare-first. Do NOT reintroduce Netlify. Any persistence change must target the existing Cloudflare Worker + KV abstraction.
3) CLI mandate for Cloudflare ops: When possible, run CLI commands yourself (Wrangler) and summarize results. Prompt user only for secret inputs. Never commit secrets. See `.github/copilot-instructions.md` → “Cloudflare Platform & CLI Preference”.
4) Usage metrics: Only emit via `eve-frontier-map/src/utils/usage.ts` and whitelist server-side. Avoid double-counting.
5) Workers & heavy compute: Keep algorithms in web workers; throttle progress ≤5Hz; respect cache invalidation rules in routing.
6) Sensitive edits: Treat worker files (`*_worker.js`, `_worker.js`) and production config as sensitive; ask before structural changes.
7) Database access: Use the VS Code Postgres extension (configured for the local Docker Postgres) for schema inspection and routine queries. Prefer this path over PowerShell `docker exec` to avoid nested quoting issues.

## Fast context to load on start
- Read `.github/copilot-instructions.md` (source of truth for patterns & guardrails)
- Skim last ~40 lines of `docs/decision-log.md` for current initiatives and recent incidents
- If touching metrics: also read Worker endpoint mappings where EVENT_MAP lives
- If touching routing: read `src/utils/routing_worker.ts` and related workers under `eve-frontier-map/`

## Common tasks & success criteria
- Stop legacy jobs (Windows): Use `tools/win/pause_world_api.ps1`; verify no scheduled tasks remain; log in decision log
- Cloudflare deploy preview: Build `eve-frontier-map`, deploy Pages preview, verify Worker endpoints (`/api/*`), no Netlify code added
- Add a new metric: client emit in `usage.ts`, server whitelist in Worker, optional Stats page panel, run typecheck/build
- Routing tweak: maintain identical path outputs unless explicitly requested; keep performance neutral or better

## Safety & boundaries
- Never commit secrets; use env vars or `.env.example` for placeholders
- Avoid large diffs (>150 LoC) or dependency adds without explicit approval
- If you need to create data migrations or bulk KV ops, create small scripts under `tools/` with a DRY_RUN flag and concise logs

## Links
- Cinematic mode spec: `CINEMATIC_MODE_SPEC.md`
- Requirements: `PROJECT_REQUIREMENTS.md`
- Repo README: `README.md`

— Keep this file concise. Update when operating rules or architecture materially change.
