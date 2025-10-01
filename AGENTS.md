# Agents Context – EF-Map

Purpose: Provide persistent, high-signal context and guardrails for agent mode in this repository. VS Code will automatically ingest this file (1.104+). Keep it short and link out for depth.

## Workflow primer (GPT-5 Codex)
- Start every reply with a brief acknowledgement plus a high-level plan.
- Manage work through the todo list tool with exactly one item `in-progress`; update statuses as soon as tasks start or finish.
- Report status as deltas—highlight what changed since the last message instead of repeating full plans.
- Run fast verification steps yourself when feasible and note any gates you couldn’t execute.

## Project quick facts
- What: EVE Frontier interactive map + data tools
- Frontend: `eve-frontier-map/` (React + TypeScript + Vite); served on Cloudflare Pages + Worker
- Backend: Cloudflare Worker with KV (shares + anonymous usage stats). No Netlify fallbacks (post-cutover)
- Data: Preprocessing scripts (Python) produce SQLite/JSON consumed by the app; local chain indexing via Primordium pg-indexer; Grafana (localhost:3000) is the canonical dashboard
- Tooling: Chrome DevTools MCP server (`chrome-devtools`) is pre-installed for VS Code Copilot. It launches an isolated Chrome profile for traces/screenshots/automation—keep it clear of secrets and close sessions once finished.

Useful entry points:
- **LLM Troubleshooting Guide**: `docs/LLM_TROUBLESHOOTING_GUIDE.md` (comprehensive orientation: architecture, components, data flows, credentials reference, common diagnostic paths)
- **Local environment**: `docs/LOCAL_ENVIRONMENT.md` (gitignored - Postgres/Grafana credentials for local dev)
- High-level rules and patterns: `.github/copilot-instructions.md`
- Operational decisions (newest first): `docs/decision-log.md`
- Cloudflare migration status & plan: `docs/archive/migration/MIGRATION_PLAN.md`, `docs/archive/migration/migration_status.json`
- Frontend root: `eve-frontier-map/` (see `src/App.tsx`, `src/utils/usage.ts`)
- Cloudflare Worker (API, KV, routing): `_worker.js` (+ any sibling worker files)
- Data Exposure Plan (current initiative): `docs/initiatives/DATA_EXPOSURE_PLAN.md`
- Overlay helper partnership: see sibling repo **ef-map-overlay** for `AGENTS.md` and `.github/copilot-instructions.md` (native helper + DX12 overlay live there; keep shared docs in sync).

## Agent operating rules (must follow)
1) Prefer smallest safe change; don’t refactor broadly without explicit approval.
2) Cloudflare-first. Do NOT reintroduce Netlify. Any persistence change must target the existing Cloudflare Worker + KV abstraction.
3) Follow the GPT-5 Codex workflow: purposeful preamble + plan, synchronized todo list, and delta-style progress updates.
4) CLI mandate for Cloudflare ops: When possible, run CLI commands yourself (Wrangler) and summarize results. Prompt user only for secret inputs. Never commit secrets. See `.github/copilot-instructions.md` → “Cloudflare Platform & CLI Preference”.
5) Usage metrics: Only emit via `eve-frontier-map/src/utils/usage.ts` and whitelist server-side. Avoid double-counting.
6) Workers & heavy compute: Keep algorithms in web workers; throttle progress ≤5Hz; respect cache invalidation rules in routing.
7) Sensitive edits: Treat worker files (`*_worker.js`, `_worker.js`) and production config as sensitive; ask before structural changes.
8) Database access: Use the VS Code Postgres extension (configured for the local Docker Postgres) for schema inspection and routine queries. Prefer this path over PowerShell `docker exec` to avoid nested quoting issues.
9) Preview-only rule: Any website/Worker/API changes must be tested via Cloudflare Pages Preview deployments first; do not modify production (main) unless explicitly approved.

## Overlay helper coordination
- Native helper / DirectX overlay code has its own repository (see sibling repo **ef-map-overlay**). When a change impacts both repos, document cross-links in each decision log and keep initiative plans synchronized.
- Web-facing integrations (helper detection endpoints, overlay payload schema) continue to be developed here; helper-side implementations live in the overlay repo.
- Before updating shared docs (guardrails, roadmap) make sure the overlay copy stays aligned or include an explicit note about divergence.

## Fast context to load on start
- **First**: Read `docs/LLM_TROUBLESHOOTING_GUIDE.md` (full system overview, reduces orientation time by 50%+)
- Read `.github/copilot-instructions.md` (source of truth for patterns & guardrails)
- Skim last ~40 lines of `docs/decision-log.md` for current initiatives and recent incidents
- If working with local services: Check `docs/LOCAL_ENVIRONMENT.md` for Postgres/Grafana credentials
- If touching metrics: also read Worker endpoint mappings where EVENT_MAP lives
- If touching routing: read `src/utils/routing_worker.ts` and related workers under `eve-frontier-map/`

## VS Code Extensions (use proactively)
The following extensions are installed and should be your **first choice** for inspection tasks:
- **PostgreSQL** (ckolkman.vscode-postgres): Browse Postgres schemas, run queries interactively. Connect to localhost:5432 (credentials in `LOCAL_ENVIRONMENT.md`)
- **Docker** (ms-azuretools.vscode-docker): Inspect containers, view logs, attach shells. Prefer over `docker` CLI for one-off checks.
- **SQLite** (alexcvzz.vscode-sqlite): Open `eve-frontier-map/public/map_data_v2.db` for schema inspection
- **REST Client** (humao.rest-client): Test API endpoints via `.http` files
- **Chrome DevTools MCP** (chrome-devtools): Capture traces/screenshots via MCP (use isolated profile, close when done)

**Default to extension UI for inspection; use CLI only when scripting or automation is required.**

## Common tasks & success criteria
- Stop legacy jobs (Windows): Use `tools/win/pause_world_api.ps1`; verify no scheduled tasks remain; log in decision log
- Cloudflare deploy preview: Build `eve-frontier-map`, deploy Pages preview, verify Worker endpoints (`/api/*`), no Netlify code added
- Add a new metric: client emit in `usage.ts`, server whitelist in Worker, optional Stats page panel, run typecheck/build
- Routing tweak: maintain identical path outputs unless explicitly requested; keep performance neutral or better
- Build frontend locally: run the VS Code task **“shell: Build frontend”** (installs deps on first run) to ensure Vite build + Worker bundling succeed.

## High-risk surfaces (coordinate before changing)
- **Core render loop & global state** – `eve-frontier-map/src/App.tsx`, `src/scene/*`, and shared stores. Impacts cinematic mode, panel wiring, and selection handling.
- **Cloudflare Worker entrypoints** – `worker.js`, `_worker.js`, and any new bindings. Affects persistence, auth, and API invariants; requires preview deploy + decision log entry.
- **Snapshot/export pipelines** – `tools/snapshot-exporter/*`, Docker cron configs, and KV write scripts. Changes can corrupt production data; run with `DRY_RUN=1` first and capture logs.
- **Usage telemetry helpers** – `src/utils/usage.ts` and EVENT_MAP definitions in the Worker. Guard against double counting and keep payload schemas backward compatible.
- **Shared schema / data files** – `public/map_data_v2.db`, Smart Gate snapshot contracts, or anything feeding the overlay repo. Coordinate with `ef-map-overlay` maintainers before altering formats.

## Safety & boundaries
- Never commit secrets; use env vars or `.env.example` for placeholders
- Avoid large diffs (>150 LoC) or dependency adds without explicit approval
- If you need to create data migrations or bulk KV ops, create small scripts under `tools/` with a DRY_RUN flag and concise logs

Remember to append material decisions or behavioral changes to `docs/decision-log.md` using the template in `.github/copilot-instructions.md`.

## Links
- Cinematic mode spec: `CINEMATIC_MODE_SPEC.md`
- Requirements: `PROJECT_REQUIREMENTS.md`
- Repo README: `README.md`

— Keep this file concise. Update when operating rules or architecture materially change.
