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

External MTProto design: `docs/superpowers/specs/2026-09-02-external-mtproto-signed-v1-adapter-design.md`

External MTProto plan: `docs/superpowers/plans/2026-09-02-external-mtproto-signed-v1-adapter.md`

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
10. **Durable MTProto recovery supervisor + scheduled recovery — GREEN.** Migration `0006_mtproto_recovery_state.sql` adds per-source `recovery_attempt_count`, `recovery_next_attempt_at`, `last_recovery_at`, and `last_recovery_error_code`. `recovery_supervisor.js` probes each source independently, clears stale retry state when a runtime self-recovers, gates only restart attempts behind durable exponential backoff/exhaustion, and restarts through the lifecycle service so credentials are reacquired server-side. `recovery_store.js` scans only active `telegram/cloudflare_container_mtproto` rows and constrains every recovery write by exact `workspace_id + source_id + provider_type + source_family + active`. `recovery_runtime.js` composes one server-side Supabase client/store/lifecycle/supervisor context and fails closed on missing configuration names before dependency creation. Wrangler keeps legacy `*/15 * * * *` work unchanged and adds a separate `* * * * *` trigger routed only to MTProto recovery. TDD: RED `33614712990`; intermediate `33614818871`; isolated GREEN `33615007257`; store/runtime/cron RED `33615213124`; stricter tenant-write RED `33615397670`; final GREEN `33615599446` @ `aa34a1681414b0abc6d6b73f84c6de9e3f30b954`.
11. **MTProto recovery replay acceptance — GREEN with no production change required.** `tests/mtproto_recovery_replay_acceptance.test.mjs` drives the actual `source_queue_consumer` -> signed V1 `ingestTradingEvent` path using persistent canonical reservation state. An exact post-restart replay of `(accountScope, chatId, messageId)` is ACKed by Queue as a successful duplicate, does not retry, and leaves interpretation/orchestration count at one. A genuinely new Telegram `messageId` proceeds and increments work once. The same native replay from redundant `cloudflare_do_mtproto` collapses to the same provider-independent identity and is ACKed without second work. Existing production idempotency already satisfied the acceptance contract; no duplicate-handling glue was needed. GREEN `33615820124` @ `b73abee97a736a4a53f726635df9d211a5f73986` across all four gates.
12. **External MTProto server-side source/chat/account authorization — GREEN.** `external_policy.js` applies only to authenticated `external_mtproto` sources after HMAC verification and JSON parse but before normalization/reservation/AI. Source `config` is loaded server-side from Trading-owned `source_connections`; missing mode defaults to fail-closed `allowlist`, empty allowlist accepts no chats, `all_visible` requires explicit server config, caller forwarding metadata cannot authorize chats, caller account scope must match server `external_identity` when supplied, and authenticated source workspace remains authoritative. No new table or provider/session credential storage was added. RED `33623557990` (policy module absent) and `33623657099` (policy + source config absent); GREEN `33623854041` @ `904690f4c97208b1306a48179aba6bb8b689bd48`: Node 337/337, MT5 3/3, Container MTProto 11/11, Wrangler dry-run all pass.
13. **External MTProto signed-V1 HTTPS sink — GREEN.** `external/mtproto-adapter/v1_sink.py` uses compact deterministic JSON and the existing `v1:<timestamp_ms>:<raw_json_body>` HMAC-SHA256 contract, refreshes timestamp/signature without mutating semantic body bytes, treats accepted and persistent-duplicate responses as terminal success, classifies network/429/5xx as retryable and permanent auth/policy/validation failures as non-retryable, and sanitizes errors so signing material/source secrets cannot leak. The external adapter Python suite is now part of the mandatory CI Python gate. GREEN implementation checkpoint `d20bf83…`.
14. **Portable external Telethon runtime — GREEN.** `external/mtproto-adapter/adapter.py`, `app.py`, `health.py`, and `requirements.txt` provide a VM/VPS/container-portable Telegram transport. Each adapter instance owns its own client/session, bounded queue, retry/backoff state, sink, filtering and health; optional `ALLOWED_CHAT_IDS` is transport-only and cannot authorize Mkety server policy. Tests prove multiple chats, outgoing suppression, native/thread/edit/media parity, non-blocking receive, bounded queue, same-event retries, permanent rejection continuation, duplicate success, two-adapter isolation, clean cancellation, secret-free health and sanitized fatal CLI output. Full GREEN `33625107407` @ `9fb58507c2797c703c967d77648e6c7e5a1d50a0`.
15. **External MTProto cross-provider replay + two-workspace isolation acceptance — GREEN with no production change required.** `external_mtproto_replay_acceptance.test.mjs` proves Container-first/external-replay and external-first/Container-replay collapse to one workspace-scoped native event while a genuinely different message remains distinct and invalid external auth cannot reserve/suppress identity. `external_mtproto_tenant_isolation.test.mjs` proves independent credentials/policies, identical Telegram native identity remains distinct across workspaces, caller workspace overrides cannot move events, one source's unauthorized/disabled/failing state does not alter the other workspace, and source policy/config is not read across tenants. Existing authenticated/workspace-scoped idempotency already satisfied this acceptance layer. GREEN `33625278355` @ `c6c2c14fb3c389b23062d83a1a2240875dd97891` across all four gates.

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
3. MTProto Python/container + external-adapter tests;
4. Wrangler dry-run.

Recent exact GREEN checkpoints:

- `33613707938` @ `4cafbcd3ad39ec09083840529087df92ccada3a8`
- `33614019384` @ `03c438567be97cbf9a765b7a10898f4a0ab486b5`
- `33615007257` @ `22dd0e8b93c2e47a94c315499b72de85e4059413`
- `33615599446` @ `aa34a1681414b0abc6d6b73f84c6de9e3f30b954`
- `33615820124` @ `b73abee97a736a4a53f726635df9d211a5f73986`
- `33623854041` @ `904690f4c97208b1306a48179aba6bb8b689bd48`
- `33625107407` @ `9fb58507c2797c703c967d77648e6c7e5a1d50a0`
- `33625278355` @ `c6c2c14fb3c389b23062d83a1a2240875dd97891`

Always inspect the exact newest branch-head run before calling the branch green.

## External configuration still required later

No Cloudflare/Zitadel account connector is available in this session; no account-side settings have been changed. Never request secret values in chat.

Container MTProto E2E later requires: review/apply migrations `0003`-`0006`; deploy/recognize Container runtime + `v3` DO migration; create non-live `cloudflare_container_mtproto` source; encrypt provider credentials server-side; set chat IDs and trusted internal handoff settings; use a Telegram test account/channel for reconnect/catch-up/soak. External MTProto real soak later requires a non-live `external_mtproto` source plus customer-owned Telegram API/session credentials on the external host. cTrader/MT5 real demo acceptance still requires existing demo-only credentials/gates.

## Current priority

1. Finish **External MTProto Task 5/6**: explicit CI-contract test, README, staging runbook update, full verification and final handoff checkpoint.
2. Complete TradingView + custom REST + MT5 + cTrader source adapters and coexistence/feedback-loop acceptance.
3. Harden pure DO+mtcute alternate provider.
4. Add Zitadel-authorized source admin/default/status APIs.
5. Add non-live multi-source acceptance, reconnect/soak harness, runbook/CI expansion.
6. External staging configuration and signed V1 + MTProto soak acceptance.
7. Broker demo probes/lifecycles only behind explicit demo gates.
8. Tiny controlled live only after all acceptance is green.

## Exact next safe starting point

Continue `docs/superpowers/plans/2026-09-02-external-mtproto-signed-v1-adapter.md` at **Task 5: CI Gate and External Adapter Operating Documentation**. The external Python suite is already executed by the workflow from the earlier TDD batch, so first add the static CI-contract test and confirm whether it is already GREEN against the current workflow; if it passes without production/workflow change, record that no CI glue is needed. Then create the external adapter README and update `cloudflare-v2/docs/STAGING_V1_RUNBOOK.md` with configuration names only, trust-boundary/tenant-isolation semantics, non-live test procedure, and no broker/live enablement. After Task 5, run the full verification matrix, inspect exact branch-head CI, update this `AGENTS.md` again, and stop before deployment/merge/live execution.