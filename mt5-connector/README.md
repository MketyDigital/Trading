# Mkety MT5 Connector

Mkety MT5 Connector is the recommended MetaTrader 5 execution adapter for Mkety Trading. It runs on the same Windows computer as a logged-in MT5 terminal and opens an outbound encrypted WebSocket connection to Mkety.

## Customer flow

1. Open **Mkety Trading → Connections**.
2. Choose **MT5 Connector — Recommended**.
3. Enter a label and the expected Demo/Live environment.
4. Click **Create MT5 Connector pairing**.
5. Download `MketyMT5Connector.exe`.
6. Keep MetaTrader 5 open and logged into the intended broker account.
7. Start the connector with the pairing token shown by Mkety:

```powershell
MketyMT5Connector.exe --token "<PAIR_TOKEN>"
```

The default gateway is:

```text
wss://cbot.mkety.com:25345/v1/mt5
```

The pair token is short-lived. On the first successful connection, the gateway issues an instance-bound reconnect credential and the connector replaces the local pair token automatically. The customer does not need to paste a token again unless the connector is reset/revoked.

8. Return to Mkety and click **Sync MT5 identity**.
9. Verify the actual account number, server, broker and Demo/Live state shown in Mkety.
10. Configure route and risk controls. New accounts remain inactive, execution-disabled and kill-switched until explicitly enabled.

## What the connector reads from MT5

The connector obtains the authoritative terminal identity directly from `MetaTrader5.account_info()` and the account symbol catalog from `MetaTrader5.symbols_get()`.

Safe metadata sent to Mkety includes account number, broker/server identity, Demo/Live state, platform symbols, volume limits/steps, tick size/value, contract size, digits and currency metadata. It does **not** send the customer's MT5 password.

## Symbol handling

Mkety resolves each canonical signal symbol against the actual connected account catalog before broker execution. Broker prefixes/suffixes and explicit customer aliases are supported. Ambiguous matches fail closed rather than guessing.

## Execution engine

The outbound connector reuses Mkety's existing `MT5Engine` and `ReplayLedger`, including market and pending orders, SL/TP, modify, partial/full close, pending cancellation, broker `order_check`, fill fallback and reconciliation after uncertain outcomes.

## Local files

The connector stores only its Mkety gateway credential and connector instance ID in its protected local config file. The default Windows location is under `%APPDATA%\Mkety\mt5-connector.json`. Replay state is stored beside it in SQLite.

Reset pairing with:

```powershell
MketyMT5Connector.exe --reset
```

Then create a new pairing in Mkety and start again with the new token.

## Legacy HTTP bridge

The older inbound/public-HTTPS MT5 Bridge remains supported as an advanced compatibility path for existing installations. New customers should use the outbound MT5 Connector.
