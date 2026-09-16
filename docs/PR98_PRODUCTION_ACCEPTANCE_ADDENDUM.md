# PR #98 Production Acceptance Addendum

Date: 2026-09-16
Production commit: `a3571eddf251ed974369021d97414e177d6280f1`
Change: Simplified logical multi-feed routing and restored `Forward as-is (original)` Telegram delivery.

This addendum is the current operator interpretation for route selection after PR #98. Where older runbook wording says a feed simply “falls back to the parent/default route”, use the more precise rules below.

## Route scope is evaluated per source → destination pair

For each source connection and each destination independently:

1. If that destination has active feed-specific/selective rows, only the explicitly selected child feeds may reach that destination.
2. An unselected feed does **not** inherit a legacy/default all-channels row for that same destination.
3. A selective route to destination A does **not** suppress an unrelated all-channels/default route to destination B.
4. `All channels from this source` is an explicit connection-wide choice for that destination.
5. Destination delivery and broker-account planning use the same route-scope resolver and must agree on authority.

Example:

```text
Main source
  Signal A -> MT5
  Signal B -> MT5
  All channels -> Telegram archive
```

For the MT5 destination, only Signal A and Signal B are authorized. A third feed such as News is skipped for MT5. The Telegram archive remains independent and may still receive every authorized feed because its own route is `All channels`.

## Editing existing logical routes

The portal groups compatible raw route rows into one logical route. When editing an existing logical subgroup, the client sends the exact underlying route IDs back to the reconcile endpoint.

Required behavior:

- edits affect only the selected logical subgroup;
- specialized sibling routes sharing the same source and destination remain intact;
- a feed already owned by another sibling logical route cannot be silently stolen;
- creating a new selective route beside an existing default route fails closed and directs the operator to edit the existing route instead;
- stale edits fail closed if the underlying route IDs changed since the form was loaded;
- moving a logical route to a new source/destination validates target collisions before reusing route rows.

## Symbol filters

Route symbol filters only narrow authority.

- Allowed blank + Blocked blank: no route-level symbol narrowing.
- Allowed populated: only those canonical symbols remain eligible for that destination.
- Blocked populated: those symbols are skipped; blocked wins on conflict.
- Filters never make an unsupported broker symbol tradable.
- The destination account's current symbol catalog, aliases, risk policy, environment, account flags and runtime/LIVE gates remain authoritative.

Instrument eligibility remains capability-driven, not hard-coded by `mt5`, `ctrader`, Deriv, Octa, FBS or another broker/platform label.

## Telegram destination formatting

The ready-made modes are:

- `none` — **Forward as-is (original)**: original stored source text, no AI, no cleanup, no deterministic reconstruction, no branding/header/footer/disclaimer; native Telegram entities are retained when available.
- `clean` — **Clean original**: deterministic cleanup only.
- `template` — **Structured template**: deterministic configured presentation.
- `ai_then_fallback` — **AI presentation + safe fallback**: AI may change presentation only; canonical trading meaning remains server-authoritative and deterministic fallback remains available.

A valid destination-level formatting mode overrides the attached template's mode. `inherit`, absent or invalid override preserves the saved template behavior. Changing formatting does not rotate the Telegram bot credential, recreate the destination endpoint or change broker execution semantics.

## Production verification for commit `a3571edd...`

The following checks completed successfully after merge:

- Trading V1 CI `#2818`;
- Production Cloudflare Deploy `#87`, including production health probe and verification of the persisted owner broker switch without changing it;
- Production Frontend E2E `#92`;
- Production Connection Readiness `#50`;
- Production Platform Configuration Verification `#49`, including Worker broker binding checks and shared gateway/WebSocket health;
- GitHub CodeQL analysis for JavaScript/TypeScript, Python, C# and Actions.

Post-deploy safety audit remained:

- `trading_access_enabled=true`;
- `broker_execution_enabled=true`;
- `live_broker_execution_enabled=false`;
- Mkay and Starpips Forex: `brokerModes=["demo"]`, `liveExecution=false`;
- cTrader LIVE account `48681337`: `execution_enabled=false`, `live_execution_enabled=false`.

No LIVE switch was enabled by PR #98. DEMO/CI/deployment success does not authorize LIVE.

## Real post-deploy DEMO evidence — 2026-09-16

Production traffic after deployment provided real broker evidence without injecting any test event or mutating routes.

Source feed `-1001822170589` emitted:

1. `telegram:-1001822170589:24135` — `V75(1s) Sell Now!!!!!` — parsed `READY` as fast/incomplete `DERIV:VOLATILITY_75_1S` SELL.
2. `telegram:-1001822170589:24136` — full V75(1s) SELL signal with entry range, SL and TP1–TP3 — parsed `READY` as the compatible completion.

Verified outcomes:

- cTrader DEMO account `48685071` opened the first leg exactly once at 0.20 lots, broker position `138094107`, fill `5749.35`.
- The full signal reused the same logical group and modified broker position `138094107` with SL `5815` and TP1 `5720`; it did not duplicate leg 1.
- TP2 and TP3 were added as independent legs with broker positions `138094685` and `138094690`.
- Durable group `163eaf58-8aa4-4ee8-a05e-1efb769d5ad4` contains both external event IDs, is no longer incomplete, and retains the original opening fill/order/deal/position identifiers on leg 1.
- All four cTrader destination-delivery actions were `SUCCEEDED`, attempt count `1`, with distinct idempotency keys and broker responses reporting `duplicate=false`.
- Octa MT5 DEMO produced **zero execution-delivery rows** for these V75(1s) events. Its current catalog does not advertise Volatility 75, so the synthetic was not forced onto the incompatible MT5 account.
- Deriv cTrader DEMO catalog does advertise `DERIV:VOLATILITY_75` / `DERIV:VOLATILITY_75_1S` products and XAUUSD.
- Octa MT5 DEMO catalog advertises XAUUSD and other normal broker symbols; it is therefore suitable for a later cross-broker XAUUSD acceptance when its connector is freshly online.
- A subsequent freeform analysis event remained `NEEDS_REVIEW` when the AI cascade failed; Mkety did not invent a trading action from it.

Current production routing remained unchanged while gathering this evidence: cTrader and MT5 are still legacy/all-channels routes with blank symbol filters. No selective route or broker account setting was mutated for this acceptance evidence.

### Current MT5 availability limitation

The Octa MT5 account row reports connector status `connected`, but its last durable heartbeat is `2026-09-14T11:09:36.328Z`. There is no separate persisted connector-session registry in Supabase. Treat MT5 real-session acceptance as **not currently proven online** until the Windows terminal/connector sends a fresh heartbeat. This is an external availability limitation, not evidence of a code failure.

## Remaining real DEMO acceptance

Production gates plus the real V75 evidence above now prove cTrader DEMO synthetic execution, fast→full completion, durable correlation, incompatible-MT5 isolation and non-duplicate execution for that event set.

Still outstanding before any LIVE consideration:

1. normal Telegram Bot source allowlist/feed creation;
2. selected feed A/B routing and an unselected feed skip for the same destination;
3. an unrelated all-channels destination continuing independently while another destination is selective;
4. one reusable Telegram delivery bot serving multiple destination endpoints;
5. `Forward as-is` exact-text Telegram delivery;
6. MT5 DEMO XAUUSD execution with the intended connector freshly online;
7. an explicit replay/recovery exercise proving no duplicate broker open (current evidence proves unique first-attempt idempotency but not a deliberate replay);
8. management/reply handling such as SL-to-BE, explicit SL/TP update, partial/full close and pending cancellation where applicable;
9. connector disconnect/reconnect recovery;
10. final fresh zero-LIVE audit.
