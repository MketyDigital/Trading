# Current Development Handoff

Read root `AGENTS.md` first. This file records the newest verified release state. Exact older handoff history remains preserved under `docs/archive/` and in dated design/runbook documents.

## Production state — 2026-09-16

Latest production `main` commit:

- `cf1f0220c781248b64413f6a66162f682fbd5f96`
- merged PR `#96` — DEMO-safe frontend, subscription lifecycle and feed-scoped routing authority

Post-merge production verification is green on that exact commit:

- Trading V1 CI `#2777` — success
- Production Cloudflare Deploy `#85` — success
- Production Frontend E2E `#90` — success
- Production Connection Readiness `#48` — success
- Production Platform Configuration Verification `#47` — success
- GitHub code scanning — success

Supabase migrations applied and verified in production:

- `0035_source_feeds_and_route_scope`
- `0036_reusable_destination_connections`
- `0037_subscription_access_lifecycle`
- `0038_backfill_telegram_source_feeds`

### Current safety authority

Latest verified runtime controls:

- `trading_access_enabled = true`
- `broker_execution_enabled = true`
- `live_broker_execution_enabled = false`

Latest verified workspace entitlements:

- `Mkay` — `brokerModes=["demo"]`, `liveExecution=false`
- `Starpips Forex` — `brokerModes=["demo"]`, `liveExecution=false`

Latest verified LIVE guard account:

- cTrader LIVE UUID `4dbe17df-40b0-412a-88de-9bbc562969c7`
- `execution_enabled=false`
- `live_execution_enabled=false`

Do not enable or mutate LIVE during DEMO acceptance. Passing DEMO acceptance does not itself authorize LIVE.

## Source-feed and routing authority

`source_connections` remains the physical transport/session boundary. Telegram chats/channels authorized under one source connection are materialized as independently routable `source_feeds`.

Starpips external MTProto source `48860770-4b2c-4b13-b49f-7d998f9d7ed5` now has three active child feeds matching its persisted allowlist:

- `-1003902892609`
- `-1001822170589`
- `-1004387586337`

Broker planning now enforces feed-scoped routing authority, not merely destination presentation. If an incoming feed has active feed-specific routes, those routes replace the legacy parent/default route set for that feed. If it has no active feed-specific routes, the designed legacy connection-route fallback remains.

Canonical-symbol route filters narrow broker fanout before accounts enter planning. Filters never bypass account symbol compatibility, risk controls, runtime controls or LIVE gates.

## Capability-driven broker execution — non-regression invariant

Instrument eligibility is **account-capability driven, not platform-name or broker-name driven**.

A platform label such as `mt5` or `ctrader` does not define the instrument universe. A broker brand such as Deriv, Octa or FBS does not receive a hard-coded allow/deny list in Mkety execution authority.

For every routed broker account Mkety must:

1. load the account's authoritative persisted/reported symbol catalog;
2. resolve the canonical requested instrument against that catalog and configured aliases;
3. require the resolved symbol to be advertised/tradable by that account;
4. apply account lot/volume/tick/digits/filling/risk constraints;
5. apply persisted route/account/runtime/LIVE authority;
6. execute only if every gate passes.

Therefore:

- a connected **Deriv MT5** account whose terminal catalog advertises `Volatility 75 Index` / an equivalent V75 broker symbol may execute canonical `DERIV:VOLATILITY_75` when routed and otherwise authorized;
- a connected cTrader account advertising the same canonical product under its own broker symbol may also execute it;
- an Octa/FBS/other MT5 account that does not advertise that instrument must fail closed;
- the rejection in the last case is because of the account catalog, **not because the platform is MT5**.

A focused regression is being added on branch `test/capability-driven-cross-platform-symbols` to freeze this invariant across MT5/cTrader and future adapters.

## Telegram Bot source and reusable destination bot

Normal Telegram Bot API source controls are visible in the real Connections UI, including Bot token and allowed chat/channel IDs. Creating a Bot source materializes those chats as child feeds. If feed materialization fails after source insertion, the disabled partial source is compensated/removed before the API returns failure.

One reusable encrypted Telegram destination bot credential may back many independently configured destination chat/channel endpoints. Ordinary destination edits must preserve the shared credential unless the caller explicitly clears or replaces it.

## MT5 multi-terminal model

One running MT5 terminal process has one active account identity at a time. For simultaneous Octa + FBS + Deriv accounts on one Windows VPS, run separate terminal installations/processes and one Mkety connector process per terminal/account.

The connector supports explicit per-instance:

- `--terminal`
- `--config`
- `--ledger`

The same connector binary may be reused; per-account terminal/catalog state remains authoritative.

## Access/subscription lifecycle

Each customer keeps one persistent Trading workspace. Access-code reissue/renewal rotates access on the same workspace rather than creating duplicate customer workspaces. Revocation/expiry locks subscription access while preserving accounts, sources, routes, destinations, templates, settings, memberships, branding and audit history.

`rotate_trading_access_code` and `sync_trading_workspace_access_code_status` are SECURITY DEFINER functions with pinned empty search paths; execute privilege is restricted to `postgres`/`service_role`.

## Remaining DEMO acceptance

Production deployment gates are green, but release acceptance still requires controlled DEMO evidence through the real pipeline:

1. normal Telegram Bot source UI/token/allowlist and child-feed creation;
2. source-feed A/B isolation and default-route fallback behavior;
3. reusable Telegram destination bot to multiple endpoints;
4. supported-symbol broker routing based on each account's catalog;
5. cTrader DEMO execution;
6. MT5 DEMO execution with the connector online;
7. replay/idempotency — no duplicate broker open;
8. management/reply/follow-up correlation to the original durable position group;
9. connector disconnect/reconnect recovery;
10. final zero-LIVE audit.

For the currently connected Octa MT5 DEMO account, use a symbol its catalog actually supports (for example XAUUSD if present). When a Deriv MT5 DEMO account is connected and reports Derived/Volatility symbols, those instruments should be tested there as normal capability-driven broker destinations.

## Completion rule

Do not declare LIVE readiness from CI/deployment alone. DEMO acceptance needs broker evidence plus a fresh final verification that:

- global `live_broker_execution_enabled=false`;
- workspace `liveExecution=false`;
- every LIVE account has `execution_enabled=false` and `live_execution_enabled=false`.

Only after separate explicit authorization should any controlled LIVE-enablement work be considered.
