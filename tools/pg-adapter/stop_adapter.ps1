$procs = Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -like '*tools/pg-adapter/server.js*' }
if ($procs) {
  foreach ($p in $procs) { try { Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue } catch {} }
  Write-Host "[pg-adapter] stopped" -ForegroundColor Yellow
} else {
  Write-Host "[pg-adapter] not running"
}
