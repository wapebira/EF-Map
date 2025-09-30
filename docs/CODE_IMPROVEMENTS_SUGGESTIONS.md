# Code Improvements & Suggestions for LLM Agents

Date: 2025-10-01
Target Audience: LLM agents working in the EF-Map repository (non-coding operator)
Purpose: Identify areas for improvement that aid LLM comprehension, reduce redundant searches, and strengthen system resilience.

---

## Critical Improvements (High Priority)

### 1. Postgres Connection Details Scattered Across Multiple Files
**Risk**: High (blocks troubleshooting, causes repeated searches)  
**Effort**: 15 minutes (consolidate to env reference doc)

**Problem**: LLM agents repeatedly search for Postgres credentials because they're scattered across:
- `docker-compose.yml` files (hardcoded `user:password@postgres`)
- Tool READMEs mentioning `PGHOST`, `PGUSER`, etc.
- No single source of truth

**Recommendation**: Create `docs/LOCAL_ENVIRONMENT.md` (NOT committed to git) with:
```markdown
## Local Postgres (Primordium Indexer)
- Host: localhost (or postgres from within Docker network)
- Port: 5432
- Database: postgres
- User: user
- Password: password
- Connection String: postgresql://user:password@localhost:5432/postgres
- Docker Network: pg-indexer-reader_indexer-network

## Grafana
- URL: http://localhost:3000
- Default login: admin/admin (first run)
- Datasource UID: ef-postgres
```

Add `.gitignore` entry for `docs/LOCAL_ENVIRONMENT.md` and reference it from `AGENTS.md` as the first file to read.

---

### 2. Docker Compose Files Have Conflicting Service Names
**Risk**: Medium (confusing for agents trying to inspect containers)  
**Effort**: 30 minutes (standardize naming convention)

**Problem**: Multiple docker-compose files use overlapping service names:
- `tools/worldapi-cron/docker-compose.yml` → `snapshot-exporter`, `worldapi-cron-killmails`, etc.
- `tools/pg-adapter/docker-compose.yml` → `db`
- Primordium indexer (external) → `postgres`, `postgres-index-write`, `postgres-query-read`

**Recommendation**: 
- Prefix all service names with their subsystem: `worldapi_`, `pgadapter_`, `primordium_`
- Document the canonical container name pattern in the orientation guide
- Update any scripts that reference container names by exact match

---

### 3. Missing VS Code Extension Guidance in Agent Context
**Risk**: Low-Medium (agents default to CLI when UI tools are faster)  
**Effort**: 10 minutes (documentation update)

**Problem**: Agents don't proactively use:
- **PostgreSQL extension** (ckolkman.vscode-postgres) for schema browsing/queries
- **Docker extension** (ms-azuretools.vscode-docker) for container inspection
- **SQLite extension** (alexcvzz.vscode-sqlite) for map_data.db inspection

These are installed but not mentioned in agent guardrails.

**Recommendation**: Add to `AGENTS.md` under "Fast context to load on start":
```markdown
## Available VS Code Extensions (use proactively)
- PostgreSQL (ckolkman.vscode-postgres): Browse local Postgres schemas, run queries interactively. Connection: localhost:5432, user/password (see LOCAL_ENVIRONMENT.md)
- Docker (ms-azuretools.vscode-docker): Inspect running containers, view logs, attach shells
- SQLite (alexcvzz.vscode-sqlite): Open eve-frontier-map/public/map_data*.db for schema inspection
- REST Client (humao.rest-client): Test API endpoints via .http files
- Chrome DevTools MCP: Registered for trace/screenshot capture (use isolated profile)

Default to extension UI for inspection tasks; use CLI only when scripting or automation is required.
```

---

### 4. Deprecated Code Still Present Without Clear Boundaries
**Risk**: Medium (agents may attempt to modify or fix deprecated systems)  
**Effort**: 2 hours (move to archive/ subdirectories with clear README)

**Problem**: `DEPRECATIONS.md` lists deprecated systems but files remain in active paths:
- `tools/local-indexer/*` (deprecated SQLite indexer)
- Root-level `archiver_worker.js`, `cron_worker.js` (deprecated D1 indexer)

Agents scanning the workspace may not immediately recognize these as legacy.

**Recommendation**:
- Move deprecated files to `legacy/` subdirectory at root:
  ```
  legacy/
    local-indexer/
    d1-indexer/
    README.md  # Brief explanation: "Retained for historical reference only"
  ```
- Update `.github/copilot-instructions.md` to explicitly exclude `legacy/` from active change scope
- Update `file_search` and `semantic_search` mental model to skip `legacy/**` unless explicitly investigating history

---

### 5. Worker.js EVENT_MAP Lacks Type Safety
**Risk**: Low-Medium (easy to introduce typos in event names)  
**Effort**: 1 hour (generate TypeScript types from EVENT_MAP)

**Problem**: `worker.js` defines `EVENT_MAP` as a plain object. Client code in `usage.ts` sends string event types. No compile-time validation that event names match.

**Recommendation**:
- Generate TypeScript types from EVENT_MAP:
  ```typescript
  // tools/generate-usage-types.js (Node script)
  // Reads worker.js EVENT_MAP -> outputs src/types/usage-events.ts
  export type UsageEventType = 
    | 'p2p_route' 
    | 'sg_route_unrestricted' 
    // ... (all event types)
  ```
- Update `usage.ts` to import and use: `track(evt: {type: UsageEventType, ...})`
- Run as precommit hook or build step to keep in sync

---

### 6. Hardcoded URLs in Multiple Locations
**Risk**: Low (maintenance burden, easy to miss during endpoint changes)  
**Effort**: 30 minutes (centralize in env config)

**Problem**: World API base URL appears in:
- `worker.js`: `const WORLD_API_BASE = 'https://world-api-stillness.live.tech.evefrontier.com'`
- `docker-compose.yml` env vars: `BASE_URL: https://world-api-stillness.live.tech.evefrontier.com`
- Decision log references

**Recommendation**:
- Create `config/endpoints.json` (committed):
  ```json
  {
    "worldApiBase": "https://world-api-stillness.live.tech.evefrontier.com",
    "worldAddress": "0x7085f3e652987f656fB8dEE5aA6592197Bb75de8",
    "deployBlock": 7288348,
    "confirmDepth": 8
  }
  ```
- Import in worker.js and docker-compose via environment variable or build-time substitution
- Single source of truth for network parameters

---

## Medium Priority Improvements

### 7. Inconsistent Error Handling in Worker Endpoints
**Risk**: Low (harder to diagnose production issues)  
**Effort**: 1 hour (standardize error response schema)

**Problem**: Some endpoints return `{error: "message"}`, others return plain text, some return 500 with HTML.

**Recommendation**:
- Standardize all API error responses:
  ```javascript
  { 
    error: true, 
    code: "INVALID_TOKEN", 
    message: "Human-readable explanation",
    details: {} // optional debug info
  }
  ```
- Add `X-Error-Code` header for easier log filtering
- Document in `docs/API_CONVENTIONS.md`

---

### 8. No Explicit Schema Versioning for KV Snapshots
**Risk**: Medium (breaking changes require manual migration)  
**Effort**: 45 minutes (add version field + migration guard)

**Problem**: `EF_SNAPSHOTS` keys like `smart_gate_links_v1` embed version in key name, but payload has no internal version field. Future breaking changes require new key names AND client updates.

**Recommendation**:
- Add `schemaVersion` field to all snapshot payloads:
  ```json
  {
    "schemaVersion": 2,
    "generatedAt": "...",
    "gates": [...]
  }
  ```
- Worker reads version, can serve compatibility layer if needed
- Allows gradual rollout of schema changes without breaking old clients

---

### 9. Missing Healthcheck Endpoints for Critical Services
**Risk**: Medium (hard to detect silent failures)  
**Effort**: 1 hour (add health endpoints for each subsystem)

**Problem**: Only some services have health endpoints:
- Indexer: `/api/indexer-health`
- Missing: snapshot-exporter, worldapi-cron services, grafana datasource ping

**Recommendation**:
- Add `/health` to snapshot-exporter Docker service (returns last successful publish timestamp)
- Add Grafana datasource health check to startup scripts
- Consolidate all health checks in `tools/diagnostics/check_all_services.ps1`
- Output JSON summary for dashboards

---

### 10. Grafana Dashboard JSON Not Under Version Control
**Risk**: Low-Medium (dashboard changes not tracked)  
**Effort**: 20 minutes (export script + docs)

**Problem**: `tools/grafana/ef_map_overview_dashboard.json` exists but may diverge from live Grafana instance.

**Recommendation**:
- Add script: `tools/grafana/export_dashboard.ps1` (uses Grafana API to dump current dashboard JSON)
- Add to precommit checklist: "If you modified Grafana dashboard, run export script"
- Document in `docs/GRAFANA.md`

---

## Low Priority (Nice to Have)

### 11. Web Worker Files Lack Inline Documentation
**Risk**: Low (learning curve for new features)  
**Effort**: 2 hours (add JSDoc comments)

**Problem**: Files like `routing_worker.ts`, `scout_optimizer_worker.ts` have minimal comments explaining algorithm choices.

**Recommendation**:
- Add JSDoc block at top of each worker:
  ```typescript
  /**
   * Routing Worker - A* / Dijkstra pathfinding
   * 
   * Key concepts:
   * - Spatial grid cache invalidated when jump distance changes cell size
   * - Cost model: 'fuel' = distance-weighted, 'jumps' = unit cost
   * - Progress messages throttled to <=5Hz to avoid main thread stalls
   * 
   * Entry point: postMessage({ type: 'find-path', ... })
   */
  ```
- LLMs can then grep for these blocks to understand subsystem without deep dive

---

### 12. No Automated Test for Critical Paths
**Risk**: Low (manual smoke testing required)  
**Effort**: 4 hours (Playwright or similar)

**Problem**: No automated browser test to verify:
- Map loads
- Routing works
- Share links resolve
- Usage events fire

**Recommendation**: (Future, not immediate)
- Add Playwright test suite:
  - `tests/smoke/map-load.spec.ts`
  - `tests/smoke/routing-p2p.spec.ts`
- Run on preview deploys via GitHub Actions
- Blocks production deploy if smoke fails

---

## Summary Table

| # | Issue | Risk | Effort | Priority |
|---|-------|------|--------|----------|
| 1 | Postgres creds scattered | High | 15m | Critical |
| 2 | Docker service naming conflicts | Medium | 30m | Critical |
| 3 | Missing VS Code extension guidance | Med | 10m | Critical |
| 4 | Deprecated code boundaries unclear | Medium | 2h | Critical |
| 5 | EVENT_MAP lacks type safety | Med | 1h | Critical |
| 6 | Hardcoded URLs | Low | 30m | Critical |
| 7 | Inconsistent error handling | Low | 1h | Medium |
| 8 | No snapshot schema versioning | Medium | 45m | Medium |
| 9 | Missing health endpoints | Medium | 1h | Medium |
| 10 | Grafana dashboard not versioned | Med | 20m | Medium |
| 11 | Worker files lack docs | Low | 2h | Low |
| 12 | No automated smoke tests | Low | 4h | Low |

**Total Critical Path Effort**: ~5 hours  
**Total Medium Priority**: ~3.5 hours  
**Total Low Priority**: ~6 hours

---

## Implementation Strategy for Vibe Coder Operator

Since you're a non-coder relying on LLM agents, prioritize improvements that **reduce agent orientation time**:

1. **Start with Critical #1, #3, #5**: These are documentation-only and immediately reduce redundant searches.
2. **Defer Critical #2, #4**: Require file moves and script updates; batch these during a dedicated "housekeeping" session.
3. **Medium priority**: Implement incrementally when touching related subsystems (e.g., add error schema when fixing a worker bug).
4. **Low priority**: Revisit after 3-6 months if they become pain points.

Each improvement should be a separate task with:
- Clear success criteria
- Rollback plan (usually: revert commit)
- Decision log entry

---

## Notes for Future Agents

When implementing these suggestions:
- Always create a branch: `improvement/<issue-number>-<short-name>`
- Test on preview deploy before merging
- Update this document to mark items complete (move to archive section)
- Cross-reference decision log entry for traceability

(End of suggestions document)
