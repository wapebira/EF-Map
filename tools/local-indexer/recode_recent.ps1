param(
  [int]$WindowBlocks = 32
)
$ErrorActionPreference = 'SilentlyContinue'

$repo = (Split-Path -Parent (Split-Path -Parent $PSScriptRoot))
if (-not $repo) { $repo = 'c:\EF-Map-main' }

$dbPath = if ($env:LOCAL_DB_PATH) { $env:LOCAL_DB_PATH } else { Join-Path $repo 'data\local-indexer.db' }
$statusPath = if ($env:STATUS_PATH) { $env:STATUS_PATH } else { Join-Path $repo 'data\local-indexer-status.json' }

function Read-Json([string]$p) { try { Get-Content -Raw -Path $p | ConvertFrom-Json } catch { $null } }
function Write-Json([string]$p, $obj) { try { $dir = Split-Path -Parent $p; if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir | Out-Null }; ($obj | ConvertTo-Json -Depth 6) | Out-File -Encoding utf8 -FilePath $p } catch {} }

$s = Read-Json $statusPath
if (-not $s) { Write-Output 'No status.json found'; exit 1 }

$safeHead = 0
if ($s.safeHead) { $safeHead = [int]$s.safeHead }
elseif ($s.head) { $safeHead = [int]$s.head }
if ($safeHead -le 0) { Write-Output 'No safeHead/head available'; exit 1 }

$fromBlock = [Math]::Max(0, $safeHead - $WindowBlocks)
Write-Output ("Recode recent window: blocks " + $fromBlock + ".." + $safeHead)

# Mark control stop to ensure decode worker halts
try { & (Join-Path $PSScriptRoot 'stop_decode.ps1') | Out-Null } catch {}
try { & (Join-Path $PSScriptRoot 'kill_decode.ps1') | Out-Null } catch {}

# For now, we rely on decode_apply.js being idempotent and progress-only.
# If materialized typed tables exist, a companion cleanup would be needed here.

# Resume decode with caps that focus on the recent window timebox (optional)
& (Join-Path $PSScriptRoot 'start_decode.ps1') -MaxMs 0 -MaxRows 0 | Out-Null

Write-Output 'Recode initiated.'
