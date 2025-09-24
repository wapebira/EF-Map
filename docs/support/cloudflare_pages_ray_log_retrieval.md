# Cloudflare Pages Ray Log Retrieval

This runbook captures Pages Functions logs associated with a specific Cloudflare Ray ID so we can validate user reports (for example, `9841bce9c86fddb2`). Follow the steps end-to-end to avoid hanging `wrangler` sessions and to persist the output for later review.

## Prerequisites

- Wrangler CLI ≥ **4.39.0** (`wrangler --version` to confirm).
- Valid Cloudflare API token with Pages read access configured via environment (for example, `CLOUDFLARE_API_TOKEN`).
- PowerShell 5.1+ on Windows (commands assume the repo root `c:\EF-Map-main`).
- Target Ray ID and approximate timestamp (Cloudflare tail only retains ~30 minutes of logs).

## Procedure

1. **Identify the production deployment ID** (replace `ef-map` if you are targeting another project):

   ```powershell
   wrangler pages deployment list --project-name ef-map --environment production --json
   ```

   Note the `Id` for the deployment that was active when the Ray was generated (usually the top entry).

2. **Tail logs filtered to the Ray ID**. Substitute `YOUR_DEPLOYMENT_ID` and `RAY_ID`. This command exits cleanly after 15 seconds and writes output to `tmp_wr_tail.log` / `tmp_wr_tail.err`.

   ```powershell
   & {
     $argsList = '/c','wrangler','pages','deployment','tail','YOUR_DEPLOYMENT_ID',
       '--project-name','ef-map','--format','json','--header','cf-ray:RAY_ID';
     $p = Start-Process -FilePath 'cmd.exe' -ArgumentList $argsList -NoNewWindow \
       -RedirectStandardOutput 'tmp_wr_tail.log' -RedirectStandardError 'tmp_wr_tail.err' -PassThru;
     Start-Sleep -Seconds 15;
     if (-not $p.HasExited) { $p.Kill() }
   }
   if (Test-Path 'tmp_wr_tail.err') { Get-Content 'tmp_wr_tail.err' }
   if (Test-Path 'tmp_wr_tail.log') { Get-Content 'tmp_wr_tail.log' }
   ```

   - `--header cf-ray:RAY_ID` narrows the stream to a single request.
   - Increase `Start-Sleep` if the traffic volume is high and you need a longer window.

3. **Inspect the captured file(s)**. Successful retrieval prints JSON lines like:

   ```json
   { "outcome": "exception", "logs": [...], "script_name": "pages" }
   ```

   If the files are empty, the Ray has likely aged out or belongs to another deployment/environment.

4. **Broaden the search if needed**:

   - Remove the `--header` filter and add `--status error` to show all failing invocations in the capture window.
   - Re-run the reproduction to generate a fresh Ray ID and repeat the steps immediately.

5. **Escalate for older Rays**:

   - Use Cloudflare Logpush or the Analytics GraphQL API to query historical logs by `rayName`.
   - Record any escalations in `docs/decision-log.md`.

## Cleanup

Delete temporary files when done:

```powershell
Remove-Item tmp_wr_tail.log,tmp_wr_tail.err -ErrorAction SilentlyContinue
```

## References

- [Cloudflare Wrangler tail docs](https://developers.cloudflare.com/workers/wrangler/commands/#tail)
- Existing support playbooks in `docs/support/`