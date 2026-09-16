# Current Development Handoff

Read root `AGENTS.md` first. This file records the newest verified release state. Exact older handoff history remains preserved under `docs/archive/`, dated design/runbook documents, and Git history.

## Active release candidate — PR #98, 2026-09-16

Branch: `feat/multiselect-routes-forward-as-is`

Latest verified code checkpoint before this documentation commit:

- `dfa28f724fa77375255f317db11ffa61ada9f6be`
- Trading V1 CI `#2817` — **success**
- Worker/trading-core tests — success
- pure MT5 bridge tests — success
- pure MTProto Python tests — success

This branch is **not production authority until merged and deployed**. Production remains `main` at the state below.

## What PR #98 changes

### One simple editor for existing and new routes

Operators should not need to understand internal `source_feed_id` rows.

For any existing or new route:

1. choose the source connection;
2. choose either **All channels from this source** or check one/more allowed child feeds;
3. choose the destination;
4. optionally narrow symbols;
5. set priority/enabled state;
6. save.

Existing sources, destination accounts, Telegram endpoints, credentials and templates are edited in place. Ordinary route changes do not recreate those objects.

### Strict selective routing — per source + destination

Selective authority is evaluated **per destination**.

If active feed-scoped rows exist for `Source A → Destination X`, only a matching selected feed may reach `Destination X`. An unchecked feed does **not** fall back to a legacy/default all-channels row for that same destination.

A different destination remains independent. For example, `Destination Y` may still intentionally use **All channels from this source** when it has no selective rows.

Destination delivery and actual broker-account planning both use the same shared resolver in `cloudflare-v2/src/routes/logical_route_scope.js`. UI routing and broker execution authority must never diverge.

### Existing specialized routes are preserved

Only compatible persisted rows are grouped into one logical multi-feed route. Compatibility includes source, destination, route name, priority, enabled state and normalized filters.

If two historical routes share the same source and destination but intentionally have different settings — for example one XAUUSD-only route and one Derived-symbol route — they remain separate logical routes.

When editing an existing logical route, the frontend submits its exact persisted `routeIds`. The reconcile endpoint mutates only those rows. Sibling logical route groups on the same source/destination are preserved.

Safety conflicts fail closed:

- a route cannot steal a feed already owned by a sibling logical route;
- creating selective routing underneath an existing all-channels route requires editing that existing route instead;
- converting one logical route to all-channels is rejected when active selective sibling authority would conflict;
- stale route IDs are rejected rather than silently editing another group.

### Symbol-filter meaning

Blank **Allowed canonical symbols** + blank **Blocked canonical symbols** means **no additional route-level narrowing**.

The destination account may therefore receive any canonical instrument that its own authoritative broker/terminal catalog actually advertises and that passes all normal alias, risk, lot/volume, environment, entitlement, runtime and execution gates.

Filters only narrow capability. They never make an unsupported symbol tradable. Blocked symbols win if an instrument appears in both allowed and blocked lists.

Instrument support remains capability-driven, never hard-coded as “MT5 instruments” versus “cTrader instruments” or by broker brand.

### Telegram formatting modes — all retained

The user-facing destination editor exposes all four persisted modes:

- **Forward as-is (original)** — `none`; original stored source message, no AI, cleanup, reconstruction, branding, header, footer or disclaimer;
- **Clean original** — `clean`; deterministic cleanup only;
- **Structured template** — `template`; deterministic configured canonical presentation;
- **AI presentation + safe fallback** — `ai_then_fallback`; presentation AI only, deterministic fallback, never trading authority.

A valid destination-level mode may override an attached saved template's mode. `inherit` keeps the saved-template/default behavior. Changing presentation mode does not alter broker execution semantics.

Forward-as-is continues to preserve exact stored source text and native Telegram entities when the mature delivery path has them available.

## Non-regression contract for PR #98

The route UX upgrade does **not** replace the established trading lifecycle. The following remain release-blocking compatibility requirements:

- new-signal execution;
- fast/incomplete → full-signal correlation;
- follow-ups;
- explicit replies and non-reply context handling;
- unresolved explicit replies fail closed;
- move SL to BE;
- SL/TP updates;
- partial and full close;
- pending cancellation;
- durable trade groups and broker IDs;
- replay/idempotency;
- broker-success/persistence-failure repair without unsafe resend;
- independent destination fanout;
- Telegram Bot API and MTProto source support;
- Telegram destination delivery and reusable bot credentials;
- cTrader execution;
- MT5 execution and multi-terminal connector model;
- capability-driven all-broker/all-market symbol resolution;
- account/catalog/risk/runtime authority;
- reconciliation/reconnect recovery.

Full Trading V1 CI is required after every final documentation/code change before merge.

## Current production authority — `main`

Latest production main before PR #98:

- `7bab4aa353cd67db1902fe4909e0fc91841ffba1`
- merged PR #97 — capability-driven cross-platform symbol-resolution regression

Verified production gates on that commit:

- Trading V1 CI — success
- Production Cloudflare Deploy — success
- Production Frontend E2E — success
- Production Connection Readiness — success
- Production Platform Configuration Verification — success
- GitHub code scanning — success

Production migrations already applied and verified:

- `0035_source_feeds_and_route_scope`
- `0036_reusable_destination_connections`
- `0037_subscription_access_lifecycle`
- `0038_backfill_telegram_source_feeds`

PR #98 requires no new database schema migration.

## Current safety authority

Freshly verified before this routing release stream:

- `trading_access_enabled = true`
- `broker_execution_enabled = true`
- `live_broker_execution_enabled = false`

Workspace entitlements:

- `Mkay` — `brokerModes=["demo"]`, `liveExecution=false`
- `Starpips Forex` — `brokerModes=["demo"]`, `liveExecution=false`

LIVE guard account:

- cTrader LIVE UUID `4dbe17df-40b0-412a-88de-9bbc562969c7`
- `execution_enabled=false`
- `live_execution_enabled=false`

**Do not enable or mutate LIVE during this release or DEMO acceptance. Passing DEMO does not itself authorize LIVE.**

## Starpips source/feed state

`source_connections` remains the physical Telegram transport/session boundary. One Telegram connection may authorize many chats/channels, each persisted as an independently routable `source_feeds` row.

Starpips external MTProto source:

- source UUID `48860770-4b2c-4b13-b49f-7d998f9d7ed5`
- three active materialized child feeds matching the persisted allowlist:
  - `-1003902892609`
  - `-1001822170589`
  - `-1004387586337`

After PR #98, the operator should edit the existing Starpips route using the logical route editor rather than manipulating raw feed UUID rows manually.

Example:

```text
Source: Main
Allowed channels:
  ☑ Main signal channel A
  ☑ Main signal channel B
  ☐ Analysis/free channel
Destination: MT5 DEMO
Allowed symbols: [blank]
Blocked symbols: [blank]
```

Only the two checked feeds may reach that MT5 destination. The unchecked feed is skipped for MT5, while it may independently reach another destination if that other route authorizes it.

## Capability-driven broker execution invariant

Platform and broker labels do not define the market universe.

For every routed account Mkety must:

1. load the account's authoritative persisted/reported symbol catalog;
2. resolve the canonical requested instrument against that catalog/aliases;
3. require that exact account to advertise the resolved instrument;
4. apply broker-specific lot/volume/tick/digits/filling/risk rules;
5. apply persisted feed/route/account/runtime/LIVE authority;
6. execute only if every gate passes.

Therefore a Deriv MT5 account may execute V75/Derived instruments when its real MT5 catalog advertises them. An MT5 account without those symbols fails closed because of its catalog, not because it is MT5. The same rule applies to cTrader and future adapters.

## Telegram source/destination credential model

Normal Telegram Bot API source controls include one encrypted BotFather token plus an allowed chat/channel list. Allowed chats materialize as child source feeds.

One reusable encrypted Telegram destination bot credential may back many independently editable destination channel endpoints. Ordinary endpoint edits preserve the shared credential unless explicitly rotated/replaced/cleared.

## MT5 multi-terminal model

One running MT5 terminal process has one active account identity. Simultaneous Octa + FBS + Deriv accounts require separate MT5 terminal installations/processes and one Mkety connector process per terminal/account.

Per-instance connector controls remain:

- `--terminal`
- `--config`
- `--ledger`

The same connector binary may be reused. The connected account's real terminal catalog remains authoritative.

## Subscription/access lifecycle

A customer keeps one persistent workspace. Access-code reissue/renewal rotates access on that workspace; it does not recreate sources, routes, destinations, accounts, templates or history.

Revocation/expiry locks workspace access. Old access/session authority stops working. Reissue/renewal can restore access while preserving workspace configuration. LIVE is never enabled by renewal/reissue.

## Remaining release sequence

1. finish PR #98 documentation and diff review;
2. obtain fresh exact-head Trading V1 CI after the documentation commit;
3. fresh pre-merge Supabase zero-LIVE audit;
4. merge only that verified exact SHA;
5. verify post-merge Production Cloudflare Deploy, Trading V1 CI, Frontend E2E, Connection Readiness, Platform Configuration Verification and code scanning;
6. repeat zero-LIVE audit;
7. begin controlled user-driven DEMO acceptance.

## Next DEMO acceptance

After all release gates are green, validate through the real pipeline:

1. open an existing Starpips route and verify the intended feeds are preselected;
2. save selective Main → broker route and prove an unchecked feed is ignored only for that destination;
3. prove another destination with its own authority remains independent;
4. prove blank route symbol filters allow catalog-supported XAUUSD and, on a suitable account, Derived instruments;
5. verify Forward as-is reproduces the original source message without AI/cleanup/reformatting;
6. cTrader DEMO open + management + replay;
7. MT5 DEMO open + management + replay with connector online;
8. fast/incomplete → full-signal same-position correlation;
9. reply/no-reply/follow-up handling;
10. disconnect/reconnect reconciliation;
11. final zero-LIVE audit.

## Completion rule

Do not declare LIVE readiness from CI/deployment alone. DEMO acceptance requires durable evidence from ingress → resolved feed → route → filters → selected destination/account → broker/delivery result → persisted lifecycle state, plus a fresh proof that every LIVE gate remains disabled.
