# Trading Project Agent Handoff

Operational source of truth for `MketyDigital/Trading`. Read before changing the project.

## Hard rules

- Active next-generation work stays in `cloudflare-v2/` unless a deliberate migration says otherwise.
- Preserve the legacy root runtime and `cloudflare-v2/src/index.js` until V1 is independently proven.
- Active branch: `design/enterprise-trading-event-core`; draft PR #2 targets `main`.
- Wrangler entrypoint: `cloudflare-v2/src/v1_entry.js`.
- **Never merge `main` without explicit user instruction.**
- Real-money execution remains disabled.
- TDD is mandatory: exact RED before production feature/bugfix code; full GREEN before completion claims.
- Never paste/log/commit broker, database, auth, source, Telegram-session, provider, transport, signing, destination, or AI secrets.
- Update this file after every meaningful implementation/testing batch.

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

Isolation is mandatory at workspace, user, source, provider runtime, Telegram session, chat, event, trade account, destination, AI provider, retry, queue, idempotency key, Position Group, health, control-state, and credential boundaries. One tenant/runtime/integration failure must never receive, mutate, stall, disable, reorder, duplicate, roll back, or corrupt another tenant/integration's credentials, configuration, state, events, retries, health, idempotency, or broker actions.

Sources are first-class pluggable providers. A workspace may enable multiple simultaneous sources across Telegram MTProto, MT5, cTrader, TradingView, REST/custom APIs, and future families.

Rules:

- default source is preference, not exclusivity;
- at most one enabled default per `(workspace_id, source_family)`;
- other enabled sources remain active;
- unconfigured providers are inert;
- runtime identity is not canonical event identity;
- redundant provider replays collapse through persistent canonical idempotency before AI/orchestration/trading;
- browser/caller workspace/source/bootstrap fields are never authoritative when a server-side trusted source exists;
- source, destination, broker, AI, retry, health, credentials, and control state stay scoped to the smallest responsible integration boundary;
- fan-out destinations succeed/fail/retry independently and never roll back successful siblings;
- retry of a failed destination must not redispatch successful siblings;
- foreign-workspace or duplicate destinations fail locally without blocking valid siblings.

Provider types:
- Telegram: `cloudflare_container_mtproto`, `cloudflare_do_mtproto`, `external_mtproto`
- TradingView: `tradingview_webhook`
- MT5: `mt5_source_bridge`
- cTrader: `ctrader_source`
- custom: `custom_signed_api`

Design: `docs/superpowers/specs/2026-09-02-multi-source-provider-and-mtproto-runtime-design.md`

Plan: `docs/superpowers/plans/2026-09-02-multi-source-provider-foundation.md`

External MTProto design: `docs/superpowers/specs/2026-09-02-external-mtproto-signed-v1-adapter-design.md`

External MTProto plan: `docs/superpowers/plans/2026-09-02-external-mtproto-signed-v1-adapter.md`

Task 9 operational runbook: `cloudflare-v2/docs/NON_LIVE_MULTI_SOURCE_ACCEPTANCE.md`

## MTProto availability contract

Preferred first-party runtime: **Cloudflare Container + Telethon**, one Telegram session listening to many configured chats/channels. Pure DO+mtcute and external MTProto remain alternate providers and must never become platform-wide startup dependencies.

Required behavior:
- continuous normal connectivity;
- reconnect/process/container/DO restart recovery;
- catch-up after interruption;
- receive loop decoupled from downstream work;
- Queue/retry-safe handoff;
- provider failover does not change native identity;
- duplicates/replays never duplicate trades.

Canonical Telegram native identity:

```text
telegram:<accountScope>:<chatId>:<messageId>
```

Container disk is ephemeral and never authoritative durable state. DO storage, Supabase idempotency/event state, Queue delivery, and Telegram catch-up/replay are recovery authorities. No cloud runtime can promise literal zero interruption; target is no known lost recoverable signal and minimal normal latency.

## Core safety

- Connected broker metadata is authoritative for symbol/precision/tick economics/volume/order/account-mode semantics.
- Clear signals use deterministic processing; ambiguous language may use bounded AI but must pass deterministic validation.
- AI failure cannot block clear deterministic work.
- Formatting is presentation only, never execution authority.
- Fast-entry policies: `execute_immediately`, `wait_for_complete_signal`, `forward_only`.
- Completed fast signals reuse the executed first leg as TP1 and add only missing targets.
- Position Groups support arbitrary TP counts and hedged/netted behavior.
- Persistent event/destination/order idempotency is mandatory.
- Every trade account requires explicit execution enablement, symbol/risk/lot/daily-loss/exposure limits, and kill switch before broker dispatch.
- Fail closed on ambiguity, tenant mismatch, provider outage, missing credentials, unavailable broker metadata, unreliable economics, invalid correlation, or unknown execution state.
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
npm run soak:mtproto:container
```

No real external Worker acceptance, real broker demo order, real Cloudflare Container/DO MTProto deployment, or real-money execution has been performed in this session because account/runtime credentials are not available here.

## Multi-source implementation status — 2026-09-02

1. **Provider registry + canonical identity — GREEN.** RED `33598485434`; GREEN `33598572539` @ `7d62761a072499f6f93910398b3be455b68a2913`.
2. **Source registry/default semantics — GREEN.** Migration `0003`; atomic per-family default; multiple sources remain active. GREEN `33598900292` @ `215c136a0ed697aac8f00c241afbbb6fa7bb2b16`.
3. **Cross-provider native-event idempotency — GREEN.** Migration `0004`; `(workspace_id, canonical_event_id)` collapse after authentication. GREEN `33599671009` @ `1f846fd7eee536cdb5ccd79e1118d3d31e30e39d`.
4. **Cloudflare Container/Telethon provider skeleton — GREEN.** Deterministic runtime identity; reconnect/catch-up; multi-chat filtering; native identity; sanitized health; Python MTProto CI gate.
5. **Cloudflare Queue -> signed V1 path — GREEN.** Listener carries no source HMAC; Worker resolves/decrypts HMAC server-side, signs exact V1 body, retries failures, DLQ. GREEN `33603127779` @ `837190d63f780f7c72f477ed5a1accb84d20071c`.
6. **MTProto downstream retry isolation — GREEN.** Same-payload bounded retry; exhausted event cannot kill worker; later success recovers health; secret-free delivery health. GREEN `33612304712` @ `760395613316974a04973553d133c21b9413952a`.
7. **Real stateful Cloudflare Container supervisor — GREEN.** `MtprotoContainerRuntime`, `MTPROTO_CONTAINER_NAMESPACE`, DO migration `v3`, strict tenant/source/account-scope runtime identity, secret-free persisted state, runtime-only start env, local health. GREEN `33613179989` @ `d65a95a1b37cf6ae644cc74213eb81313035802d`.
8. **Server-side MTProto bootstrap resolver — GREEN.** Migration `0005`; exact workspace/source/provider lookup; provider credential decrypt server-side; caller bootstrap ignored. GREEN `33613707938` @ `4cafbcd3ad39ec09083840529087df92ccada3a8`.
9. **Tenant-safe MTProto Container lifecycle service — GREEN.** Trusted workspace/source only; exact identity verification; server-derived runtime; restart re-resolves credentials; status strips secrets. GREEN `33614019384` @ `03c438567be97cbf9a765b7a10898f4a0ab486b5`.
10. **Durable MTProto recovery supervisor + scheduled recovery — GREEN.** Migration `0006`; per-source counters/backoff/error codes; exact tenant/source writes; one-minute recovery cron isolated from legacy scheduler. GREEN `33615599446` @ `aa34a1681414b0abc6d6b73f84c6de9e3f30b954`.
11. **MTProto recovery replay acceptance — GREEN.** Exact post-restart replay ACKs as duplicate with one orchestration; new message proceeds; redundant provider replay converges on same native identity. GREEN `33615820124` @ `b73abee97a736a4a53f726635df9d211a5f73986`.
12. **External MTProto server-side authorization — GREEN.** Server-owned chat/account policy after HMAC but before reservation/AI; authenticated workspace remains authoritative. GREEN `33623854041` @ `904690f4c97208b1306a48179aba6bb8b689bd48`.
13. **External MTProto signed-V1 HTTPS sink — GREEN.** Exact raw-body signing; retryable/permanent distinction; persistent duplicate terminal success; sanitized errors.
14. **Portable external Telethon runtime — GREEN.** Per-adapter session/queue/retry/health isolation; multiple chats; native/thread/edit/media parity; clean cancellation. GREEN `33625107407` @ `9fb58507c2797c703c967d77648e6c7e5a1d50a0`.
15. **Cross-provider replay + two-workspace isolation — GREEN.** Provider replay collapses only within workspace; identical Telegram identity remains distinct across workspaces. GREEN `33625278355` @ `c6c2c14fb3c389b23062d83a1a2240875dd97891`.
16. **External MTProto CI/operator docs — GREEN.** Both MTProto Python suites are mandatory CI gates. GREEN `33626149089` @ `e2bc271842a5df1425f3fb879ba0c413bfb180e0`.
17. **Heterogeneous source registration/configuration/coexistence — GREEN.** Six provider types coexist; invalid provider config cannot mutate siblings/defaults. GREEN `33626927619` @ `a78dc9fbe257f41b67337ad5f06587a018f1d573`. Broader-plan Task 7 complete.
18. **Pure Durable Object + mtcute alternate provider — GREEN.** Per-DO persisted update state/catch-up/reconnect; same queue-compatible native identity; no global credential fallback; alternate/non-default. GREEN `33627974053` @ `b15e4b7afc864daba23d0e8b8d77773d1a3e0175`. Broader-plan Task 6 complete.
19. **Zitadel-authorized source administration API — GREEN.** Existing V1 auth is sole gate; exact-workspace source list/status/default/enable/disable; secret-whitelisted responses. RED `33628546167`; GREEN `33628759094` @ `69b3d89b016d2d00335450046b5688541aa7649c`. Broader-plan Task 8 complete.
20. **Task 9 non-live multi-source operational gate — GREEN in source/CI.** `source_provider_acceptance` covers source/provider failure isolation and cross-workspace canonical identity; MTProto recovery/cross-provider tests cover reconnect/replay duplicate collapse; observation-only soak harness exposed via `npm run soak:mtproto:container`; destination fan-out now runs siblings independently, sanitizes failures, rejects foreign-workspace/duplicate destinations locally, and supports retrying only failed destinations. Soak GREEN `33629585665` @ `276abbc362c03703d897f1410f1eeb534ff75b07`. Destination isolation RED `33630032190` @ `7c27ca546602b48fcbfa7b1db8051f6e4469af0f` (378 pass, sole failure missing fan-out module). Exact destination-isolation GREEN `33630219329` @ `fa253f04eba80354781a91474a237ebd02c51f34`, all four mandatory gates passing. Operational procedure is `cloudflare-v2/docs/NON_LIVE_MULTI_SOURCE_ACCEPTANCE.md`. **Broader-plan Task 9 complete at source-code/CI level.**

## Supabase boundary

No Supabase development branch exists; use the existing Mkety Supabase with strict Trading-owned isolation.

Trading-owned:
- `trading_workspace_access`
- `source_connections`
- `trading_events`
- `position_groups`
- `position_legs`
- `destination_deliveries`
- additive Trading policy columns on `trade_accounts`

Rules:
- never alter/drop/rewrite unrelated Mkety tables;
- V1 auth does not depend on shared `public.workspaces`;
- `trading_workspace_access` is Trading entitlement authority with no FK to shared workspaces;
- migrations `0001` and `0002` were previously confirmed applied;
- migrations `0003_multi_source_provider_registry.sql`, `0004_cross_provider_event_identity.sql`, `0005_mtproto_provider_credentials.sql`, and `0006_mtproto_recovery_state.sql` are **checked in but not yet claimed applied**;
- keep previously verified Trading entitlement disabled/no Zitadel org until external authorization is configured and verified;
- no paid/dev Supabase branch.

Runbooks:
- `cloudflare-v2/docs/STAGING_V1_RUNBOOK.md`
- `cloudflare-v2/docs/NON_LIVE_MULTI_SOURCE_ACCEPTANCE.md`

## CI rule

Every meaningful head must pass:
1. Node Worker/trading-core tests;
2. pure MT5 bridge tests;
3. MTProto Python/container + external-adapter tests;
4. Wrangler dry-run.

Recent exact GREEN checkpoints:
- `33627974053` @ `b15e4b7afc864daba23d0e8b8d77773d1a3e0175`
- `33628759094` @ `69b3d89b016d2d00335450046b5688541aa7649c`
- `33629585665` @ `276abbc362c03703d897f1410f1eeb534ff75b07`
- `33630219329` @ `fa253f04eba80354781a91474a237ebd02c51f34`

Always inspect the exact newest branch-head run before calling the branch green.

## External configuration still required later

No Cloudflare/Zitadel account connector is available in this session; no account-side settings have been changed. Never request secret values in chat.

Controlled staging later requires:
- inspect the actual shared Supabase schema and migration history first;
- review/apply only required Trading migrations `0003`-`0006`;
- configure intended non-live Zitadel/workspace bindings before enabling Trading entitlement;
- create non-live source identities with encrypted server-side credentials where applicable;
- deploy/recognize Container runtime + `v3` DO migration before first-party Container E2E;
- use Telegram test accounts/channels for Container/external/DO reconnect/catch-up/soak;
- run signed V1 simulation acceptance;
- run cTrader/MT5 actual demo probes/lifecycles only with demo credentials and explicit existing demo gates.

Do not claim zero-loss MTProto recovery until real reconnect/restart/catch-up soak proves no known lost recoverable event. Container disk remains ephemeral. Current in-memory listener retry exhaustion can drop an event from that local queue after bounded retries; durable replay/catch-up/idempotency remains the intended recovery path and requires real environment verification.

## Current priority

1. **Controlled staging readiness/migration review**: inspect actual shared Supabase state, compare migrations `0003`-`0006`, and apply only missing Trading-owned changes if account access is available.
2. Configure non-live Zitadel/workspace/source bindings without enabling any real broker execution.
3. Run signed V1 + MTProto non-live soak acceptance using `cloudflare-v2/docs/NON_LIVE_MULTI_SOURCE_ACCEPTANCE.md`.
4. Run cTrader/MT5 broker demo probes/lifecycles only behind their existing explicit demo gates.
5. Tiny controlled live only after every non-live/demo gate is green and only after an explicit separate cutover decision.

## Exact next safe starting point

Task 9 is complete in source/CI. **Do not add more provider/fan-out code speculatively.** The next safe step is controlled staging readiness. First inspect the actual shared Supabase migration/schema state and confirm whether `0003`-`0006` are already present or missing. If Supabase/account access is unavailable, do not claim environment acceptance; continue only with clearly isolated static work that is necessary for the staging gate. Keep Trading entitlement disabled until Zitadel mapping is verified, keep broker/live execution disabled, and rerun all four mandatory CI gates after any repository change.