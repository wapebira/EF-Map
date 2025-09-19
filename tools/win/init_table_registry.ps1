Param(
  [string]$Container = 'pg-indexer-reader-postgres-1'
)

$ErrorActionPreference = 'Stop'

$sqlPath = Join-Path $PSScriptRoot '..\sql\create_table_registry.sql'
if (!(Test-Path $sqlPath)) { throw "SQL file not found: $sqlPath" }

Write-Host "Creating meta.table_registry in container '$Container'..."
docker cp $sqlPath ${Container}:/tmp/create_table_registry.sql | Out-Null
docker exec $Container bash -lc "psql -U user -d postgres -f /tmp/create_table_registry.sql" | Write-Host
Write-Host "Done."
