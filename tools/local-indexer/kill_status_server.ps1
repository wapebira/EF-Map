$ErrorActionPreference = 'SilentlyContinue'
$regex = 'status_server\.js'
$procs = Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -match $regex }
if ($procs) {
  foreach ($p in $procs) {
    Write-Output ("Stopping status server PID " + $p.ProcessId)
    Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue
  }
} else {
  Write-Output 'No status_server.js process found'
}
