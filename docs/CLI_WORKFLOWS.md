# Cloudflare CLI Workflows (Wrangler Sandbox)

**Purpose**: Give AI agents a ready-made command library for common Cloudflare operations. All commands assume PowerShell 5.1 on Windows with Wrangler installed and the required environment variables (`CF_API_TOKEN`, `CF_ACCOUNT_ID`) already configured.

**Last Updated**: 2025-10-01

---

## Quick Usage Notes

- Always execute commands yourself (per CLI mandate) and summarize the outcome rather than the raw log dump.
- For commands that prompt for secrets, start the command, note the prompt, and allow the operator to provide the secret locally.
- Prefer preview deployments for validation work; production deploys require explicit operator approval.

---

## Environment Sanity Check

```powershell
# Confirm Wrangler is authenticated and list bound projects
wrangler whoami
wrangler pages project list
```

Expected outcome: `wrangler whoami` prints the active account, and the project list includes `ef-map`.

---

## Preview Deployment Workflow

```powershell
# 1. Build frontend + worker bundle
cd eve-frontier-map
npm run build

# 2. Deploy a preview (replace <branch-name> with a short alias)
wrangler pages deploy dist --project-name ef-map --branch <branch-name>

# 3. Capture the resulting preview URL from the command output
```

Tips:
- Use `--commit-dirty=true` if deploying with uncommitted work tree changes.
- Record the preview URL (e.g., `https://<branch-name>.ef-map.pages.dev`) in your status update and decision log entry when relevant.

---

## Inspecting Deployments

```powershell
# List recent deployments for the Pages project
wrangler pages deployment list --project-name ef-map --limit 5
```

Use this before and after deploys to confirm the latest preview or production release ID. Summarize the relevant deployment IDs in your report.

---

## KV Namespace Inspection

```powershell
# List keys in EF_SNAPSHOTS (limit to first 10)
wrangler kv key list --namespace-id 2af7298532dd4acfbda8bf06020981ba --limit 10

# Retrieve a specific snapshot (pretty-print with ConvertFrom-Json if needed)
wrangler kv key get --namespace-id 2af7298532dd4acfbda8bf06020981ba smart_gate_links_v1
```

Guidelines:
- Redact or omit large payloads in summaries; report on `updatedAt`, counts, and other high-signal fields instead.
- For write operations, prefer scripts under `tools/` with a `DRY_RUN` flag—document intent before mutating data.

---

## Endpoint Smoke Tests

```powershell
# Invoke an API endpoint on a preview deployment
$previewUrl = "https://<branch-name>.ef-map.pages.dev"
Invoke-WebRequest -UseBasicParsing -Uri "$previewUrl/api/smart-gate-links?force=1" -Headers @{ Accept = 'application/json' }
```

Evaluate:
- HTTP status (expect 200)
- `Content-Type` header (`application/json`)
- First line/bytes of the response body to confirm it is JSON (not HTML fallback)

---

## Secret Management Prompt (Reference)

For commands requiring secret input:

```powershell
wrangler pages secret put <SECRET_NAME> --project-name ef-map --branch <branch-name>
# Operator: paste secret now (input hidden)
```

The assistant initiates the command, then pauses while the operator pastes the secret locally. Do not log the secret value.

---

## Cleanup & Follow-up

- After finishing preview validation, consider removing unused previews with `wrangler pages deployment delete <deployment-id>` (requires operator approval if production-impacting).
- Always update the relevant decision log entry with:
  - Deployment ID/URL
  - KV keys touched
  - Commands executed (summarized)
  - Verification results

---

(End of CLI_WORKFLOWS.md)
