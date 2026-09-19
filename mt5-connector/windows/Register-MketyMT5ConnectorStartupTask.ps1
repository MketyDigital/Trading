param(
  [Parameter(Mandatory = $true)]
  [string]$ConnectorExe,

  [Parameter(Mandatory = $true)]
  [string]$TerminalExe,

  [string]$TaskName = "Mkety MT5 Connector",
  [string]$ConfigPath = "",
  [string]$LedgerPath = ""
)

$ErrorActionPreference = "Stop"

function Require-File([string]$Path, [string]$Label) {
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
    throw "$Label not found: $Path"
  }
}

Require-File $ConnectorExe "MketyMT5Connector.exe"
Require-File $TerminalExe "MetaTrader terminal64.exe"

$connector = (Resolve-Path -LiteralPath $ConnectorExe).Path
$terminal = (Resolve-Path -LiteralPath $TerminalExe).Path

$arguments = @("--terminal", ('"{0}"' -f $terminal))
if ($ConfigPath) {
  $configParent = Split-Path -Parent $ConfigPath
  if ($configParent -and -not (Test-Path -LiteralPath $configParent)) {
    New-Item -ItemType Directory -Path $configParent -Force | Out-Null
  }
  $arguments += @("--config", ('"{0}"' -f $ConfigPath))
}
if ($LedgerPath) {
  $ledgerParent = Split-Path -Parent $LedgerPath
  if ($ledgerParent -and -not (Test-Path -LiteralPath $ledgerParent)) {
    New-Item -ItemType Directory -Path $ledgerParent -Force | Out-Null
  }
  $arguments += @("--ledger", ('"{0}"' -f $LedgerPath))
}

$action = New-ScheduledTaskAction -Execute $connector -Argument ($arguments -join " ")
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero)
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Highest

$task = New-ScheduledTask -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Description "Starts Mkety MT5 outbound connector at Windows logon and restarts it if the connector process exits."

Register-ScheduledTask -TaskName $TaskName -InputObject $task -Force | Out-Null

Write-Host "Registered scheduled task: $TaskName"
Write-Host "Connector: $connector"
Write-Host "Terminal:  $terminal"
Write-Host "The task adds no second always-running watchdog process."
