param(
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]] $Rest
)

$ErrorActionPreference = 'Stop'

# Locate the portable Node directory under tools/node-portable
$nodeRoot = Join-Path $PSScriptRoot 'node-portable'
$nodeDir = Get-ChildItem $nodeRoot -Directory | Select-Object -First 1
if (-not $nodeDir) {
    Write-Error "Portable Node not found under $nodeRoot. Please run the setup step to download Node 20."
    exit 1
}

$node = Join-Path $nodeDir.FullName 'node.exe'
# Build wrangler.js path robustly (avoid extra arguments to Join-Path)
$wranglerBase = Join-Path $PSScriptRoot '..'
$wranglerModules = Join-Path $wranglerBase 'node_modules'
$wranglerPkg = Join-Path $wranglerModules 'wrangler'
$wranglerBin = Join-Path $wranglerPkg 'bin'
$wranglerJs = Join-Path $wranglerBin 'wrangler.js'

if (-not (Test-Path $wranglerJs)) {
    Write-Error "Wrangler entrypoint not found at $wranglerJs. Ensure dependencies are installed (npm/pnpm i)."
    exit 1
}

& $node $wranglerJs @Rest

