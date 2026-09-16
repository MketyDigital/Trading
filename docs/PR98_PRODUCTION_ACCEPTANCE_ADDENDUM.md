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

## Remaining real DEMO acceptance

Production gates prove deploy/configuration safety, not end-to-end broker acceptance. Before any LIVE consideration, still obtain controlled DEMO evidence for:

1. normal Telegram Bot source allowlist/feed creation;
2. selected feed A/B routing and an unselected feed skip for the same destination;
3. an unrelated all-channels destination continuing independently;
4. one reusable Telegram delivery bot serving multiple destination endpoints;
5. `Forward as-is` exact-text delivery;
6. cTrader DEMO execution on a supported catalog symbol;
7. MT5 DEMO execution with the intended connector online and a supported catalog symbol;
8. replay/idempotency with no duplicate broker open;
9. management/reply/follow-up correlation to the durable original position group;
10. connector disconnect/reconnect recovery;
11. final fresh zero-LIVE audit.
