# Trading Project Agent Handoff

Operational source of truth for `MketyDigital/Trading`. Read before changing the project.

## Hard repository rules

- Active next-generation work stays in `cloudflare-v2/` unless a deliberate migration says otherwise.
- Preserve root/legacy runtime and `cloudflare-v2/src/index.js` until V1 is independently proven.
- Active branch: `design/enterprise-trading-event-core`.
- Draft PR: #2 `feat: build enterprise trading event core foundation`.
- Wrangler entrypoint: `cloudflare-v2/src/v1_entry.js`.
- **Never merge `main` without explicit user instruction.**
- Real-money execution remains disabled.
- TDD is mandatory: exact RED before production feature/bugfix code, full GREEN before completion claims.
- Never paste/log/commit source, broker, provider, database, or auth secrets.
- Update this file after every meaningful implementation/testing batch.

## Product contract

Mkety Trading is an enterprise/custom multi-tenant trading automation platform, not a Telegram-only copier.

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

### Multi-source / multi-destination

Sources are first-class pluggable providers like destinations. A workspace may enable multiple simultaneous sources across Telegram MTProto, MT5, cTrader, TradingView, REST/custom APIs, and future families.

Rules:

- default source = preference, not exclusivity;
- at most one enabled default per `(workspace_id, source_family)`;
- other enabled sources in that family remain active;
- unconfigured providers are inert and never block configured providers;
- provider runtime identity must not become canonical event identity;
- redundant providers may replay the same native event, but persistent canonical idempotency must collapse it before AI/orchestration/trading.

Current provider types in `cloudflare-v2/src/sources/provider_registry.js`:

- Telegram: `cloudflare_container_mtproto`, `cloudflare_do_mtproto`, `external_mtproto`
- TradingView: `tradingview_webhook`
- MT5: `mt5_source_bridge`
- cTrader: `ctrader_source`
- custom: `custom_signed_api`

Design:
`docs/superpowers/specs/2026-09-02-multi-source-provider-and-mtproto-runtime-design.md`

Plan:
`docs/superpowers/plans/2026-09-02-multi-source-provider-foundation.md`

## MTProto direction / availability requirement

Preferred first-party Telegram runtime: **Cloudflare Container + Telethon**, one Telegram session listening to many configured chats/channels.

Also supported as first-class providers:

- pure Cloudflare Durable Object + mtcute;
- external Telethon/mtcute;
- future compatible signed MTProto listeners.

Hard availability behavior:

- continuous normal connectivity;
- automatic reconnect/process/container restart;
- persistent Telegram authorization/update state;
- recovery/catch-up after infrastructure interruption;
- receive loop decoupled from downstream processing;
- Queue/retry-safe delivery for first-party runtime where practical;
- provider/runtime failover does not change native event identity;
- replays/duplicates never create duplicate trades.

Canonical Telegram native event identity:

```text
telegram:<accountScope>:<chatId>:<messageId>
```

No cloud runtime can promise zero infrastructure interruption. Engineering target is no known lost recoverable Telegram signal and minimal normal receive latency.

### MT5 in Cloudflare Container — feasibility note only

Technically feasible on Cloudflare Linux/amd64 using MT5 via Wine. Do **not** target the 256 MiB `lite` tier for MT5+Wine reliability. Any MT5-container experiment is separate and must not weaken existing MT5 demo safety gates.

## Core safety / semantics

- Static aliases are hints; connected broker metadata is authoritative for symbol IDs/names, suffixes, precision, tick economics, lot/volume units, order semantics, and account mode.
- Straightforward signals use deterministic processing and may bypass AI.
- Ambiguous language may use bounded AI but AI structure must pass deterministic validation.
- AI latency/failure must not block clear deterministic work.
- Customer formatting is presentation only, never execution authority.
- Fast-entry policies: `execute_immediately`, `wait_for_complete_signal`, `forward_only`.
- Completed fast signals reuse executed first leg as TP1 and add only missing targets.
- Position Groups support arbitrary TP counts and hedged/netted semantics.
- Persistent event/destination/order idempotency is mandatory.
- Every trade account requires explicit execution enablement, symbol/risk/lot/daily-loss/exposure policy, and kill switch before broker dispatch.
- Fail closed on ambiguity, unavailable broker metadata, unreliable risk economics, invalid correlation, provider outage, or missing credentials.
- Protective management may bypass drawdown/open-risk locks; global kill switch still blocks all actions.
- Never replace the legacy Telegram route until V1 comparison, source acceptance, and broker demos are satisfactory.

## Existing verified V1 foundation

Already implemented/tested before the multi-source batch:

- legacy `/api/webhook/process_signal` preserved; `TRADING_V1_SHADOW=true` adds side-effect-free diagnostics only;
- signed universal `POST /api/v1/events` with exact raw-body HMAC source authentication;
- V1 Zitadel/workspace admin authorization and Trading-owned entitlement isolation;
- AES-256-GCM encrypted tenant/source secrets;
- persistent Trading event reservation before interpretation;
- deterministic parser + bounded AI ambiguity resolution;
- MT5/cTrader/Deriv symbol/account normalization;
- metadata-driven risk sizing and account safety controls;
- arbitrary-TP Position Groups, fast-entry completion, hedged/netted foundations;
- persistent `TradeStateNode` Durable Object correlation/state;
- simulation orchestration for new signals, fast completion, BE, partial/full close, and pending cancellation;
- signed V1 simulation acceptance matrix;
- cTrader demo acceptance foundation;
- MT5 demo acceptance foundation.

Critical cTrader rule: preserve raw `ProtoOASymbol.lotSize` protocol-cent semantics; never add another x100 conversion.

Executables:

```text
npm run accept:v1:simulation
npm run accept:ctrader:demo
npm run accept:mt5:demo
```

No real external Worker acceptance, real cTrader demo order, or real MT5 demo order has been run in this development session because required account/runtime credentials are not available here.

## Multi-source provider foundation — 2026-09-02

### Task 1 — provider registry + canonical identity: GREEN

Files:

- `cloudflare-v2/src/sources/provider_registry.js`
- `cloudflare-v2/src/sources/canonical_event_id.js`
- corresponding tests.

Behavior:

- provider registry is data-driven;
- unknown/mismatched providers fail closed;
- Telegram Container/DO/external providers can converge on one provider-independent native identity;
- MT5/cTrader/TradingView identities remain family/scoped.

TDD evidence:

- RED `33598485434`: 257/259 passed; only two intentionally missing modules failed.
- GREEN `33598572539` @ `7d62761a072499f6f93910398b3be455b68a2913`: Worker/core, MT5 bridge, Wrangler dry-run success.

### Task 2 — source registry/default semantics: GREEN

Files:

- `cloudflare-v2/db/migrations/0003_multi_source_provider_registry.sql`
- `cloudflare-v2/src/sources/source_connection_store.js`
- `cloudflare-v2/tests/source_connection_store.test.mjs`

Behavior:

- additive extension of existing `source_connections`;
- source family/provider/default/priority/external identity/config/common health fields;
- one active default per workspace/source-family through partial unique index;
- atomic `trading_set_default_source(...)` validates target before switching preference;
- disabling a source clears only its own default;
- multiple heterogeneous providers remain active simultaneously;
- default status never globally reorders unrelated families.

TDD/debug evidence:

- RED `33598660566`: 267/268; only missing store.
- Intermediate `33598814319`: 272/273; exposed incorrect global default sorting.
- GREEN `33598900292` @ `215c136a0ed697aac8f00c241afbbb6fa7bb2b16`: 273/273 Node/core + MT5 bridge + Wrangler success.

### Task 3 — cross-provider persistent native-event idempotency: GREEN

Files:

- `cloudflare-v2/db/migrations/0004_cross_provider_event_identity.sql`
- `cloudflare-v2/src/storage/supabase_ingest_store.js`
- `cloudflare-v2/src/pipeline/ingest.js`
- `cloudflare-v2/tests/v1_cross_provider_idempotency.test.mjs`
- `cloudflare-v2/tests/supabase_cross_provider_idempotency_store.test.mjs`
- `cloudflare-v2/tests/cross_provider_event_migration.test.mjs`

Behavior:

- provider-local `external_event_id` remains preserved for audit/legacy behavior;
- authenticated source lookup exposes only required non-secret provider metadata plus server-decrypted HMAC secret;
- canonical identity is derived only **after successful source authentication**;
- `trading_events.canonical_event_id` is additive;
- partial unique index on `(workspace_id, canonical_event_id)` collapses the same native event across different provider connections;
- on canonical unique violation, duplicate lookup uses workspace + canonical event only, not provider ID;
- sources without stable canonical identity retain the original `(workspace, source_connection, external_event_id)` dedupe path;
- invalid provider signatures cannot pre-reserve/suppress a legitimate canonical event;
- different native Telegram message IDs remain distinct.

TDD evidence:

- RED `33599310435`: 275/276; only same-native cross-provider duplicate behavior failed.
- Extended RED `33599410187`: 276/279; exactly source metadata, canonical duplicate lookup, and same-native reservation gaps.
- Migration RED `33599559597`: 276/280; exactly those three gaps plus intentionally missing `0004`.
- GREEN `33599671009` @ `1f846fd7eee536cdb5ccd79e1118d3d31e30e39d`: Worker/core, pure MT5 bridge, Wrangler dry-run all success.

### Task 4 — Cloudflare Container/Telethon provider skeleton: GREEN

Implemented under TDD before Queue wiring:

- deterministic one-session/one-container provider identity;
- enabled/unconfigured lifecycle behavior;
- idempotent restart and sanitized common health status;
- Python Telethon listener core with restored session, auto reconnect, handler registration before catch-up, multi-chat filtering, outgoing-message suppression, Telegram native identity, bounded non-blocking handoff queue, and sanitized health;
- Python MTProto listener tests are now a required CI gate alongside Worker/core, MT5 bridge, and Wrangler dry-run.

First-party listener credentials remain runtime-only and are never exposed in status output.

### Task 5 — Cloudflare Queue → signed V1 reliability path: GREEN

Files:

- `cloudflare-v2/src/sources/source_event_queue.js`
- `cloudflare-v2/src/sources/source_queue_consumer.js`
- `cloudflare-v2/src/sources/source_queue_runtime.js`
- `cloudflare-v2/src/v1_entry.js`
- `cloudflare-v2/wrangler.toml`
- corresponding Queue/runtime/entrypoint/config tests.

Behavior:

- first-party listener/runtime hands off compact native events without receiving/decrypting the Trading source HMAC secret;
- Worker Queue consumer resolves the active source in Supabase and decrypts its source secret server-side only;
- exact canonical V1 body is signed inside the Worker and dispatched through the existing `/api/v1/events` handler;
- Queue success or persistent V1 duplicate acknowledgment causes message `ack()`;
- inactive/unknown source, missing runtime configuration, or downstream V1 failure causes message `retry()`;
- one Queue batch reuses one Supabase/store context;
- Worker exposes native Cloudflare `queue()` handler independently from legacy `fetch()` and `scheduled()` routes;
- Wrangler binds producer `SOURCE_EVENT_QUEUE` to `mkety-trading-source-events`;
- consumer uses low-latency `max_batch_size=5`, `max_batch_timeout=1`, bounded `max_retries=8`, and DLQ `mkety-trading-source-events-dlq`;
- no broker/destination behavior changed and real-money execution remains disabled.

TDD/verification evidence:

- RED `33602378306`: 289/290; only missing Queue consumer module.
- RED `33602515079`: 291/292; only missing Queue runtime module.
- GREEN `33602689542` @ `e53ae3489adf2395d5b72ea089a1eb30742463ef`: Worker/core, MT5 bridge, MTProto Python listener, Wrangler all success.
- RED after adding Worker queue contract: 293/295; exactly missing `worker.queue` behavior.
- GREEN `33602885866` @ `1e8dd3d40e00094bd8f9e0b04fbf8f5207f420c8`: all four CI gates success.
- Queue binding RED `33602954804`: 295/297; only missing Wrangler Queue producer/consumer blocks.
- GREEN `33603127779` @ `837190d63f780f7c72f477ed5a1accb84d20071c`: Worker/core, pure MT5 bridge, pure MTProto listener, and Wrangler dry-run all success.

### Task 6 — MTProto downstream retry isolation: GREEN

Files:

- `cloudflare-v2/containers/mtproto-listener/listener.py`
- `cloudflare-v2/containers/mtproto-listener/health.py`
- `cloudflare-v2/containers/mtproto-listener/test_listener.py`

Behavior:

- downstream handoff retries the exact same compact event with bounded delays;
- Telegram receive callbacks remain decoupled from downstream network latency;
- retry exhaustion degrades only that listener/event and never terminates the delivery worker;
- a later successful event automatically recovers listener health;
- delivery failure/success counters and timestamps are exposed only through the sanitized health contract;
- no Telegram/API/session/transport secret is exposed in health.

TDD/verification evidence:

- RED at the pre-fix branch head: Worker/core 302/302 and MT5 bridge green; MTProto tests failed exactly because the new retry contract supplied `retry_delays`/`sleep` before production supported them.
- GREEN `33612304712` @ `760395613316974a04973553d133c21b9413952a`: all four CI gates success.

### Task 7 — stateful Cloudflare Container supervisor: GREEN

Files:

- `cloudflare-v2/src/sources/mtproto/container_runtime.js`
- `cloudflare-v2/containers/mtproto-listener/Dockerfile`
- `cloudflare-v2/containers/mtproto-listener/requirements.txt`
- `cloudflare-v2/containers/mtproto-listener/app.py`
- `cloudflare-v2/src/v1_entry.js`
- `cloudflare-v2/wrangler.toml`
- `cloudflare-v2/tests/mtproto_container_runtime_contract.test.mjs`

Behavior:

- real Cloudflare Container class `MtprotoContainerRuntime` is bound through `MTPROTO_CONTAINER_NAMESPACE`;
- additive Durable Object migration `v3` creates the Container-backed class;
- provider `getByName(...)` continues to give deterministic one-runtime-per-workspace/account-scope identity;
- Durable Object storage persists only tenant/runtime identity and secret-free lifecycle/health state;
- runtime identity mismatch fails closed rather than allowing another workspace/source/account scope to reuse a runtime;
- Telegram API hash/session and trusted handoff token are passed only through the per-container start environment and are not persisted in DO state or returned from status;
- the Python image runs only the isolated Telethon listener and exposes a secret-free local `/health` endpoint on port 8080;
- Container local disk is never treated as authoritative durable state; Telegram catch-up plus the persistent event/Queue pipeline remains the recovery authority;
- initial rollout uses `lite` instances with `max_instances = 100` as a conservative staged SaaS cap;
- runtime uses Cloudflare's official low-level `this.ctx.container` Durable Object API rather than the helper package.

TDD/debug evidence:

- RED `33612630711` @ `29bad1c5a675197cff807b22f3f0678ec3755fea`: Container binding/runtime/image contract intentionally absent.
- Intermediate `33612963137`: source contract tests passed, but Node integration exposed an `@cloudflare/containers@0.3.7` native-ESM resolution failure (`ERR_MODULE_NOT_FOUND`) when `v1_entry.js` imported the helper package.
- The helper dependency was removed; the supervisor was moved to the documented low-level `ctx.container` API without weakening the Container/tenant contract.
- GREEN `33613179989` @ `d65a95a1b37cf6ae644cc74213eb81313035802d`: Worker/core, MT5 bridge, MTProto listener, and Wrangler Container/Durable Object dry-run all success.

## Shared Supabase boundary

There is no Supabase development branch. Existing free-tier Mkety Supabase is used with strict Trading-owned isolation.

Trading-owned tables include:

- `trading_workspace_access`
- `source_connections`
- `trading_events`
- `position_groups`
- `position_legs`
- `destination_deliveries`
- Trading-specific additive policy columns on `trade_accounts`.

Rules:

- never alter/drop/rewrite unrelated Mkety tables;
- V1 Trading auth does not depend on shared `public.workspaces`;
- `trading_workspace_access` is Trading entitlement authority with no FK to shared workspaces;
- migrations `0001` and `0002` were previously confirmed applied;
- migrations `0003_multi_source_provider_registry.sql` and `0004_cross_provider_event_identity.sql` are **checked in but not yet claimed applied**;
- keep the previously verified Trading entitlement disabled/no Zitadel org until external authorization is configured and verified;
- no paid/dev Supabase branch.

Runbook: `cloudflare-v2/docs/STAGING_V1_RUNBOOK.md`.

## CI verification rule

Every meaningful head must pass:

1. Node Worker/trading-core tests;
2. pure MT5 bridge tests;
3. Wrangler dry-run;
4. MTProto Python/container tests.

Recent exact GREEN checkpoints:

- `33555072129` @ `ceb17534e7d416d76ac3f2361b4705b7646860bd`
- `33598572539` @ `7d62761a072499f6f93910398b3be455b68a2913`
- `33598900292` @ `215c136a0ed697aac8f00c241afbbb6fa7bb2b16`
- `33599074398` @ `0d6c4572bd250dca18bd7bd6b1558fd7d9946313`
- `33599671009` @ `1f846fd7eee536cdb5ccd79e1118d3d31e30e39d`
- `33602689542` @ `e53ae3489adf2395d5b72ea089a1eb30742463ef`
- `33602885866` @ `1e8dd3d40e00094bd8f9e0b04fbf8f5207f420c8`
- `33603127779` @ `837190d63f780f7c72f477ed5a1accb84d20071c`
- `33612304712` @ `760395613316974a04973553d133c21b9413952a`
- `33613179989` @ `d65a95a1b37cf6ae644cc74213eb81313035802d`

Always inspect the exact newest branch-head run before calling the branch green.

## External configuration still required later

No Cloudflare/Zitadel account connector is available in this session; no account-side settings have been changed.

Real signed V1 Worker acceptance later requires server-side Supabase/Trading master key/Trade State/Zitadel/source HMAC configuration and restrictive non-live account/context records. Never ask for those secret values in chat.

Cloudflare Container MTProto E2E later requires:

- account-side Container deployment/rollout and recognition of the checked-in `v3` Container Durable Object migration;
- server-side bootstrap resolution from encrypted Trading-owned source configuration rather than caller/browser-supplied credentials;
- Telegram API ID/hash/session material stored/encrypted server-side only and injected into the isolated runtime at start;
- source-specific configured chat list;
- trusted internal Worker handoff URL/token;
- non-live source provider record;
- Telegram test account/channel for reconnect/catch-up/soak testing.

The Container binding/runtime is now checked in and Wrangler-validated, but no real Cloudflare Container deployment has been performed in this session.

cTrader and MT5 real demo acceptance still require their existing demo-only credentials/gates.

## Current development priority

1. Build a server-side MTProto Container bootstrap resolver from Trading-owned encrypted source configuration so callers/browser payloads can never supply or cross-wire Telegram session credentials.
2. Add supervisor recovery/monitoring: unexpected Container exit must reacquire that exact source's encrypted bootstrap server-side and restart the same tenant runtime; prove catch-up/replay safety under TDD.
3. Add external MTProto direct signed-V1 source runtime.
4. Complete day-1 TradingView + custom REST + MT5 + cTrader source adapters and coexistence/feedback-loop acceptance.
5. Harden pure DO+mtcute alternate provider using the same Telegram native identity/health contract.
6. Add Zitadel-authorized source admin/default/status APIs.
7. Add non-live multi-source acceptance, long-running MTProto reconnect/soak harness, runbook and CI expansion.
8. External staging: review/apply Trading-owned migrations `0003` + `0004` plus any new MTProto credential migration, configure non-live Worker/Container/source secrets, then signed V1 + MTProto soak acceptance.
9. cTrader/MT5 real demo probes/lifecycles only behind existing explicit gates.
10. Tiny controlled live only after all static/source-provider/broker-demo acceptance is green.

## Exact next safe starting point

Implement the server-side MTProto bootstrap resolver under TDD: load only the exact enabled `cloudflare_container_mtproto` source under trusted workspace/source identity, decrypt Telegram provider credentials server-side with `TRADING_MASTER_KEY`, resolve the configured Telegram chat list, inject the internal Worker handoff URL/token from Worker environment, and call the existing Container provider. No browser/caller-supplied bootstrap is authoritative; no decrypted credential may persist in Durable Object status, logs, Queue payloads, or client responses. Then add restart/recovery tests proving the same runtime identity is reused and a source can never receive another tenant's bootstrap.