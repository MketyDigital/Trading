# Current Development Handoff

Read root `AGENTS.md` first. This top section is the newest continuation authority. Older handoff content is preserved afterward as historical evidence and must not override the current branch/main facts below.

## Current production + continuation authority — 2026-09-16

### Production main

At the start of the current continuation audit, actual production `main` was:

- `98bb917d562a40e212a51bd6eba726ff2d212fbc`
- merged PR `#100` — `Stabilize CMP and Telegram diagnostics`

The older PR #98 production-head text preserved later in this file is stale. Always re-query current `main` and deployment state before production acceptance.

### Active continuation

- branch: `fix/ai-operations-observability-continuation`
- draft PR: `#101` — `Stabilize deterministic revisions, protection policy, and Telegram lineage`
- latest verified code head before documentation commits: `1c268972bc47595b08669a6e65b7d7e1606fe950`
- Trading V1 CI `#2901` — success across Worker/trading-core, MT5 bridge and MTProto
- LIVE has not been enabled by this continuation; branch work is not production authority until reviewed/merged/deployed and re-accepted.

### Verified continuation behavior

The continuation branch now verifies:

- explicit incomplete signals do not require AI merely because optional SL/TP is missing;
- prose/conditional/contradictory ambiguity remains guarded/fail-closed;
- invalid SL/TP is a validation-policy concern, with strict `reject_trade` as backward-compatible default and explicit opt-in `skip_invalid` for allowed optional protection fields;
- Telegram edits are append-only source revisions of one logical message/trade, not new opens;
- exact revision replay remains no-resend/idempotent; changed revisions receive distinct broker idempotency keys;
- edited SL/TP can become management against the same durable group; semantic edit handling cannot create `OPEN_POSITION`;
- replies remain strongest correlation, and guarded no-reply context behavior remains intact;
- Telegram destination replies/edits preserve mapped destination lineage across `none`, `clean`, `template`, and `ai_then_fallback`; missing edit mapping never falls back to duplicate standalone send;
- missing broker fill remains absent rather than becoming `0`, and full close state preserves original opening identity/fill while recording closed state/time;
- first-class DB-authoritative AI adapters now cover OpenAI, Azure OpenAI, Gemini, Vertex AI, Cloudflare AI and AWS Bedrock;
- Cloudflare account ID no longer falls back to provider-specific runtime env config;
- new AI credentials are encrypted; provider-specific public config is whitelisted;
- AI attempts now return normalized sanitized diagnostics without raw provider bodies or credentials;
- workspace-scoped provider health testing persists only sanitized latest-health evidence via migrations `0040` and `0041`;
- nullable provider HTTP status stays absent rather than becoming `0`.

Detailed evidence is in `docs/DETERMINISTIC_REVISION_PROTECTION_HANDOFF_2026-09-16.md` and root `AGENTS.md` section 21.

### Next active scope

Next is the normalized Operations evidence layer and customer/admin observability.

Non-negotiable architecture:

- `destination_deliveries` remains destination retry/outbox authority;
- trading events/revisions remain source/idempotency authority;
- position groups/legs and broker reconciliation remain execution-state authority;
- the normalized operation journal is evidence only and must never authorize a resend/retry;
- customer Operations is workspace-scoped and infrastructure-neutral;
- Mkety Admin may expose richer normalized internal context but never plaintext credentials;
- broker success + persistence failure remains repair-only/no-resend;
- continue TDD and exact-head CI;
- no LIVE changes during this stream.

### Remaining acceptance before any LIVE discussion

1. finish normalized Operations journal and customer/admin views;
2. full exact-head CI and frontend/non-regression suites;
3. re-query production runtime controls/accounts/sources/routes/destinations before any real broker test;
4. controlled real DEMO source/feed/reply/edit/context/Telegram destination/cTrader/MT5/replay/reconnect acceptance;
5. final fresh zero-LIVE audit;
6. only reviewed/merged `main` may deploy through the production workflow.

---

## Historical handoff content — preserved verbatim from the previous CURRENT_HANDOFF

# Current Development Handoff

Read root `AGENTS.md` first. The newest verified production authority is immediately below. The complete previous handoff is preserved verbatim afterward as historical evidence.

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

## Complete previous handoff — preserved verbatim

# Current Development Handoff

Read root `AGENTS.md` first. This file records the newest verified release state. Exact older handoff history remains preserved under `docs/archive/` and in dated design/runbook documents.

## Active release candidate — PR #98, 2026-09-16

Branch: `feat/multiselect-routes-forward-as-is`

Latest verified implementation checkpoint before this documentation commit:

- `977dfaac78ad534ba41c92897ab224ca38c1c37b`
- Trading V1 CI `#2809` — success
- Worker/trading-core tests — success
- pure MT5 bridge tests — success
- pure MTProto Python tests — success

This branch is **not production authority until merged and deployed**. Production remains the `main` state documented below.

### Logical multi-feed routing

The Connections portal now edits routing as a logical source → destination relationship rather than exposing one raw route row per Telegram feed.

For one source connection and one destination, the operator explicitly chooses either:

- **All channels from this source** — connection-wide/default behavior; or
- **Selective channels/feeds** — one or more checked child feeds only.

Selective authority is strict **for that source → destination pair**. Once selective rows exist for a destination, an unchecked feed cannot inherit a legacy/default row to that same destination. Unrelated destinations remain independent, so one destination may be selective while another remains all-channels.

Destination delivery and broker-account planning use the same shared resolver in `cloudflare-v2/src/routes/logical_route_scope.js`; UI routing and broker routing must not diverge.

Existing routes use the same editor as new routes. Compatible feed-scoped rows are presented as one multi-select logical route and existing route row IDs are reused where possible. Moving an existing logical route to another source/destination reuses its rows after validating the target and rejects a target collision instead of leaving a duplicate old route behind.

Historical rows with incompatible settings are not silently normalized merely by viewing them. They remain flagged as mixed legacy state and require an explicit operator confirmation before a save normalizes their common settings.

### Symbol filters

Blank Allowed Symbols + blank Blocked Symbols means **no route-level narrowing**. The destination account's authoritative symbol catalog, aliases, risk limits, environment, runtime gates and broker capabilities remain final authority.

Allowed/blocked canonical-symbol filters may only narrow a destination. They cannot make an unsupported symbol tradable. Instrument eligibility remains capability-driven rather than hard-coded by MT5/cTrader or broker brand.

### Telegram destination formatting

The portal exposes four ready-made modes:

- **Forward as-is (original)** — `none`; no AI, cleanup, deterministic reconstruction, branding, header, footer or disclaimer;
- **Clean original** — `clean`; deterministic cleanup only;
- **Structured template** — `template`; deterministic configured presentation;
- **AI presentation + safe fallback** — `ai_then_fallback`; presentation AI only, with deterministic fallback and no authority to change canonical trading meaning.

A valid destination-level formatting selection overrides an attached template's mode. `inherit`, invalid or absent override preserves the saved template behavior. Telegram endpoint identity and saved reusable bot credentials are preserved when formatting/template settings are edited.

`Forward as-is` still uses the mature delivery path: the original source text is sent as stored and native Telegram entities are retained when available. It does not alter broker execution semantics.

### Non-regression scope frozen by this branch

The implementation intentionally leaves the established execution/management engine in place. Full branch CI remains the release gate for signal execution, fast/follow-up handling, reply/thread correlation, management actions, replay/idempotency, reconciliation, independent destination fanout, cTrader, MT5, MTProto and capability-driven symbols.

LIVE remains outside this change. Do not mutate global LIVE, workspace `liveExecution`, or LIVE-account execution flags while finishing this release.

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
