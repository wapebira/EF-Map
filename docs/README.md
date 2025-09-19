# Documentation Index

Central index for project markdown content. Source files preserved in root for now; future consolidation can relocate them here with path updates.

## Core Documents
- Project Requirements: `PROJECT_REQUIREMENTS.md` (product scope, functional/non-functional requirements)
- Operational Playbooks:
  - `GITHUB-COPILOT.md` (Copilot guardrails & safe edit rules)
  - `GEMINI.md` (Gemini agent operational workflow)
  - `.github/copilot-instructions.md` (AI agent quick-start & patterns)
- Feature Specs:
  - Cinematic Mode: `CINEMATIC_MODE_SPEC.md`
  - Dynamic Structures Plan: `dynamic_structures_plan.md`
  - Dynamic Structures Field Mapping: `dynamic_structures_field_mapping.md`

## Data Processing
- Root `README.md`: Map data consolidation & filtering scripts (`create_map_data.py`, `filter_map_data.py`).

## Frontend App
- `eve-frontier-map/README.md`: Frontend quick start & deployment pointer (post‑migration minimal docs). See root `README.md` for full architecture.

## Active vs Archived
Active docs live in this folder. Completed or obsolete docs are moved under `docs/archive/`.

Archived (reference only):
- `archive/migration/MIGRATION_PLAN.md` and `archive/migration/migration_status.json` – Netlify → Cloudflare migration (completed 2025-09-07)
- `archive/local-indexer/*` – Local SQLite indexer plans/scripts (deprecated in favor of Primordium pg-indexer)
- `docs/archive/d1/d1_schema_draft.sql` – Early D1 schema draft (superseded by KV + optional D1 later)
- `archive/reports/indexer-vs-worldapi-audit-2025-09-18.md` – Point-in-time analysis

Active docs here:
- `DEPRECATIONS.md` – What’s deprecated and why (Primordium/Grafana as canonical)
- `dynamic_structures_plan.md` / `dynamic_structures_field_mapping.md`
- `operations-secrets.md` (operational guidance; no secrets committed)
- `post-ingestion-playbook.md` (operational playbook, current)
- `primodium-indexer.md` (current canonical chain ingestion)
- `UNIVERSE_DATA_PIPELINE.md`, `WORLD_ROTATION_PLAYBOOK.md`

## AI Usage Guidance
If using an AI assistant ("Vibe coding" workflow – user provides intent, AI designs & implements):
- Always restate the user's plain-language goal as a short actionable checklist.
- Confirm whether a change touches protected baseline areas before editing (see playbooks above).
- Propose safer alternative if user asks for something large/risky without required tokens (CORE CHANGE OK, SCHEMA CHANGE OK, etc.).

## Status Notes
* Cloudflare Pages Worker is primary; legacy Netlify functions retained only for historical reference pending deletion.
* Worker strips UTF‑8 BOM from daily stats snapshots defensively (see decision log entry 2025-09-08).

Feedback welcome before broader consolidation.
