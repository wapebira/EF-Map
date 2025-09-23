$ErrorActionPreference = 'SilentlyContinue'
$repo = (Split-Path -Parent (Split-Path -Parent $PSScriptRoot))
if (-not $repo) { $repo = 'c:\EF-Map-main' }

$env:LOCAL_DB_PATH   = if ($env:LOCAL_DB_PATH)   { $env:LOCAL_DB_PATH }   else { Join-Path $repo 'data\local-indexer.db' }
$env:DECODED_DB_PATH = if ($env:DECODED_DB_PATH) { $env:DECODED_DB_PATH } else { Join-Path $repo 'data\local-indexer-decoded.db' }
$env:STATUS_PATH     = if ($env:STATUS_PATH)     { $env:STATUS_PATH }     else { Join-Path $repo 'data\local-indexer-status.json' }
$env:MUD_CHUNK       = if ($env:MUD_CHUNK)       { $env:MUD_CHUNK }       else { 10000 }
# Optional validation cap: uncomment or set in env
# $env:MUD_MAX_ROWS = 200000

$node = 'node'
$script = (Join-Path $repo 'tools\local-indexer\materialize_mud_setrecord.js')
$p = Start-Process -FilePath $node -ArgumentList $script -WorkingDirectory $repo -WindowStyle Hidden -PassThru
if ($p -and $p.Id) { Write-Output ("MUD PID=" + $p.Id) }
exit 0
