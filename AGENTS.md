# Mkety Trading — AGENTS.md

## 0. Purpose and authority

This is the primary operational handoff for agents working in `MketyDigital/Trading`. Read it before changing source ingestion, AI interpretation, destination formatting, broker execution, persistence, recovery, runtime controls, infrastructure, or acceptance tests.

Mkety Trading is a source-agnostic trading automation platform. It receives source events, normalizes them into one canonical lifecycle, correlates follow-ups to durable position state, independently fans out to configured destinations, executes on broker adapters, and persists enough evidence to recover safely without duplicate broker actions.

If an older plan, comment, PR description, or runbook conflicts with this file, prefer current code + current production state + this file. Update this file whenever a material invariant changes.

---

## 1. Absolute safety rules

1. **Never enable LIVE execution automatically.**
2. DEMO acceptance must be complete before any controlled LIVE test is proposed.
3. Before every real broker test, re-query current runtime controls and account rows. Do not rely on copied IDs or an old document.
4. During DEMO stabilization, require:
   - `trading_access_enabled = true`;
   - `broker_execution_enabled = true` when DEMO execution is intentionally being tested;
   - `live_broker_execution_enabled = false`;
   - target DEMO account `execution_enabled = true` and `live_execution_enabled = false`;
   - every LIVE account `execution_enabled = false` and `live_execution_enabled = false`.
5. Never commit or expose Telegram bot tokens, Telegram sessions, API keys, pairing tokens, reconnect credentials, broker passwords, Supabase service-role keys, Cloudflare secrets, or other credentials.
6. Persisted workspace/source/route/account authority wins over caller hints. Reload authority immediately before execution.
7. AI is never trading authority. AI may interpret bounded ambiguity or present a Telegram message, but deterministic server-side validation controls semantics and execution.
8. If broker success occurred but state binding/persistence failed, repair state only. **Never resend the broker action** unless broker reconciliation proves it did not occur.
9. One destination failure must never cancel independent sibling destinations.
10. Debug root cause first. For reproducible defects, add/adjust regression coverage before the implementation fix.

---

## 2. Current production acceptance baseline — 2026-09-14

Supabase project: `Mkety Digital` (`vdblajgxrfndjesoyayy`).

Acceptance workspace last known:

- `5f63234c-20e9-426c-995f-56d129f51ece`

Last verified runtime controls:

- `trading_access_enabled = true`
- `broker_execution_enabled = true`
- `live_broker_execution_enabled = false`

Last known DEMO accounts:

- cTrader DEMO UUID `40eacf2a-5a8a-4648-9b90-55038748d2ed`, broker account `48685071`
- MT5 DEMO UUID `87eb40ab-5cce-48c5-b764-149fd6b31ca5`, broker account `213921698`, server `Deriv-Demo`

LIVE guard account:

- cTrader LIVE UUID `4dbe17df-40b0-412a-88de-9bbc562969c7`, broker account `48681337`
- must remain execution-disabled until an explicit controlled LIVE test is authorized after full DEMO signoff.

These values are historical aids, not permanent authority. Always query current production state before testing.

---

## 3. End-to-end architecture

Normal flow:

```text
Source
  -> authenticated ingress
  -> persisted source/workspace authorization
  -> source-native idempotency
  -> deterministic parser
  -> bounded AI only when needed
  -> deterministic fallback when safely recoverable
  -> canonical signal / management event
  -> reply/thread/context correlation
  -> durable position-group lifecycle
  -> persisted route resolution
  -> independent destination fanout
       -> Telegram destination presentation/delivery
       -> cTrader execution
       -> MT5 execution
       -> webhook/audit destinations
  -> delivery result persistence
  -> broker identifiers + durable state materialization
  -> later follow-up / management / replay / reconnect
```

All supported source types must converge into the same canonical lifecycle. Do not create Telegram-specific or broker-specific trading semantics when the canonical event contract can represent the behavior.

---

## 4. Main runtime components

### Cloudflare Worker

Primary runtime is under `cloudflare-v2/`.

Responsibilities include authentication, source validation, canonical interpretation, AI routing/fallback, lifecycle correlation, route resolution, Telegram presentation, broker dispatch authorization, delivery state, Durable Object coordination, Supabase persistence/recovery, admin/customer APIs, and runtime controls.

Production Worker: `mkety-copier-engine`.

Primary production URL: `https://trade.mkety.com/`.

Production deployment is restricted to `main` through `.github/workflows/production-cloudflare-deploy.yml`.

### Durable Objects + Supabase

Durable Objects are the hot coordination layer. Supabase is the durable relational materialization/recovery layer. Neither should cause a broker resend simply because the other temporarily lost state.

Relevant files:

- `cloudflare-v2/src/state/trade_state_store.js`
- `cloudflare-v2/src/state/trade_state_node.js`
- `cloudflare-v2/src/state/production_trade_state_binder.js`
- `cloudflare-v2/src/persistence/supabase_trade_state_persistence.js`
- execution binding-repair modules under `cloudflare-v2/src/execution/`

### cTrader / MT5 gateway

Gateway/connector health is separate from Worker health. A successful Worker deploy does not prove the MT5 gateway or local connector is online.

MT5 production WebSocket endpoint:

```text
wss://cbot.mkety.com:25345/v1/mt5
```

---

## 5. Source ingress contracts

Supported concepts include normal Telegram Bot API, Telegram MTProto, TradingView webhooks, custom signed API, MT5 source bridge, cTrader source, and future sources that conform to the canonical source-event contract.

### Normal Telegram Bot API source — release-blocking contract

Normal Telegram Bot API source support is a first-class feature and must not regress.

Primary ingress:

- `cloudflare-v2/src/http/telegram_bot_webhook.js`

Required behavior:

1. Resolve a persisted source by public handle.
2. Require persisted provider `telegram_bot_api` and source family `telegram`.
3. Verify `X-Telegram-Bot-Api-Secret-Token` against the encrypted persisted webhook secret using constant-time comparison.
4. Enforce the persisted Telegram chat allowlist before AI, routing, or execution.
5. Support `message`, `edited_message`, `channel_post`, and `edited_channel_post`.
6. Use stable native identity `chat_id:message_id` for replay/idempotency.
7. Preserve reply identity so later replies can correlate to prior trading events.
8. Preserve the source text **without trimming or rewriting it**. Whitespace/newlines are part of exact-forwarding fidelity.
9. Preserve Telegram text/caption `entities` in event metadata when Telegram supplies them. These entities are presentation metadata only and do not become trading authority.
10. Queue into the same canonical source-event pipeline used by other sources.
11. Ignore irrelevant/non-message/empty updates safely.
12. Never trust workspace/account/route/execution hints from Telegram payload content.

### Telegram MTProto

External or hosted MTProto is transport only. Workspace ownership, source allowlists, canonical interpretation, routing, risk, and execution remain server-controlled.

Last known production acceptance source UUID:

- `48860770-4b2c-4b13-b49f-7d998f9d7ed5`

Re-query it before testing. Historical allowlist included `-1003902892609`, `-1001822170589`, and `-1004387586337`.

---

## 6. Interpretation, AI, fallback and validation

Primary files:

- `cloudflare-v2/src/ai/trading_interpreter.js`
- `cloudflare-v2/src/ai/relaxed_signal_recovery.js`
- `cloudflare-v2/src/pipeline/signal_intent_validator.js`
- `cloudflare-v2/src/ai/universal_ai.js`

Required sequence:

1. deterministic parsing/management aliases;
2. strict deterministic recovery where safe;
3. bounded AI for genuine ambiguity;
4. deterministic material fallback if AI fails/times out and source text is still recoverable;
5. `NEEDS_REVIEW` only when safe canonical intent cannot be established.

Typical statuses:

- `READY`
- `MANAGEMENT`
- `NO_ACTION`
- `NEEDS_REVIEW`

Hard contradictions remain fail-closed. Secondary numeric evidence mismatches must not invalidate an otherwise coherent signal merely because an AI-proposed number is not an exact raw substring.

Break-even aliases include `SL AT BE`, `SL AT BE NOW`, `SL TO BE`, `SL TO BE NOW`, `MOVE SL TO BE`, `BREAKEVEN`, and `BREAK EVEN` -> `MOVE_SL_TO_BE`.

Informational wording such as `STOPPED AT BE AFTER TP2` must not become a destructive management action.

---

## 7. Canonical lifecycle and rich follow-ups

Canonical trade semantics include side, symbol, order type, entry kind/range/price, stop loss, TP1..TPN, risk/volume intent, source relation, and management action.

Supported management concepts include move SL to BE, explicit SL update, TP update, partial close, full close, pending cancellation, and other explicitly implemented risk-reducing actions.

Correlation priority is conservative:

1. explicit reply target;
2. explicit thread/relation target;
3. strong symbol/context match;
4. guarded unique/recent fallback only when unambiguous.

Canonical reply relation uses `thread.reply_to_event_id` after normalization.

### Fast/incomplete -> full signal is a non-regression invariant

This behavior is mandatory:

- a fast signal such as `SELL GOLD`/`audjpy buy` may open one immediate configured leg;
- a later compatible full signal carrying SL/TP/entry completion must correlate to the **same logical position group**;
- it must update/protect/promote the already-open broker position as designed;
- it must not create an accidental second open for the same logical trade;
- replay of either source event must not duplicate broker execution;
- source-event IDs from both messages must remain auditable on the same group.

Real DEMO evidence on 2026-09-14 proved this for cTrader XAUUSD: source event 276 opened position `136559593`; source event 277 supplied SL/TP and modified that same position instead of opening a duplicate. This is historical evidence only; re-run after material lifecycle changes.

---

## 8. Destination model and failure isolation

Destination types include broker accounts, Telegram, internal webhooks, and audit-only destinations.

Routes are persisted and workspace-scoped. Fanout is independent. Examples:

- Telegram formatting/delivery failure must not cancel a valid cTrader/MT5 action.
- MT5 failure must not cancel cTrader or Telegram.
- cTrader failure must not roll back a Telegram message that already succeeded.
- each destination outcome must be persisted independently.

Broker destinations are authoritative only after execution code reloads current account/route/runtime authority.

---

## 9. Telegram destinations and template modes — release-blocking contract

Primary files:

- `cloudflare-v2/src/destinations/formatting.js`
- `cloudflare-v2/src/destinations/telegram_destination.js`
- `cloudflare-v2/src/destinations/v1_destination_delivery_stage.js`
- `cloudflare-v2/src/destinations/telegram_presentation.js`

Telegram destination support is a first-class feature alongside broker execution. Do not remove AI templates, deterministic templates, raw forwarding, or fallback behavior to simplify broker work.

### Persisted formatting modes

#### `none` — exact/raw forwarding mode

This is the mode to use when the customer wants the destination to receive the source Telegram message as received, with no Mkety rewrite.

Contract:

- no AI presentation;
- no cleanup;
- no canonical signal reconstruction;
- no brand/header/footer insertion;
- source text is sent exactly as stored, including line breaks and surrounding whitespace;
- when a normal Telegram Bot API source supplied native Telegram `entities`, pass those entities to Telegram `sendMessage` and do not also set `parse_mode`;
- if native entities are unavailable, preserve the exact text but do not invent formatting.

This is an exact-send/recreate behavior, not Telegram's Bot API `forwardMessage`; it intentionally does not expose/force the original source-channel forwarding attribution.

#### `clean`

Deterministic cleanup only. It may remove configured branding/footer/links while preserving the signal meaning. No AI.

#### `template`

Deterministic canonical reconstruction using the configured labels/layout/brand/header/footer/disclaimer.

#### `ai_then_fallback`

AI presentation only, bounded by timeout/circuit breaker and deterministic fallback. AI must not change canonical trading semantics.

### Telegram destination delivery requirements

- destination bot token stays encrypted at rest and must never appear in public API results;
- destination chat/channel reference is persisted and workspace-scoped;
- exact mode must preserve Telegram entities only when safe/native entities are available;
- Telegram API parse/entity errors must be isolated to the Telegram destination;
- no destination formatting mode may alter the canonical broker action already derived from the source event;
- destination result and Telegram message ID should be persisted/auditable where the current delivery model supports it.

When diagnosing Telegram output, separately verify source capture, route selection, template loading, AI/fallback mode, Telegram API delivery, and persisted delivery outcome.

---

## 10. cTrader execution

Primary areas:

- `cloudflare-v2/src/adapters/ctrader_executor_v2.js`
- `cloudflare-v2/src/execution/platform_translation.js`
- cTrader protocol/session/gateway code.

Important requirements:

- internal idempotency keys may remain long;
- broker-facing cTrader `clientMsgId` must stay within API limits (<=64 chars) using deterministic bounded derivation;
- open and management paths must both use safe bounded IDs;
- broker order/position/deal IDs and useful diagnostics must be retained;
- market acceptance/fill and later SL/TP protection may be distinct broker operations;
- uncertain outcomes must reconcile before retrying.

2026-09-14 real DEMO evidence confirmed bounded management IDs fixed prior cTrader close rejection: XAUUSD position `136559593` and AUDJPY position `136560498` both closed successfully after the fix.

---

## 11. MT5 execution and connector

Recommended destination uses the standalone Windows connector in `mt5-connector/` beside an open logged-in MT5 terminal.

Key files:

- `mt5-connector/mkety_mt5_connector.py`
- `cloudflare-v2/bridges/mt5_bridge.py`
- `cloudflare-v2/bridges/test_mt5_bridge.py`
- `cloudflare-v2/bridges/test_mt5_bridge_preflight.py`

Release workflow: `.github/workflows/mt5-connector-release.yml`.

Pairing model:

1. create a one-time pairing token;
2. connector authenticates outbound to Mkety;
3. connector reports authoritative terminal account/server/environment/catalog;
4. gateway issues an instance-bound reconnect credential;
5. reconnect credential is persisted locally;
6. pairing token never becomes trade authority.

Default local config:

- `%APPDATA%\Mkety\mt5-connector.json`
- `%APPDATA%\Mkety\mt5-connector-ledger.sqlite`

Reset:

```powershell
MketyMT5Connector.exe --reset
```

Pair:

```powershell
MketyMT5Connector.exe --token "<ONE_TIME_PAIR_TOKEN>"
```

Broker-adaptive requirements include safe symbol catalog matching, ambiguity fail-closed, min/max/step lot normalization, broker tick/digits normalization, filling-mode candidates, market/pending/STOP_LIMIT where supported, `order_check`, short deterministic comments with commentless retry only when the broker rejects comments, modify, partial/full close, cancel, reconciliation, and connector-local replay protection.

`execute_reconciled()` must reconcile before a new OPEN when a prior broker success might already exist.

---

## 12. Broker execution authorization

Immediately before dispatch, reload/revalidate persisted authority including workspace, source, route, destination/account identity, active/execution flags, environment, global runtime controls, LIVE gate, risk/kill switch and allowed symbols/limits.

A connector being online does not authorize a trade. A route existing does not authorize LIVE. An account being active does not authorize LIVE.

---

## 13. Durable trade state

Design:

- Durable Object = active coordination/hot state;
- Supabase = durable relational materialization/recovery;
- UUID relational PK/FKs remain UUID;
- runtime textual group/leg IDs use dedicated columns.

A successful OPEN should retain opening fill/broker identifiers. Later management must not destroy historical opening information merely because a close/modify response omits it.

On successful full close/cancel, durable state must reflect lifecycle completion, including a non-null close timestamp where appropriate and zero remaining volume for a fully closed leg.

Known defect found during 2026-09-14 DEMO acceptance: successful close materialization left `closed_at` null and converted missing management `fillPrice` to zero because `Number(null) === 0`. Regression coverage/fix is required before final signoff.

State repair must never cause a broker resend.

---

## 14. Real DEMO acceptance matrix — all rows required before LIVE

Do not declare production-ready-for-LIVE from unit tests alone. Obtain fresh real DEMO evidence after relevant deployments.

Required matrix:

1. **Safety preflight:** LIVE global/account gates off; zero unexpected LIVE deliveries.
2. **Normal Telegram Bot API source:** authenticated real webhook event accepted only from allowed chat; stable native identity; reply/edit path works.
3. **Telegram MTProto source:** real allowed-channel event reaches canonical pipeline.
4. **Telegram exact destination (`none`):** real Bot API source message reaches target with exact text and native formatting entities where provided; no AI/cleanup/template rewrite.
5. **Telegram deterministic template:** canonical template output reaches destination correctly.
6. **Telegram AI presentation:** configured AI output works and provider failure still produces deterministic safe fallback.
7. **Destination isolation:** one Telegram/broker destination failure does not cancel independent siblings.
8. **Fresh broker open:** same source event executes exactly once on each intended DEMO broker destination.
9. **Replay/idempotency:** exact replay does not create a duplicate broker position.
10. **Fast -> full completion:** one fast/incomplete entry followed by compatible full SL/TP signal stays on one logical group/position and does not duplicate OPEN.
11. **Reply/thread management:** `SL AT BE NOW` and explicit SL/TP management correlate to the intended group.
12. **Partial close:** correct volume remains and durable state stays OPEN.
13. **Full close:** broker position closes; durable remaining volume becomes zero; status CLOSED; `closed_at` populated; original opening fill retained.
14. **Pending + cancel:** broker-native pending order lifecycle works where instrument/account supports it.
15. **Connector restart/reconnect:** MT5 reconnects with instance credential and does not replay a completed command.
16. **Recovery:** DO/Supabase recovery can restore correlation without duplicate execution.
17. **Final safety check:** LIVE gate still off and no unintended LIVE delivery exists.

Only after every applicable row is green may an agent propose a small, explicitly authorized controlled LIVE test. The user must explicitly authorize that LIVE test; agents must never flip LIVE gates on their own.

---

## 15. Debugging playbooks

### Signal did not trade

Trace in order:

1. source ingress/auth/allowlist;
2. stored event identity/idempotency;
3. deterministic interpretation;
4. AI attempt/fallback if applicable;
5. intent validation status;
6. correlation result;
7. persisted route resolution;
8. runtime/account safety gates;
9. broker translation;
10. connector/gateway/broker response;
11. destination delivery row;
12. durable state materialization.

### Fast signal opened but completion duplicated

Inspect original and follow-up external event IDs, source instance, reply/thread metadata, incomplete group state, correlation reason, action type, broker position ID and idempotency key. Never fix this by symbol-only destructive matching.

### Telegram exact forwarding differs from source

Inspect the original Bot API update `text`/`caption`, `entities`/`caption_entities`, normalized event metadata, selected template formatting mode, and final Telegram request body. `none` must not invoke AI or deterministic template rendering.

### Broker success but DB looks wrong

Reconcile broker truth first. Repair durable state only. Never resend a broker action simply to make DB rows look complete.

---

## 16. Documentation map

Key operational references include:

- `AGENTS.md` — first read / source-of-truth handoff
- `docs/MT5_CONNECTOR_ACCEPTANCE_RUNBOOK.md`
- `docs/STABILIZATION_PROGRESS_2026-09-14.md`
- `docs/STABILIZATION_HANDOFF_2026-09-14.md`
- `docs/MKETY_TRADING_OPERATOR_CUSTOMER_MANUAL.md`
- `docs/trading-launch-console-manual-e2e.md`
- `cloudflare-v2/docs/PRODUCTION_V1_CUTOVER_RUNBOOK.md`
- current specs/plans under `docs/superpowers/`

Historical checklists are evidence, not authority over current code/production state.

---

## 17. Agent startup sequence

For any future debugging/acceptance session:

1. read this file;
2. inspect current `main`, open PRs and latest deployment state;
3. query current production runtime controls/accounts/sources/routes/destinations/templates;
4. confirm LIVE is off before any broker work;
5. inspect the latest event/delivery/state evidence rather than assuming an old failure still exists;
6. reproduce with the smallest safe DEMO case;
7. add regression coverage before a reproducible code fix;
8. run focused tests, then full CI;
9. deploy only reviewed/merged `main` through the production workflow;
10. repeat the applicable real DEMO acceptance rows;
11. document fresh evidence here/runbook when it changes the operational baseline.

---

## 18. Definition of done

A trading change is not done merely because code compiles or a unit test passes. It is done when:

- security/authority boundaries remain intact;
- LIVE has not been enabled implicitly;
- canonical interpretation/fallback behavior is preserved;
- fast/follow-up lifecycle correlation remains idempotent;
- normal Telegram Bot and MTProto source behavior remains valid;
- Telegram `none` exact-forwarding, clean, deterministic template and AI-fallback modes remain functional;
- cTrader and MT5 broker behavior is broker-adaptive and auditable;
- broker and Telegram destinations remain independently isolated;
- durable trade state accurately reflects broker reality;
- replay/reconnect/recovery cannot create accidental duplicate execution;
- automated tests and CI are green;
- relevant real DEMO acceptance rows pass after deployment;
- final safety check proves LIVE remained off.

---

## 19. Current implementation stream — 2026-09-16 source feeds, reusable Telegram bot endpoints, multi-instance MT5

Status: **implementation in progress on isolated feature branch; not deployed; migrations not applied to production; CI not yet accepted.**

Branch:

- `feat/source-feeds-telegram-endpoints-mt5-multi-instance`

Approved design/spec:

- `docs/superpowers/specs/2026-09-16-source-feeds-telegram-endpoints-mt5-multi-instance-design.md`

Implementation plan/progress checklist:

- `docs/superpowers/plans/2026-09-16-source-feeds-telegram-endpoints-mt5-multi-instance.md`

### 19.1 Approved routing semantics

`source_connections` remains the transport/credential boundary. A Telegram connection may authorize two or many chats/channels. Each persisted allowed chat is materialized as an independent `source_feeds` row and may have its own route set.

A user therefore needs another source connection only when they actually need another independent transport/session. An external MTProto VM may internally aggregate however it wants; Mkety does not depend on that internal topology. Mkety authenticates the persisted source connection, re-checks its allowed-chat policy, resolves the incoming Telegram native chat ID to a child feed, and applies the feed's persisted route policy.

Feed-specific active routes override the connection-level/default routes **for that feed only**. If a feed has no explicit feed-specific route, existing connection-level routes remain the compatibility fallback. Existing route rows are not deleted or rewritten.

First route-filter surface is canonical-symbol allow/block lists. Malformed broker filters fail closed; blocked wins; filtering is additive to broker symbol/account compatibility and never replaces broker-side symbol validation.

### 19.2 Telegram Bot API source

The UI already contained a conditional Bot Token input, but the generic admin source-onboarding map did not include `telegram_bot_api -> telegram_bot` encrypted credentials. This branch adds that missing backend contract and materializes the configured allowed chat IDs into source feeds after source creation.

One normal Telegram bot/webhook connection can therefore authorize many chats while each chat is independently routable. Telegram's webhook remains connection-scoped; users are not expected to create one bot per source channel.

### 19.3 Reusable Telegram destination credentials

New additive `trading_destination_connections` persistence stores a Telegram Bot API credential once per workspace. `trading_destinations.credential_connection_id` may reference that shared credential while retaining the legacy destination-local `credential_ciphertext` path.

One saved delivery bot can therefore be admin in many destination channels. Each destination keeps its own chat/channel ID, display name, template, enable state, route membership and delivery evidence while resolving the same encrypted bot token internally. Public APIs never return the token/ciphertext.

### 19.4 MT5 multi-terminal Windows VPS model

One connector process controls exactly one active MT5 terminal/account identity. For simultaneous Octa/FBS/Deriv MT5 accounts on one Windows VPS, run separate terminal installations/directories/processes and one Mkety connector instance per terminal/account.

This branch adds:

- `--terminal <terminal64.exe path>` -> deterministic `MetaTrader5.initialize(path=...)`;
- `--ledger <sqlite path>` -> isolated replay state;
- existing `--config <path>` -> isolated pairing/reconnect identity;
- omitting the new flags preserves the historical single-terminal auto-discovery/default-ledger behavior.

Windows/Windows VPS is the primary supported multi-terminal target. Wine/Linux remains experimental until independently accepted.

### 19.5 Additive migrations currently staged only on branch

- `0035_source_feeds_and_route_scope.sql`
- `0036_reusable_destination_connections.sql`

Do **not** apply these to production until branch CI, schema compatibility review, and migration dry verification are green. Both migrations are intended to preserve existing rows and behavior.

### 19.6 Implemented branch modules/tests so far

Implemented or modified:

- `cloudflare-v2/src/sources/source_feed_store.js`
- `cloudflare-v2/src/http/v1_admin_sources.js`
- `cloudflare-v2/src/http/v1_admin_destinations.js`
- `cloudflare-v2/src/http/v1_admin_destination_connections.js`
- `cloudflare-v2/src/http/v1_admin.js`
- `cloudflare-v2/src/destinations/route_filters.js`
- `cloudflare-v2/src/destinations/v1_destination_delivery_stage.js`
- `cloudflare-v2/src/dashboard_granular_routing.js`
- `cloudflare-v2/src/v1_connections_entry.js`
- `mt5-connector/mkety_mt5_connector.py`
- `mt5-connector/README.md`

New focused coverage includes source-feed store/admin route contracts, route filters, reusable Telegram destination credentials, granular-routing frontend contracts and MT5 multi-instance isolation.

### 19.7 Safety and compatibility requirements for this branch

- no LIVE flag/entitlement may be changed by these features;
- legacy connection-level routes remain functional when no feed-specific override exists;
- legacy Telegram destinations containing their own encrypted bot token remain functional;
- source authorization remains based on the persisted source connection allowlist; a `source_feeds` row never grants source authorization by itself;
- feed routes are constrained to their exact workspace + parent source connection;
- Telegram source/destination secrets remain encrypted and absent from public DTOs;
- route filtering must happen before broker fanout and may only narrow, never broaden, execution;
- existing exact-forward, template, AI-fallback, reply correlation, lifecycle/idempotency, broker normalization and durable-state behavior must remain intact;
- main/production stays untouched until verification succeeds.

### 19.8 Next steps from this handoff

1. Update the customer/operator manual and MT5 acceptance runbook with the new source-feed/reusable-bot/multi-terminal flow.
2. Open a PR from the feature branch and run full repository CI.
3. Treat any failing existing test as a compatibility signal; root-cause before changing working behavior.
4. Verify migrations against the current Supabase schema/constraint names before applying anything.
5. Apply migrations only after review/CI, then deploy through normal reviewed `main` production flow.
6. Re-query LIVE controls/account flags immediately before post-deploy DEMO testing.
7. Re-run Telegram source/feed routing, Telegram shared destination bot, cTrader DEMO, MT5 DEMO, replay, management and reconnect acceptance.
8. Final acceptance must again prove zero unintended LIVE actions and `live_broker_execution_enabled=false`.

---

## 20. Current production authority — 2026-09-16 PR #98

**This section supersedes section 19's stale implementation-status wording. Section 19 is preserved only as historical development evidence.**

Current production `main`:

- commit `a3571eddf251ed974369021d97414e177d6280f1`
- merged PR `#98` — simplified logical multi-feed routing and restored Telegram `Forward as-is (original)`

Post-merge production verification on this exact commit:

- Trading V1 CI `#2818` — success;
- Production Cloudflare Deploy `#87` — success, including health probe and verification of the persisted owner broker switch without changing it;
- Production Frontend E2E `#92` — success;
- Production Connection Readiness `#50` — success;
- Production Platform Configuration Verification `#49` — success for Worker broker bindings, shared gateway configuration, public gateway health and both broker WebSocket routes;
- CodeQL — success for JavaScript/TypeScript, Python, C# and Actions.

### 20.1 Current route authority

Route scope is resolved independently for each persisted **source connection → destination** pair.

- `All channels from this source` allows every authorized child feed to that destination, subject to normal filters/account/runtime gates.
- Selective mode allows only the explicitly checked child feeds to that destination.
- Once selective rows exist for a destination, an unchecked feed cannot inherit a legacy/default all-channels row for that same destination.
- Selective routing for destination A does **not** suppress an unrelated all-channels/default route to destination B.
- `cloudflare-v2/src/routes/logical_route_scope.js` is shared by destination delivery and broker planning; those two authority paths must not diverge.

Existing logical subgroups carry their exact underlying `routeIds` during edits. The reconcile API must preserve sibling specialized logical groups, reject stale route IDs, reject overlapping feed ownership, fail closed when a new selective route conflicts with an existing default route, and validate target collisions before moving route rows to another source/destination.

### 20.2 Symbol filters remain narrowing-only

Blank Allowed Symbols + blank Blocked Symbols means no route-level narrowing. Allowed/blocked filters may reduce eligible canonical symbols, but they never make an unsupported instrument tradable.

The destination account's current symbol catalog, aliases, risk constraints, environment, account state, runtime controls and LIVE gates remain authoritative. Instrument eligibility is capability-driven, not hard-coded by MT5/cTrader or broker brand.

### 20.3 Telegram destination formatting

Ready-made modes are:

- `none` — **Forward as-is (original)**;
- `clean` — **Clean original**;
- `template` — **Structured template**;
- `ai_then_fallback` — **AI presentation + safe fallback**.

A valid destination-level formatting selection overrides an attached template's formatting mode. `inherit`, absent or invalid override preserves the saved template behavior. Forward as-is preserves the original stored source text and native Telegram entities when available, with no AI/cleanup/reconstruction/branding. Changing formatting must not rotate the saved Telegram bot credential, recreate the endpoint or alter canonical broker execution semantics.

### 20.4 Current safety posture after production deployment

Fresh post-deploy audit:

- `trading_access_enabled=true`;
- `broker_execution_enabled=true`;
- `live_broker_execution_enabled=false`;
- Mkay — `brokerModes=["demo"]`, `liveExecution=false`;
- Starpips Forex — `brokerModes=["demo"]`, `liveExecution=false`;
- cTrader LIVE account `48681337` — `execution_enabled=false`, `live_execution_enabled=false`.

No LIVE gate was enabled by PR #98. CI/deployment/DEMO success does not authorize LIVE.

### 20.5 Remaining acceptance

Production gates are green, but real broker/source acceptance still requires fresh controlled DEMO evidence for feed A/B isolation, unselected-feed skip for the same selective destination, unrelated all-channels destination independence, reusable Telegram bot to multiple endpoints, exact Forward-as-is delivery, cTrader DEMO, MT5 DEMO with connector online, replay/no duplicate, management/reply/follow-up correlation, reconnect recovery and a final zero-LIVE audit.

Current detailed operator semantics: `docs/PR98_PRODUCTION_ACCEPTANCE_ADDENDUM.md`.
