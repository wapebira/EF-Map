$ErrorActionPreference = 'SilentlyContinue'
$repo = (Split-Path -Parent (Split-Path -Parent $PSScriptRoot))
if (-not $repo) { $repo = 'c:\EF-Map-main' }

$env:DECODED_DB_PATH = if ($env:DECODED_DB_PATH) { $env:DECODED_DB_PATH } else { Join-Path $repo 'data\local-indexer-decoded.db' }
$env:STATUS_PATH     = if ($env:STATUS_PATH)     { $env:STATUS_PATH }     else { Join-Path $repo 'data\local-indexer-status.json' }

$node = 'node'
$script = (Join-Path $repo 'tools\local-indexer\materialize_erc721.js')
$p = Start-Process -FilePath $node -ArgumentList $script -WorkingDirectory $repo -WindowStyle Hidden -PassThru
if ($p -and $p.Id) { Write-Output ("ERC721 PID=" + $p.Id) }
exit 0
