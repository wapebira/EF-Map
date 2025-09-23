Param(
  [int]$TimeoutMs = 20000,
  [int]$SolarsystemsLimit = 2000,
  [int]$TribesLimit = 1000,
  [string]$WorldApiBase = "https://world-api-stillness.live.tech.evefrontier.com"
)
# For now this calls the same pipeline as fast; limits differ. Non-blocking.
& (Join-Path (Split-Path -Parent $PSCommandPath) 'run_world_api_dlt_fast.ps1') -TimeoutMs $TimeoutMs -SolarsystemsLimit $SolarsystemsLimit -TribesLimit $TribesLimit -WorldApiBase $WorldApiBase
param(
  [string]$Base = 'https://world-api-stillness.live.tech.evefrontier.com',
  [int]$LimitSolarsystems = 2000,
  [int]$LimitTribes = 1000
)
$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent -Path $MyInvocation.MyCommand.Path
$runner = Join-Path $here 'run_world_api_dlt.ps1'
& $runner -Base $Base -LimitSolarsystems $LimitSolarsystems -LimitTribes $LimitTribes -TimeoutMs 20000
Param(
	[string]$WorldApiBase = "https://world-api-stillness.live.tech.evefrontier.com"
)

$here = Split-Path -Parent $MyInvocation.MyCommand.Definition
& (Join-Path $here 'run_world_api_dlt_fast.ps1') -WorldApiBase $WorldApiBase

