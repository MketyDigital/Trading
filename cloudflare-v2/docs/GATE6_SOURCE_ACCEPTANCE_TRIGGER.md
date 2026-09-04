# Gate 6 Real MT5 / cTrader Source Acceptance Trigger

This file is the deliberate trigger surface for the protected Gate 6 **source-capture** acceptance workflows. Gate 6 source acceptance is distinct from the older broker connectivity/metadata demo probes and from Gate 7 destination lifecycle acceptance.

## What this gate proves

### MT5 source
- the exact prepared demo terminal/account is the configured source account;
- `MT5SourceCapture` reads a bounded recent window through `history_deals_get`;
- broker deal history is mapped to canonical `mt5_source_bridge` events and signed to `/api/v1/events` through `MT5SourceDelivery`;
- a fresh capture of the same bounded history window is a persistent canonical duplicate rather than a second interpretation/orchestration path;
- source capture remains independent of destination/broker execution.

### cTrader source
- the exact dedicated demo account authenticates against cTrader demo;
- a real `ProtoOAExecutionEvent` deal for that exact `ctidTraderAccountId` is captured by `CTraderSourceCapture`;
- the captured source event is signed into the canonical `/api/v1/events` source path;
- replay of that exact captured source event converges to the existing persistent canonical event;
- a new authenticated demo session can reconnect after capture;
- source capture remains independent of destination/broker execution.

## Safety boundary

Both protected jobs run with:

```text
TRADING_ACCESS_ENABLED=false
BROKER_EXECUTION_ENABLED=false
```

These runners must not create a broker order, build an `OPEN_POSITION`, invoke Gate 7 lifecycle mode, enable a production execution fuse, deploy Cloudflare, or mutate unrelated Mkety state.

Any demo deal required for the source test must be deliberately prepared **outside these source runners** before/during the authorized non-live test. The source runner observes/captures/replays; it does not generate the trade.

Output must remain sanitized. Do not print source secrets, cTrader client secret/access token, MT5 credentials, raw HMAC values, Supabase credentials, or unrelated destination/broker credentials.

## Required preparation

Before authorizing a real run:

1. Gate 4 identity acceptance and Gate 5 Telegram acceptance should be handled according to the launch order or any deviation must be explicitly reviewed/documented.
2. Provision an enabled non-live `mt5_source_bridge` source row and an enabled non-live `ctrader_source` source row with server-owned source IDs/secrets.
3. Confirm the canonical ingress endpoint is exact HTTPS `/api/v1/events` and points to the intended non-live environment.
4. Prepare an MT5 demo terminal/account on the protected Windows runner with at least one known recent deal inside the configured bounded lookback window.
5. Prepare a dedicated cTrader demo account and arrange for one known demo deal event to occur while the bounded cTrader source runner is listening. This event must be generated independently of the source runner.
6. Confirm neither source is attached to a live-money destination and `BROKER_EXECUTION_ENABLED` remains false.
7. Confirm other source/provider/workspace health can be observed separately so any source-local failure is not misread as a platform-wide failure.

## Deliberate MT5 trigger

Only after explicit real-environment Gate 6 MT5 authorization, edit this trigger file and push a commit whose entire commit message is exactly:

```text
source: accept mt5 gate 6
```

The protected job first requires the ordinary regression job to pass, then runs only the source-capture acceptance on the protected `staging` environment and MT5 demo runner.

## Deliberate cTrader trigger

Only after explicit real-environment Gate 6 cTrader authorization, edit this trigger file and push a commit whose entire commit message is exactly:

```text
source: accept ctrader gate 6
```

The protected job first requires the ordinary regression job to pass, then runs only the source-capture acceptance against cTrader demo.

Merely adding/editing this tooling with any other commit message does not authorize Gate 6 real source acceptance.
