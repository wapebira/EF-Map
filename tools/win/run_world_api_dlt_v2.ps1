# Runs the new dlt/OpenAPI ingestion scaffold locally (one-shot)
param(
  [string]$ConfigPath = "c:\\EF-Map-main\\tools\\world_api_dlt_v2\\config.yaml"
)

$ErrorActionPreference = 'Stop'

$py = Get-Command python -ErrorAction SilentlyContinue
if (-not $py) { throw 'python not found on PATH' }

Write-Host "Running ingestion with config: $ConfigPath" -ForegroundColor Cyan
python "c:\\EF-Map-main\\tools\\world_api_dlt_v2\\ingest_openapi.py" "$ConfigPath"
