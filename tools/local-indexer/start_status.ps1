$ErrorActionPreference = 'SilentlyContinue'
$port = if ($env:STATUS_PORT) { [int]$env:STATUS_PORT } else { 8736 }
$env:STATUS_PORT = $port
Write-Output ("Starting status server on port " + $port)
Start-Process -FilePath node -ArgumentList 'c:\EF-Map-main\tools\local-indexer\status_server.js' -NoNewWindow