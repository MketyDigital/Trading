# MT5 Connector Installation and DEMO Acceptance Runbook

Use this runbook for the recommended outbound Mkety MT5 Connector. For architecture and safety rules, read root `AGENTS.md` first.

## Safety boundary

This procedure is for DEMO acceptance unless the owner explicitly authorizes a separate LIVE-readiness phase.

Before testing:

- global `live_broker_execution_enabled` must be `false`;
- intended MT5 account must be DEMO;
- MT5 DEMO account `execution_enabled=true` and `live_execution_enabled=false`;
- cTrader LIVE account must remain execution-disabled;
- workspace `liveExecution` entitlement must remain false.

## What you need

- Windows computer or Windows VPS;
- MetaTrader 5 installed;
- intended broker DEMO account logged in inside MT5;
- latest approved `MketyMT5Connector.exe`;
- one-time MT5 pairing token generated in Mkety Trading.

The connector does not need an inbound port or public HTTPS URL. It connects outward to:

```text
wss://cbot.mkety.com:25345/v1/mt5
```

## 1. Prepare MetaTrader 5

1. Open MT5.
2. Log in to the intended DEMO trading account.
3. Confirm the account number and server shown in MT5.
4. Confirm the terminal has an internet connection and market data is updating.
5. Leave MT5 open while the connector runs.

The connector reads the actual terminal account identity through the MetaTrader5 API. It does not use the pairing token as account identity.

## 2. Create or refresh the Mkety MT5 pairing

In Mkety Trading:

1. Open **Connections**.
2. Select or create **MT5 Connector — Recommended**.
3. Set/confirm the expected environment as **DEMO**.
4. Generate a new pairing token if the previous one is stale, revoked, or was used with the wrong terminal.
5. Copy the token once. Treat it as a secret.

Do not paste the token into GitHub issues, commits, screenshots, public chat, or logs.

## 3. Download the connector

Use the latest approved Windows connector built by `.github/workflows/mt5-connector-release.yml`.

Expected artifact/release files:

```text
MketyMT5Connector.exe
MketyMT5Connector.exe.sha256
```

The GitHub Actions artifact is named:

```text
MketyMT5Connector-windows
```

For a release from `main`, the stable GitHub release tag is normally:

```text
mt5-connector-v1.0.0
```

Verify the SHA256 file when distributing the executable outside GitHub Actions.

## 4. Install/run

Recommended folder:

```text
C:\Mkety\MT5\
```

Place the EXE there, then run it while MT5 is open.

On first run, the connector prompts:

```text
Paste the MT5 connection token from Mkety Trading:
```

Paste the one-time token and press Enter.

Operator equivalent:

```powershell
cd C:\Mkety\MT5
.\MketyMT5Connector.exe --token "<PAIR_TOKEN>"
```

Do not normally pass `--gateway`; production gateway is built into the connector.

## 5. Expected successful connection

A healthy first connection prints a line similar to:

```text
Mkety MT5 Connector connected: account <ACCOUNT_NUMBER> / <SERVER_NAME>
```

The gateway then issues an instance-bound reconnect credential. The connector saves it locally and replaces the one-time pairing token for future reconnects.

Default local config:

```text
%APPDATA%\Mkety\mt5-connector.json
```

Default replay ledger:

```text
%APPDATA%\Mkety\mt5-connector-ledger.sqlite
```

Do not edit these files manually unless debugging with an agent.

## 6. Sync identity in Mkety

Return to Mkety Trading and use **Sync MT5 identity** or **Retry identity sync** if shown.

Confirm that Mkety shows the same:

- account number;
- server;
- broker/company;
- DEMO environment.

If Mkety reports a different account/server/environment, stop. Do not test execution until the mismatch is resolved.

## 7. Reset a wrong/stale pairing

Close the connector, then run:

```powershell
.\MketyMT5Connector.exe --reset
```

Generate a new pairing token in Mkety and run the connector again.

`--reset` deletes the saved transport pairing configuration. It does not authorize trades and does not change server-side execution controls.

## 8. Keep the connector running

For acceptance or normal execution, keep:

- MT5 terminal open and logged in;
- `MketyMT5Connector.exe` running.

The connector automatically reconnects after ordinary WebSocket/network disconnects.

Typical reconnect output:

```text
Mkety MT5 Connector reconnecting: <error>
```

It retries after a short delay.

## 9. First controlled DEMO test

Before sending the Telegram signal, an agent/operator must re-check runtime/account LIVE guards from `AGENTS.md`.

Then send one controlled XAUUSD signal through the configured Telegram source.

Use the smallest configured DEMO risk/lot suitable for the broker.

Verify separately:

1. source event was accepted once;
2. interpretation is `READY`;
3. correct XAUUSD broker symbol was resolved, including broker suffix/prefix if applicable;
4. exactly one MT5 DEMO order executed;
5. exactly one cTrader DEMO order executed if that route is enabled;
6. Telegram destination output appears if configured;
7. broker order/position/deal IDs persist;
8. `position_groups` and `position_legs` materialize;
9. delivery result is persisted.

## 10. Replay/idempotency test

Replay the exact event.

Expected result:

- no second MT5 broker order;
- no second cTrader broker order;
- event/delivery converges as duplicate/replay.

The connector also maintains a local SQLite replay ledger and performs broker reconciliation before a new OPEN where supported.

## 11. Management acceptance

Reply to the controlled signal and test, in this order:

```text
SL AT BE NOW
```

Then, where valid for the open position:

- explicit new SL;
- new TP;
- partial close;
- full close.

For a separate controlled pending-order case, test cancel pending.

After each command verify:

- correct position/order was targeted;
- MT5 accepted the management action;
- cTrader accepted it if routed;
- durable state updated;
- duplicate replay does not repeat the management action.

## 12. Fast-signal and follow-up acceptance

Send a fast/incomplete signal, then later send SL/TP completion/update using the intended reply/thread/context pattern.

Expected:

- one logical position group;
- no duplicate open;
- later update correlates to the original group;
- later management persists correctly.

## 13. Reconnect/recovery acceptance

1. Close the connector.
2. Reopen it without supplying a new token.
3. Confirm it reconnects using the saved instance credential.
4. Replay prior event/management commands and confirm no duplicate broker action.
5. Send a new explicit reply management event and confirm correlation still works.

## 14. Broker-compatibility behavior to expect

The current MT5 engine is broker-adaptive rather than broker-name hardcoded.

It supports:

- canonical symbol to actual broker symbol resolution;
- safe prefix/suffix matching;
- fail-closed ambiguous symbol resolution;
- min/max/step lot normalization;
- tick-size/point/digits normalization when broker metadata supplies it;
- preservation of raw broker tick when a constraint is absent;
- FOK/IOC/RETURN filling candidates;
- MARKET/LIMIT/STOP and STOP_LIMIT when exposed by the MT5 installation;
- `order_check` before send;
- deterministic short comment marker;
- commentless fallback only when the broker specifically rejects comments;
- SL/TP modify;
- partial/full close;
- pending cancellation;
- reconciliation and replay protection.

## 15. Common problems

### Connector says MT5 account is unavailable

MT5 is not initialized/logged in. Open MT5 and log in to the intended account first.

### Account mismatch

The connector terminal account does not match the broker account row. Stop and pair/sync the correct terminal/account.

### Symbol not found

Check the broker's Market Watch/symbol catalog. The connector can resolve suffix/prefix variants, but ambiguous matches fail closed.

### Order check fails

Capture the exact `order_check` retcode/comment. Do not guess. Typical causes include broker volume rules, price/tick rules, filling mode, market state, stops/freeze levels, unsupported order type, or account permission.

### Comment rejected

The engine should retry without a comment only when broker diagnostics specifically indicate the comment is the incompatibility.

### Connector reconnect loop

Check internet connectivity, gateway reachability, pairing/reconnect credential state, MT5 login, and server-observed identity. If credentials are stale/revoked, reset and create a fresh pairing.

### Broker executed but Mkety shows no state

Do not resend the trade. Investigate destination delivery, broker IDs, state binder/materialization, state-only repair, and Supabase/DO recovery first.

## 16. Final DEMO sign-off

After completing entry, replay, management, fast-signal, and reconnect tests, query production again and record:

- global LIVE remains false;
- DEMO accounts remain LIVE-disabled;
- LIVE account remains execution-disabled;
- zero LIVE broker actions occurred.

Passing DEMO acceptance does not authorize LIVE. LIVE requires a separate owner-approved readiness review.
