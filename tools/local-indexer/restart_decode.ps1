param(
  [Nullable[int]]$MaxMs,
  [Nullable[int]]$MaxRows
)
$ErrorActionPreference = 'SilentlyContinue'

$repo = (Split-Path -Parent (Split-Path -Parent $PSScriptRoot))
if (-not $repo) { $repo = 'c:\EF-Map-main' }

# Kill any existing decode
& (Join-Path $PSScriptRoot 'kill_decode.ps1') | Out-Null

# Small wait to free locks
Start-Sleep -Milliseconds 250

# Start fresh decode (propagate caps if provided)
if ($PSBoundParameters.ContainsKey('MaxMs') -and $PSBoundParameters.ContainsKey('MaxRows')) {
  & (Join-Path $PSScriptRoot 'start_decode.ps1') -MaxMs $MaxMs -MaxRows $MaxRows
} elseif ($PSBoundParameters.ContainsKey('MaxMs')) {
  & (Join-Path $PSScriptRoot 'start_decode.ps1') -MaxMs $MaxMs
} elseif ($PSBoundParameters.ContainsKey('MaxRows')) {
  & (Join-Path $PSScriptRoot 'start_decode.ps1') -MaxRows $MaxRows
} else {
  & (Join-Path $PSScriptRoot 'start_decode.ps1')
}
