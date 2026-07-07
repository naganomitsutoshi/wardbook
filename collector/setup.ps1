$ErrorActionPreference = "Stop"

function Read-SecretText([string]$Prompt) {
  $secure = Read-Host $Prompt -AsSecureString
  $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try {
    return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)
  } finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)
  }
}

$configSource = Read-Host "Firebase config file path (leave blank to paste inline)"
if ($configSource) {
  $firebaseConfig = Get-Content -Raw -LiteralPath $configSource
} else {
  Write-Host "Paste firebaseConfig JSON/text. Finish with an empty line."
  $lines = @()
  while ($true) {
    $line = Read-Host
    if ($line -eq "") { break }
    $lines += $line
  }
  $firebaseConfig = ($lines -join [Environment]::NewLine)
}

$email = Read-Host "Email"
$password = Read-SecretText "Password"
$passphrase = Read-SecretText "Passphrase"

# The Firebase console snippet is JavaScript, not strict JSON. Extract the two
# values the collector needs by regex (same approach as the app UI).
function Get-ConfigValue([string]$Text, [string]$Key) {
  $m = [regex]::Match($Text, $Key + '["'']?\s*[:=]\s*["'']([^"'']+)["'']')
  if ($m.Success) { return $m.Groups[1].Value }
  return $null
}
$apiKey = Get-ConfigValue $firebaseConfig "apiKey"
$projectId = Get-ConfigValue $firebaseConfig "projectId"
if (-not $apiKey -or -not $projectId) {
  Write-Error "Could not extract apiKey/projectId from the pasted config."
}

Add-Type -AssemblyName System.Security
$core = Join-Path $PSScriptRoot "core.mjs"
$payload = @{
  firebaseConfig = @{ apiKey = $apiKey; projectId = $projectId }
  email = $email
  password = $password
  passphrase = $passphrase
} | ConvertTo-Json -Depth 10 -Compress

$result = $payload | node $core setup
if ($LASTEXITCODE -ne 0) {
  Write-Error "core.mjs setup failed (exit $LASTEXITCODE)"
}
$bytes = [Text.Encoding]::UTF8.GetBytes($result.Trim())
$protected = [Security.Cryptography.ProtectedData]::Protect($bytes, $null, [Security.Cryptography.DataProtectionScope]::CurrentUser)
$targetDir = Join-Path $env:APPDATA "wardbook"
New-Item -ItemType Directory -Force -Path $targetDir | Out-Null
[IO.File]::WriteAllBytes((Join-Path $targetDir "collector.dat"), $protected)
Write-Host "Saved collector.dat"
