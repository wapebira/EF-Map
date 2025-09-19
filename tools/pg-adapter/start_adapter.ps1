param(
  [int]$Port = 8850,
  [string]$PgUrl = "postgres://postgres:postgres@127.0.0.1:5432/ef_indexer"
)
$ErrorActionPreference = 'Stop'
# Use cmd.exe to reliably pass env to child on Windows PowerShell 5.1
$cmd = "cmd.exe"
# Build command via format string to avoid escaping pitfalls in PS5.1
$cmdLine = 'set "PG_ADAPTER_PORT={0}" && set "PG_URL={1}" && node tools\pg-adapter\server.js' -f $Port, $PgUrl
$procArgs = @('/c', $cmdLine)
Write-Host "[pg-adapter] starting on :$Port -> $PgUrl"
Start-Process -WindowStyle Hidden -FilePath $cmd -ArgumentList $procArgs
Start-Sleep -Milliseconds 600
try {
  $r = Invoke-WebRequest -UseBasicParsing -Uri ("http://127.0.0.1:"+$Port+"/health") -TimeoutSec 4
  Write-Host ("[pg-adapter] health " + $r.StatusCode) -ForegroundColor Green
} catch {
  Write-Host ("[pg-adapter] no health yet") -ForegroundColor Yellow
}
