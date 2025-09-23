param(
  [string]$NodeDir = "",
  [string]$WorkingDir = "",
  [switch]$Install
)

$ErrorActionPreference = 'Stop'

function Resolve-NodeDir {
  param([string]$Hint)
  $candidates = @()
  if ($Hint) { $candidates += $Hint }
  if ($env:NVM_SYMLINK) { $candidates += $env:NVM_SYMLINK }
  $candidates += @(
    "$env:USERPROFILE\AppData\Roaming\nvm\v18.20.4",
    "$env:USERPROFILE\AppData\Roaming\nvm\current",
    "$env:ProgramFiles\nodejs",
    "$env:ProgramFiles(x86)\nodejs"
  )
  foreach ($dir in $candidates) {
    if ($dir -and (Test-Path (Join-Path $dir 'node.exe'))) { return $dir }
  }
  return $null
}

$NodeDir = Resolve-NodeDir -Hint $NodeDir
if (-not $NodeDir) {
  Write-Host "[bootstrap] Could not find node.exe in common locations. Please provide -NodeDir." -ForegroundColor Red
  exit 1
}

$node = Join-Path $NodeDir 'node.exe'
$corepack = Join-Path $NodeDir 'corepack.cmd'

if (-not (Test-Path $node)) {
  Write-Host ("[bootstrap] node.exe not found in: " + $NodeDir) -ForegroundColor Red
  exit 1
}

if (-not (Test-Path $corepack)) {
  Write-Host ("[bootstrap] corepack.cmd not found in: " + $NodeDir) -ForegroundColor Red
  exit 1
}

# Prepend NodeDir to PATH for this session so corepack is found
$env:PATH = "$NodeDir;" + $env:PATH

& $node -v

# Enable and activate pnpm 8.x via corepack
& $corepack enable
& $corepack prepare pnpm@8.15.9 --activate
& $corepack pnpm -v

if ($WorkingDir -and (Test-Path $WorkingDir)) {
  Push-Location $WorkingDir
}

try {
  if ($Install) {
    Write-Host "[bootstrap] running: pnpm install" -ForegroundColor Cyan
    & $corepack pnpm install
  }
} finally {
  if ($WorkingDir -and (Test-Path $WorkingDir)) { Pop-Location }
}

Write-Host "[bootstrap] done" -ForegroundColor Green
