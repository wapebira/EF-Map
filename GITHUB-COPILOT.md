````markdown
# GITHUB-COPILOT.md — Operational Playbook for GitHub Copilot (Repo SAFE Rules)

This file defines the guardrails, workflow, and minimal verification steps that GitHub Copilot-style agents must follow when making changes in this repository.

Purpose
- Provide an always-available, repo-level contract describing what edits are safe for an automated assistant to make without additional approvals.
- Keep the project baseline intact and ensure small, testable changes are applied with proper checks.

Scope
- Applies to automated edits performed by a coding assistant working directly against this repository (suggesting patches, creating files, or producing PR-ready diffs).
- Does not grant permission to run commands on the user's machine or to change external infrastructure.

Baseline (must never regress)
1. The application builds and typechecks: `npm run typecheck` and `npm run build` should pass after changes (unless the change is explicitly a non-build item and noted).
2. The core map render baseline must remain: orbit/pan/zoom, hover label, selection/persistent label, search focus.
3. No committed changes should introduce console errors in the app startup path under normal data conditions.

Quick rules (always follow)
- Make the smallest possible change to achieve the goal.
- Prefer non-invasive fixes: add small helper functions, guard clauses, tests, or comments rather than large refactors.
- Run static checks (typecheck/lint) locally before proposing the final patch. If you cannot run them, clearly state the commands and the expected output.
- Never modify `eve-frontier-map/public/map_data.db` or other generated artifacts without the `SCHEMA CHANGE OK` token (see below).
- Do not add secrets, tokens, or external credentials to the repository.

Approval tokens (explicit user instruction required)
- `CORE CHANGE OK` — You may change base rendering, camera, hit-detection, or selection logic in `src/App.tsx` and related files.
- `SCHEMA CHANGE OK` — You may change DB schema, generated DB artifact, or `src/types/*`. If granted, include migration notes and a rebuilt `map_data.db` offline.
- `BUNDLE WORKER OK` — You may change worker bundling strategy or convert classic workers to module workers.

Safe edit checklist (for any automated edit)
- [ ] Plan: Short summary (1–2 lines), files to touch, why this is safe.
- [ ] Touch list: Only the files required for the change.
- [ ] Typecheck: `npm run typecheck` (or `tsc -b`) — paste result if available.
- [ ] Build: `npm run build` — paste result if available.
- [ ] Smoke: Manual smoke test notes (open app, attempt a quick hover/select/search, report console logs). If the author cannot run the smoke test, clearly mark it as `MANUAL-TEST-REQUIRED`.
- [ ] Decision log entry: Append a short entry to `docs/decision-log.md` (create if missing).

Anchors and protected regions
- Do not change code between these anchors unless `CORE CHANGE OK` is provided:
  - `// GEMINI-ANCHOR: selection-logic`
  - `// GEMINI-ANCHOR: hover-labels`
  - `// GEMINI-ANCHOR: starfield-buffers`
  - `// GEMINI-ANCHOR: stargate-lines`
- If a change must touch these anchors, ask for `CORE CHANGE OK` and include a rollback plan.

Testing & verification
- Unit tests: Add small unit tests when changing logic that can be tested (e.g., routing algorithm helpers). If tests are added, run them locally and include results.
- Memory/smoke checks: For changes touching Three.js or workers, include a short note about how to manually verify (open app, toggle the changed feature 10×, confirm no errors and verify memory doesn't grow unboundedly in the devtools timeline).

Performance guidelines
- Avoid O(n^2) loops over large arrays in render or interaction loops. Use maps/indices where appropriate.
- Prefer reusing BufferGeometry attributes and calling `.needsUpdate = true` rather than recreating geometries each animation frame.

Worker & bundling rules
- Web workers that use `importScripts` (classic workers) must be created as classic workers and kept in `public/` or provided as static assets.
- Module workers should be instantiated with `new Worker(new URL('./path', import.meta.url), { type: 'module' })`.
- If changing a worker strategy, ask for `BUNDLE WORKER OK` and provide a short migration plan.

Decision log (append only)
- Create `docs/decision-log.md` if missing. For each accepted change, append:
```
## YYYY-MM-DD — Short title
- Summary: 1–2 lines
- Files: src/..., public/...
- Baseline checks: typecheck | build | smoke
- Risk: low/med/high
- Notes: (optional)
```

PR checklist
- Description: Why and what changed.
- Files changed: minimal and relevant.
- Baseline status: typecheck/build results included or marked `MANUAL-TEST-REQUIRED`.
- Rollback plan: one-line (revert commit or branch).

When to stop and ask
- If a change requires more than 3 files to be edited across core, modules, and types, stop and ask for explicit approval.
- If you are unsure whether a change affects the baseline (render, selection, labels), stop and request `CORE CHANGE OK`.

How to apply patches
- Provide a minimal patch (git diff or single-file replacement). Prefer `apply_patch`/`git apply` friendly formats.
- Include the commands a maintainer should run to verify, for example:
```powershell
cd "C:\EF-Map-main\eve-frontier-map"
npm install
npm run typecheck
npm run build
npm run dev
```

Contact and escalation
- If the assistant is uncertain or a failing check appears, notify the repo owner (maintainers listed in README) and open a draft PR with `WIP` in the title.

---

This file is intentionally short and conservative. If you want a stricter or more permissive policy, tell me which areas to relax or tighten and I will produce an updated version.

````
