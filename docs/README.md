# Documentation Index

Central map for project documentation. Files still live alongside source for now; moves into `docs/` proper will be tracked here when they happen.

## Quick Orientation
- Repository overview & data tooling: root `README.md`
- Frontend quick start: `eve-frontier-map/README.md`
- Troubleshooting deep dive: `docs/LLM_TROUBLESHOOTING_GUIDE.md`
- Guardrails for AI agents: `.github/copilot-instructions.md`, `GITHUB-COPILOT.md`, and `GEMINI.md`

## Active Docs by Theme
### Guardrails & Operations
- `.github/copilot-instructions.md` – Cloudflare-first workflow & CLI mandate
- `GITHUB-COPILOT.md` / `GEMINI.md` – Assistant-specific rules of engagement
- `post-ingestion-playbook.md` – Current operational runbook
- `operations-secrets.md` – Handling of operational secrets (no secrets committed)

### Architecture, Data, and Pipelines
- `PROJECT_REQUIREMENTS.md` – Product scope and functional expectations
- `UNIVERSE_DATA_PIPELINE.md` – End-to-end data flow
- `dynamic_structures_plan.md` & `dynamic_structures_field_mapping.md` – Dynamic structures reference
- `support/structure_snapshot_plan.md` – Snapshot exporter + stats stitching plan
- Root tooling docs (`README.md`, comments in `create_map_data.py`, `filter_map_data.py`)

### Platform & Integration Guides
- `CINEMATIC_MODE_SPEC.md`
- `primordium-indexer.md` – Primordium PostgreSQL indexer workflow
- `DEPRECATIONS.md` – Cloudflare-first posture and retired paths

### Initiatives & Roadmaps
- `initiatives/DATA_EXPOSURE_PLAN.md`
- `initiatives/smart-gates-plan.md`

### References
- `references/WorldV2-QuickRef.md`
- `support/` folder for auxiliary implementation notes

## Legacy & Archived Material
Completed or obsolete content moves under `docs/archive/`.

- `archive/migration/MIGRATION_PLAN.md` & `archive/migration/migration_status.json` – Netlify → Cloudflare cutover
- `archive/local-indexer/` – Legacy SQLite indexer experiments (replaced by Primordium)
- `archive/reports/indexer-vs-worldapi-audit-2025-09-18.md` – Historical audit
- `archive/d1/d1_schema_draft.sql` – Superseded D1 schema ideas
- `WORLD_ROTATION_PLAYBOOK.md` – Marked legacy; refer to Primordium/KV docs instead

## AI Usage Guidance
If you are following the "Vibe coding" pattern (human intent → AI implementation):
- Restate the user’s plain-language goal as an actionable checklist before editing.
- Flag high-risk areas (schema, worker, performance paths) and confirm tokens when required.
- Prefer assistant-run CLI for Cloudflare/Wrangler; lean on installed VS Code extensions for inspection.

## Status Notes
- Cloudflare Pages Worker is authoritative; Netlify artifacts persist only for historical reference.
- Worker strips UTF-8 BOM from daily stats snapshots defensively (decision log 2025-09-08).

Feedback welcome before larger re-organization of the docs tree.
