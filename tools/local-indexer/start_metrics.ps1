param(
  [int]$Port = 8733,
  [string]$DecodedDbPath
)

$ErrorActionPreference = 'SilentlyContinue'

# Paths
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path  # .../tools/local-indexer
$repoRoot = Split-Path -Parent $scriptDir                    # .../tools
$repoRoot = Split-Path -Parent $repoRoot                      # repo root
$metricsDir = Join-Path $repoRoot 'tools/local-indexer'
$scriptPath = Join-Path $metricsDir 'metrics_server.js'
$dataDir = Join-Path $repoRoot 'data'
$pidFile = Join-Path $dataDir 'metrics_server.pid'

try { New-Item -ItemType Directory -Force -Path $dataDir | Out-Null } catch {}

# Kill any existing listener on the target port
try {
  $existing = Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty OwningProcess
  if ($existing) { Stop-Process -Id $existing -Force -ErrorAction SilentlyContinue; Start-Sleep -Milliseconds 250 }
} catch {}

# Start metrics server detached, bound to 127.0.0.1 and fixed port
$env:PORT = "$Port"
if ($DecodedDbPath) { $env:DECODED_DB_PATH = $DecodedDbPath }
$node = 'node'
$argList = @($scriptPath, '--port', "$Port")
$proc = Start-Process -FilePath $node -ArgumentList $argList -PassThru -WindowStyle Minimized -WorkingDirectory $repoRoot

if ($proc -and $proc.Id) {
  try { Set-Content -Path $pidFile -Value $proc.Id -Encoding ascii } catch {}
  Write-Output ("metrics_started pid={0} port={1}" -f $proc.Id, $Port)
} else {
  Write-Output 'metrics_start_failed'
  exit 1
}
