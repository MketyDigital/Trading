# Current Development Handoff

Read root `AGENTS.md` first. This file records the newest verified release state. Exact older handoff history remains preserved below, under `docs/archive/`, and in dated design/runbook documents.

## Current production authority — 2026-09-16

Latest production `main` commit:

- `a3571eddf251ed974369021d97414e177d6280f1`
- merged PR `#98` — simplified logical multi-feed routing and restored Telegram `Forward as-is (original)`

Production verification on this exact commit is green:

- Trading V1 CI `#2818` — success
- Production Cloudflare Deploy `#87` — success
- Production Frontend E2E `#92` — success
- Production Connection Readiness `#50` — success
- Production Platform Configuration Verification `#49` — success
- GitHub CodeQL — success for JavaScript/TypeScript, Python, C# and Actions

The deploy workflow completed its production health probe and verified the persisted owner broker switch without changing it. Platform configuration verification confirmed required Worker broker bindings by name, shared gateway configuration, public gateway health and both broker WebSocket routes.

### Current post-deploy safety authority

Fresh post-deploy Supabase audit:

- `trading_access_enabled = true`
- `broker_execution_enabled = true`
- `live_broker_execution_enabled = false`
- Mkay — `brokerModes=["demo"]`, `liveExecution=false`
- Starpips Forex — `brokerModes=["demo"]`, `liveExecution=false`
- cTrader LIVE account `48681337` — `execution_enabled=false`, `live_execution_enabled=false`

No LIVE switch was enabled by PR #98. Passing CI/deployment/DEMO does not itself authorize LIVE.

### Current logical route authority

Routing is resolved independently for every persisted **source connection → destination** pair.

- `All channels from this source` means that destination accepts every authorized child feed, subject to all normal filters/account/runtime gates.
- Selective mode means only the checked child feeds may reach that destination.
- If selective rows exist for a destination, an unchecked feed cannot fall back to a legacy/default row for that same destination.
- Selective routing for destination A does not suppress an unrelated default/all-channels route to destination B.
- Destination delivery and broker planning both consume `cloudflare-v2/src/routes/logical_route_scope.js`; presentation routing and broker authority must not diverge.

Existing logical subgroups carry exact underlying `routeIds` when edited. The reconcile API uses those IDs to preserve specialized sibling route groups, reject stale edits, reject overlapping-feed ownership, prevent a new selective route from silently coexisting with/stealing authority from an existing default route, and validate target collisions when moving a route.

Blank Allowed Symbols + blank Blocked Symbols means no route-level symbol narrowing. Route filters can only narrow; authoritative destination account catalogs, aliases, risk/environment/account/runtime/LIVE gates remain final authority.

### Telegram destination formatting

Ready-made modes remain:

- `none` — **Forward as-is (original)**
- `clean` — **Clean original**
- `template` — **Structured template**
- `ai_then_fallback` — **AI presentation + safe fallback**

A valid destination-level mode overrides the attached template mode. `inherit`, invalid or absent override leaves the saved template behavior in force. Forward as-is keeps the original stored source text and native Telegram entities where available, without AI/cleanup/reconstruction/branding. Formatting edits do not rotate the saved bot credential, recreate the Telegram endpoint or alter canonical broker execution.

Detailed current operator semantics and the post-deploy checklist are in `docs/PR98_PRODUCTION_ACCEPTANCE_ADDENDUM.md`.

### Remaining real DEMO acceptance

Production CI/deployment gates are green, but real end-to-end acceptance still requires controlled DEMO evidence for:

1. normal Telegram Bot source allowlist and child-feed creation;
2. selected feed A/B isolation plus proof that an unselected feed skips the same selective destination;
3. proof that an unrelated all-channels destination remains independent;
4. reusable Telegram destination bot serving multiple endpoints;
5. `Forward as-is` exact-text delivery;
6. cTrader DEMO broker execution;
7. MT5 DEMO broker execution with the intended connector online;
8. replay/idempotency with no duplicate broker open;
9. management/reply/follow-up correlation to the original durable position group;
10. connector disconnect/reconnect recovery;
11. final fresh zero-LIVE audit.

Do not declare LIVE readiness from production gates alone.

---

## Historical PR #98 release-candidate handoff — preserved

The section below is retained as release-history evidence. Current production authority is the section above.

### Active release candidate — PR #98, 2026-09-16

Branch: `feat/multiselect-routes-forward-as-is`

Latest verified implementation checkpoint before the original documentation commit:

- `977dfaac78ad534ba41c92897ab224ca38c1c37b`
- Trading V1 CI `#2809` — success
- Worker/trading-core tests — success
- pure MT5 bridge tests — success
- pure MTProto Python tests — success

The final PR head later advanced through additional conflict/isolation regressions and was verified green at `dfa28f724fa77375255f317db11ffa61ada9f6be` before squash merge to production commit `a3571eddf251ed974369021d97414e177d6280f1`.

#### Logical multi-feed routing

The Connections portal edits routing as a logical source → destination relationship rather than exposing one raw route row per Telegram feed.

For one source connection and one destination, the operator explicitly chooses either:

- **All channels from this source** — connection-wide/default behavior; or
- **Selective channels/feeds** — one or more checked child feeds only.

Selective authority is strict **for that source → destination pair**. Once selective rows exist for a destination, an unchecked feed cannot inherit a legacy/default row to that same destination. Unrelated destinations remain independent, so one destination may be selective while another remains all-channels.

Destination delivery and broker-account planning use the same shared resolver in `cloudflare-v2/src/routes/logical_route_scope.js`; UI routing and broker routing must not diverge.

Existing routes use the same editor as new routes. Compatible feed-scoped rows are presented as one multi-select logical route and existing route row IDs are reused where possible. Specialized sibling groups with different persisted settings remain independently editable through exact route IDs.

#### Symbol filters

Blank Allowed Symbols + blank Blocked Symbols means **no route-level narrowing**. The destination account's authoritative symbol catalog, aliases, risk limits, environment, runtime gates and broker capabilities remain final authority.

Allowed/blocked canonical-symbol filters may only narrow a destination. They cannot make an unsupported symbol tradable. Instrument eligibility remains capability-driven rather than hard-coded by MT5/cTrader or broker brand.

#### Telegram destination formatting

The portal exposes four ready-made modes:

- **Forward as-is (original)** — `none`; no AI, cleanup, deterministic reconstruction, branding, header, footer or disclaimer;
- **Clean original** — `clean`; deterministic cleanup only;
- **Structured template** — `template`; deterministic configured presentation;
- **AI presentation + safe fallback** — `ai_then_fallback`; presentation AI only, with deterministic fallback and no authority to change canonical trading meaning.

A valid destination-level formatting selection overrides an attached template's mode. `inherit`, invalid or absent override preserves the saved template behavior. Telegram endpoint identity and saved reusable bot credentials are preserved when formatting/template settings are edited.

`Forward as-is` still uses the mature delivery path: the original source text is sent as stored and native Telegram entities are retained when available. It does not alter broker execution semantics.

---

## Earlier production baseline — preserved historical evidence

Before PR #98, the production baseline recorded here was:

- `cf1f0220c781248b64413f6a66162f682fbd5f96`
- merged PR `#96` — DEMO-safe frontend, subscription lifecycle and feed-scoped routing authority
- Trading V1 CI `#2777` — success
- Production Cloudflare Deploy `#85` — success
- Production Frontend E2E `#90` — success
- Production Connection Readiness `#48` — success
- Production Platform Configuration Verification `#47` — success
- GitHub code scanning — success

Supabase migrations already applied and verified in production before PR #98:

- `0035_source_feeds_and_route_scope`
- `0036_reusable_destination_connections`
- `0037_subscription_access_lifecycle`
- `0038_backfill_telegram_source_feeds`

PR #98 introduced no database migration.

## Source-feed and routing background

`source_connections` remains the physical transport/session boundary. Telegram chats/channels authorized under one source connection are materialized as independently routable `source_feeds`.

Starpips external MTProto source `48860770-4b2c-4b13-b49f-7d998f9d7ed5` historically has three active child feeds matching its persisted allowlist:

- `-1003902892609`
- `-1001822170589`
- `-1004387586337`

Re-query current source/feed state before testing; copied IDs are historical aids, not permanent authority.

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

Therefore a connected Deriv MT5 or cTrader account may execute a Derived/Volatility product only when its own catalog advertises a compatible symbol and every other authority gate passes. An Octa/FBS/other account that does not advertise that instrument fails closed because of account capability, not because its platform is MT5.

## Telegram Bot source and reusable destination bot

Normal Telegram Bot API source controls are visible in the Connections UI, including Bot token and allowed chat/channel IDs. Creating a Bot source materializes those chats as child feeds. Source authorization still comes from the persisted parent source connection allowlist.

One reusable encrypted Telegram destination bot credential may back many independently configured destination chat/channel endpoints. Ordinary endpoint edits must preserve the shared credential unless the caller explicitly clears or replaces it.

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

## Completion rule

Do not declare LIVE readiness from CI/deployment alone. DEMO acceptance needs broker evidence plus a fresh final verification that:

- global `live_broker_execution_enabled=false`;
- workspace `liveExecution=false`;
- every LIVE account has `execution_enabled=false` and `live_execution_enabled=false`.

Only after separate explicit authorization should any controlled LIVE-enablement work be considered.
