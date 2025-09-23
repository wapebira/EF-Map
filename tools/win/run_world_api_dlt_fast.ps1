Param(
  [int]$TimeoutMs = 20000,
  [int]$SolarsystemsLimit = 1000,
  [int]$TribesLimit = 500,
  [int]$TypesLimit = 1000,
  [int]$FuelsLimit = 500,
  [int]$SmartassembliesLimit = 1000,
  [int]$SmartcharactersLimit = 1000,
  [int]$KillmailsLimit = 500,
  [string]$WorldApiBase = "https://world-api-stillness.live.tech.evefrontier.com",
  [int]$ListTtlMin = 1440,
  [int]$RotateSolarsystems = 200,
  [int]$RotateTribes = 100,
  [int]$RotateTypes = 250,
  [int]$RotateSmartchars = 500,
  [int]$DetailThrottleMs = 0,
  [string]$WorkerPostUrl,
  [string]$WorkerAdminToken
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent (Split-Path -Parent (Split-Path -Parent $PSCommandPath))
$pyCmd = $null
$pyCmd = Get-Command python -ErrorAction SilentlyContinue
if(-not $pyCmd){ $pyCmd = Get-Command py -ErrorAction SilentlyContinue }
if(-not $pyCmd){ Write-Error "Python not found. Install Python 3 and ensure it's on PATH." }

$env:WORLD_API_TIMEOUT_MS = [string]$TimeoutMs
$env:WORLD_API_LIMIT_SOLARSYSTEMS = [string]$SolarsystemsLimit
$env:WORLD_API_LIMIT_TRIBES = [string]$TribesLimit
$env:WORLD_API_LIMIT_TYPES = [string]$TypesLimit
$env:WORLD_API_LIMIT_FUELS = [string]$FuelsLimit
$env:WORLD_API_LIMIT_SMARTASSEMBLIES = [string]$SmartassembliesLimit
$env:WORLD_API_LIMIT_SMARTCHARS = [string]$SmartcharactersLimit
$env:WORLD_API_LIMIT_KILLMAILS = [string]$KillmailsLimit
$env:WORLD_API_BASE = $WorldApiBase
$env:WORLD_API_LIST_TTL_MIN = [string]$ListTtlMin
$env:WORLD_API_ROTATE_SOLARSYSTEMS = [string]$RotateSolarsystems
$env:WORLD_API_ROTATE_TRIBES = [string]$RotateTribes
$env:WORLD_API_ROTATE_TYPES = [string]$RotateTypes
$env:WORLD_API_ROTATE_SMARTCHARS = [string]$RotateSmartchars
$env:WORLD_API_DETAIL_THROTTLE_MS = [string]$DetailThrottleMs
if($WorkerPostUrl){ $env:WORKER_POST_URL = $WorkerPostUrl }
if($WorkerAdminToken){ $env:WORKER_ADMIN_TOKEN = $WorkerAdminToken }

$script = Join-Path $repoRoot 'tools\world_api_dlt\pipeline.py'
if(-not (Test-Path $script)){ Write-Error "Pipeline missing: $script" }

# Start-Process in background with logs redirected (non-blocking)
$logDir = Join-Path $repoRoot 'scratch\world_api'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$ts = Get-Date -Format 'yyyyMMdd_HHmmss'
$outLog = Join-Path $logDir ("fast_run_" + $ts + "_out.log")
$errLog = Join-Path $logDir ("fast_run_" + $ts + "_err.log")

Write-Output ("Running World API fetch (base={0}, solarsystems={1}, tribes={2}, types={3}, fuels={4}, smartassemblies={5}, smartcharacters={6}, killmails={7}, timeoutMs={8}, listTtlMin={9}, rotate: sol={10} trb={11} types={12} sch={13}, detailThrottleMs={14})" -f $WorldApiBase, $SolarsystemsLimit, $TribesLimit, $TypesLimit, $FuelsLimit, $SmartassembliesLimit, $SmartcharactersLimit, $KillmailsLimit, $TimeoutMs, $ListTtlMin, $RotateSolarsystems, $RotateTribes, $RotateTypes, $RotateSmartchars, $DetailThrottleMs)
$postMsg = if($WorkerPostUrl){ " -> post:"+$WorkerPostUrl } else { '' }
Write-Output ("Counts will be posted to worker if configured{0}" -f $postMsg)
$argsList = @('-u', $script)
$proc = Start-Process -FilePath $pyCmd.Path -ArgumentList $argsList -WindowStyle Hidden -PassThru -RedirectStandardOutput $outLog -RedirectStandardError $errLog -WorkingDirectory $repoRoot
Write-Output "Started fast World API fetch (PID=$($proc.Id)). Logs: $outLog | $errLog"
exit 0

