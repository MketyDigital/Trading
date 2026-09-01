# Trading Project Agent Handoff

This file is the operational source of truth for `MketyDigital/Trading`. Read it before changing the project.

## Repository boundaries

- Active next-generation work stays in `cloudflare-v2/` unless a deliberate migration says otherwise.
- Root `server.js`, root `wrangler.toml`, `patch_admin_api.js`, and the old root package are legacy/reference material.
- `trade.mkety.com` / this repository is the standalone Trading runtime.
- `app.mkety.com` / Mkety is the identity, billing, entitlement, provisioning, and revocation control plane.
- `cloudflare-v2/src/index.js` is the preserved legacy Worker. Do not broad-refactor it while V1 is being proven.
- `cloudflare-v2/src/v1_entry.js` is the design-branch Cloudflare entrypoint.
- `main` is unchanged by this branch work. **Never merge to `main` without explicit user instruction.**

## Active branch / PR

- Branch: `design/enterprise-trading-event-core`
- Draft PR: **#2 — `feat: build enterprise trading event core foundation`**
- Wrangler entrypoint: `cloudflare-v2/src/v1_entry.js`
- Real-money execution: disabled

## Product contract

Mkety Trading is an enterprise/custom multi-tenant trading automation platform, not a Telegram-only copier.

Authoritative flow:

```text
Source Adapter
  -> authenticated/versioned Trading Event
  -> persistent event idempotency
  -> deterministic normalization / bounded AI ambiguity resolution
  -> correlation + Trade State
  -> canonical intent / management event
  -> deterministic validation
  -> account safety + risk
  -> Position Group / arbitrary TP legs
  -> platform translation
  -> persistent destination idempotency
  -> destination / broker adapter
```

Supported/target source classes include Telegram MTProto/DO, Telethon/Python VM listeners, TradingView, MT5 bridges, REST/custom webhooks, and future adapters. Canonical events may fan out to Telegram/manual outputs, MT5, cTrader, product-specific Deriv adapters, webhooks, Workers/services, and enterprise custom destinations.

### Core design rules

- Static symbol aliases are hints only. Connected-account broker metadata is authoritative for symbol names/IDs, suffixes/prefixes, precision, tick economics, lot/volume units, order semantics, and account mode.
- Straightforward signals use deterministic processing and may bypass AI.
- Ambiguous language may use bounded AI, but AI structure must pass the same deterministic validation.
- AI failure/latency must not block clear deterministic processing.
- Customer formatting is presentation only; rendered Telegram text/HTML is never execution authority.
- Fast-entry policy may be `execute_immediately`, `wait_for_complete_signal`, or `forward_only`.
- A later complete signal should reuse an executed fast first leg as TP1 and create only missing targets.
- Position Groups support arbitrary TP counts and preserve hedged/netted semantics.

## Mandatory trading safety

1. Real-money execution remains disabled until static simulation plus cTrader and MT5 demo acceptance are complete.
2. Never test live execution with meaningful capital.
3. Persistent event/destination/order idempotency is mandatory; in-memory dedupe is never authoritative.
4. Formatting/forwarding stays separate from trade authorization/execution.
5. Every account needs explicit execution enablement, symbol policy, max lots/risk, daily-loss/exposure controls, and kill switch before broker dispatch.
6. Fail closed on ambiguity, missing price, unsupported instrument, missing broker metadata, provider outage, missing credentials, unreliable risk economics, or ambiguous correlation.
7. Source/broker/provider secrets must never be returned to browsers, logged, or committed.
8. Risk-reducing management may bypass drawdown/open-risk locks, but the global kill switch still blocks all actions.
9. Do not replace the legacy Telegram route until V1 comparison and demo acceptance are satisfactory.

## Verified V1 implementation state — 2026-09-01

### Worker / ingress / auth

- Legacy `POST /api/webhook/process_signal` remains authoritative by default.
- `TRADING_V1_SHADOW=true` adds side-effect-free canonical diagnostics only.
- `POST /api/v1/events` is the universal signed V1 ingress.
- `GET /api/v1/health` reports non-secret readiness only.
- `/api/v1/admin/*` uses V1 Zitadel/workspace authorization.
- legacy `/api/admin/*` returns `410 LEGACY_ADMIN_API_RETIRED`.
- Exact raw-body HMAC headers: `X-Mkety-Source-Id`, `X-Mkety-Timestamp`, `X-Mkety-Signature`.
- Authenticated `source_connections` establishes trusted workspace/source authority.
- `trading_events` is reserved persistently before interpretation; duplicates stop before AI/orchestration.
- Reply/thread/edit metadata is preserved.
- AES-256-GCM versioned secret envelopes use `TRADING_MASTER_KEY`; source secrets decrypt server-side only.

### Parser / normalization / risk

Implemented/tested:

- market/pending signals, LONG/SHORT and wording variants;
- entry ranges, SL, arbitrary TP lists, fast/incomplete entries;
- BE, close, partial close, cancel-pending interpretation;
- deterministic obvious cases and bounded AI ambiguity resolution;
- impossible AI geometry fails closed;
- MT5/cTrader/Deriv catalog normalization and broker aliases/suffixes/prefixes;
- tick/price/volume normalization and entry-zone policies;
- fixed-lot and metadata-driven risk sizing;
- adapter-provided loss-per-lot for complex products;
- volume flooring without increasing intended risk;
- fail closed below broker minimum;
- worst-case range risk and current-price requirement for MARKET/NOW when necessary;
- account safety: execution gate, kill switch, symbol allowlist, max lots/risk, daily loss/open risk/exposure.

Critical cTrader volume rule: preserve raw `ProtoOASymbol.lotSize` protocol-cent semantics. **Never add another x100 conversion.**

### Correlation / Trade State

Implemented/tested:

- reply targeting;
- thread targeting;
- recent incomplete fast-entry completion by source + symbol + side + time window;
- ambiguous unthreaded management fails closed;
- persistent `TradeStateNode` Durable Object state;
- source-event IDs append idempotently;
- broker position/order IDs bind to canonical legs;
- closed groups remain auditable but are excluded from active correlation;
- actual V1 simulation dependencies expose authenticated `GET /groups/:id` through the internal Trade State client.

Cloudflare binding:

```text
TRADE_STATE_NAMESPACE -> TradeStateNode
```

### Simulation-only orchestration

`src/pipeline/v1_orchestrator.js` has no broker executor dependency and never dispatches a live/demo broker action.

Verified behavior:

- disabled/blocked/kill-switch accounts emit zero actions;
- `wait_for_complete_signal` remains action-free for incomplete fast entries;
- ambiguous correlation remains action-free;
- `FAST_ENTRY_COMPLETION` reuses the matched Position Group, recalculates the completed plan under current policy/risk, promotes the existing first leg to TP1, creates only missing TP legs, preserves original group/leg identity, appends the completion source event, clears `incomplete`, and marks actions `simulated:true`;
- simulation can reconcile a prior `PLANNED` fast leg before broker IDs exist; real broker helpers remain stricter;
- deterministic `MANAGEMENT` interpretations now enter correlation instead of returning early;
- matched BE/partial/full-close management uses existing durable group state, requires the exact bound account, evaluates `actionKind=REDUCE_RISK`, does not require market metadata/new risk sizing, and emits only simulated actions;
- drawdown/open-risk locks do not prevent protective/risk-reducing management, but execution disablement and kill switch still block it;
- successful simulated management appends its source event to the same durable group for audit without pretending broker state changed;
- unsupported management fails closed. `CANCEL_PENDING` is still a separate pending-order-state task.

### Signed V1 simulation acceptance command

Executable:

```text
npm run accept:v1:simulation
```

Default matrix:

- `complete_signal`
- exact `duplicate`
- `invalid_signature`
- correctly signed `stale_timestamp`

Verified semantic contracts:

- complete signal requires `simulation.status=SIMULATED`, `executionEnabled=false`, at least one READY account, and `simulated:true` actions;
- duplicate must prove `ok=true` and `duplicate=true`;
- invalid signature must return exact `401`;
- stale timestamp must return exact `401` while the stale body/timestamp pair remains correctly signed;
- optional `kill_switch` sends a normal signal and passes only if server-side policy returns BLOCKED + `KILL_SWITCH`, zero actions, and no READY account; the event cannot toggle safety policy;
- optional `fast_entry,fast_completion` is now sequence-aware: the first event must establish one READY group, the completion must prove `FAST_ENTRY_COMPLETION`, reuse the exact same `groupId`, modify TP1, open only TP2/TP3, preserve target ordering, and keep all actions simulated.

Other optional scenario templates currently include `fast_entry`, `pending_order`, `ambiguous`, `move_be`, `close_half`, and `cancel_pending`. Scenario-specific semantic validation for management/arbitrary TP/AI ambiguity is still pending.

This command has **not** been run against a configured external Worker in this development session because Cloudflare/source credentials are not available here.

### cTrader demo foundation

Executable:

```text
npm run accept:ctrader:demo
```

Verified repo-side behavior:

- official JSON WebSocket endpoint;
- app then account auth;
- heartbeat, request correlation, timeouts/errors/socket close;
- account rights/mode, account symbol metadata, quotes;
- market/pending/amend/close/partial-close/cancel pending;
- persistent destination idempotency;
- demo-only runtime by default; live requires explicit runtime opt-in outside the acceptance harness;
- probe resolves real account catalog + quote;
- lifecycle waits for actual fill (`ORDER_ACCEPTED` is not fill), then protects, moves SL to actual-fill BE, partial-closes and closes exact remainder;
- lifecycle always closes runtime in `finally`;
- persistent acceptance uses `destination_deliveries` scoped to workspace/demo account;
- lifecycle requires both `CTRADER_DEMO_ACCEPTANCE_MODE=lifecycle` and `CTRADER_DEMO_ORDER_TEST=true`.

No real cTrader demo credentials/order were used in this development session.

### MT5 demo foundation

Executable:

```text
npm run accept:mt5:demo
```

Verified repo-side behavior:

- signed/versioned `mkety.mt5.v1` bridge envelope;
- workspace/account/command/expiry scope and replay rejection;
- Python/EA bridge architecture and pure Python CI tests;
- dynamic terminal symbol catalog + tick;
- exact expected demo account/server validation;
- persistent destination idempotency;
- protected market lifecycle, broker-confirmed fill price, BE, partial close, exact remainder close;
- probe/lifecycle only; no live mode in the command;
- lifecycle requires `MT5_DEMO_ACCEPTANCE_MODE=lifecycle` and `MT5_DEMO_ORDER_TEST=true`.

No real MT5 demo terminal/bridge/order was used in this development session.

## Shared Supabase boundary — IMPORTANT

There is **no Supabase development branch**. The existing free-tier Mkety Supabase project is used with strict Trading isolation.

Trading-owned public schema:

- `trading_workspace_access`
- `source_connections`
- `trading_events`
- `position_groups`
- `position_legs`
- `destination_deliveries`
- additive V1 policy/index columns on Trading-specific existing `trade_accounts`

Rules/state:

- Do not alter/drop/rewrite unrelated Mkety tables.
- V1 Trading authorization must not depend on shared `public.workspaces`.
- `trading_workspace_access` is the Trading entitlement authority; intentionally no FK to shared `workspaces`.
- Checked-in migrations `0001` and `0002` were already applied under this isolation rule.
- Shared `public.workspaces` retained its exact pre-change schema.
- All new V1 workspace FKs point to `trading_workspace_access`.
- RLS is enabled on all six new Trading-owned public tables; no anon/authenticated policies are intentional for service-role-only internals.
- Advisor-reported V1 FK indexes were added; `trade_accounts.workspace_id` is indexed.
- One `trading_workspace_access` row exists disabled with no Zitadel org binding.
- At the verified DB checkpoint, source/event/position/delivery/trade-account staging rows were empty.
- Do not re-run migrations from scratch and do not create a paid/dev Supabase branch.

Runbook: `cloudflare-v2/docs/STAGING_V1_RUNBOOK.md`.

## Verification evidence

CI gates on this branch:

1. Node Worker/trading-core tests;
2. pure MT5 bridge tests;
3. Wrangler dry-run.

Important recent GREEN checkpoints:

- `33525149642` — final cTrader demo package command;
- `33541021382` — final MT5 demo package command;
- `33541653303` — signed V1 simulation package command;
- `33541946489` — expected-negative V1 security semantics;
- `33542227070` — default V1 acceptance matrix;
- `33542711209` — complete/duplicate response semantics;
- `33545224979` — fast-entry orchestration reconciliation;
- `33545664690` — authenticated matched-group Trade State read dependency;
- `33545946677` — kill-switch acceptance semantics;
- `33546437577` on head `8a964247e176905a70390371cfd7df3169cd1953` — reply-management orchestration, all three CI gates success;
- `33546971743` on head `7c2adaa34ae91abea3c990b4ac38fa6e116716af` — sequence-aware fast-entry completion acceptance, all three CI gates success.

Recent intentional RED checkpoints:

- `33543050264` — sole missing fast-completion orchestration behavior;
- `33545506600` — sole missing `stateStore.getGroup` dependency;
- `33545804689` — only two missing kill-switch acceptance contracts;
- `33546205291` — only two missing management orchestration contracts;
- `33546768317` on head `92a1ab00e2edc38ee08c5f0a25988eef212807c3` — 238/240 passed; only the two new fast-sequence acceptance tests failed.

Always inspect the newest branch/push run before claiming the current head is green.

## External configuration still required

No Cloudflare or Zitadel account connector is available in this session, so those settings have not been changed.

Before real signed V1 Worker acceptance:

- Worker `SUPABASE_URL` / service-role secret;
- Worker `TRADING_MASTER_KEY`;
- Worker `TRADE_STATE_INTERNAL_TOKEN`;
- Zitadel issuer/audience/JWKS/project/role/org mapping;
- encrypted active source HMAC secret;
- explicit simulation instrument/price context;
- restrictive non-live Trading account record;
- acceptance-side `TRADING_V1_ENDPOINT`, `TRADING_V1_SOURCE_ID`, `TRADING_V1_SOURCE_SECRET` supplied via runtime environment only.

Before cTrader demo E2E:

- Supabase service credentials/workspace ID;
- cTrader client ID/secret/access token/demo account ID;
- optional demo symbol;
- lifecycle explicit order-test gates.

Before MT5 demo E2E:

- Supabase service credentials/workspace ID;
- authenticated MT5 bridge URL/secret;
- exact demo account ID and expected demo server;
- optional demo symbol/lot values;
- lifecycle explicit order-test gates.

Do not paste secret values into Git/chat/logs.

## Remaining blockers / priority order

1. **Fix enterprise multi-account fast-completion correlation.** Current event-level correlation can treat multiple per-account fast groups from the same source signal as ambiguous, and a matched fast group can cause accounts that used `wait_for_complete_signal` to be skipped instead of opening from the completed signal. Correlation/orchestration must distinguish one source-signal cluster across multiple accounts from genuinely multiple competing fast signals.
2. Add scenario-specific signed acceptance for management/reply/thread behavior where durable open-position state can be safely established.
3. Add arbitrary-TP semantic acceptance.
4. Add AI ambiguity/fail-closed semantic acceptance.
5. Add pending-order cancellation state/orchestration separately from open-position management.
6. Run `npm run accept:v1:simulation` against a configured non-live Worker.
7. Configure Cloudflare Worker secrets/bindings and Zitadel role/org mapping; keep Trading access disabled until authorization is verified.
8. Create encrypted active source + restrictive non-live account and run the real shared-Supabase simulation matrix.
9. Configure cTrader demo credentials and run probe then explicitly gated lifecycle.
10. Configure MT5 demo bridge and run probe then explicitly gated lifecycle.
11. Migrate MTProto listener to signed V1 events while preserving legacy fallback/recovery.
12. Add per-customer destination formatting profiles with bounded AI + deterministic fallback.
13. Decide Deriv Options vs CFD/account API scope before replacing the legacy CALL/PUT executor.
14. Only after static simulation + cTrader demo + MT5 demo are green may deliberately tiny controlled live tests be considered.

## Exact next safe starting point

Do not redesign the DB or add more broker abstraction first.

Next repo-side work:

1. keep CI green;
2. write RED tests for multi-account fast-completion correlation using multiple Position Groups from one originating fast source event;
3. require one safe matched source-signal cluster to reconcile each account that already entered fast while allowing accounts that waited for completion to create their normal full-signal group;
4. keep genuinely distinct/competing fast source events ambiguous and action-free;
5. verify the full Node + MT5 + Wrangler suite;
6. update this file with the exact RED/GREEN evidence;
7. continue acceptance semantics only after that enterprise account fanout behavior is correct.

## Mandatory progress update rule

After every meaningful implementation/testing batch, update this file with branch/PR state, what changed, verification evidence, DB/config changes, remaining blockers, account-side setup still required, and the exact next safe starting point.
