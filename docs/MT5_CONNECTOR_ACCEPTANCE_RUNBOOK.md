# MT5 Connector Installation and DEMO Acceptance Runbook

Use this runbook for the recommended outbound Mkety MT5 Connector. For architecture and safety rules, read root `AGENTS.md` first.

## Safety boundary

This procedure is for DEMO acceptance unless the owner explicitly authorizes a separate LIVE-readiness phase.

Before testing:

- global `live_broker_execution_enabled` must be `false`;
- intended MT5 account must be DEMO;
- MT5 DEMO account `execution_enabled=true` and `live_execution_enabled=false`;
- every LIVE trading account must remain execution-disabled and LIVE-disabled;
- workspace `liveExecution` entitlement must remain false.

Source-feed routing, Telegram destination reuse, or adding another MT5 connector instance never authorizes LIVE execution.

## What you need

- Windows computer or Windows VPS;
- one MT5 terminal installation/process for each account that must stay connected simultaneously;
- intended broker DEMO account logged into each terminal;
- latest approved `MketyMT5Connector.exe`;
- one Mkety MT5 pairing per intended terminal/account;
- one distinct connector config and replay ledger per simultaneous terminal/account.

The connector does not need an inbound port or public HTTPS URL. Every instance connects outward to:

```text
wss://cbot.mkety.com:25345/v1/mt5
```

## 1. Prepare MetaTrader 5

### Single terminal/account

1. Open MT5.
2. Log in to the intended DEMO trading account.
3. Confirm the account number and server shown in MT5.
4. Confirm the terminal has an internet connection and market data is updating.
5. Leave MT5 open while the connector runs.

The connector reads the actual terminal account identity through the MetaTrader5 API. It does not use the pairing token as account identity.

### Multiple brokers/accounts on one Windows VPS

One running MT5 terminal instance has one active logged-in account identity at a time. To keep Octa, FBS, Deriv MT5, or other accounts connected simultaneously, install/run a separate terminal directory/process for every broker/account.

Example:

```text
C:\MT5\Octa\terminal64.exe
C:\MT5\FBS\terminal64.exe
C:\MT5\Deriv\terminal64.exe
```

Log each terminal into the account it must control and keep all required terminals open. Do not rely on one MT5 process while switching logins if simultaneous execution is required.

Windows/Windows VPS is the primary supported multi-terminal target. Linux + Wine is experimental until it has independent connector/broker acceptance evidence.

## 2. Create or refresh the Mkety MT5 pairing

In Mkety Trading:

1. Open **Connections**.
2. Select or create **MT5 Connector — Recommended** for the specific terminal/account.
3. Set/confirm the expected environment as **DEMO**.
4. Generate a new pairing token if the previous one is stale, revoked, or was used with the wrong terminal.
5. Copy the token once. Treat it as a secret.

For multiple simultaneous MT5 accounts, create a distinct Mkety MT5 account/pairing row per terminal/account. One pairing must not be reused across different terminal identities.

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

### Single-terminal compatibility mode

Recommended folder:

```text
C:\Mkety\MT5\
```

Place the EXE there, then run it while MT5 is open.

On first run, the connector prompts:

```text
Paste the MT5 connection token from Mkety Trading:
```

Operator equivalent:

```powershell
cd C:\Mkety\MT5
.\MketyMT5Connector.exe --token "<PAIR_TOKEN>"
```

If `--terminal` and `--ledger` are omitted, the connector preserves the historical single-terminal auto-discovery/default-ledger behavior.

### Deterministic multi-terminal mode

Use one connector process per terminal/account and give every process its own explicit terminal path, config and ledger.

Example layout:

```text
C:\Mkety\Octa\connector.json
C:\Mkety\Octa\ledger.sqlite
C:\Mkety\FBS\connector.json
C:\Mkety\FBS\ledger.sqlite
C:\Mkety\Deriv\connector.json
C:\Mkety\Deriv\ledger.sqlite
```

Example first-run commands:

```powershell
MketyMT5Connector.exe --terminal "C:\MT5\Octa\terminal64.exe" --config "C:\Mkety\Octa\connector.json" --ledger "C:\Mkety\Octa\ledger.sqlite" --token "<OCTA_PAIR_TOKEN>"

MketyMT5Connector.exe --terminal "C:\MT5\FBS\terminal64.exe" --config "C:\Mkety\FBS\connector.json" --ledger "C:\Mkety\FBS\ledger.sqlite" --token "<FBS_PAIR_TOKEN>"

MketyMT5Connector.exe --terminal "C:\MT5\Deriv\terminal64.exe" --config "C:\Mkety\Deriv\connector.json" --ledger "C:\Mkety\Deriv\ledger.sqlite" --token "<DERIV_PAIR_TOKEN>"
```

After the first successful pairing, omit `--token`; the instance reloads its own protected reconnect credential from its own config file.

Do not normally pass `--gateway`; the production gateway is built into the connector.

## 5. Expected successful connection

A healthy first connection prints a line similar to:

```text
Mkety MT5 Connector connected: account <ACCOUNT_NUMBER> / <SERVER_NAME>
```

The gateway then issues an instance-bound reconnect credential. The connector saves it locally and replaces the one-time pairing token for future reconnects.

Default single-instance config:

```text
%APPDATA%\Mkety\mt5-connector.json
```

Default single-instance replay ledger:

```text
%APPDATA%\Mkety\mt5-connector-ledger.sqlite
```

For multi-terminal operation, do not share either file between connector processes. Each instance must use its own `--config` and `--ledger` paths.

## 6. Sync identity in Mkety

Return to Mkety Trading and use **Sync MT5 identity** or **Retry identity sync** if shown.

Confirm that Mkety shows the same:

- account number;
- server;
- broker/company;
- DEMO environment.

For multiple terminals, repeat identity sync for every Mkety MT5 account row and verify every connector is bound to the expected terminal/account.

If Mkety reports a different account/server/environment, stop. Do not test execution until the mismatch is resolved.

## 7. Source feeds and selective routes before broker testing

Telegram transport and Telegram feed identity are separate concepts.

A single external/hosted MTProto userbot or normal Telegram Bot API source may authorize many chats/channels. Each authorized chat is represented as an independently routable source feed. A second source connection is needed only when a genuinely separate transport/session is required.

Before a controlled broker test:

1. confirm the intended parent source connection is authorized and active;
2. confirm the intended Telegram chat/channel appears as the expected child source feed;
3. inspect the route for that specific feed;
4. make sure only intended destinations are selected;
5. use **All feeds / default** only when every child feed should inherit the same destination fanout;
6. use canonical-symbol allow/block route filters when a feed carries mixed instruments and a destination should receive only a subset.

Example:

```text
Gold feed
  -> Octa MT5 DEMO
  -> Deriv cTrader DEMO
  -> VIP Telegram

Synthetic feed
  -> Deriv cTrader DEMO
  -> Synthetic Telegram
  -> NOT Octa MT5
```

Route filters are an additional narrowing guard. The destination broker account's actual symbol catalog remains final authority. A route must never be used to force an unsupported instrument onto a broker account.

## 8. Telegram destination bot reuse

One Telegram BotFather bot token may be saved once as a reusable destination connection and used for multiple destination channels where that bot is an admin.

Example:

```text
Starpips Delivery Bot
  -> VIP Gold channel
  -> Free Signals channel
  -> Synthetic Signals channel
```

Each channel endpoint remains independently routable and keeps its own channel/chat ID, template, enabled state and delivery history. Legacy Telegram destinations that store their own encrypted bot token remain supported.

Do not create extra Telegram bots merely because several destination channels exist.

## 9. Reset a wrong/stale pairing

Close the relevant connector instance, then reset only its config.

Single-instance/default reset:

```powershell
.\MketyMT5Connector.exe --reset
```

Isolated instance reset:

```powershell
.\MketyMT5Connector.exe --config "C:\Mkety\Octa\connector.json" --reset
```

Generate a new pairing token in Mkety and run that connector again.

`--reset` deletes the saved transport pairing configuration. It does not authorize trades and does not change server-side execution controls.

## 10. Keep the connector running

For acceptance or normal execution, keep:

- the intended MT5 terminal open and logged in;
- its matching `MketyMT5Connector.exe` process running.

For multi-terminal VPS operation, every required terminal and every matching connector process must remain running. The connector automatically reconnects after ordinary WebSocket/network disconnects.

Typical reconnect output:

```text
Mkety MT5 Connector reconnecting: <error>
```

It retries after a short delay.

## 11. First controlled DEMO test

Immediately before sending the Telegram signal, an agent/operator must freshly re-check the runtime/account LIVE guards from `AGENTS.md`.

Then send one controlled, explicit XAUUSD signal through the configured Telegram source feed. Use the smallest configured DEMO risk/lot suitable for the broker.

Prefer a clear structured test signal so acceptance does not depend on discretionary AI interpretation.

Verify separately:

1. source event was accepted once;
2. the incoming Telegram native chat ID resolved to the intended source feed;
3. interpretation is `READY`;
4. only the persisted routes for that feed/default policy were selected;
5. canonical-symbol filters narrowed fanout as configured;
6. correct XAUUSD broker symbol was resolved, including broker suffix/prefix if applicable;
7. exactly one MT5 DEMO order executed on every intended MT5 account and no unintended MT5 account;
8. exactly one cTrader DEMO order executed if that route is enabled;
9. Telegram destination output appears on every intended Telegram endpoint and nowhere else;
10. broker order/position/deal IDs persist;
11. `position_groups` and `position_legs` materialize;
12. delivery results are persisted independently.

For synthetic-index acceptance, use a compatible Deriv destination only. A synthetic signal must not be considered an MT5 failure merely because an Octa/FBS account does not support that instrument; routing should exclude incompatible destinations before execution.

## 12. Feed-isolation acceptance

With one parent Telegram connection containing at least two authorized child feeds:

1. configure feed A to one destination set;
2. configure feed B to a different destination set;
3. send a harmless/non-broker or controlled DEMO event from A and verify only A's routes run;
4. send from B and verify only B's routes run;
5. confirm adding a feed-specific route for A does not alter B;
6. confirm a feed with no feed-specific route still follows the legacy/default connection route;
7. confirm an unauthorized Telegram chat remains rejected even if a mistaken feed row exists.

## 13. Replay/idempotency test

Replay the exact event using the source transport mechanism that preserves the same canonical source-event identity.

Expected result:

- no second MT5 broker order;
- no second cTrader broker order;
- event/delivery converges as duplicate/replay.

The connector also maintains its own per-instance SQLite replay ledger and performs broker reconciliation before a new OPEN where supported. In multi-terminal mode, verify the same command identity is independently protected on each intended connector ledger without sharing ledger files across accounts.

## 14. Management acceptance

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

- correct source reply/thread relation was preserved;
- correct position/order was targeted;
- only destinations belonging to the intended feed/route were affected;
- MT5 accepted the management action on every intended MT5 account independently;
- cTrader accepted it if routed;
- durable state updated;
- duplicate replay does not repeat the management action.

## 15. Fast-signal and follow-up acceptance

Send a fast/incomplete signal, then later send SL/TP completion/update using the intended reply/thread/context pattern.

Expected:

- one logical position group per intended broker destination;
- no duplicate open;
- later update correlates to the original group;
- feed identity remains stable;
- later management persists correctly.

## 16. Reconnect/recovery acceptance

For each MT5 connector instance under test:

1. close that connector process without changing another connector;
2. confirm only that MT5 account becomes offline;
3. reopen it without supplying a new token;
4. confirm it reconnects using its own saved instance credential;
5. replay prior event/management commands and confirm no duplicate broker action;
6. send a new explicit reply management event and confirm correlation still works;
7. confirm sibling MT5 connector instances remained connected and unaffected.

## 17. Broker-compatibility behavior to expect

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

## 18. Common problems

### Connector says MT5 account is unavailable

The intended terminal is not initialized/logged in. Open that terminal and log in to the intended account first.

### Wrong terminal/account connected on a multi-terminal VPS

Check the `--terminal` path for that connector process, then verify the matching `--config` and `--ledger` paths. Do not solve this by switching a shared terminal login while several accounts are expected to stay online.

### Account mismatch

The connector terminal account does not match the broker account row. Stop and pair/sync the correct terminal/account.

### Symbol not found

Check the broker's Market Watch/symbol catalog. The connector can resolve suffix/prefix variants, but ambiguous matches fail closed. Also confirm the source feed is routed to an account that actually supports the instrument.

### Synthetic signal reaches an incompatible MT5 broker

Treat this first as a routing/configuration defect, not a reason to force a symbol mapping. Configure feed-specific destinations and/or canonical symbol filters so unsupported instruments never fan out to that account.

### Telegram Bot API source token field or allowed chats missing

The normal bot source must expose one Bot Token field plus allowed chat/channel IDs. The token is stored encrypted on the source connection; the allowed chats become independently routable feeds. If those fields are absent, treat it as a frontend/integration regression.

### Telegram delivery bot seems to require a new token for every channel

Use one reusable Telegram destination bot connection, then create multiple channel endpoints under it. A separate bot is only needed when a genuinely separate bot identity/permission boundary is desired.

### Order check fails

Capture the exact `order_check` retcode/comment. Do not guess. Typical causes include broker volume rules, price/tick rules, filling mode, market state, stops/freeze levels, unsupported order type, or account permission.

### Comment rejected

The engine should retry without a comment only when broker diagnostics specifically indicate the comment is the incompatibility.

### Connector reconnect loop

Check internet connectivity, gateway reachability, pairing/reconnect credential state, exact terminal path, MT5 login, and server-observed identity. If credentials are stale/revoked, reset only that connector instance and create a fresh pairing.

### Broker executed but Mkety shows no state

Do not resend the trade. Investigate destination delivery, broker IDs, state binder/materialization, state-only repair, and Supabase/DO recovery first.

## 19. Final DEMO sign-off

After completing source-feed isolation, entry, replay, management, fast-signal, shared Telegram destination, multi-instance reconnect and recovery tests, query production again and record:

- global LIVE remains false;
- workspace `liveExecution` remains false;
- DEMO accounts remain LIVE-disabled;
- every LIVE account remains execution-disabled and LIVE-disabled;
- zero unintended LIVE broker actions occurred;
- no incompatible destination received a broker action because of broad/default routing.

Passing DEMO acceptance does not authorize LIVE. LIVE requires a separate owner-approved readiness review.
