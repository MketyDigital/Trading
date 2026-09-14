# Mkety Trading — AGENTS.md

## 0. Purpose and authority

This file is the highest-priority operational handoff for agents working in `MketyDigital/Trading`. Read it before changing code, configuration, infrastructure, broker execution, source ingestion, routing, persistence, AI behavior, or acceptance tests.

The goal of this repository is a source-agnostic trading automation platform that ingests trading events, normalizes them into one canonical lifecycle, routes them to configured destinations, executes on supported broker adapters, persists durable state, and safely handles later management/follow-up messages without duplicate execution.

If this file conflicts with an older plan, old PR description, old runbook, or stale comment, prefer this file plus current code and current production state. Then update this file as part of the fix.

---

## 1. Absolute safety rules

1. **Never enable LIVE execution automatically.**
2. **Do not use the cTrader LIVE account for engineering or DEMO acceptance.**
3. Before any real broker test, verify all three layers:
   - global runtime `live_broker_execution_enabled = false`;
   - target DEMO account `execution_enabled = true`, `live_execution_enabled = false`;
   - any LIVE account `execution_enabled = false`, `live_execution_enabled = false`.
4. Broker execution may be globally enabled for DEMO while LIVE remains disabled. The DB runtime controls are authoritative; do not infer safety only from an old Wrangler env value or an old document.
5. Never commit secrets, Telegram sessions, API keys, broker passwords, pairing tokens, reconnect tokens, Cloudflare secrets, Supabase service-role keys, or userbot sessions.
6. Never expose stored secrets through browser/API responses. Return safe state such as `credentialConfigured`, connection status, or redacted metadata only.
7. Caller-supplied workspace/account/destination/provider/broker/role/routing/execution hints are never authority. Reload persisted state before execution.
8. AI is never trading authority. AI may interpret genuine ambiguity or format destination output, but canonical semantics and final execution safety remain deterministic and server-controlled.
9. If broker success occurred but state persistence/binding failed, repair state only. **Never resend the broker action** unless broker outcome is proven not to have occurred.
10. For debugging, find the root cause before changing production code. Add or update a regression test first whenever the failure is reproducible.

---

## 2. Current production safety state — 2026-09-14

Supabase project: `Mkety Digital` (`vdblajgxrfndjesoyayy`).

Current runtime controls immediately before PR #85 deployment:

- `trading_access_enabled = true`
- `broker_execution_enabled = true`
- `live_broker_execution_enabled = false`

Current acceptance workspace:

- workspace UUID: `5f63234c-20e9-426c-995f-56d129f51ece`

DEMO execution accounts:

- cTrader DEMO UUID: `40eacf2a-5a8a-4648-9b90-55038748d2ed`
- MT5 DEMO UUID: `87eb40ab-5cce-48c5-b764-149fd6b31ca5`

LIVE guard account:

- cTrader LIVE UUID: `4dbe17df-40b0-412a-88de-9bbc562969c7`
- must remain `execution_enabled = false`
- must remain `live_execution_enabled = false`

The workspace entitlement must keep `liveExecution = false` throughout DEMO stabilization.

Do not rely on IDs copied into this file forever. Before a future real-broker test, query current rows and verify environment/account state again.

---

## 3. End-to-end architecture

The normal event flow is:

```text
Source
  -> authenticated ingress
  -> source/workspace authorization
  -> source-native idempotency
  -> deterministic parser
  -> bounded AI only when genuinely needed
  -> deterministic fallback when recoverable
  -> canonical signal/management event
  -> correlation to position group / prior event
  -> persisted route resolution
  -> independent destination fanout
       -> Telegram presentation/delivery
       -> cTrader execution
       -> MT5 execution
       -> audit/internal destinations
  -> delivery result persistence
  -> durable trade-state materialization
  -> later management/follow-up/reply events
  -> reconnect/replay/recovery without duplicate broker action
```

### Core rule

Every source must converge into one normalized lifecycle. Telegram, TradingView, custom signed API, MTProto, MT5 source bridge, or future sources must not create separate trading semantics.

---

## 4. Main runtime components

### Cloudflare Worker

Primary runtime under `cloudflare-v2/`.

Responsibilities:

- auth and workspace access;
- source validation and ingress;
- canonical interpretation;
- AI routing/circuit breakers;
- signal validation;
- correlation and lifecycle orchestration;
- destination routing;
- broker dispatch authorization;
- Telegram presentation;
- delivery state;
- Durable Object coordination;
- Supabase persistence/recovery;
- admin/customer APIs;
- runtime controls.

Production Worker script: `mkety-copier-engine`.

Primary production URL: `https://trade.mkety.com/`.

Production deploy workflow: `.github/workflows/production-cloudflare-deploy.yml`.

Important: production deployment is intentionally restricted to `main`.

### Durable Objects

Durable Objects are the hot coordination/state layer for active trade lifecycle state and correlation. They are not the sole durable source of truth. Supabase mirrors material state and can hydrate/recover DO state after loss/restart.

Relevant files include:

- `cloudflare-v2/src/state/trade_state_store.js`
- `cloudflare-v2/src/state/trade_state_node.js`
- `cloudflare-v2/src/state/production_trade_state_binder.js`
- `cloudflare-v2/src/execution/production_binding_repair.js`

### Supabase

Supabase stores authoritative workspace/configuration state and durable trading records.

Key operational areas:

- `trading_runtime_controls`
- `trade_accounts`
- source connection rows
- destinations and routes
- destination deliveries/retry state
- `position_groups`
- `position_legs`
- access/session/entitlement state

Never assume the schema from memory; query `information_schema.columns` when writing migrations or debugging row shape.

### Shared cTrader / MT5 gateway

The gateway is deployed separately from the Cloudflare Worker. It handles outbound connector sessions and cTrader/MT5 gateway transport.

MT5 production WebSocket endpoint:

```text
wss://cbot.mkety.com:25345/v1/mt5
```

A successful Worker deploy does not prove gateway health. Verify gateway/connector state independently.

---

## 5. Source types and ingress

Supported source concepts include:

- Telegram / external MTProto
- hosted MTProto
- TradingView webhook
- custom signed API
- MT5 source bridge
- cTrader source

### External MTProto principle

An external/user-owned MTProto client is transport only. It does not choose workspace, account, destination, risk rules, or execution authority.

The Worker authenticates the persisted source and enforces the persisted Telegram chat allowlist before AI or routing.

### Signed source events

External signed sources use the canonical event ingress contract. Source identity, event identity, timestamp, and signature must remain stable enough for replay/idempotency guarantees.

Do not create a second ingestion path for a feature that can use the canonical source-event contract.

### Existing acceptance source

The currently routed Telegram/MTProto acceptance source is persisted in the production DB. Re-query it before testing rather than relying only on copied values here. The last known source UUID was:

`48860770-4b2c-4b13-b49f-7d998f9d7ed5`

It routes to both DEMO broker destinations.

---

## 6. Interpretation, AI and fallback

Primary files:

- `cloudflare-v2/src/ai/trading_interpreter.js`
- `cloudflare-v2/src/ai/relaxed_signal_recovery.js`
- `cloudflare-v2/src/pipeline/signal_intent_validator.js`
- `cloudflare-v2/src/ai/universal_ai.js`

### Intended behavior

1. Deterministic parsing runs first for straightforward signals and management commands.
2. AI is used only for genuine ambiguity or explicitly configured destination presentation.
3. AI receives a bounded timeout.
4. If AI fails, times out, returns malformed JSON, or its circuit is open, materially recoverable source text falls back to deterministic recovery.
5. A coherent trade must not be rejected merely because AI-proposed numeric values do not appear as exact raw strings.
6. Secondary numeric/evidence validation is advisory unless there is a material contradiction.
7. Hard contradictions remain fail-closed, including clear side conflicts, symbol conflicts, unsupported/contradictory order type, impossible/unsafe geometry, or explicit do-not-trade wording.

### Status outputs

Typical interpretation status:

- `READY`
- `MANAGEMENT`
- `NO_ACTION`
- `NEEDS_REVIEW`

### Management wording

Deterministic aliases include common break-even wording such as:

- `SL AT BE`
- `SL AT BE NOW`
- `SL TO BE`
- `SL TO BE NOW`
- `MOVE SL TO BE`
- `BREAKEVEN`
- `BREAK EVEN`

These normalize to `MOVE_SL_TO_BE`.

Informational lifecycle text such as `STOPPED AT BE AFTER TP2` must be `NO_ACTION`, not a destructive broker command.

---

## 7. Canonical signal and lifecycle model

Canonical signal semantics include:

- side: BUY / SELL (LONG / SHORT normalize)
- symbol
- order type: MARKET / LIMIT / STOP / STOP_LIMIT
- entry: market / fixed / range / fast-incomplete
- stop loss
- TP1 / TP2 / TP3+
- risk/volume intent
- management action
- source relation/reply/thread metadata

Management actions include:

- move SL to breakeven
- move SL to explicit value
- change TP
- partial close/reduce
- full close
- cancel pending
- other explicitly supported risk-reducing lifecycle actions

Never infer a destructive management target from ambiguous context. Correlation must succeed safely first.

---

## 8. Correlation and follow-ups

Reply/follow-up correlation priority is intentionally conservative:

1. explicit reply target;
2. thread/relation target;
3. strong symbol/context match;
4. guarded unique/recent fallback only when unambiguous.

Fast/incomplete entries and later SL/TP completion must remain one logical group, not create duplicate positions.

Canonical reply relation currently uses `thread.reply_to_event_id` rather than older stale names such as `reply_to_external_event_id`.

Reply reason names and tests must follow current canonical correlator behavior.

---

## 9. Destination model and failure isolation

Routes are persisted and workspace-scoped. A source can fan out independently to multiple destinations.

Destination types include:

- broker account
- Telegram channel/group
- internal webhook/API
- audit-only

A failure in one destination must not cancel independent destinations.

Examples:

- Telegram formatting failure must not cancel valid DEMO broker execution.
- MT5 failure must not cancel cTrader or Telegram if those routes are independently valid.
- cTrader failure must not roll back a Telegram delivery already completed.

Persist each destination outcome separately.

---

## 10. Telegram destinations

Telegram destination presentation supports deterministic and AI-assisted formatting.

Keep user-selectable options intact. Do not simplify by deleting old templates or forcing AI.

General modes include concepts equivalent to:

- no transformation/raw
- clean deterministic formatting
- configured template
- AI transformation with deterministic fallback

AI presentation is presentation-only. It cannot change canonical trading semantics.

When debugging Telegram output, separate these questions:

1. Was the source event interpreted correctly?
2. Was the route selected?
3. Was the configured presentation/template loaded?
4. Did AI presentation run or fall back?
5. Did Telegram delivery succeed?
6. Was the result persisted?

Do not diagnose formatting by changing broker logic.

---

## 11. cTrader execution

Primary areas:

- `cloudflare-v2/src/adapters/ctrader_executor_v2.js`
- `cloudflare-v2/src/execution/platform_translation.js`
- cTrader protocol/session modules and gateway/cBot project

### Important compatibility rules

- Internal idempotency keys may be long.
- Broker-facing cTrader `clientMsgId` is bounded to the API limit (<= 64 chars) using deterministic collision-resistant derivation.
- Do not truncate the internal idempotency key itself.
- Broker order/position/deal IDs must be persisted.
- Market orders may require waiting for fill execution after order acceptance.
- Post-fill SL/TP protection is a separate broker action and must classify uncertain outcomes correctly.
- Broker error code and human-readable description must be preserved in delivery diagnostics.

### Known prior DEMO evidence

Historical real cTrader DEMO acceptance proved XAUUSD and synthetic execution before the latest durability work. Treat those records as historical evidence only; perform fresh acceptance after material execution changes.

---

## 12. MT5 execution architecture

### Recommended connector

The recommended MT5 destination uses the standalone Windows connector in `mt5-connector/`.

It runs on the same Windows computer as an open, logged-in MetaTrader 5 terminal and opens an outbound encrypted WebSocket to Mkety. The customer does not expose an inbound port or public VPS HTTP endpoint.

Code:

- `mt5-connector/mkety_mt5_connector.py`
- `cloudflare-v2/bridges/mt5_bridge.py`
- `mt5-connector/test_connector.py`
- `cloudflare-v2/bridges/test_mt5_bridge.py`
- `cloudflare-v2/bridges/test_mt5_bridge_preflight.py`

Release workflow:

- `.github/workflows/mt5-connector-release.yml`

Artifact name:

- `MketyMT5Connector-windows`

Executable:

- `MketyMT5Connector.exe`

### Pairing model

1. Create MT5 Connector pairing from Mkety Trading.
2. Download/run connector beside a logged-in MT5 terminal.
3. Paste the one-time pairing token on first run.
4. Connector authenticates to the gateway and sends authoritative terminal identity plus symbol catalog.
5. Gateway issues an instance-bound reconnect credential.
6. Connector saves that reconnect credential locally and uses it on later reconnects.
7. Mkety persists server-observed account/server/environment/catalog data.
8. Pairing token is transport onboarding only; it is never trade authority.

Default config file:

`%APPDATA%\Mkety\mt5-connector.json`

Default replay ledger:

`%APPDATA%\Mkety\mt5-connector-ledger.sqlite`

Reset pairing:

```powershell
MketyMT5Connector.exe --reset
```

Operator explicit token mode:

```powershell
MketyMT5Connector.exe --token "<PAIR_TOKEN>"
```

Ordinary users should not need `--gateway`; production gateway is baked in.

### MT5 broker-adaptive behavior

The engine must be capability-driven, not broker-name hardcoded.

Supported compatibility behavior includes:

- exact symbol when available;
- safe suffix/prefix/alias resolution against actual broker catalog;
- ambiguity fails closed;
- min/max/step lot normalization;
- broker tick-size/point/digits price normalization when metadata exists;
- preserve broker price if a constraint is absent rather than inventing one;
- FOK/IOC/RETURN filling-mode candidate handling;
- market orders;
- LIMIT/STOP and STOP_LIMIT when the terminal exposes corresponding constants;
- broker `order_check` before send;
- short deterministic comment marker;
- commentless retry only when broker specifically rejects the comment;
- modify SL/TP;
- partial/full close;
- pending cancellation;
- reconciliation after uncertain outcomes;
- connector-local replay ledger preventing duplicate commands.

### Critical idempotency behavior

`execute_reconciled()` attempts broker reconciliation before a new OPEN. If a prior broker success exists but Worker/state binding was lost, recover that result instead of sending another order.

---

## 13. Broker execution authorization

Immediately before dispatch, execution code must reload/revalidate persisted authority including:

- workspace access;
- source authorization;
- route enabled state;
- destination/account identity;
- account active state;
- account execution flag;
- environment;
- global runtime controls;
- LIVE gate;
- kill switch/risk policy;
- allowed symbol/risk constraints.

A connector being online does not authorize a trade.

A route existing does not authorize LIVE.

An account being active does not authorize LIVE.

---

## 14. Durable trade state and Supabase materialization

Current design:

- Durable Object = hot coordination state.
- Supabase = durable relational materialization/recovery source.
- UUID relational PKs/FKs remain UUIDs.
- Runtime textual identities use dedicated text columns.

Important columns added by migration `trading_0032_durable_trade_state_materialization`:

`position_groups`:

- `runtime_group_id`

`position_legs`:

- `runtime_leg_id`
- `broker_deal_id`
- `fill_price`
- `requested_lots`
- `executed_lots`
- `remaining_lots`
- `volume_step_lots`
- `minimum_lots`
- `action_type`
- `failure_code`

Do not map composite runtime group IDs into UUID PK columns.

Key persistence/recovery files:

- `cloudflare-v2/src/persistence/supabase_trade_state_persistence.js`
- `cloudflare-v2/src/state/trade_state_store.js`
- `cloudflare-v2/src/state/trade_state_node.js`
- `cloudflare-v2/src/state/production_trade_state_binder.js`
- `cloudflare-v2/src/execution/production_binding_repair.js`

### State-only repair rule

If broker success is known and only state binding/persistence failed, the retry path must perform state repair only. A state error must never convert into a second broker order.

---

## 15. Workspace scoping

Every internal state read/write/bind path that can cross workspace boundaries must carry the workspace identity explicitly.

A previous bug omitted the workspace header on some internal Trade State calls, preventing correct Supabase recovery. Regression coverage now protects this.

Do not infer workspace from a composite runtime group ID or client input.

---

## 16. Runtime controls

Production runtime controls are stored in `trading_runtime_controls`.

Important keys:

- `trading_access_enabled`
- `broker_execution_enabled`
- `live_broker_execution_enabled`

Treat them as independent gates.

For DEMO acceptance the intended state is:

```text
trading_access_enabled = true
broker_execution_enabled = true
live_broker_execution_enabled = false
```

For LIVE readiness, a separate owner-approved review is required. Do not flip the LIVE key merely because DEMO tests pass.

---

## 17. Important production/admin APIs

Common production base: `https://trade.mkety.com`.

Operational/admin endpoints include concepts such as:

- runtime controls
- access-code issuance/revocation
- admin connections
- sources
- destinations
- routes
- signed event ingress
- health

Before scripting against an endpoint, read the current handler implementation and tests. Do not rely on stale endpoint examples from old plans.

Admin authentication secrets remain server/GitHub-environment-side only.

---

## 18. CI and verification

### Main Worker/trading CI

Workflow:

`.github/workflows/trading-v1-ci.yml`

It runs:

- Worker/trading-core Node tests;
- legacy/pure MT5 bridge tests;
- MTProto Python tests.

### MT5 compatibility CI

Workflow:

`.github/workflows/mt5-compatibility-ci.yml`

This is a permanent compatibility gate and runs the expanded `test_mt5_bridge*.py` suite covering broker-adaptive behavior.

### MT5 connector release

Workflow:

`.github/workflows/mt5-connector-release.yml`

It:

1. installs pinned Python/build dependencies;
2. runs connector regression tests;
3. builds `MketyMT5Connector.exe` with PyInstaller;
4. smoke-tests packaged imports/runtime;
5. generates SHA256;
6. uploads `MketyMT5Connector-windows` artifact;
7. publishes/clobbers stable release assets on `main`/tag runs.

### Verification rule

Never claim a fix is complete because one focused test passed. Required evidence depends on changed area but normally includes:

- focused regression test;
- full Worker/Node suite if Worker logic changed;
- MT5 bridge compatibility if bridge changed;
- connector package build if connector/bridge changed;
- cTrader gateway/cBot CI if cTrader changed;
- post-merge production deploy if production runtime changed.

---

## 19. PR #85 stabilization — 2026-09-14

PR: `#85 Harden real DEMO management parsing and broker diagnostics`.

The branch incorporated the broad DEMO stabilization work, including:

- permissive secondary validation;
- deterministic recovery when AI fails on materially recoverable signals;
- preservation of AI for genuine ambiguity;
- break-even management aliases;
- informational stopped-at-BE handling;
- cTrader bounded management transport IDs;
- preserved cTrader broker error descriptions;
- MT5 broker-adaptive symbol/volume/price/filling/comment behavior;
- STOP_LIMIT support when exposed by MT5;
- corrected legacy tests for the approved fallback contract;
- permanent MT5 compatibility CI.

Exact automated evidence immediately before merge/deploy:

- Trading V1 CI run `34881442565`: Worker/Node ✅, MT5 bridge ✅, MTProto ✅
- MT5 Compatibility CI run `34881442554`: ✅
- Windows MT5 Connector build run `34881442599`: connector tests ✅, build ✅, smoke test ✅, checksum/artifact ✅

`docs/STABILIZATION_PROGRESS_2026-09-14.md` contains the chronological checkpoint details.

---

## 20. Real DEMO acceptance procedure

Use this order. Do not skip safety checks.

### A. Preflight

1. Verify production deployment is the intended commit.
2. Verify global runtime controls.
3. Verify cTrader DEMO account execution enabled and LIVE disabled.
4. Verify MT5 DEMO account execution enabled and LIVE disabled.
5. Verify cTrader LIVE account execution disabled and LIVE disabled.
6. Verify workspace entitlement `liveExecution=false`.
7. Verify source active/healthy and routes point only to intended DEMO destinations.
8. Verify MT5 connector is the freshly built/restarted connector from the accepted release.

### B. Controlled entry

Send one clear Telegram XAUUSD DEMO signal using minimum accepted risk/volume configuration.

Verify independently:

- source event accepted exactly once;
- interpretation = `READY`;
- correct symbol/side/entry/SL/TP;
- Telegram destination output where configured;
- exactly one cTrader DEMO broker action;
- exactly one MT5 DEMO broker action;
- real broker position/order/deal IDs captured;
- `position_groups` and `position_legs` materialized;
- destination delivery rows persisted.

### C. Replay

Replay the exact source event.

Expected:

- source/delivery idempotency converges;
- no duplicate cTrader order;
- no duplicate MT5 order.

### D. Management

Use an explicit reply to the controlled trade and test, where supported:

1. `SL AT BE NOW`
2. SL to explicit value
3. TP change
4. partial close
5. full close
6. pending cancel on a controlled pending-order case

Verify broker state plus durable DB lifecycle after each action.

### E. Fast signal lifecycle

Test fast/incomplete entry then later completion/update. Verify one group, no duplicate open, and later fields/actions correlate to the same group.

### F. Reconnect/recovery

Restart/reconnect connector and replay events. Verify:

- connector reconnect credential works;
- no duplicate broker action;
- DO/Supabase recovery preserves correlation;
- subsequent explicit reply management still reaches the correct group.

### G. Final safety proof

Query production again and confirm zero LIVE execution and unchanged LIVE account guards.

---

## 21. Debugging playbook

Always debug from upstream authority to downstream effect.

### If a Telegram signal does nothing

Check in order:

1. source connection active/healthy;
2. source/chat allowlist;
3. event ingress/authentication;
4. source-event reservation/idempotency;
5. interpretation status/reason;
6. correlation if management/follow-up;
7. route resolution;
8. destination authorization;
9. account/runtime gates;
10. adapter execution result;
11. delivery persistence;
12. durable trade-state materialization.

### If AI appears to block a valid signal

Check:

- deterministic parse first;
- AI timeout/circuit/provider result;
- deterministic fallback;
- `validationWarnings` vs hard validation failure;
- actual contradiction reason.

Do not restore exact-raw-number matching as a hard gate unless a new safety design explicitly requires it.

### If cTrader rejects management

Check:

- correlation and broker position/order ID;
- normalized management action;
- bounded `clientMsgId` length;
- symbol volume economics;
- broker error code and preserved description;
- whether response is TERMINAL, RETRYABLE, or UNCERTAIN.

### If MT5 fails

Check:

1. connector process running;
2. MT5 terminal open/logged into expected account;
3. connector authenticated to gateway;
4. server-observed account/environment matches DB row;
5. symbol exists or safely resolves to suffix/prefix variant;
6. volume min/max/step;
7. tick/digits metadata;
8. filling modes;
9. `order_check` retcode/comment;
10. whether broker rejected only the comment and commentless fallback was attempted;
11. connector replay ledger/reconciliation;
12. Worker delivery/state binding.

Do not hardcode a broker name to fix capability differences.

### If broker executed but DB state is missing

Stop before resending anything.

Check:

- destination delivery result;
- broker IDs in response;
- state binder failure;
- state-only repair queue/path;
- Supabase materialization;
- DO hydration/recovery.

The recovery must bind existing broker execution, not create another one.

### If CI fails

Use exact workflow/job logs. Do not infer from job name alone.

For GitHub Actions:

- identify exact head SHA;
- identify exact failing step;
- fetch decoded job logs;
- reproduce/focus locally or with a temporary diagnostic workflow only when normal logs are insufficient;
- remove temporary diagnostic workflow after root cause is known;
- add/update permanent regression coverage.

---

## 22. Database troubleshooting queries

Use read-only queries first.

Typical checks:

```sql
select * from trading_runtime_controls order by control_key;
```

```sql
select id, platform, environment, account_id, is_active, execution_enabled, live_execution_enabled
from trade_accounts
order by platform, environment;
```

For trade state, query recent `position_groups`, `position_legs`, destination deliveries and source events by workspace/event/time. Inspect schema before assuming column names.

Use `apply_migration` for DDL. Do not use ad-hoc `execute_sql` DDL for production schema changes.

---

## 23. Connector installation / operator quick guide

For full detail also read `mt5-connector/README.md`.

Customer/operator procedure:

1. Install/open MetaTrader 5 on Windows.
2. Log in to the intended **DEMO** broker account for acceptance.
3. In Mkety Trading, open Connections.
4. Create/select **MT5 Connector — Recommended** and request pairing.
5. Download the latest `MketyMT5Connector.exe` from the approved GitHub release/artifact.
6. Put the EXE in a stable folder such as `C:\Mkety\MT5\`.
7. Keep MT5 running.
8. Run the EXE.
9. On first run paste the one-time pairing token when prompted, or use:

```powershell
.\MketyMT5Connector.exe --token "<PAIR_TOKEN>"
```

10. Wait for output similar to:

```text
Mkety MT5 Connector connected: account <ACCOUNT> / <SERVER>
```

11. Return to Mkety Trading and use Sync/Retry identity sync if required.
12. Confirm account, server, broker and DEMO environment are correct before enabling DEMO execution.
13. Leave the connector running while tests/trading are active.

If pairing is wrong/stale:

```powershell
.\MketyMT5Connector.exe --reset
```

Then create a fresh pairing token and reconnect.

Do not send pairing/reconnect tokens in screenshots, chats, issues, commits, or logs.

---

## 24. Important documentation map

Read these when relevant:

- `AGENTS.md` — primary operational source of truth
- `docs/STABILIZATION_PROGRESS_2026-09-14.md` — latest stabilization checkpoint/evidence
- `docs/STABILIZATION_HANDOFF_2026-09-14.md` — earlier durability/acceptance handoff
- `docs/superpowers/plans/2026-09-14-demo-execution-complete-stabilization.md` — detailed stabilization plan
- `docs/superpowers/specs/2026-09-14-demo-execution-complete-stabilization-design.md` — design rationale
- `docs/superpowers/plans/2026-09-13-universal-normalization-reconciliation.md` — normalization/reconciliation work
- `mt5-connector/README.md` — customer/operator MT5 connector guide
- `docs/MKETY_TRADING_OPERATOR_CUSTOMER_MANUAL.md` — broader operator/customer workflow
- `cloudflare-v2/docs/PRODUCTION_V1_CUTOVER_RUNBOOK.md` — production cutover safety

Old plans are historical context, not automatic authority over current code.

---

## 25. How future agents should start any task

1. Read this file.
2. Read the latest stabilization handoff/progress file.
3. Inspect current `main` and relevant open PRs.
4. Query current production safety state if the task touches broker execution.
5. Identify the exact subsystem and its tests.
6. Reproduce the problem or establish current baseline.
7. Add/fix regression coverage before production logic where practical.
8. Keep LIVE off unless the owner explicitly begins a separate LIVE-readiness phase.
9. Run the full relevant verification matrix.
10. Update this file if architecture, safety gates, workflows, critical IDs, runbooks, or debugging procedures changed.

---

## 26. What not to do

- Do not build a second trading pipeline for one source or broker.
- Do not bypass persisted routing with payload hints.
- Do not let AI choose execution authority.
- Do not make numeric evidence matching aggressively reject coherent signals.
- Do not assume a broker symbol is exactly `XAUUSD`; resolve against the connected catalog.
- Do not round partial-close volume upward beyond requested risk reduction.
- Do not resend an action after an uncertain/known broker success without reconciliation.
- Do not use LIVE accounts as a shortcut for missing DEMO connectivity.
- Do not merge debugging-only workflows into permanent production state.
- Do not claim real DEMO acceptance from simulation or old broker IDs.
- Do not enable LIVE automatically after DEMO success.

---

## 27. Definition of done for current stabilization

The current stabilization is truly complete only when all of the following are evidenced on the current production code:

- automated Worker/Node green;
- MT5 compatibility green;
- cTrader/gateway relevant CI green;
- fresh MT5 connector release built from accepted code;
- fresh connector running against the intended MT5 DEMO account;
- one controlled Telegram XAUUSD signal reaches configured Telegram output plus cTrader DEMO plus MT5 DEMO as routed;
- exactly-once behavior proven by replay;
- real broker IDs persisted;
- Supabase group/legs materialized;
- explicit reply management tested on both brokers where supported;
- fast-signal follow-up lifecycle tested;
- reconnect/recovery tested without duplicate broker action;
- zero LIVE execution confirmed before and after.

Only after that should a separate LIVE-readiness review begin. LIVE activation is never part of this automatic completion flow.
