$ErrorActionPreference = 'Stop'
# Fixed command only: URI contents are intentionally never passed to PowerShell.
$scutLauncher = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot 'start-assistant.ps1'))
if (-not (Test-Path -LiteralPath $scutLauncher -PathType Leaf)) { throw 'Launcher missing' }
$scutPowerShell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$scutProtocolKey = 'HKCU:\Software\Classes\scut-classroom'
$scutCommandKey = Join-Path $scutProtocolKey 'shell\open\command'
New-Item -Path $scutCommandKey -Force | Out-Null
Set-Item -LiteralPath $scutProtocolKey -Value 'URL:SCUT Classroom Assistant'
New-ItemProperty -LiteralPath $scutProtocolKey -Name 'URL Protocol' -Value '' -PropertyType String -Force | Out-Null
$scutCommand = '"' + $scutPowerShell + '" -NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + $scutLauncher + '" -NoBrowser'
Set-Item -LiteralPath $scutCommandKey -Value $scutCommand
Write-Host 'Browser launcher registered for this Windows user. No startup task was created.'
