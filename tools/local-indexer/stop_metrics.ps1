$repo = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$pidFile = Join-Path $repo '..' | Join-Path -ChildPath 'data/metrics_server.pid'
if (Test-Path $pidFile) {
  try {
    $pid = Get-Content -Path $pidFile | Select-Object -First 1
    if ($pid) { Stop-Process -Id $pid -Force -ErrorAction SilentlyContinue }
    Remove-Item $pidFile -Force -ErrorAction SilentlyContinue
    Write-Output "metrics_stopped pid=$pid"
  } catch {
    Write-Output 'metrics_stop_error'
  }
} else {
  Write-Output 'metrics_no_pid'
}
