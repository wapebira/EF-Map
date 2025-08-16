# GEMINI.md — Project Operating Guide (v2, drop‑in)

This file tells Gemini Code Assist **how to work in this repo without breaking working features**. It defines baselines to preserve, safe‑edit rules, and a short workflow Gemini must follow after every change.

> **Single source of truth:** Product/feature intentions live in `PROJECT_REQUIREMENTS.md` (or similar). This file is the **operational playbook** for the agent.

---

## 0) Quick context
- Frontend: React + TypeScript + Vite (Three.js scene for a 3D starmap).
- Data: SQLite is **read‑only in the browser** (populated offline). Types live in `src/types` (update types when schema changes).

---

## 1) Baseline (must never regress)
1. **Map renders** with camera orbit/pan/zoom.
2. **Left‑click selection** highlights a system.
3. **Hover label** appears near hovered system; **persistent label** on the selected system.
4. **Search** finds systems and focuses the camera.
5. **Build & typecheck** succeed with no errors.

If a change jeopardizes any baseline, **revert or fix before proceeding**.

---

## 2) Hard guardrails
**Do:**
- Keep diffs **small and localized**. Prefer additive changes over refactors.
- Put new visual features in **modules** (overlay on top of the base map). See §5.
- Run **typecheck, build, and smoke tests** after any change (§4).

**Don’t:**
- Don’t rename/remove public exports used by the app without explicit approval.
- Don’t modify generated/static DB artifacts directly; rebuild them offline.
- Don’t change core rendering/controls unless explicitly allowed.

**Approval tokens** (must appear in the user request before risky edits):
- `CORE CHANGE OK` — You may change base rendering/camera/selection/label logic.
- `SCHEMA CHANGE OK` — You may change DB schema/types/queries and rebuild the artifact.
- `BASELINE WAIVER OK` — Temporary acceptance of a baseline regression while landing a feature.

---

## 3) Standard workflow for Gemini
1. **Plan** the change (short checklist + list of files to touch). If risky, stop unless an approval token is present.
2. Create a branch: `feat/<short>` or `fix/<short>`.
3. Use `read_file` / `search_code` to build a **touch list** (only what’s needed).
4. Apply **minimal diffs** with `write_file`.
5. Verify:
   - `npm run typecheck`
   - `npm run build`
   - Run smoke tests (§4)
6. If successful, update **Decision Log** (§4) and open a PR with results.

---

## 4) Scripts, smoke tests, and Decision Log
**Scripts** (ensure these exist in `package.json`):
```json
{
  "dev": "vite",
  "build": "tsc -b && vite build",
  "typecheck": "tsc -b",
  "lint": "eslint .",
  "preview": "vite preview"
}
```

**Smoke checklist (all must pass):**
- App boots with no console errors.
- Orbit, zoom, and pan work.
- Hovering a system shows a transient label; selecting shows a persistent label.
- Search finds a known system and focuses camera.

**Decision Log:** create `docs/decision-log.md` (append‑only). After each accepted change, add:
```
## YYYY‑MM‑DD – Short title
- Summary: what changed and why (1–2 lines)
- Affected files: src/...
- Baseline checks: ✅ render | ✅ selection | ✅ labels | ✅ search | ✅ build
- Risk: low/med/high
- Follow‑ups: (optional)
```

**PR checklist:**
- [ ] Why (user story / bug)
- [ ] What changed (1–2 lines)
- [ ] Baseline still OK
- [ ] Typecheck & build outputs attached
- [ ] Rollback plan (1 line)

---

## 5) Overlay module pattern (keep core safe)
Add features that draw on top of the map (e.g., highlighting, routes, clustering) as modules under `src/modules/`.

**Minimal contract (TypeScript):**
```ts
// src/modules/Module.d.ts (create if missing)
import * as THREE from 'three';

export interface SolarSystem {
  id: number; name: string;
  position: { x: number; y: number; z: number };
}
export interface Module {
  id: string; name: string;
  init: (
    scene: THREE.Scene,
    visibleSystems: SolarSystem[],
    selectedSystem: SolarSystem | null
  ) => void;
  cleanup: () => void;
}
```

**Registry:**
```ts
// src/modules/index.ts
import ExampleModule from './ExampleModule';
export const modules = { ExampleModule };
```

**Optional UI:** A basic toggle menu to enable/disable modules; persist flags in `localStorage`.

---

## 6) Anchors in core code (protect fragile areas)
Insert and respect these comments in core files (e.g., `src/App.tsx`). Don’t change the surrounding logic unless `CORE CHANGE OK` is present.
```ts
// GEMINI-ANCHOR: selection-logic
// GEMINI-ANCHOR: hover-labels
// GEMINI-ANCHOR: starfield-buffers
// GEMINI-ANCHOR: stargate-lines
// GEMINI-KEEP: critical baseline – changing this requires CORE CHANGE OK
```

---

## 7) Data & schema rules
- Treat the browser DB as **read‑only**. Schema changes require a migration and a rebuilt artifact.
- Types are **canonical**. If schema changes, update `src/types/*` and all query sites.
- **Performance:** avoid per‑frame allocations; update typed arrays/buffer attributes rather than recreating geometries.

---

## 8) Copy‑blocks Gemini can reuse
**A) Safe feature edit**
```
PLAN
- Goal:
- Files to touch:
- Baseline risks:
- Tests to run: typecheck, build, smoke

PATCH
- Minimal diffs only.

VERIFY
- Paste results of npm run typecheck && npm run build
- Smoke checklist results

UPDATE DOCS
- Append a decision-log entry
```

**B) New module skeleton**
```
Create src/modules/<Name>.ts implementing Module interface.
Register it in src/modules/index.ts and (optionally) add a toggle in the UI.
```

**C) Schema change (requires SCHEMA CHANGE OK)**
```
- Add migration file (scripts/migrations/NNN_description.sql)
- Update src/types/* and query sites
- Rebuild DB artifact offline and commit
- Run full build + smoke
```

---

## 9) Recent changes (assistant‑maintained)
*(Gemini appends entries after each successful PR)*
- _YYYY‑MM‑DD_: …

---

### Final note
If a requested change conflicts with these rules, **stop and ask for an approval token**. Otherwise, follow the Standard workflow and keep the Decision Log up to date.
