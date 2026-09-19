# MT5 Connector Windows Operations

## Purpose

The Mkety MT5 outbound connector already contains its own WebSocket reconnect loop. If the gateway drops, DNS changes, the network blips, or the OCI gateway restarts, the same connector process reconnects automatically and retries after three seconds.

A separate always-running watchdog is therefore unnecessary for normal operation and would only add another process to the Windows VPS.

The remaining operational gap is process or Windows restart: if `MketyMT5Connector.exe` is closed, crashes, or Windows reboots, Windows needs a way to start it again.

## Recommended low-overhead setup

Use Windows Task Scheduler at interactive user logon.

Repository helper: `mt5-connector/windows/Register-MketyMT5ConnectorStartupTask.ps1`

The scheduled task starts the existing connector executable with the exact MT5 `terminal64.exe` path. The connector then calls the MetaTrader5 API initialization against that terminal and uses the already-persisted local pairing/reconnect token.

The task itself is not an additional resident watchdog process. Task Scheduler is part of Windows, and the only steady-state Mkety process remains the connector executable already required for trading.

### Example

```powershell
PowerShell -ExecutionPolicy Bypass -File .\Register-MketyMT5ConnectorStartupTask.ps1 `
  -ConnectorExe "C:\Mkety\MketyMT5Connector.exe" `
  -TerminalExe "C:\Program Files\MetaTrader 5\terminal64.exe" `
  -TaskName "Mkety MT5 - FBS Live"
```

For multiple MT5 installations/accounts on the same VPS, register a separate task for each connector instance and use separate config/ledger files.

## What this protects against

- Windows user logon after a reboot.
- Connector executable process exit/crash.
- Gateway/network disconnects are already handled internally by the connector and do not require Task Scheduler intervention.

## What it does not replace

This does not alter Mkety runtime gates. Trading still requires persisted workspace/account controls, global broker controls, LIVE controls for LIVE accounts, authoritative broker symbol resolution, valid volume constraints, available margin, broker trading permissions, and successful broker responses.

If the MT5 terminal itself becomes internally unhealthy while both processes remain alive, inspect connector/gateway heartbeat and the MT5 terminal session first. Do not add aggressive restart loops unless live observation shows that condition repeatedly.

## VPS resource posture

For a small Windows VPS, this Task Scheduler approach is preferred over NSSM, a custom Windows service, or a separate polling watchdog because it adds essentially no extra continuous application workload. Keep one connector process per connected MT5 terminal/account.
