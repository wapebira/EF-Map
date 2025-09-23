$ErrorActionPreference = 'SilentlyContinue'
$port = 8731
# Kill by port listener
$conn = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
if ($conn) {
  $pids = $conn | Select-Object -ExpandProperty OwningProcess -Unique
  foreach ($pid in $pids) {
    try {
      Write-Output ("Stopping PID listening on ${port}: " + $pid)
      Stop-Process -Id $pid -Force -ErrorAction SilentlyContinue
    } catch {}
  }
}
# Kill any node running status_server.js by command line match
$regex = 'tools\\local-indexer\\status_server.js'
$procs = Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -match $regex }
if ($procs) {
  foreach ($p in $procs) {
    try {
      Write-Output ("Stopping status_server process PID " + $p.ProcessId)
      Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue
    } catch {}
  }
}
Start-Sleep -Seconds 1
Write-Output 'Starting status_server.js'
Start-Process -FilePath node -ArgumentList "c:\EF-Map-main\tools\local-indexer\status_server.js" -NoNewWindow
# Wait for listener and print command line
Start-Sleep -Seconds 1
$try = 0
while ($try -lt 10) {
  $listen = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
  if ($listen) {
    $pid = $listen | Select-Object -First 1 -ExpandProperty OwningProcess
    $cmd = (Get-CimInstance Win32_Process -Filter "ProcessId=$pid").CommandLine
    Write-Output ("Now listening on ${port} by PID=" + $pid)
    Write-Output $cmd
    break
  }
  Start-Sleep -Milliseconds 300
  $try++
}