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
Source Provider / Adapter
  -> authenticated/versioned Trading Event
  -> persistent canonical event idempotency
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

### Multi-source / multi-destination rule

Sources are first-class pluggable providers just like destinations. A workspace may enable multiple source connections simultaneously across Telegram MTProto, MT5, cTrader, TradingView, REST/custom APIs, and future source families.

- Default source is a **preference**, not exclusivity.
- At most one default source is allowed per `(workspace_id, source_family)`.
- Other enabled sources in the same family remain active.
- Unconfigured providers are inert and must never block configured providers.
- Provider runtime identity must not become canonical trade/event identity.
- Redundant providers may deliver the same native event; persistent canonical idempotency must collapse the duplicate before AI/orchestration/trading.

Current provider families/types are defined in `cloudflare-v2/src/sources/provider_registry.js`:

- Telegram: `cloudflare_container_mtproto`, `cloudflare_do_mtproto`, `external_mtproto`
- TradingView: `tradingview_webhook`
- MT5: `mt5_source_bridge`
- cTrader: `ctrader_source`
- custom: `custom_signed_api`

Design/spec:
`docs/superpowers/specs/2026-09-02-multi-source-provider-and-mtproto-runtime-design.md`

Implementation plan:
`docs/superpowers/plans/2026-09-02-multi-source-provider-foundation.md`

### MTProto runtime direction

Preferred first-party Telegram runtime: **Cloudflare Container + Telethon**, one Telegram session listening to many configured chats/channels.

Supported alternatives remain first-class:

- pure Cloudflare Durable Object + mtcute;
- external Telethon/mtcute listener;
- future compatible signed MTProto providers.

Hard reliability requirements:

- continuous normal connectivity;
- automatic reconnect/restart;
- persistent Telegram session/update state;
- recovery/catch-up after infrastructure interruption;
- listener receive loop decoupled from downstream processing;
- queue/retry-safe delivery where first-party runtime supports it;
- native Telegram identity survives provider changes;
- replays/duplicates never create duplicate trades.

Canonical Telegram identity currently targets:

```text
telegram:<accountScope>:<chatId>:<messageId>
```

Container availability must not make DO/external providers mandatory or unavailable. If a provider is not configured, the others continue normally.

### MT5 in Cloudflare Container — feasibility note only

Cloudflare Containers are Linux/amd64 and MetaTrader 5 can run on Linux via Wine, so an MT5 terminal in a Cloudflare Container is technically feasible. Do **not** target the 256 MiB `lite` tier for MT5+Wine reliability. Any MT5-container experiment is a separate future gated task; it is **not** part of the current MTProto implementation batch and must not weaken existing MT5 demo safety gates.

## Core design rules

- Static symbol aliases are hints only. Connected-account broker metadata is authoritative for symbol names/IDs, suffixes/prefixes, precision, tick economics, lot/volume units, order semantics, and account mode.
- Straightforward signals use deterministic processing and may bypass AI.
- Ambiguous language may use bounded AI, but AI structure must pass deterministic validation.
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
7. Source/broker/provider secrets must never be returned to browsers, logged, committed, or pasted into chat.
8. Risk-reducing management may bypass drawdown/open-risk locks, but the global kill switch still blocks all actions.
9. Do not replace the legacy Telegram route until V1 comparison and non-live/demo acceptance are satisfactory.
10. TDD is mandatory: observe an exact RED before production feature/bugfix code, then require full GREEN before claiming completion.

## Verified V1 implementation state

### Worker / ingress / auth

- Legacy `POST /api/webhook/process_signal` remains authoritative by default.
- `TRADING_V1_SHADOW=true` adds side-effect-free canonical diagnostics only.
- `POST /api/v1/events` is universal signed V1 ingress.
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
- multiple per-account fast Position Groups from the same originating source event form one safe completion cluster;
- genuinely distinct competing fast source events remain ambiguous and fail closed;
- ambiguous unthreaded management fails closed;
- persistent `TradeStateNode` Durable Object state;
- source-event IDs append idempotently;
- broker position/order IDs bind to canonical legs;
- closed groups remain auditable but are excluded from active correlation;
- V1 simulation dependencies expose authenticated matched-group reads through the internal Trade State client.

Cloudflare binding:

```text
TRADE_STATE_NAMESPACE -> TradeStateNode
```

### Simulation-only orchestration

`src/pipeline/v1_orchestrator.js` has no broker executor dependency and never dispatches a live/demo broker action.

Verified behavior includes:

- disabled/blocked/kill-switch accounts emit zero actions;
- `wait_for_complete_signal` remains action-free for incomplete fast entries;
- ambiguous correlation remains action-free;
- `FAST_ENTRY_COMPLETION` reuses existing Position Groups, promotes first leg to TP1, and opens only missing targets;
- multi-account completion reconciles every account sharing the same originating fast source event while wait-policy accounts open normally on completion;
- simulation may reconcile prior `PLANNED` legs without inventing broker IDs; real broker helpers remain strict;
- matched BE/partial/full-close management uses durable group state and `REDUCE_RISK` policy;
- simulation-only pending cancellation works for `PLANNED` non-market legs without fabricating `brokerOrderId`;
- market-position groups cannot be cancelled as pending;
- drawdown/open-risk locks do not prevent protective management, but execution disablement/kill switch still block it;
- unsupported management fails closed.

### Signed V1 simulation acceptance

Executable:

```text
npm run accept:v1:simulation
```

Verified scenario semantics include complete signal, exact duplicate, invalid signature, stale signed timestamp, kill switch, fast-entry completion, arbitrary TP count, AI ambiguity fail-closed, reply-targeted BE/half-close, thread-targeted BE, and pending-order cancellation.

This command has **not** been run against a configured external Worker in this development session because Cloudflare/source credentials are not available here.

### cTrader demo foundation

Executable:

```text
npm run accept:ctrader:demo
```

Repo-side support includes official JSON WebSocket auth/session lifecycle, heartbeat/correlation, account rights/mode, dynamic symbols/quotes, market/pending/amend/close/partial/cancel, persistent destination idempotency, actual-fill-aware protection/BE, and explicit demo lifecycle gates.

No real cTrader demo credentials/order were used in this development session.

### MT5 demo foundation

Executable:

```text
npm run accept:mt5:demo
```

Repo-side support includes signed/versioned bridge envelopes, replay/expiry protection, dynamic terminal symbol/tick discovery, exact expected demo account/server validation, persistent destination idempotency, protected market lifecycle, actual fill, BE, partial close, and exact remainder close behind explicit demo lifecycle gates.

No real MT5 demo terminal/bridge/order was used in this development session.

## Multi-source provider foundation — 2026-09-02

### Task 1 — provider registry and canonical native identity: GREEN

Files:

- `cloudflare-v2/src/sources/provider_registry.js`
- `cloudflare-v2/src/sources/canonical_event_id.js`
- `cloudflare-v2/tests/source_provider_registry.test.mjs`
- `cloudflare-v2/tests/canonical_source_event_id.test.mjs`

Behavior:

- heterogeneous provider registry is data-driven;
- unknown providers fail closed;
- provider/source-family mismatches fail closed;
- provider default status is preference only;
- Telegram Container and DO providers converge on the same provider-independent native event ID;
- MT5/cTrader/TradingView identities remain family/scoped.

TDD evidence:

- RED `33598485434`: **257/259 passed**; only the two intentionally missing new modules failed.
- GREEN `33598572539` on exact head `7d62761a072499f6f93910398b3be455b68a2913`: Worker/core, MT5 bridge, Wrangler dry-run all success.

### Task 2 — source connection store/default semantics: GREEN

Files:

- `cloudflare-v2/db/migrations/0003_multi_source_provider_registry.sql`
- `cloudflare-v2/src/sources/source_connection_store.js`
- `cloudflare-v2/tests/source_connection_store.test.mjs`

Behavior:

- extends existing `source_connections`; does not rename/drop legacy ingress columns;
- adds `source_family`, `provider_type`, family-scoped `is_default`, `priority`, external identity/config, and common health fields;
- partial unique index allows only one enabled default per workspace/source-family;
- `trading_set_default_source(...)` validates target then atomically switches the family preference;
- disabling a source also clears only that source's default flag;
- multiple providers/families remain simultaneously enabled;
- default status does not globally reorder unrelated families.

Migration status: **checked in but not yet applied to the shared Supabase project in this batch.** `0001` and `0002` remain the only migrations previously confirmed applied.

TDD/debug evidence:

- RED `33598660566`: **267/268 passed**; sole failure was intentionally missing `source_connection_store.js`.
- First implementation run `33598814319`: **272/273 passed**; exact single failure exposed an incorrect global-default sort. Root cause: `isDefault` is family-scoped and must not globally reorder unrelated source families.
- GREEN `33598900292` on exact head `215c136a0ed697aac8f00c241afbbb6fa7bb2b16`: **273/273 Node/core tests**, MT5 bridge, and Wrangler dry-run all success.

## Shared Supabase boundary — IMPORTANT

There is **no Supabase development branch**. The existing free-tier Mkety Supabase project is used with strict Trading isolation.

Trading-owned public schema includes:

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
- Checked-in migrations `0001` and `0002` were previously applied under this isolation rule.
- Migration `0003_multi_source_provider_registry.sql` is checked in but **not yet claimed applied**.
- Shared `public.workspaces` must remain untouched.
- RLS remains required on Trading-owned public tables.
- One previously verified `trading_workspace_access` row exists disabled with no Zitadel org binding; keep it disabled until authorization is verified.
- Do not create a paid/dev Supabase branch.

Runbook: `cloudflare-v2/docs/STAGING_V1_RUNBOOK.md`.

## CI / verification rule

Every meaningful code head must pass all current gates before it is called green:

1. Node Worker/trading-core tests;
2. pure MT5 bridge tests;
3. Wrangler dry-run;
4. MTProto Python/container tests once those are added to CI.

Always inspect the exact newest branch/push run before claiming current head green.

Key recent green checkpoints:

- `33554901358` @ `d3edefe91f9ecae49ebf4f84d5d6b04f0d5cd7c5` — signed pending cancellation acceptance;
- `33555072129` @ `ceb17534e7d416d76ac3f2361b4705b7646860bd` — docs checkpoint, all existing gates green;
- `33598572539` @ `7d62761a072499f6f93910398b3be455b68a2913` — multi-source provider registry/canonical identity green;
- `33598900292` @ `215c136a0ed697aac8f00c241afbbb6fa7bb2b16` — multi-source source-store/default semantics green.

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
- acceptance-side `TRADING_V1_ENDPOINT`, `TRADING_V1_SOURCE_ID`, `TRADING_V1_SOURCE_SECRET` supplied through runtime environment only.

Before Cloudflare Container MTProto E2E:

- Cloudflare Container binding/configuration;
- encrypted Telegram API ID/hash/session bootstrap values through runtime secrets only;
- queue or internal signed-ingress binding;
- non-live source connection/provider record;
- Telegram test account/channel suitable for soak/reconnect tests;
- no secret values in Git/chat/logs.

Before cTrader demo E2E:

- Supabase service credentials/workspace ID;
- cTrader client ID/secret/access token/demo account ID;
- explicit lifecycle order-test gates.

Before MT5 demo E2E:

- Supabase service credentials/workspace ID;
- authenticated MT5 bridge URL/secret;
- exact demo account ID and expected demo server;
- explicit lifecycle order-test gates.

## Current development priority

1. Task 3: make V1 event reservation/provider authentication support provider-independent native event identity and cross-provider deduplication without weakening authentication.
2. Task 4: Cloudflare Container MTProto provider contract + Telethon listener skeleton, health, persistence contract and Docker image under TDD.
3. Task 5: reliable Queue/signed-V1 handoff and recovery/checkpoint semantics.
4. Task 6: harden pure DO+mtcute as an alternative provider using the same canonical Telegram identity and health contract.
5. Task 7: heterogeneous external MTProto/MT5/cTrader/TradingView/custom source registration/coexistence.
6. Task 8: Zitadel-authorized admin source management/default selection API.
7. Task 9: non-live acceptance + long-running reconnect/soak harness and runbook updates.
8. External staging: apply reviewed Trading-owned migration `0003`, configure non-live Worker/Container/source secrets, run signed V1 and MTProto soak acceptance.
9. cTrader and MT5 real demo probes/lifecycles only behind existing explicit gates.
10. Tiny controlled live tests only after static + source-provider + cTrader demo + MT5 demo acceptance is green.

## Exact next safe starting point

Write an intentional RED acceptance test proving that two separately authenticated Telegram source providers for the same workspace/session scope and same native `(chatId,messageId)` resolve to one canonical persisted event: first delivery processes, second returns `duplicate:true` and never enters AI/orchestration. Also prove a different message remains distinct and an unauthenticated source cannot exploit canonical deduplication. Then implement the smallest persistence/ingress change required.

## Mandatory progress update rule

After every meaningful implementation/testing batch, update this file with branch/PR state, what changed, exact RED/GREEN evidence, DB/config changes, remaining blockers, account-side setup still required, and the exact next safe starting point.
