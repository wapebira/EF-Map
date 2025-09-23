param(
  [string]$Base = $env:WORLD_API_BASE,
  [int]$LimitSolarsystems = [int]($env:WORLD_API_LIMIT_SOLARSYSTEMS | ForEach-Object { if($_){$_} else {1000} }),
  [int]$LimitTribes = [int]($env:WORLD_API_LIMIT_TRIBES | ForEach-Object { if($_){$_} else {500} }),
  [int]$TimeoutMs = [int]($env:WORLD_API_TIMEOUT_MS | ForEach-Object { if($_){$_} else {12000} })
)

$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent -Path $MyInvocation.MyCommand.Path
$root1 = Resolve-Path (Join-Path $here '..') | Select-Object -ExpandProperty Path
$repo = Resolve-Path (Join-Path $root1 '..') | Select-Object -ExpandProperty Path
$pyScript = Join-Path $repo 'tools/world_api_dlt/pipeline.py'

if(-not (Test-Path $pyScript)){
  Write-Error "pipeline.py not found at $pyScript"
}

if([string]::IsNullOrWhiteSpace($Base)){ $Base = 'https://world-api-stillness.live.tech.evefrontier.com' }

$env:WORLD_API_BASE = $Base
$env:WORLD_API_LIMIT_SOLARSYSTEMS = [string]$LimitSolarsystems
$env:WORLD_API_LIMIT_TRIBES = [string]$LimitTribes
$env:WORLD_API_TIMEOUT_MS = [string]$TimeoutMs

function Invoke-Py {
  param([string]$Script)
  # Prefer py launcher, fallback to python
  $cmds = @('py -3', 'python')
  foreach($c in $cmds){
    try {
      $pinfo = New-Object System.Diagnostics.ProcessStartInfo
      $pinfo.FileName = 'cmd.exe'
      $pinfo.Arguments = "/c $c `"$Script`""
      $pinfo.RedirectStandardOutput = $true
      $pinfo.RedirectStandardError = $true
      $pinfo.UseShellExecute = $false
      $p = [System.Diagnostics.Process]::Start($pinfo)
      $stdout = $p.StandardOutput.ReadToEnd()
      $stderr = $p.StandardError.ReadToEnd()
      $p.WaitForExit()
      if($p.ExitCode -eq 0){
        if($stdout){ Write-Output $stdout.TrimEnd() }
        return 0
      } else {
        Write-Verbose "$($c) exit $($p.ExitCode): $stderr"
      }
    } catch {
      Write-Verbose "Invoke failed for $($c): $($_.Exception.Message)"
    }
  }
  Write-Error "No working Python interpreter found (tried 'py -3' and 'python'). Install Python 3 and ensure it is on PATH."
}

Write-Host "Running World API fetch (base=$Base, solarsystems=$LimitSolarsystems, tribes=$LimitTribes, timeoutMs=$TimeoutMs)" -ForegroundColor Cyan
$code = Invoke-Py -Script $pyScript
exit $code

