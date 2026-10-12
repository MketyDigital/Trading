# Mkety MT5 Multi-Terminal Manager Design

**Status:** Approved for implementation; release/deployment remains separate
**Scope:** Windows/Windows VPS connector UX and per-terminal process management. This document does not authorize implementation, release, or deployment.

## Goals

- Preserve the existing single-terminal pairing behavior for current users.
- Make first-time setup easy for one or several MT5 terminals.
- Let returning users see which saved terminals and connector sessions are running, then add more terminals without mixing identities or credentials.
- Support selecting already-installed/running terminals and adding a fresh terminal from an installer file or the official MetaQuotes download flow.
- Keep the connector download universal across brokers and keep Mkety as the authority for account identity and execution permissions.
- Add no behavior that scans, edits, closes, or otherwise manages existing positions or pending orders.

## User flows

### First run on a PC/VPS

1. The connector checks known MT5 install locations and currently running MT5 processes. It does not scan every disk by default.
2. If it finds an MT5 terminal, it lists each distinct executable path and labels it **Running** or **Installed**. The user chooses **Connect one terminal** or **Set up multiple terminals**; one terminal is the default.
3. If none is found, the user can browse to an MT5 installer they already have or open the official MetaQuotes download page. The installer runs interactively. The connector never enters broker credentials or silently installs software.
4. For each account, the user selects a terminal, starts it if needed, logs in to the broker inside MT5, and returns to the connector. The connector displays the detected account number, server, and Demo/Live state before the user assigns that terminal its own Mkety pairing token.
5. Each connection follows the existing gateway pairing exchange. The user returns to Mkety and syncs each account identity independently. An optional **Sync all pending identities** action may call the existing per-account sync operation for each selected account, continue after individual failures, and report results per account.

### Returning user

1. The connector shows saved terminal profiles and separate status fields for MT5 process, logged-in account, Mkety gateway heartbeat, and dashboard identity sync.
2. The user can start/reconnect a saved terminal or choose **Add another terminal**.
3. Adding another terminal reuses the existing list/install choices, then requires a distinct Mkety pairing token and distinct local state for that terminal.
4. If the old single-terminal config exists, the upgraded connector adopts it in place. It does not reset or move the saved reconnect credential or replay ledger. If an older connector process is still open, the manager explains that it must be closed before the manager starts that same profile, preventing duplicate connections.

## Terminal installation and discovery

- Detect running terminals from their process executable paths and installed terminals from known install/registry locations. Provide an explicit **Browse for terminal64.exe** fallback. Any broader search is user-initiated and bounded to selected folders.
- Every selectable terminal is identified by its canonical executable path, not only its broker label. Duplicate discovery of the same path becomes one entry.
- MetaTrader does not support running two terminal copies from the same directory; additional copies must use distinct installation directories. The connector must refuse to register two profiles for the same path as independent terminals. genui{"citation":{"ref":"turn27search0"}}
- A new instance can be installed using a user-selected setup file or the official MetaQuotes installer. If the user wants a broker-customized server list, they can use that broker's installer. The installer is interactive and the user selects a new, non-overwriting installation directory.
- Offer **Create another copy from this terminal** only for a recognized and tested package layout. It must create a new installation directory and copy only verified program files; it must not copy roaming terminal data, saved account databases, or credentials. If the package layout is unknown or validation fails, guide the user to install from a setup file instead.
- After installation, the manager launches the exact selected `terminal64.exe`. MetaTrader's Python API supports initialization by explicit terminal path and may launch that terminal when needed. genui{"citation":{"ref":"turn25view0"}}
- Portable mode is not a default because MetaQuotes documents folder permission/UAC conditions for it. Use normal separate install directories unless a tested use case needs portable mode. genui{"citation":{"ref":"turn27search0"}}

## Runtime and state isolation

- Keep the current connector execution engine. A lightweight manager supervises one connector worker per active terminal; each worker binds to one explicit MT5 executable path.
- Each profile has a stable local profile ID, terminal path, label, connector config/reconnect credential, and replay ledger. Config and ledger paths are unique per profile. Pairing one terminal must never overwrite another profile's token or ledger.
- Preserve the legacy default config and ledger path for the existing one-terminal profile. New profiles use separate paths under the Mkety application data directory. No credential migration is required for the existing profile.
- The manager obtains status from worker heartbeat/status updates. **Process running** must not be presented as **Gateway connected**; gateway status is based on a recent successful heartbeat. Account identity and dashboard sync are shown as separate facts.
- Background discovery is off. Starting the manager does not start all installed terminals unless the user opts into that behavior. Optional start-at-Windows-login is off by default.
- Stop/disconnect affects only the local connector session. Removing a local profile requires a separate confirmation and must explain that it does not close broker positions, delete the Mkety account, or change server-side trading settings.

## Compatibility and non-goals

- Keep the current one-terminal sequence and gateway protocol intact: create pairing in Mkety, paste token into connector, then sync identity in Mkety.
- Do not require a new connector download per broker. The Mkety connector executable is universal; MT5 terminal packages may still be broker-specific when required for that broker's server configuration.
- Do not collect broker passwords, change route/risk/execution controls, auto-enable accounts, or perform trading actions as part of terminal setup.
- Do not change cTrader, cBot, MT5 order execution, pending-order lifecycle, or live-trade management behavior.
- Do not claim that multiple active terminals consume the same RAM as one. Each active terminal and worker consumes additional resources; users can leave unused terminals stopped.
- No production rollout is part of this feature design.

## Failure handling

- If an executable path is missing or invalid, leave the profile and credentials intact and ask the user to locate the terminal again.
- If MT5 is open but logged out, show **MT5 open — sign in required**; do not attempt broker authentication.
- If the account identity does not match the selected Mkety destination or expected Demo/Live environment, do not complete identity sync; show the observed identity and the destination label for correction.
- If a connector worker exits or heartbeat becomes stale, show **Disconnected** with a retry control. Do not create another worker for the same profile until its prior process is confirmed stopped.
- A batch identity sync reports success/failure per account and never treats partial success as total success.

## Verification requirements before release

- Regression: first-time users can choose one terminal (default) or multiple; the one-terminal choice preserves the existing pairing/token/sync sequence. An existing default config reconnects without a new pairing token or profile migration.
- Discovery: running/installed terminal detection, manual path selection, duplicate-path handling, invalid path, and no-terminal first run.
- Install: user-provided installer and official download handoff both create/select a distinct install directory without overwriting an existing install; no broker secret is read or copied.
- Isolation: two or more terminal workers use distinct paths, pairing credentials, instance IDs, and replay ledgers; a wrong token or changed account identity cannot attach to another profile.
- Status: process, login, gateway heartbeat, and dashboard sync states are distinct and recover correctly after restart/network loss.
- Dashboard: individual sync remains unchanged; if batch sync is included, one account failure does not block or misreport other results.
- Trading safety: tests prove the manager lifecycle makes no broker order/position API calls and does not modify execution/risk state.
- Packaging: exercise the built Windows EXE and its installer/discovery flows in CI or a controlled Windows test environment before publishing a new versioned release. Keep the existing release asset unchanged until a new release passes verification.

## Decisions for this design

1. Use an explicit manager/wizard in the same universal connector download, with the current single-terminal path preserved.
2. Detect known terminals, allow manual selection, and support an interactive install path plus a validated clean-copy option for recognized packages. Do not run full-disk scans or silent installers by default.
3. Use a separate worker and isolated local state per active terminal.
4. Preserve one-time token pairing and per-account dashboard sync. Batch sync is optional and must remain independent per account.
5. Exclude all trading behavior and production deployment from scope.
