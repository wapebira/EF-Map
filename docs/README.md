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

## Data Processing
- Root `README.md`: Map data consolidation & filtering scripts (`create_map_data.py`, `filter_map_data.py`).

## Frontend App
- `eve-frontier-map/README.md`: Vite + React template notes (kept minimal).

## AI Usage Guidance
If using an AI assistant ("Vibe coding" workflow – user provides intent, AI designs & implements):
- Always restate the user's plain-language goal as a short actionable checklist.
- Confirm whether a change touches protected baseline areas before editing (see playbooks above).
- Propose safer alternative if user asks for something large/risky without required tokens (CORE CHANGE OK, SCHEMA CHANGE OK, etc.).

## Future Consolidation Plan (Optional)
1. Migrate root specs into `docs/` keeping stubs at old paths that link here.
2. Update cross-file references (e.g., GEMINI.md linking to requirements) to new relative paths.
3. Add `docs/decision-log.md` for structured change history (see playbooks).

Feedback welcome before relocating source markdown files.
