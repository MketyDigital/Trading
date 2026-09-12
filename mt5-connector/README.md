# Mkety MT5 Connector

Mkety MT5 Connector is the recommended MetaTrader 5 execution adapter for Mkety Trading. It runs on the same Windows computer as a logged-in MT5 terminal and opens an outbound encrypted WebSocket connection to Mkety. The customer does not expose an inbound port, public HTTPS URL, or VPS endpoint for this mode.

## Customer flow

1. Open **Mkety Trading → Connections**.
2. Choose **MT5 Connector — Recommended**.
3. Enter a label and the expected Demo/Live environment.
4. Click **Create MT5 Connector pairing**.
5. Download `MketyMT5Connector.exe`.
6. Keep MetaTrader 5 open and logged into the intended broker account.
7. Start `MketyMT5Connector.exe`. On first run, with no saved config and no CLI token, it prompts once:

```text
Paste the one-time pairing token from Mkety Trading:
```

The production gateway is preconfigured in the connector:

```text
wss://cbot.mkety.com:25345/v1/mt5
```

The customer normally pastes only the one-time pairing token; they do not need to copy or configure the WebSocket URL.

For operator/testing use, the equivalent explicit command is:

```powershell
MketyMT5Connector.exe --token "<PAIR_TOKEN>"
```

The pair token is short-lived. On the first successful connection, the gateway issues an instance-bound reconnect credential and the connector replaces the local pair token automatically. The customer does not need to paste a token again unless the connector is reset or revoked.

8. Return to Mkety and click **Sync MT5 identity**.
9. Verify the actual account number, server, broker and Demo/Live state shown in Mkety.
10. Configure route and risk controls. New accounts remain inactive, execution-disabled and kill-switched until explicitly enabled.

## Authority and credential boundary

The Mkety database is authoritative for the account row, connection/provider status, server-observed broker identity, Demo/Live environment, account activation, execution permission, kill switch, symbol catalog, routes and risk policy. The connector-local reconnect credential authenticates only the outbound transport session to the gateway; it is never trade authority and cannot bypass the Worker safety checks.

The original one-time pairing token is retained only until successful identity sync. After sync, Mkety rewrites the encrypted server-side connector credentials without that pairing token and keeps only the gateway/control material required for the managed connection.

## What the connector reads from MT5

The connector obtains the authoritative terminal identity directly from `MetaTrader5.account_info()` and the account symbol catalog from `MetaTrader5.symbols_get()`.

Safe metadata sent to Mkety includes account number, broker/server identity, Demo/Live state, platform symbols, volume limits/steps, tick size/value, contract size, digits and currency metadata. It does **not** send the customer's MT5 password.

## Symbol handling

Mkety resolves each canonical signal symbol against the actual connected account catalog before broker execution. Broker prefixes/suffixes and explicit customer aliases are supported. Ambiguous matches fail closed rather than guessing.

## Execution engine

The outbound connector reuses Mkety's existing `MT5Engine` and replay/reconciliation behavior, including market and pending orders, SL/TP, modify, partial/full close, pending cancellation, broker `order_check`, fill fallback and reconciliation after uncertain outcomes.

The Worker remains the sole trading authority. Immediately before dispatch it reloads durable source/workspace/account state and rechecks source authorization, account activation, execution permission, kill switch, routing and risk/symbol policy.

## Local files

The connector stores only its Mkety gateway transport credential and connector instance ID in its protected local config file. The default Windows location is under `%APPDATA%\Mkety\mt5-connector.json`. Replay state is stored beside it in SQLite.

Reset pairing with:

```powershell
MketyMT5Connector.exe --reset
```

Then create a new pairing in Mkety and start again with the new token.

Advanced/operator flags are available when needed:

```text
--token <PAIR_TOKEN>
--gateway <WSS_URL>
--config <PATH>
--reset
```

`--gateway` is for controlled operator/testing scenarios; ordinary customers should use the baked production gateway.

## Gateway deployment boundary

`wss://cbot.mkety.com:25345/v1/mt5` is served by the shared cTrader/MT5 gateway. The gateway process is deployed separately from the Cloudflare Worker (for example through the gateway's Azure/Coolify deployment path). A Worker deployment does not by itself deploy or prove the health of the gateway.

## Legacy HTTP bridge

The older inbound/public-HTTPS MT5 Bridge remains supported as an advanced compatibility path for existing installations. It requires an externally reachable HTTPS bridge beside MT5 and is not the recommended customer flow. New customers should use the outbound MT5 Connector, which requires no inbound customer VPS/public URL.
