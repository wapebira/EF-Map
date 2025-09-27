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

Useful entry points:
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
- Read `.github/copilot-instructions.md` (source of truth for patterns & guardrails)
- Skim last ~40 lines of `docs/decision-log.md` for current initiatives and recent incidents
- If touching metrics: also read Worker endpoint mappings where EVENT_MAP lives
- If touching routing: read `src/utils/routing_worker.ts` and related workers under `eve-frontier-map/`

## Common tasks & success criteria
- Stop legacy jobs (Windows): Use `tools/win/pause_world_api.ps1`; verify no scheduled tasks remain; log in decision log
- Cloudflare deploy preview: Build `eve-frontier-map`, deploy Pages preview, verify Worker endpoints (`/api/*`), no Netlify code added
- Add a new metric: client emit in `usage.ts`, server whitelist in Worker, optional Stats page panel, run typecheck/build
- Routing tweak: maintain identical path outputs unless explicitly requested; keep performance neutral or better
- Build frontend locally: run the VS Code task **“shell: Build frontend”** (installs deps on first run) to ensure Vite build + Worker bundling succeed.

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
