# Trading Project Agent Handoff

Operational source of truth for `MketyDigital/Trading`. Read before changing the project.

## Hard rules

- Active next-generation work stays in `cloudflare-v2/` unless a deliberate migration says otherwise.
- Preserve legacy root runtime and `cloudflare-v2/src/index.js` until V1 is independently proven.
- Active branch: `design/enterprise-trading-event-core`; draft PR #2.
- Wrangler entrypoint: `cloudflare-v2/src/v1_entry.js`.
- **Never merge `main` without explicit user instruction.**
- Real-money execution remains disabled.
- TDD is mandatory: exact RED before production feature/bugfix code, full GREEN before completion claims.
- Never paste/log/commit broker, database, auth, source, Telegram-session, provider, or transport secrets.
- Update this file after each meaningful implementation/testing batch.

## Product / tenancy contract

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

Isolation is mandatory at workspace, user, source, provider runtime, Telegram session, chat, event, trade account, destination, AI provider, retry, idempotency key, position group, and broker credential boundaries. One tenant/runtime must never receive another tenant's credentials, config, state, events, or broker actions.

Sources are first-class pluggable providers. A workspace may enable multiple simultaneous sources across Telegram MTProto, MT5, cTrader, TradingView, REST/custom APIs, and future families.

Rules:

- default source is preference, not exclusivity;
- at most one enabled default per `(workspace_id, source_family)`;
- other enabled sources remain active;
- unconfigured providers are inert;
- runtime identity is not canonical event identity;
- redundant provider replays collapse through persistent canonical idempotency before AI/orchestration/trading;
- browser/caller workspace/source/bootstrap fields are never authoritative when a server-side trusted source exists.

Provider types: Telegram `cloudflare_container_mtproto`, `cloudflare_do_mtproto`, `external_mtproto`; TradingView `tradingview_webhook`; MT5 `mt5_source_bridge`; cTrader `ctrader_source`; custom `custom_signed_api`.

Design: `docs/superpowers/specs/2026-09-02-multi-source-provider-and-mtproto-runtime-design.md`

Plan: `docs/superpowers/plans/2026-09-02-multi-source-provider-foundation.md`

## MTProto availability contract

Preferred first-party runtime: **Cloudflare Container + Telethon**, one Telegram session listening to many configured chats/channels. Pure DO+mtcute and external MTProto remain alternate providers.

Required behavior:

- continuous normal connectivity;
- reconnect/process/container restart;
- catch-up after interruption;
- receive loop decoupled from downstream work;
- Queue/retry-safe handoff;
- provider failover does not change native identity;
- duplicates/replays never duplicate trades.

Canonical Telegram native identity:

```text
telegram:<accountScope>:<chatId>:<messageId>
```

Container disk is ephemeral and never authoritative durable state. DO storage, Supabase idempotency/event state, Queue delivery, and Telegram catch-up/replay are recovery authorities. No cloud runtime can promise zero infrastructure interruption; target is no known lost recoverable signal and minimal normal latency.

## Core safety

- Connected broker metadata is authoritative for symbol/precision/tick economics/volume/order/account-mode semantics.
- Clear signals use deterministic processing; ambiguous language may use bounded AI but must pass deterministic validation.
- Formatting is presentation only, never execution authority.
- Fast-entry policies: `execute_immediately`, `wait_for_complete_signal`, `forward_only`.
- Completed fast signals reuse the executed first leg as TP1 and add only missing targets.
- Position Groups support arbitrary TP counts and hedged/netted behavior.
- Persistent event/destination/order idempotency is mandatory.
- Every trade account requires execution enablement, symbol/risk/lot/daily-loss/exposure limits, and kill switch before broker dispatch.
- Fail closed on ambiguity, tenant mismatch, provider outage, missing credentials, unavailable broker metadata, unreliable economics, or invalid correlation.
- Global kill switch blocks all actions; protective management may bypass only ordinary drawdown/open-risk locks.
- Legacy Telegram route remains until V1/source/broker acceptance is satisfactory.
- Critical cTrader rule: preserve raw `ProtoOASymbol.lotSize` protocol-cent semantics; never add another x100 conversion.

## Existing verified V1 foundation

Implemented/tested: legacy shadow compatibility; signed `/api/v1/events`; cryptographic Zitadel/workspace authorization; AES-256-GCM secrets; persistent event reservation; deterministic parser + bounded AI; MT5/cTrader/Deriv normalization; metadata-driven risk/account safety; arbitrary-TP Position Groups; `TradeStateNode`; signal/fast-completion/BE/partial/full-close/pending-cancel simulation; signed simulation acceptance; cTrader demo and MT5 demo acceptance foundations.

Commands:

```text
npm run accept:v1:simulation
npm run accept:ctrader:demo
npm run accept:mt5:demo
```

No real external Worker acceptance, real broker demo order, or real Cloudflare Container MTProto deployment has been performed in this session because account/runtime credentials are not available here.

## Multi-source implementation status — 2026-09-02

1. **Provider registry + canonical identity — GREEN.** RED `33598485434`; GREEN `33598572539` @ `7d62761a072499f6f93910398b3be455b68a2913`.
2. **Source registry/default semantics — GREEN.** Migration `0003`; atomic per-family default; multiple sources remain active. RED `33598660566`, intermediate `33598814319`; GREEN `33598900292` @ `215c136a0ed697aac8f00c241afbbb6fa7bb2b16`.
3. **Cross-provider native-event idempotency — GREEN.** Migration `0004`; `(workspace_id, canonical_event_id)` collapse after authentication. RED `33599310435`, `33599410187`, `33599559597`; GREEN `33599671009` @ `1f846fd7eee536cdb5ccd79e1118d3d31e30e39d`.
4. **Cloudflare Container/Telethon provider skeleton — GREEN.** Deterministic runtime identity; Telethon reconnect/catch-up; multi-chat filtering; native identity; sanitized health; Python MTProto tests required in CI.
5. **Cloudflare Queue -> signed V1 path — GREEN.** Listener carries no source HMAC; Worker resolves/decrypts HMAC server-side, signs exact V1 body, retries failures, DLQ. Final GREEN `33603127779` @ `837190d63f780f7c72f477ed5a1accb84d20071c`.
6. **MTProto downstream retry isolation — GREEN.** Same payload bounded retry; exhausted event cannot kill worker; later success recovers health; secret-free delivery health. GREEN `33612304712` @ `760395613316974a04973553d133c21b9413952a`.
7. **Real stateful Cloudflare Container supervisor — GREEN.** `MtprotoContainerRuntime`, `MTPROTO_CONTAINER_NAMESPACE`, DO migration `v3`, strict persisted `(sourceId, workspaceId, accountScope)`, secret-free DO state, runtime-only start env, local `/health`, `lite`, staged `max_instances=100`. RED `33612630711`; intermediate `33612963137` exposed `@cloudflare/containers@0.3.7` Node ESM issue, so implementation uses official low-level `ctx.container` API. GREEN `33613179989` @ `d65a95a1b37cf6ae644cc74213eb81313035802d`.
8. **Server-side MTProto bootstrap resolver — GREEN.** Migration `0005` adds separate `provider_secret_ciphertext`; existing `secret_ciphertext` remains ingress HMAC only. Exact workspace/source/provider/active lookup, provider credential decrypt with `TRADING_MASTER_KEY`, non-secret chat IDs from config, internal URL/token from Worker env; caller bootstrap/config credentials ignored. RED `33613601588` @ `5284443596a10a674456aa2a10b635ddd9cba879`; GREEN `33613707938` @ `4cafbcd3ad39ec09083840529087df92ccada3a8`.
9. **Tenant-safe MTProto Container lifecycle service — GREEN.** `src/sources/mtproto/container_lifecycle_service.js` is the server-side start/restart/stop/status boundary. It accepts trusted `workspaceId/sourceId` only, invokes the bootstrap resolver, verifies the resolved identity exactly matches the trusted request, derives runtime `mtproto:<workspaceId>:<accountScope>`, and never accepts caller bootstrap as authority. Restart re-resolves/decrypts current credentials so rotations/revocations take effect. Tests prove two workspaces get distinct runtime names/bootstrap and status cannot leak secret/ciphertext fields. RED `33613934166` @ `1a95e5c32791e60962264a1a78637e01d66b2cbc`; GREEN `33614019384` @ `03c438567be97cbf9a765b7a10898f4a0ab486b5` across all four gates.
10. **Durable MTProto recovery supervisor + scheduled recovery — GREEN.** Migration `0006_mtproto_recovery_state.sql` adds per-source `recovery_attempt_count`, `recovery_next_attempt_at`, `last_recovery_at`, and `last_recovery_error_code`. `recovery_supervisor.js` probes each source independently, clears stale retry state when a runtime self-recovers, gates only restart attempts behind durable exponential backoff/exhaustion, and restarts through the lifecycle service so credentials are reacquired server-side. `recovery_store.js` scans only active `telegram/cloudflare_container_mtproto` rows and constrains every recovery write by exact `workspace_id + source_id + provider_type + source_family + active`. `recovery_runtime.js` composes one server-side Supabase client/store/lifecycle/supervisor context and fails closed on missing configuration names before dependency creation. Wrangler now keeps legacy `*/15 * * * *` scheduled work unchanged and adds a separate `* * * * *` trigger routed only to MTProto recovery; one-minute recovery never invokes legacy VIP/scheduled work. TDD evidence: RED `33614712990` (only missing supervisor/migration); intermediate `33614818871` exposed stale-backoff-before-health ordering; isolated GREEN `33615007257` @ `22dd0e8b93c2e47a94c315499b72de85e4059413`; store/runtime/cron RED `33615213124` (319/323); stricter tenant-write RED `33615397670` (316/323, exactly seven intentional gaps); final GREEN `33615599446` @ `aa34a1681414b0abc6d6b73f84c6de9e3f30b954` across Node core, MT5 bridge, MTProto listener, and Wrangler.

## Supabase boundary

No Supabase development branch exists; use existing Mkety Supabase with strict Trading-owned isolation. Trading-owned tables include `trading_workspace_access`, `source_connections`, `trading_events`, `position_groups`, `position_legs`, `destination_deliveries`, plus Trading policy columns on `trade_accounts`.

Rules:

- never alter/drop/rewrite unrelated Mkety tables;
- V1 auth does not depend on shared `public.workspaces`;
- `trading_workspace_access` is Trading entitlement authority with no FK to shared workspaces;
- migrations `0001` and `0002` were previously confirmed applied;
- migrations `0003_multi_source_provider_registry.sql`, `0004_cross_provider_event_identity.sql`, `0005_mtproto_provider_credentials.sql`, and `0006_mtproto_recovery_state.sql` are **checked in but not yet claimed applied**;
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

- `33603127779` @ `837190d63f780f7c72f477ed5a1accb84d20071c`
- `33612304712` @ `760395613316974a04973553d133c21b9413952a`
- `33613179989` @ `d65a95a1b37cf6ae644cc74213eb81313035802d`
- `33613707938` @ `4cafbcd3ad39ec09083840529087df92ccada3a8`
- `33614019384` @ `03c438567be97cbf9a765b7a10898f4a0ab486b5`
- `33615007257` @ `22dd0e8b93c2e47a94c315499b72de85e4059413`
- `33615599446` @ `aa34a1681414b0abc6d6b73f84c6de9e3f30b954`

Always inspect the exact newest branch-head run before calling the branch green.

## External configuration still required later

No Cloudflare/Zitadel account connector is available in this session; no account-side settings have been changed. Never request secret values in chat.

Container MTProto E2E later requires: review/apply migrations `0003`-`0006`; deploy/recognize Container runtime + `v3` DO migration; create non-live `cloudflare_container_mtproto` source; encrypt provider credentials server-side; set chat IDs and trusted internal handoff settings; use a Telegram test account/channel for reconnect/catch-up/soak. cTrader/MT5 real demo acceptance still requires existing demo-only credentials/gates.

## Current priority

1. Prove **recovery/catch-up/replay safety** end-to-end in deterministic tests: a restarted listener may replay the same native Telegram message, but Queue/V1 persistent canonical idempotency must collapse it before orchestration/destination work, while genuinely new message IDs still proceed.
2. Add external MTProto direct signed-V1 runtime.
3. Complete TradingView + custom REST + MT5 + cTrader source adapters and coexistence/feedback-loop acceptance.
4. Harden pure DO+mtcute alternate provider.
5. Add Zitadel-authorized source admin/default/status APIs.
6. Add non-live multi-source acceptance, reconnect/soak harness, runbook/CI expansion.
7. External staging configuration and signed V1 + MTProto soak acceptance.
8. Broker demo probes/lifecycles only behind explicit demo gates.
9. Tiny controlled live only after all acceptance is green.

## Exact next safe starting point

Define an intentional RED for **MTProto recovery replay acceptance**. Simulate one first-party Container Telegram native event being accepted before a runtime interruption, then replay the exact same `(accountScope, chatId, messageId)` after recovery through the existing Queue -> signed V1 path. The replay must resolve to the same provider-independent canonical event id, return persistent duplicate acknowledgment, be acknowledged by the Queue consumer, and execute zero interpretation/orchestration/destination work. A different Telegram `messageId` from the recovered runtime must remain distinct and proceed normally. Also prove the same replay coming from a redundant Telegram provider collapses identically. Then implement only any missing glue and rerun all four CI gates.