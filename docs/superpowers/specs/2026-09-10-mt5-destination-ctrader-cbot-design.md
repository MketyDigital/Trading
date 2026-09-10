# MT5 Destination Repair and cTrader Cloud cBot Design

## Scope

This change completes MT5 as a destination-only execution connector and adds cTrader Cloud cBot as an additional cTrader destination method beside the existing cTrader Open API integration.

MT5 source/master capture is explicitly out of scope and remains unchanged for a future version.

## Safety constraints

- Existing broker execution gates remain authoritative.
- New or paired accounts remain inactive, execution-disabled, and kill-switched by default.
- This work must not enable live-money execution for acceptance or UI testing.
- Destination account identity comes only from persisted authoritative account state; caller-supplied workspace/account hints are never execution authority.
- Secrets are encrypted at rest and never returned after the one-time setup response.

## MT5 destination

The existing MT5 bridge remains the execution agent. The current pairing endpoint is only a bootstrap endpoint and must no longer be persisted as the runtime bridge address.

During pairing, the MT5 connector supplies its externally reachable HTTPS bridge base URL together with its terminal account metadata. The pairing endpoint validates that URL, verifies the bridge over the existing signed metadata protocol, verifies that the bridge-reported account matches the submitted terminal account, and then replaces the encrypted bootstrap bridge URL with the verified runtime bridge URL while preserving the one-time bridge secret.

A successful pair stores the real HTTPS bridge URL, account login, server, environment and provider status. The existing production MT5 executor continues to use `/v1/health`, `/v1/account`, `/v1/symbols`, `/v1/tick`, and `/v1/command` without a new execution protocol.

## cTrader destination methods

The existing cTrader Open API method remains unchanged and is the recommended/default connection method.

A second provider mode, `ctrader_cbot`, represents **Cloud Auto Trader**. It does not use cTrader Open API for order execution. Instead, a cBot running in cTrader Cloud maintains an outbound WebSocket connection to a Mkety gateway on TCP/TLS port 25345. cTrader Cloud requires `WebSocketClient` traffic to use port 25345 and does not send normal HTTP requests.

### Data flow

Telegram/source event -> existing Mkety parse/canonicalization/risk/routing -> destination execution dispatch -> cBot gateway control API -> authenticated WebSocket session on port 25345 -> cTrader Cloud cBot -> cTrader account.

The cBot is intentionally a thin execution adapter. It does not parse Telegram, make strategy decisions, or choose destination authority.

## cBot gateway

The gateway is a small shared Mkety service, not customer infrastructure. It has two surfaces:

1. An internal HTTPS control endpoint used by the Mkety Worker to submit signed commands and query connection state.
2. A secure WebSocket listener on port 25345 used by Cloud cBots.

The gateway maps an authenticated cBot session to a persisted Mkety connection/account identifier. Commands include command ID, account binding, issued/expiry timestamps, action and payload. Duplicate or expired commands are rejected. Results are correlated by command ID and returned to the Worker.

The gateway must fail closed when the cBot is offline, account binding does not match, a command is expired, authentication fails, or execution result is ambiguous.

## cBot client

The cBot is a C# cTrader Algo robot using `cAlgo.API.WebSocketClient` with `AccessRights.None`. Configuration is limited to the Mkety gateway URI and one-time connection token/code.

On start it connects to `wss://<gateway-host>:25345`, authenticates, reports its cTrader account identity, and waits for commands. It supports the destination actions already expected by Mkety: open market/pending order, modify position protection, close position, partial close, and cancel pending order. It returns structured acknowledgements/results and reconnects after disconnects.

The cBot validates account binding, command expiry and command IDs locally before any trading API call. It keeps a bounded duplicate-command cache for the lifetime of the Cloud instance; durable delivery/idempotency remains authoritative on the Mkety side.

## Connection onboarding

The cTrader connection UI/API exposes two destination methods:

- `ctrader_openapi`: **Direct Connection — Recommended** (existing behavior)
- `ctrader_cbot`: **Cloud Auto Trader**

Creating a cBot connection generates a one-time connection token and returns gateway setup details once. The account remains in `awaiting_cbot` state until the gateway/cBot heartbeat binds an actual cTrader account. Pairing alone never enables execution.

## Deployment boundary

Customer-side VPS/VM/always-on desktop is not required for cBot mode because cTrader Cloud hosts the cBot. Mkety must deploy and operate the shared gateway with TLS on port 25345 and an internal HTTPS control endpoint.

## Acceptance

MT5 destination acceptance requires a demo terminal bridge with a public HTTPS base URL and successful signed metadata verification before pairing is marked connected.

cBot acceptance requires a demo cTrader Cloud instance connecting to the gateway, authoritative account binding, duplicate/expired command rejection, and a full demo order lifecycle while broker execution safety gates remain controlled explicitly.
