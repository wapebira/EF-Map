$ErrorActionPreference = 'SilentlyContinue'
# Kill existing ingest
$regex = 'tools\\local-indexer\\ingest_raw.js'
$procs = Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -match $regex }
if ($procs) {
  foreach ($p in $procs) { try { Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue } catch {} }
}
Start-Sleep -Milliseconds 500
# Start fresh
& "c:\EF-Map-main\tools\local-indexer\start_ingest.ps1"
