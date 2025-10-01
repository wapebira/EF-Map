# Secrets Operations Runbook

Status: Active (Cloudflare Pages + Worker primary)
Scope: Procedures for adding, rotating, verifying, and troubleshooting secrets used by the EF Map Cloudflare Worker. Today the only secret is the legacy D1 indexer admin token; newer Worker features use KV bindings and do not require additional secrets.

## 1. Secrets We Currently Use
| Name | Purpose | Scope | Notes |
|------|---------|-------|-------|
| INDEXER_ADMIN_TOKEN | Auth header `X-Indexer-Admin` for legacy D1 indexer endpoints (`/api/indexer-migrate`, `/api/indexer-bootstrap`, other `/api/indexer-*`) | Pages Worker (preview & production) | Required only when invoking the deprecated D1 admin routes. New Cloudflare Worker features rely on KV + Pages bindings instead of this token. |

(If more secrets are added later, extend this table; keep one-line purposes.)

## 2. Add or Update a Secret (CLI First)
Always add via Wrangler for reproducibility and audit.

1. Put/Update the secret:
   ```powershell
   wrangler pages secret put INDEXER_ADMIN_TOKEN --project-name ef-map
   ```
   (CLI will prompt; paste value – it is not echoed.)
2. (Optional) For a preview branch you can still use the same command; Pages will scope it to the project (current behavior: secret is available to preview + production after redeploy).
3. Redeploy the site (secret only becomes available after deployment):
   ```powershell
   wrangler pages deploy dist --project-name ef-map --branch <branch-name>
   ```
4. Verify (see Section 3) before invoking protected endpoints.

## 3. Verification Checklist
Perform in order after deployment.

1. Health Endpoint (planned enhancement):
   - `GET /api/indexer-health?details=1` should return JSON including `hasAdminToken:true` (future) or at minimum `status:"uninitialized"` / `"ok"` without 401.
2. Attempt an authorized request (use a harmless read first once exposed – currently migrate/bootstrap are write operations so skip if already applied):
   - `curl -H "X-Indexer-Admin: <token>" https://<preview-or-prod>/api/indexer-health`
   - Expect 200 JSON (not 401). If schema already applied: `status:"ok"`.
3. If still 401:
   - Confirm latest deployment contains worker (check a normal `/api/stats` JSON response – not HTML).
   - List deployments (CLI) and confirm timestamp after secret put (Wrangler command to add when we script this future: `wrangler pages deployment list`).
   - Ensure you deployed from directory whose `wrangler.jsonc` matches bindings (root vs subdirectory). Our cleanup task will consolidate to one config to remove this hazard.

## 4. Troubleshooting Flow
| Symptom | Likely Cause | Diagnostic | Action |
|---------|--------------|-----------|--------|
| 401 on admin endpoint after secret put | Missing redeploy | Deployment time < secret put time | Redeploy pages project.
| 401 persists after redeploy | Wrong config file used (binding mismatch) | Compare `wrangler.jsonc` (root & `eve-frontier-map/`) KV/D1 ids | Deploy from directory with correct binding; (future) remove duplicate config.
| 200 HTML instead of JSON for `/api/*` | Worker not in dist or copy script skipped | Inspect response `Content-Type: text/html` | Re-run build; ensure `_worker.js` copied; redeploy.
| Secret appears unset intermittently | Forgot to set at project level / using unsupported beta feature | List secrets (not yet standardized) / examine health debug | Re-put secret then redeploy.
| Need to rotate token | Compromise concern or routine rotation | N/A | Put new secret (steps above), redeploy immediately; old token invalid from next deploy onward.

## 5. Prohibited / Avoid
- Do NOT rely on ad-hoc debug endpoints that expose secret metadata (remove them after use).
- Do NOT edit secrets solely through dashboard without recording action (lack of CLI step can hide ordering mistakes).
- Do NOT deploy from a directory with outdated `wrangler.jsonc` (pre-cleanup risk) – always verify EF_STATS & D1 ids match expected authoritative IDs.

## 6. Removal / Decommission
If a secret becomes obsolete:
1. Remove its usage in code (delete guarded endpoints or feature flag).
2. Remove row from the table in Section 1.
3. (Optional) Remove from Pages dashboard if UI clutter is a concern (safe – unused secret has no runtime effect).
4. Add a decision log entry if removal relates to a security concern or larger architectural shift.

## 7. Future Enhancements
- Implement `/api/indexer-health?details=1` returning `{ status, migrationsApplied, hasAdminToken, d1:{tables,ready} }`.
- Consolidate duplicate wrangler configs (root + subdir) → single source of truth.
- Add small script: `tools/verify_secrets_env.js` to attempt a fetch to health and log result (useful in CI).
- Optional: Bind a read-only public health route that never reveals secret presence but returns a short implementation hash for faster drift detection.

## 8. Quick Reference (TL;DR)
Add/Update:
```powershell
wrangler pages secret put INDEXER_ADMIN_TOKEN --project-name ef-map
wrangler pages deploy dist --project-name ef-map --branch <branch>
```
Verify:
```powershell
curl -H "X-Indexer-Admin: <token>" https://<branch>.ef-map.pages.dev/api/indexer-health
```
If 401 → redeploy, then compare wrangler configs.

(End)
