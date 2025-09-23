# Export top 10 rows for every table in a Postgres schema to CSV files.
# - Detects the running Postgres container for the Primordium indexer
# - Uses psql inside the container to \copy query results to /tmp
# - Copies the files back to the repo under tmp/pg_samples/<schema>/

param(
  [Parameter(Mandatory = $true)]
  [string]$Schema,

  [string]$OutDir = "tmp/pg_samples",

  # Optional: override docker container name running Postgres
  [string]$ContainerName,

  # DB credentials (defaults match local Primordium Postgres)
  [string]$PgUser = "user",
  [string]$PgPassword = "password",
  [string]$PgDb = "postgres"
)

$ErrorActionPreference = 'Stop'

function Write-Info($msg) { Write-Host "[info] $msg" -ForegroundColor Cyan }
function Write-Warn($msg) { Write-Host "[warn] $msg" -ForegroundColor Yellow }
function Write-Err($msg) { Write-Host "[err ] $msg" -ForegroundColor Red }

# Resolve repo root (this script lives under tools/pg)
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = Split-Path -Parent (Split-Path -Parent $ScriptDir)

# Create output directory
$SchemaOutDir = Join-Path -Path (Join-Path $RepoRoot $OutDir) -ChildPath $Schema
New-Item -ItemType Directory -Force -Path $SchemaOutDir | Out-Null

if (-not $ContainerName) {
  Write-Info "Detecting Postgres container..."
  $names = (& docker ps --format '{{.Names}}') 2>$null
  if (-not $names) { throw "No running docker containers found. Ensure the Primordium stack is up." }
  $candidate = $names | Where-Object { $_ -match 'pg-indexer.*postgres' } | Select-Object -First 1
  if (-not $candidate) {
    # Fallback: any container with 'postgres' in name
    $candidate = $names | Where-Object { $_ -match 'postgres' } | Select-Object -First 1
  }
  if (-not $candidate) { throw "Could not find a Postgres container. Provide -ContainerName explicitly." }
  $ContainerName = $candidate
}

Write-Info "Using container: $ContainerName"

# Prepare temp dir inside container
$ContainerTmpDir = "/tmp/pg_samples/$Schema"
& docker exec $ContainerName sh -lc "mkdir -p '$ContainerTmpDir'" | Out-Null

# Helper to run psql in container
function Invoke-PsqlInContainer([string]$sql, [switch]$Quiet) {
  $dockArgs = @('exec','-i','-e',"PGPASSWORD=$PgPassword", $ContainerName, 'psql','-U', $PgUser,'-d', $PgDb, '-v','ON_ERROR_STOP=1')
  if ($Quiet) { $dockArgs += '-q' }
  $dockArgs += @('-Atc', $sql)
  return & docker @dockArgs
}

# Run COPY (SELECT ...) TO STDOUT and write to a file inside the container using psql -o
function Invoke-PsqlCopyToFile([string]$sqlStatement, [string]$destFileInContainer) {
  $dockArgs = @('exec','-i','-e',"PGPASSWORD=$PgPassword", $ContainerName, 'psql','-U', $PgUser,'-d', $PgDb, '-v','ON_ERROR_STOP=1','-q','-c', $sqlStatement, '-o', $destFileInContainer)
  $out = & docker @dockArgs
  if ($LASTEXITCODE -ne 0) {
    throw ("psql exited {0}: {1}" -f $LASTEXITCODE, ($out -join "\n"))
  }
}

# List tables
Write-Info "Listing tables in schema '$Schema'..."
$listSql = "SELECT tablename FROM pg_tables WHERE schemaname = '$Schema' ORDER BY 1;"
$tablesRaw = Invoke-PsqlInContainer -sql $listSql -Quiet
$tables = @()
if ($tablesRaw) {
  if ($tablesRaw -is [array]) { $tables = $tablesRaw } else { $tables = @($tablesRaw) }
}
if (-not $tables -or $tables.Count -eq 0) { throw "No tables found in schema '$Schema'" }
Write-Info ("Found {0} tables" -f $tables.Count)

$summary = @()
$ok = 0; $fail = 0

foreach ($t in $tables) {
  $table = "$t".Trim()
  if ([string]::IsNullOrWhiteSpace($table)) { continue }
  $safeFile = $table -replace '[^A-Za-z0-9_\-\.]','_'
  $destInContainer = "$ContainerTmpDir/$safeFile.csv"

  Write-Info "Exporting top 10 from $Schema.$table ..."
  try {
    # Check for __last_updated_block_number
    $colSql = @"
SELECT 1
FROM information_schema.columns
WHERE table_schema = '$Schema'
  AND table_name = '$table'
  AND column_name = '__last_updated_block_number'
LIMIT 1;
"@
    $hasCol = Invoke-PsqlInContainer -sql $colSql -Quiet
  $orderClause = ''
  if ($hasCol) { $orderClause = ' ORDER BY __last_updated_block_number DESC NULLS LAST' }

  $innerSelect = ('SELECT * FROM "{0}"{1} LIMIT 10' -f $table, $orderClause)
  $stmt = ('SET search_path TO ''{0}''; COPY ({1}) TO STDOUT WITH (FORMAT CSV, HEADER)' -f $Schema, $innerSelect)
  Invoke-PsqlCopyToFile -sqlStatement $stmt -destFileInContainer $destInContainer

    $summary += @{ table = $table; rows = 10; file = "$safeFile.csv"; status = 'ok' }
    $ok += 1
  }
  catch {
    Write-Warn ("Failed exporting {0}.{1}: {2}" -f $Schema, $table, $_.Exception.Message)
    $summary += @{ table = $table; rows = 0; file = "$safeFile.csv"; status = 'error'; error = "$($_.Exception.Message)" }
    $fail += 1
  }
}

# Copy results back to host
Write-Info "Copying CSVs back to host: $SchemaOutDir"
& docker cp "$($ContainerName):$ContainerTmpDir/." "$SchemaOutDir" | Out-Null

# Cleanup container temp dir
& docker exec $ContainerName sh -lc "rm -rf '$ContainerTmpDir'" | Out-Null

# Write summary.json
$summaryObj = [ordered]@{
  schema = $Schema
  container = $ContainerName
  outputDir = (Resolve-Path $SchemaOutDir).Path
  exported = $ok
  failed = $fail
  total = $tables.Count
  generatedAt = (Get-Date).ToString('s')
  items = $summary
}
$summaryPath = Join-Path $SchemaOutDir 'summary.json'
$summaryObj | ConvertTo-Json -Depth 6 | Set-Content -Path $summaryPath -Encoding UTF8

Write-Host ""; Write-Info ("Done. Exported {0}/{1}. Summary: {2}" -f $ok, $tables.Count, $summaryPath)
