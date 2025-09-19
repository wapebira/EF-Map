Param(
  [Parameter(Mandatory=$true)][string]$SqlFile,
  [string]$Container = 'pg-indexer-reader-postgres-1'
)

$ErrorActionPreference = 'Stop'
if (!(Test-Path $SqlFile)) { throw "SQL not found: $SqlFile" }

$tmp = "/tmp/run_$(Get-Random).sql"
docker cp $SqlFile ${Container}:$tmp | Out-Null
docker exec $Container bash -lc "psql -U user -d postgres -P pager=off -f $tmp" | Write-Host
