# Mkety MT5 Connector

Mkety MT5 Connector is the recommended MetaTrader 5 execution adapter for Mkety Trading. It runs on the same Windows computer as a logged-in MT5 terminal and opens an outbound encrypted WebSocket connection to Mkety. The customer does not expose an inbound port, public HTTPS URL, or VPS endpoint for this mode.

## Customer flow

1. Open **Mkety Trading → Connections**.
2. Choose **MT5 Connector — Recommended**.
3. Enter a label and the expected Demo/Live environment, then click **Create MT5 Connector pairing**.
4. Download the universal `MketyMT5Connector.exe` and open it. The packaged Windows app opens the terminal manager; choose **Connect one terminal** (recommended) or **Set up multiple terminals**.
5. Select a listed MT5 installation, browse to `terminal64.exe`, or choose an installer. The app checks known locations and running processes without scanning every drive. An installer opens interactively and you choose a new or empty folder.
6. Sign in to the intended broker account inside MT5, select that installation, and click **Pair / start selected**. The manager creates a local profile for the selected path if needed, then reads and displays the account, server and Demo/Live state for confirmation before asking for the token created for that same account.
7. If the manager finds an old local pairing, it reuses that credential and replay ledger. If no local pairing is found, it warns before creating a new one; cancel if you expected to reuse an older connection and first verify the old local config. On first successful gateway authentication, the gateway reconnect credential replaces the local one-time pairing token.
8. Return to Mkety and click **Sync MT5 identity** for that account. The manager opens Mkety and keeps identity sync as unconfirmed until it is verified there.
9. Verify the account number, server, broker and Demo/Live state in Mkety. New accounts remain inactive, execution-disabled and kill-switched until explicitly enabled.

For Python/console or operator use, the existing token prompt and flags remain supported. With no saved config and no CLI token, the connector prompts once:

```text
Paste the one-time pairing token from Mkety Trading:
```

The production gateway is preconfigured in the connector:

```text
wss://cbot.mkety.com:25345/v1/mt5
```

The customer pastes only the one-time pairing token; they do not need to copy or configure the WebSocket URL.

For operator/testing use, the equivalent explicit command is:

```powershell
MketyMT5Connector.exe --token "<PAIR_TOKEN>"
```

The pair token is short-lived. On the first successful connection, the gateway issues an instance-bound reconnect credential and the connector replaces the local pair token automatically. The customer does not need to paste a token again unless the connector is reset or revoked.

Explicit CLI startup is retained for existing installations and operator workflows; omitting `--terminal` preserves historical single-terminal auto-discovery.

## Multiple MT5 brokers/accounts on one Windows VPS

The multi-terminal manager is designed to make this setup available from one universal connector download. On launch it checks running MT5 processes, Windows' registered MT5 install entries, and a short list of standard install folders. It does not scan every drive. If a terminal is not listed, use **Browse for terminal64.exe** or search only a folder you choose. The list is deduplicated by the full executable path, and a terminal already assigned to a profile cannot be added a second time.

To add another installation, choose an MT5 installer you already have or open the [official MetaTrader 5 download page](https://www.metatrader5.com/en/download). The manager asks you to choose an empty target folder, validates it, and tells you to select that folder in the interactive installer. It does not use silent or overwrite flags. Complete broker login inside MT5 yourself. A universal MetaQuotes terminal may not include every broker's server entry; use that broker's MT5 installer if its server is missing. Copying an existing terminal is kept unavailable until a package layout can be validated to exclude roaming data and credentials.

For each terminal, select its `terminal64.exe`, open MT5, sign in to the intended account, and assign a distinct Mkety pairing token. Then use **Sync MT5 identity** for each destination in Mkety. Process status, account login, gateway connection, and dashboard identity sync are separate states; seeing MT5 open does not by itself mean Mkety is connected or synced.

### Upgrading an existing single-terminal connector

The manager detects the existing `%APPDATA%\Mkety\mt5-connector.json` config and adopts it as the **Existing MT5 connection** profile. It keeps the old config and replay ledger at their original paths and does not ask for a new token. If the terminal executable path is not known, select that existing terminal once; the selected path is kept in the local profile manifest. If an older standalone connector process is still open, close it before starting the manager profile. The manager checks for that old process and refuses to start a duplicate worker.

### Status, sync and stopping

The profile list shows saved terminal profiles, the MT5 terminal process, connector worker process, observed account/server/environment, gateway state, and dashboard sync reminder separately. The installation list is only terminal discovery; it does not claim to identify logged-in accounts until a selected terminal is probed. **Connected** requires successful gateway authentication followed by a recent heartbeat acknowledgement; a running process alone is not enough. Mkety remains authoritative for identity sync, so confirm each account in the dashboard. Individual **Sync MT5 identity** remains available. **Sync all pending MT5 identities** runs only pending MT5 Connector accounts sequentially, continues after a per-account failure, and reports the results separately; it does not sync cTrader, the HTTP Bridge, or accounts already marked connected.

Minimizing the manager keeps it and its connector workers running. While a worker remains running, it automatically retries a lost gateway connection every three seconds. Closing asks whether to stop the managed connector workers and exit; choosing No leaves the manager open. If the manager exits unexpectedly, a worker that is still running can continue reconnecting, and the manager can recover its status when reopened. A stopped or crashed worker is not automatically restarted; select its saved profile and click **Pair / start selected**. The manager does not automatically start profiles at Windows login. Stopping a worker leaves its MT5 terminal, open positions and pending orders alone.

## Local MT5 copier

The local copier is an optional MT5-to-MT5 feature inside the same Windows manager. It runs on this computer and copies broker positions directly between two MT5 terminal installations; it does not use portal routes. The copier and portal follower features are separate. For portal-managed trading, connect and sync both accounts in Mkety and configure the portal follower there.

1. Install or add two separate MT5 terminal installations on the same Windows PC/VPS. Sign in to the main account in one terminal and the follower account in the other. Keep both terminals open and connected to their brokers.
2. Open `MketyMT5Connector.exe`, click **Refresh terminals**, select the main terminal and click **Add another terminal**. Repeat for the follower terminal. The manager lists each saved profile and its **Profile ID**.
   If an account is signed in but its connector is stopped or it has not been paired to Mkety, select its saved profile and click **Read selected account**. This reads only the account number, server and Demo/Live environment from MT5; it does not pair the account or place trades. The result is shown for this manager session. A running connector supplies its own status, so the manager does not probe that terminal concurrently.
3. Select the follower row and click **Mark selected as local follower**. Choose the main account from the saved-profile dropdown; it shows the label, broker account, server and Profile ID so you don't need to type or copy an ID. Choose one lot-sizing mode:
   - **Fixed lots:** enter the follower volume in lots, such as `0.01`, `0.1`, or `1.0`. This requests that volume for each copied position.
   - **Multiplier:** `1` copies the same volume as the main position, `0.5` copies half, and `2` copies double.

   MT5 applies the follower broker's supported volume minimum, maximum and step. A requested fixed volume below the broker minimum is raised to that minimum; one above its maximum is capped. Check the effective volume on a demo account before using live accounts.
4. After saving, the follower remains selected and its row shows the parent and lot sizing under **Local copier**. Select that follower row and click **Start local copy**. Confirm the warning. Start with demo accounts. Any positions already open on the main account can be copied as soon as the copier starts. The local copier does not require the follower profile to have a Mkety token; the two signed-in MT5 terminals are used directly.
5. Click **Stop local copy** to stop that pair. **Disable local copy** stops it and removes the follower link. On manager close, choosing **Yes** stops connector and copier workers; choosing **No** leaves them running. Keep the manager open while managing pairs.

Follower setup does not ask for symbol mappings. The connector resolves exact names and a unique broker prefix/suffix variation automatically in either copy direction (for example, `EURUSD` and `EURUSD.a`). If two or more follower symbols could match, it fails closed instead of guessing. For unrelated broker names, use **Advanced symbol aliases** after enabling the follower and enter `ParentSymbol = FollowerSymbol` pairs (for example, `XAUUSD = GOLD`). The follower terminal must list and allow trading of the target instrument. An alias changes the name only; it does not convert contract size, price scale, margin, or risk between instruments.

The local copier checks open positions about every two seconds. It mirrors market-position opens, SL/TP changes (including manual edits observed in the main MT5 terminal), partial volume closes, and full closes. Partial closes are reconciled proportionally to the original parent volume, including fixed-lot follower sizing, and rounded down to the follower broker's volume step. The MT5 adapter reads the follower's volume and price precision and lets the broker validate execution. It only manages follower positions recorded in its local copy journal; unrelated/manual follower positions are left alone. It does not copy pending orders or increases to the volume of an already-open parent position. It identifies the follower's netting/hedging mode; in netting mode it skips same-symbol parent collisions and symbols already holding an unlinked follower position. Use a dedicated follower account because manual trades added to a copier-owned netting symbol cannot always be separated from the copied volume. A running copier can place real broker orders on the follower account; test its symbol availability, lot sizing, SL/TP and stop behavior on demo accounts before using live accounts.

The installer path is available for a downloaded MetaQuotes or broker-specific setup file. Copying an existing terminal directory is intentionally unavailable until its layout can be validated to exclude terminal data and credentials.

One running MT5 terminal instance can hold one active logged-in trading account identity at a time. Switching the login inside that terminal changes the account controlled by that terminal; it does not keep multiple broker accounts simultaneously connected.

To keep Octa, FBS, Deriv MT5, or other accounts connected at the same time on one Windows VPS, install/run a separate MT5 terminal directory/process for each broker/account and run one Mkety connector process per terminal/account. All connector processes may use the same `MketyMT5Connector.exe` binary and the same Mkety gateway, but every instance must have its own:

- exact MT5 `terminal64.exe` path;
- Mkety account/pairing;
- local connector config/reconnect credential;
- connector instance ID;
- replay ledger SQLite file.

Example layout:

```text
C:\MT5\Octa\terminal64.exe
C:\MT5\FBS\terminal64.exe
C:\MT5\Deriv\terminal64.exe

C:\Mkety\Octa\connector.json
C:\Mkety\Octa\ledger.sqlite
C:\Mkety\FBS\connector.json
C:\Mkety\FBS\ledger.sqlite
C:\Mkety\Deriv\connector.json
C:\Mkety\Deriv\ledger.sqlite
```

Example processes:

```powershell
MketyMT5Connector.exe --terminal "C:\MT5\Octa\terminal64.exe" --config "C:\Mkety\Octa\connector.json" --ledger "C:\Mkety\Octa\ledger.sqlite" --token "<OCTA_PAIR_TOKEN>"

MketyMT5Connector.exe --terminal "C:\MT5\FBS\terminal64.exe" --config "C:\Mkety\FBS\connector.json" --ledger "C:\Mkety\FBS\ledger.sqlite" --token "<FBS_PAIR_TOKEN>"

MketyMT5Connector.exe --terminal "C:\MT5\Deriv\terminal64.exe" --config "C:\Mkety\Deriv\connector.json" --ledger "C:\Mkety\Deriv\ledger.sqlite" --token "<DERIV_PAIR_TOKEN>"
```

After first successful pairing, omit `--token`; each instance reloads its own protected reconnect credential from its own `--config` file.

The explicit `--terminal` option is what makes the connector bind deterministically to the intended broker installation instead of relying on MetaTrader5 package auto-discovery. Omitting `--terminal` preserves the original single-terminal behavior for existing installations.

Windows/Windows VPS is the primary supported multi-terminal deployment target. Linux + Wine remains experimental until it has its own connector and broker acceptance evidence.

Each running terminal and connector worker adds RAM and CPU use. Three live MT5 terminals should not be planned on a 1 GB RAM VPS. Treat 4 GB as a starting point for a controlled resource check and 6 GB as a safer initial choice; these are conservative planning estimates, not measurements or guarantees for every broker, Windows image, or workload. Leave terminals stopped when they are not needed, and keep charts and extra terminal features disabled if the broker allows it.

## Authority and credential boundary

The Mkety database is authoritative for the account row, connection/provider status, server-observed broker identity, Demo/Live environment, account activation, execution permission, kill switch, symbol catalog, routes and risk policy. The connector-local reconnect credential authenticates only the outbound transport session to the gateway; it is never trade authority and cannot bypass the Worker safety checks.

The original one-time pairing token is retained only until successful identity sync. After sync, Mkety rewrites the encrypted server-side connector credentials without that pairing token and keeps only the gateway/control material required for the managed connection.

## What the connector reads from MT5

The connector obtains the authoritative terminal identity directly from `MetaTrader5.account_info()` and the account symbol catalog from `MetaTrader5.symbols_get()`.

Safe metadata sent to Mkety includes account number, broker/server identity, Demo/Live state, platform symbols, volume limits/steps, tick size/value, contract size, digits and currency metadata. It does **not** send the customer's MT5 password.

## Symbol handling

Mkety resolves each canonical signal symbol against the actual connected account catalog before broker execution. Broker prefixes/suffixes and explicit customer aliases are supported. Ambiguous matches fail closed rather than guessing.

A source route may additionally restrict canonical symbols for a particular destination. For example, an Octa MT5 route may allow `XAUUSD` while a Deriv cTrader route handles supported synthetic indices. These route filters are additional guards; the destination account's actual broker symbol catalog remains the final compatibility authority.

## Execution engine

The outbound connector reuses Mkety's existing `MT5Engine` and replay/reconciliation behavior, including market and pending orders, SL/TP, modify, partial/full close, pending cancellation, broker `order_check`, fill fallback and reconciliation after uncertain outcomes.

The Worker remains the sole trading authority. Immediately before dispatch it reloads durable source/workspace/account state and rechecks source authorization, account activation, execution permission, kill switch, routing and risk/symbol policy.

## Local files

The connector stores only its Mkety gateway transport credential and connector instance ID in its protected local config file. The default Windows location is under `%APPDATA%\Mkety\mt5-connector.json`. Replay state is stored beside it in SQLite.

For multi-terminal deployments, always supply separate `--config` and `--ledger` paths for each connector instance.

Reset pairing with:

```powershell
MketyMT5Connector.exe --reset
```

For an explicitly isolated instance, reset that instance's config:

```powershell
MketyMT5Connector.exe --config "C:\Mkety\Octa\connector.json" --reset
```

Then create a new pairing in Mkety and start again with the new token.

Advanced/operator flags are available when needed:

```text
--token <PAIR_TOKEN>
--gateway <WSS_URL>
--config <PATH>
--terminal <TERMINAL64_EXE_PATH>
--ledger <SQLITE_PATH>
--reset
```

`--gateway` is for controlled operator/testing scenarios; ordinary customers should use the baked production gateway.

## Gateway deployment boundary

`wss://cbot.mkety.com:25345/v1/mt5` is served by the shared cTrader/MT5 gateway. The gateway process is deployed separately from the Cloudflare Worker (for example through the gateway's Azure/Coolify deployment path). A Worker deployment does not by itself deploy or prove the health of the gateway.

## Legacy HTTP bridge

The older inbound/public-HTTPS MT5 Bridge remains supported as an advanced compatibility path for existing installations. It requires an externally reachable HTTPS bridge beside MT5 and is not the recommended customer flow. New customers should use the outbound MT5 Connector, which requires no inbound customer VPS/public URL.
