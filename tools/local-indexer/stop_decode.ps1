$ErrorActionPreference = 'SilentlyContinue'
$repo = (Split-Path -Parent (Split-Path -Parent $PSScriptRoot))
if (-not $repo) { $repo = 'c:\EF-Map-main' }
$control = if ($env:CONTROL_PATH) { $env:CONTROL_PATH } else { Join-Path $repo 'data\local-indexer-control.json' }
try {
  $obj = @{ stop = $true }
  ($obj | ConvertTo-Json -Compress) | Set-Content -Path $control -Encoding UTF8
  Write-Output ("Wrote stop flag -> " + $control)
} catch {}
 