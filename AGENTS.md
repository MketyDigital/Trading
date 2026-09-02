# Trading Project Agent Handoff

Operational source of truth for `MketyDigital/Trading`. Read before changing the project.

## Hard rules

- Active next-generation work stays in `cloudflare-v2/` unless a deliberate migration says otherwise.
- Preserve root/legacy runtime and `cloudflare-v2/src/index.js` until V1 is independently proven.
- Active branch: `design/enterprise-trading-event-core`.
- Draft PR: #2 `feat: build enterprise trading event core foundation`.
- Wrangler entrypoint: `cloudflare-v2/src/v1_entry.js`.
- **Never merge `main` without explicit user instruction.**
- Real-money execution remains disabled.
- TDD is mandatory: exact RED before production feature/bugfix code, full GREEN before completion claims.
- Never paste/log/commit source, broker, provider, database, auth, Telegram-session, or transport secrets.
- Update this file after every meaningful implementation/testing batch.

## Product and tenancy contract

Mkety Trading is an enterprise/custom **multi-tenant** trading automation platform, not a Telegram-only copier.

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

Isolation is mandatory at workspace, user, source, provider runtime, Telegram session, chat, event, trade account, destination, AI provider, retry, idempotency key, position group, and broker credential boundaries. A source/runtime belonging to one workspace must never receive another workspace's credentials/config/state.

Sources are first-class pluggable providers. A workspace may enable multiple simultaneous sources across Telegram MTProto, MT5, cTrader, TradingView, REST/custom APIs, and future families.

Rules:

- default source = preference, not exclusivity;
- at most one enabled default per `(workspace_id, source_family)`;
- other enabled sources in that family remain active;
- unconfigured providers are inert and never block configured providers;
- provider runtime identity must not become canonical event identity;
- redundant providers may replay the same native event, but persistent canonical idempotency must collapse it before AI/orchestration/trading;
- no browser/caller-provided workspace/source/account identity is authoritative when server-side trusted identity is available.

Provider types in `cloudflare-v2/src/sources/provider_registry.js`:

- Telegram: `cloudflare_container_mtproto`, `cloudflare_do_mtproto`, `external_mtproto`
- TradingView: `tradingview_webhook`
- MT5: `mt5_source_bridge`
- cTrader: `ctrader_source`
- custom: `custom_signed_api`

Design: `docs/superpowers/specs/2026-09-02-multi-source-provider-and-mtproto-runtime-design.md`

Plan: `docs/superpowers/plans/2026-09-02-multi-source-provider-foundation.md`

## MTProto availability contract

Preferred first-party Telegram runtime: **Cloudflare Container + Telethon**, one Telegram session listening to many configured chats/channels.

Also supported as first-class providers:

- pure Cloudflare Durable Object + mtcute;
- external Telethon/mtcute;
- future compatible signed MTProto listeners.

Hard behavior:

- continuous normal connectivity;
- automatic reconnect/process/container restart;
- persistent authorization/update recovery behavior;
- catch-up after infrastructure interruption;
- receive loop decoupled from downstream processing;
- Queue/retry-safe first-party delivery;
- provider/runtime failover does not change native event identity;
- replays/duplicates never create duplicate trades.

Canonical Telegram native event identity:

```text
telegram:<accountScope>:<chatId>:<messageId>
```

No cloud runtime can promise zero infrastructure interruption. Engineering target is no known lost recoverable Telegram signal and minimal normal receive latency.

Cloudflare Container disk is ephemeral and is never authoritative durable state. Durable Object storage, Supabase event/idempotency state, Queue delivery, and Telegram catch-up/replay are the recovery authorities.

### MT5 in Cloudflare Container

Feasibility note only. MT5+Wine on Linux/amd64 is separate work. Do **not** target the 256 MiB `lite` tier for MT5+Wine reliability and never weaken existing MT5 demo safety gates.

## Core safety / semantics

- Static aliases are hints; connected broker metadata is authoritative for symbols, suffixes, precision, tick economics, volume units, order semantics, and account mode.
- Straightforward signals use deterministic processing and may bypass AI.
- Ambiguous language may use bounded AI but AI structure must pass deterministic validation.
- AI latency/failure must not block clear deterministic work.
- Customer formatting is presentation only, never execution authority.
- Fast-entry policies: `execute_immediately`, `wait_for_complete_signal`, `forward_only`.
- Completed fast signals reuse executed first leg as TP1 and add only missing targets.
- Position Groups support arbitrary TP counts and hedged/netted semantics.
- Persistent event/destination/order idempotency is mandatory.
- Every trade account requires explicit execution enablement, symbol/risk/lot/daily-loss/exposure policy, and kill switch before broker dispatch.
- Fail closed on ambiguity, unavailable broker metadata, unreliable risk economics, invalid correlation, provider outage, tenant mismatch, or missing credentials.
- Protective management may bypass drawdown/open-risk locks; global kill switch still blocks all actions.
- Never replace the legacy Telegram route until V1 comparison, source acceptance, and broker demos are satisfactory.

Critical cTrader rule: preserve raw `ProtoOASymbol.lotSize` protocol-cent semantics; never add another x100 conversion.

## Verified V1 foundation

Implemented/tested:

- legacy `/api/webhook/process_signal` preserved; `TRADING_V1_SHADOW=true` adds side-effect-free diagnostics only;
- signed universal `POST /api/v1/events` with exact raw-body HMAC authentication;
- cryptographic Zitadel JWT/workspace authorization and Trading-owned entitlement isolation;
- AES-256-GCM tenant/source secret encryption;
- persistent Trading event reservation before interpretation;
- deterministic parser + bounded AI ambiguity resolution;
- MT5/cTrader/Deriv symbol/account normalization;
- metadata-driven risk sizing and account safety controls;
- arbitrary-TP Position Groups, fast-entry completion, hedged/netted foundations;
- persistent `TradeStateNode` Durable Object correlation/state;
- simulation orchestration for signals, fast completion, BE, partial/full close, pending cancellation;
- signed V1 simulation acceptance matrix;
- cTrader demo acceptance foundation;
- MT5 demo acceptance foundation.

Commands:

```text
npm run accept:v1:simulation
npm run accept:ctrader:demo
npm run accept:mt5:demo
```

No real external Worker acceptance, real cTrader demo order, real MT5 demo order, or real Cloudflare Container MTProto deployment has been run in this development session because account/runtime credentials are not available here.

## Multi-source implementation status — 2026-09-02

### Task 1 — provider registry + canonical identity: GREEN

- Data-driven provider registry; unknown/mismatched providers fail closed.
- Telegram Container/DO/external providers converge on provider-independent native identity.
- MT5/cTrader/TradingView identities remain family/scoped.
- RED `33598485434`; GREEN `33598572539` @ `7d62761a072499f6f93910398b3be455b68a2913`.

### Task 2 — source registry/default semantics: GREEN

- `0003_multi_source_provider_registry.sql` extends Trading-owned source registry additively.
- One active default per workspace/source-family; other enabled sources stay active.
- Atomic `trading_set_default_source(...)` validates target before switch.
- RED `33598660566`; intermediate `33598814319`; GREEN `33598900292` @ `215c136a0ed697aac8f00c241afbbb6fa7bb2b16`.

### Task 3 — cross-provider native-event idempotency: GREEN

- `0004_cross_provider_event_identity.sql` adds `canonical_event_id` additively.
- Unique `(workspace_id, canonical_event_id)` collapses same native event across provider connections.
- Authentication occurs before canonical reservation, so invalid provider cannot suppress legitimate event.
- Legacy provider-scoped dedupe remains for sources without stable canonical identity.
- RED `33599310435`, `33599410187`, `33599559597`; GREEN `33599671009` @ `1f846fd7eee536cdb5ccd79e1118d3d31e30e39d`.

### Task 4 — Cloudflare Container/Telethon provider skeleton: GREEN

- Deterministic one-session/one-container provider identity.
- Python Telethon listener restores session, reconnects, registers handler before catch-up, filters many chats, ignores outgoing messages, preserves native identity, and exposes sanitized health.
- Python MTProto tests are a mandatory CI gate.

### Task 5 — Cloudflare Queue -> signed V1 path: GREEN

- Compact first-party source events contain no source HMAC secret.
- Queue consumer resolves active source and decrypts HMAC server-side only.
- Exact canonical V1 body signed inside Worker.
- Success/duplicate ack; downstream/source/config failures retry; bounded retries + DLQ.
- Worker exposes native `queue()` handler independently from legacy routes.
- Wrangler binds `SOURCE_EVENT_QUEUE`, low-latency batching, bounded retries and DLQ.
- RED `33602378306`, `33602515079`, queue-entry RED, `33602954804`; GREEN `33602689542`, `33602885866`, final `33603127779` @ `837190d63f780f7c72f477ed5a1accb84d20071c`.

### Task 6 — MTProto downstream retry isolation: GREEN

Files: `containers/mtproto-listener/listener.py`, `health.py`, tests.

- Exact same compact event is retried with bounded delays.
- Telegram receive callback remains independent of downstream latency.
- Retry exhaustion degrades only that listener/event and never kills delivery worker.
- A later successful event recovers health.
- Secret-free success/failure counters/timestamps are exposed.
- GREEN `33612304712` @ `760395613316974a04973553d133c21b9413952a` after intentional retry-contract RED.

### Task 7 — real stateful Cloudflare Container supervisor: GREEN

Files: `src/sources/mtproto/container_runtime.js`, Python Docker/image entrypoint, `v1_entry.js`, `wrangler.toml`, contract tests.

- `MtprotoContainerRuntime` bound through `MTPROTO_CONTAINER_NAMESPACE`.
- Additive DO migration `v3` creates Container-backed runtime class.
- Strict persisted runtime identity `(sourceId, workspaceId, accountScope)`; mismatch fails closed.
- DO storage contains only secret-free identity/lifecycle/health state.
- Telegram API hash/session and internal transport token exist only in per-container start environment.
- Local Python `/health` is secret-free.
- Runtime uses official low-level `this.ctx.container` API.
- `lite`, `max_instances = 100` for conservative staged SaaS rollout.
- RED `33612630711` @ `29bad1c5a675197cff807b22f3f0678ec3755fea`.
- Intermediate `33612963137` exposed Node ESM issue in `@cloudflare/containers@0.3.7`; helper dependency removed in favor of official low-level API.
- GREEN `33613179989` @ `d65a95a1b37cf6ae644cc74213eb81313035802d` including Wrangler Container/DO validation.

### Task 8 — server-side MTProto bootstrap resolver: GREEN

Files:

- `db/migrations/0005_mtproto_provider_credentials.sql`
- `src/sources/mtproto/container_bootstrap.js`
- `tests/mtproto_container_bootstrap.test.mjs`
- `tests/mtproto_provider_secret_migration.test.mjs`

Behavior:

- adds separate nullable `provider_secret_ciphertext` to Trading-owned `source_connections`;
- preserves existing `secret_ciphertext` exclusively for signed V1 ingress/HMAC trust;
- Telegram API ID/hash/session are encrypted together as a provider-specific envelope and never placed in plaintext JSON config;
- resolver queries exact `workspace_id + source_id + source_family=telegram + provider_type=cloudflare_container_mtproto + is_active=true`;
- provider credential decryption occurs server-side only with `TRADING_MASTER_KEY`;
- non-secret `config.chat_ids` is resolved separately;
- internal source handoff URL/token come only from trusted Worker environment;
- caller-supplied bootstrap values and credential-looking JSON config values are ignored as authority;
- resolver output contains only the exact tenant/source runtime identity plus runtime bootstrap and never exposes ingress/provider ciphertext fields.

TDD evidence:

- RED `33613601588` @ `5284443596a10a674456aa2a10b635ddd9cba879`: Node gate failed because resolver and migration were intentionally absent.
- GREEN `33613707938` @ `4cafbcd3ad39ec09083840529087df92ccada3a8`: Worker/core, MT5 bridge, MTProto listener, Wrangler dry-run all success.

## Shared Supabase boundary

There is no Supabase development branch. Existing Mkety Supabase is used with strict Trading-owned isolation.

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
- migrations `0003_multi_source_provider_registry.sql`, `0004_cross_provider_event_identity.sql`, and `0005_mtproto_provider_credentials.sql` are **checked in but not yet claimed applied**;
- keep previously verified Trading entitlement disabled/no Zitadel org until external authorization is configured and verified;
- no paid/dev Supabase branch.

Runbook: `cloudflare-v2/docs/STAGING_V1_RUNBOOK.md`.

## CI rule

Every meaningful head must pass:

1. Node Worker/trading-core tests;
2. pure MT5 bridge tests;
3. MTProto Python/container tests;
4. Wrangler dry-run.

Recent exact GREEN checkpoints:

- `33599671009` @ `1f846fd7eee536cdb5ccd79e1118d3d31e30e39d`
- `33602689542` @ `e53ae3489adf2395d5b72ea089a1eb30742463ef`
- `33602885866` @ `1e8dd3d40e00094bd8f9e0b04fbf8f5207f420c8`
- `33603127779` @ `837190d63f780f7c72f477ed5a1accb84d20071c`
- `33612304712` @ `760395613316974a04973553d133c21b9413952a`
- `33613179989` @ `d65a95a1b37cf6ae644cc74213eb81313035802d`
- `33613707938` @ `4cafbcd3ad39ec09083840529087df92ccada3a8`

Always inspect the exact newest branch-head run before calling the branch green.

## External configuration still required later

No Cloudflare/Zitadel account connector is available in this session; no account-side settings have been changed.

Real signed V1 Worker acceptance later requires server-side Supabase/Trading master key/Trade State/Zitadel/source configuration and restrictive non-live account/context records. Never ask for secret values in chat.

Cloudflare Container MTProto E2E later requires:

- apply/review Trading migrations `0003`, `0004`, `0005` in staging;
- deploy/recognize checked-in Container runtime and `v3` DO migration;
- create non-live `cloudflare_container_mtproto` source record;
- encrypt/store provider credential envelope server-side;
- configure source-specific chat IDs;
- configure trusted Worker internal source URL/token;
- Telegram test account/channel for reconnect/catch-up/soak testing.

cTrader and MT5 real demo acceptance still require their existing demo-only credentials/gates.

## Current development priority

1. Wire `resolveMtprotoContainerBootstrap(...)` into a server-side Container lifecycle service so start/restart never accepts raw bootstrap from browser/caller input.
2. Add supervisor recovery/monitoring: unexpected Container exit reacquires that exact source's encrypted bootstrap server-side and restarts the same tenant runtime; prove no cross-tenant bootstrap mixing and catch-up/replay safety.
3. Add external MTProto direct signed-V1 source runtime.
4. Complete day-1 TradingView + custom REST + MT5 + cTrader source adapters and coexistence/feedback-loop acceptance.
5. Harden pure DO+mtcute alternate provider with same Telegram identity/health contract.
6. Add Zitadel-authorized source admin/default/status APIs.
7. Add non-live multi-source acceptance, MTProto reconnect/soak harness, runbook and CI expansion.
8. External staging configuration and signed V1 + MTProto soak acceptance.
9. cTrader/MT5 real demo probes/lifecycles only behind explicit demo gates.
10. Tiny controlled live only after static/source-provider/broker-demo acceptance is green.

## Exact next safe starting point

Define an intentional RED for a **server-side MTProto Container lifecycle service**. The service must accept trusted `workspaceId/sourceId` only, use `resolveMtprotoContainerBootstrap(...)`, derive the deterministic runtime from `MTPROTO_CONTAINER_NAMESPACE`, and call `ensureStarted/restartRuntime` with the resolved identity/bootstrap. Tests must prove: wrong workspace/source cannot resolve; caller-supplied bootstrap cannot override decrypted tenant credentials; two workspaces never share runtime names or bootstrap; restart reacquires credentials server-side; status output contains no decrypted/ciphertext secrets. Then implement the minimal service and rerun all four CI gates.