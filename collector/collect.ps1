$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Security

$path = Join-Path (Join-Path $env:APPDATA "wardbook") "collector.dat"
if (-not (Test-Path -LiteralPath $path)) {
  Write-Error "collector.dat not found. Run setup.ps1 first."
}

$core = Join-Path $PSScriptRoot "core.mjs"
$protected = [IO.File]::ReadAllBytes($path)
$bytes = [Security.Cryptography.ProtectedData]::Unprotect($protected, $null, [Security.Cryptography.DataProtectionScope]::CurrentUser)
$payload = [Text.Encoding]::UTF8.GetString($bytes)
$resultJson = $payload | node $core collect
if ($LASTEXITCODE -ne 0) {
  Write-Error "core.mjs collect failed (exit $LASTEXITCODE)"
}
$result = $resultJson | ConvertFrom-Json

if ($result.newRefreshToken) {
  $state = $payload | ConvertFrom-Json
  $state.refreshToken = $result.newRefreshToken
  $nextBytes = [Text.Encoding]::UTF8.GetBytes(($state | ConvertTo-Json -Depth 10 -Compress))
  $nextProtected = [Security.Cryptography.ProtectedData]::Protect($nextBytes, $null, [Security.Cryptography.DataProtectionScope]::CurrentUser)
  [IO.File]::WriteAllBytes($path, $nextProtected)
}

Write-Host ($result | ConvertTo-Json -Compress)
if (($result.appended + $result.skipped) -lt 0) {
  exit 1
}
