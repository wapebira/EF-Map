param(
  [string]$AccountId,
  [string]$Title = "EF_SNAPSHOTS",
  [switch]$Quiet
)

# Purpose: Create (or find) a Cloudflare KV namespace with the given Title and print its ID.
# Requirements: Cloudflare API Token with Workers KV permissions.
# Token retrieval order: env var CF_API_TOKEN -> interactive prompt (masked).

$ErrorActionPreference = 'Stop'

function Get-TokenPlain {
  if($env:CF_API_TOKEN -and $env:CF_API_TOKEN.Trim().Length -gt 0){
    return $env:CF_API_TOKEN.Trim()
  }
  Write-Host "CF_API_TOKEN not found in environment."
  $secure = Read-Host -AsSecureString -Prompt "Operator: paste Cloudflare API Token (input hidden)"
  $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try {
    $plain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
  } finally {
    if($bstr -ne [IntPtr]::Zero){ [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
  }
  if(-not $plain -or $plain.Trim().Length -eq 0){ throw 'No API token provided.' }
  return $plain.Trim()
}

function Ensure-AccountId([string]$Given){
  if($Given -and $Given.Trim().Length -gt 0){ return $Given.Trim() }
  $tmpPath = Join-Path $PSScriptRoot '..' | Join-Path -ChildPath '..' | Join-Path -ChildPath 'tmp_cf_account_id.txt'
  if(Test-Path $tmpPath){
    $id = (Get-Content -Raw $tmpPath).Trim()
    if($id.Length -gt 0){ return $id }
  }
  throw 'Account ID not provided and tmp_cf_account_id.txt missing. Provide -AccountId.'
}

$AccountId = (Ensure-AccountId -Given $AccountId).Trim()
$Token = Get-TokenPlain

$base = "https://api.cloudflare.com/client/v4/accounts/$AccountId/storage/kv/namespaces"
$null = $base # keep for scope
$baseTrim = $base.Trim()
try { [void]([Uri]$baseTrim) } catch { Write-Host "Debug: Invalid base URI constructed: '$baseTrim'"; throw }
$headers = @{ Authorization = "Bearer $Token"; 'Content-Type' = 'application/json' }

try {
  # 1) List existing namespaces to avoid duplicates
  $listUri = "$baseTrim?per_page=100"
  $list = Invoke-RestMethod -Uri $listUri -Headers $headers -Method GET
  $existing = $null
  if($list.success -and $list.result){
    $existing = $list.result | Where-Object { $_.title -eq $Title } | Select-Object -First 1
  }
  if($existing){
    if(-not $Quiet){ Write-Host "Found existing KV namespace '$Title' with id: $($existing.id)" }
    $nsId = $existing.id
  } else {
    # 2) Create the namespace
    if(-not $Quiet){ Write-Host "Creating KV namespace '$Title'..." }
    $body = @{ title = $Title } | ConvertTo-Json
    $resp = Invoke-RestMethod -Uri $baseTrim -Headers $headers -Method POST -Body $body
    if(-not $resp.success){ throw "Cloudflare API error creating namespace: $($resp | ConvertTo-Json -Depth 6)" }
    $nsId = $resp.result.id
    if(-not $Quiet){ Write-Host "Created KV namespace '$Title' with id: $nsId" }
  }

  # 3) Write to tmp file for convenience
  $root = Resolve-Path (Join-Path $PSScriptRoot '..' | Join-Path -ChildPath '..')
  $outFile = Join-Path $root 'tmp_cf_snapshots_ns.txt'
  Set-Content -Path $outFile -Value $nsId -NoNewline
  if(-not $Quiet){ Write-Host "Wrote namespace id to $outFile" }

  # 4) Print the id as the only output for easy capture
  Write-Output $nsId
} catch {
  Write-Error $_
  exit 1
}
