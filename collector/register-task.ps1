$ErrorActionPreference = "Stop"

$scriptPath = Join-Path $PSScriptRoot "collect.ps1"
$taskName = "WardbookCollector"
$command = "powershell.exe -NoProfile -ExecutionPolicy Bypass -File `"$scriptPath`""
schtasks /Create /F /SC DAILY /ST 21:30 /TN $taskName /TR $command | Out-Host
Write-Host "Registered task $taskName for 21:30 daily."
