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
- Never paste/log/commit broker, database, auth, source, Telegram-session, provider, transport, or signing secrets.
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

Isolation is mandatory at workspace, user, source, provider runtime, Telegram session, chat, event, trade account, destination, AI provider, retry, idempotency key, position group, and broker credential boundaries. One tenant/runtime/integration failure must never receive, mutate, stall, disable, reorder, or corrupt another tenant/integration's credentials, configuration, state, events, retries, health, idempotency, or broker actions.

Sources are first-class pluggable providers. A workspace may enable multiple simultaneous sources across Telegram MTProto, MT5, cTrader, TradingView, REST/custom APIs, and future families.

Rules:

- default source is preference, not exclusivity;
- at most one enabled default per `(workspace_id, source_family)`;
- other enabled sources remain active;
- unconfigured providers are inert;
- runtime identity is not canonical event identity;
- redundant provider replays collapse through persistent canonical idempotency before AI/orchestration/trading;
- browser/caller workspace/source/bootstrap fields are never authoritative when a server-side trusted source exists;
- source, destination, broker, AI, retry, health, credentials, and control state stay scoped to the smallest responsible integration boundary.

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

No real external Worker acceptance, real broker demo order, or real Cloudflare Container/DO MTProto deployment has been performed in this session because account/runtime credentials are not available here.

## Multi-source implementation status — 2026-09-02

1. **Provider registry + canonical identity — GREEN.** RED `33598485434`; GREEN `33598572539` @ `7d62761a072499f6f93910398b3be455b68a2913`.
2. **Source registry/default semantics — GREEN.** Migration `0003`; atomic per-family default; multiple sources remain active. RED `33598660566`, intermediate `33598814319`; GREEN `33598900292` @ `215c136a0ed697aac8f00c241afbbb6fa7bb2b16`.
3. **Cross-provider native-event idempotency — GREEN.** Migration `0004`; `(workspace_id, canonical_event_id)` collapse after authentication. RED `33599310435`, `33599410187`, `33599559597`; GREEN `33599671009` @ `1f846fd7eee536cdb5ccd79e1118d3d31e30e39d`.
4. **Cloudflare Container/Telethon provider skeleton — GREEN.** Deterministic runtime identity; reconnect/catch-up; multi-chat filtering; native identity; sanitized health; Python MTProto CI gate.
5. **Cloudflare Queue -> signed V1 path — GREEN.** Listener carries no source HMAC; Worker resolves/decrypts HMAC server-side, signs exact V1 body, retries failures, DLQ. GREEN `33603127779` @ `837190d63f780f7c72f477ed5a1accb84d20071c`.
6. **MTProto downstream retry isolation — GREEN.** Same-payload bounded retry; exhausted event cannot kill worker; later success recovers health; secret-free delivery health. GREEN `33612304712` @ `760395613316974a04973553d133c21b9413952a`.
7. **Real stateful Cloudflare Container supervisor — GREEN.** `MtprotoContainerRuntime`, `MTPROTO_CONTAINER_NAMESPACE`, DO migration `v3`, strict `(sourceId, workspaceId, accountScope)`, secret-free persisted state, runtime-only start env, local health, staged `max_instances=100`. RED `33612630711`; intermediate `33612963137`; GREEN `33613179989` @ `d65a95a1b37cf6ae644cc74213eb81313035802d`.
8. **Server-side MTProto bootstrap resolver — GREEN.** Migration `0005` separates provider credentials from ingress HMAC. Exact workspace/source/provider/active lookup; provider credential decrypt server-side; caller bootstrap ignored. RED `33613601588`; GREEN `33613707938` @ `4cafbcd3ad39ec09083840529087df92ccada3a8`.
9. **Tenant-safe MTProto Container lifecycle service — GREEN.** Trusted `workspaceId/sourceId` only; exact identity verification; server-derived runtime; restart re-resolves credentials; status strips secret/ciphertext. RED `33613934166`; GREEN `33614019384` @ `03c438567be97cbf9a765b7a10898f4a0ab486b5`.
10. **Durable MTProto recovery supervisor + scheduled recovery — GREEN.** Migration `0006`; per-source recovery counters/backoff/error codes; exact tenant/source recovery writes; one-minute recovery cron isolated from legacy scheduler. TDD RED/intermediates `33614712990`, `33614818871`, `33615213124`, `33615397670`; final GREEN `33615599446` @ `aa34a1681414b0abc6d6b73f84c6de9e3f30b954`.
11. **MTProto recovery replay acceptance — GREEN with no production change.** Exact post-restart replay ACKs as duplicate with one orchestration; new message proceeds; redundant DO replay converges on same provider-independent native identity. GREEN `33615820124` @ `b73abee97a736a4a53f726635df9d211a5f73986`.
12. **External MTProto server-side source/chat/account authorization — GREEN.** External policy runs after HMAC but before reservation/AI; server-owned allowlist/all-visible policy; authenticated workspace authoritative; caller forwarding metadata cannot authorize chats. RED `33623557990`, `33623657099`; GREEN `33623854041` @ `904690f4c97208b1306a48179aba6bb8b689bd48`.
13. **External MTProto signed-V1 HTTPS sink — GREEN.** Exact raw-body signing; retryable vs permanent failures; persistent duplicates terminal success; sanitized errors; external Python suite in mandatory CI. Implementation checkpoint `d20bf83…`.
14. **Portable external Telethon runtime — GREEN.** Per-adapter session/queue/retry/health isolation; multiple chats; native/thread/edit/media parity; clean cancellation; secret-free health. GREEN `33625107407` @ `9fb58507c2797c703c967d77648e6c7e5a1d50a0`.
15. **External MTProto cross-provider replay + two-workspace isolation acceptance — GREEN.** Container/external replay collapses only within workspace; identical Telegram identity remains distinct across workspaces; credentials/policy/disabled/failure state never cross tenants. GREEN `33625278355` @ `c6c2c14fb3c389b23062d83a1a2240875dd97891`.
16. **External MTProto CI contract + operator/staging docs — GREEN.** Static CI contract protects both MTProto Python suites; README/runbook documents trust boundary, credential scope, replay, rotation, non-live acceptance. Exact GREEN `33626149089` @ `e2bc271842a5df1425f3fb879ba0c413bfb180e0`.
17. **Heterogeneous source registration/configuration/coexistence — GREEN.** `provider_config_validation.js` validates one source at a time; stable non-secret canonical scope; no source-to-broker/destination/execution coupling. Six provider types coexist; one invalid provider cannot mutate siblings/defaults. RED `33626475474` @ `7eaaac74bdd8d76a5b1522d63f36d447d0058cac`; production GREEN `33626665176` @ `01e388ac6d94e2770461d9264340ec1fca7a3ab8`; store-level GREEN `33626927619` @ `a78dc9fbe257f41b67337ad5f06587a018f1d573`. Broader-plan Task 7 complete.
18. **Pure Durable Object + mtcute alternate MTProto provider — GREEN.** `src/sources/mtproto/do_provider.js` persists mtcute storage/update state in the exact DO, enables `updates.catchUp`, uses per-DO alarms for reconnect, keeps disconnected/reconnect health local, emits the same queue-compatible Telegram native identity as Container, and never exposes API hash/session material through status. `listener_node.js` now delegates `/start`, `/send_code`, `/stop`, `/status`, and `alarm()` to this isolated provider; `/send_code` persists the exported Telegram session internally but returns only `{status:"authenticated"}`; provider exceptions return fixed `MTPROTO_DO_CONTROL_FAILED`; legacy direct `GLOBAL_ROUTER_URL` forwarding and admin-env credential fallback are removed from the active DO path. The DO produces into the existing `SOURCE_EVENT_QUEUE` so downstream server-side source resolution, HMAC signing, persistent idempotency, and V1 ingest stay shared without cross-provider coupling. It remains alternate/non-default and does not become a platform startup dependency. Initial provider RED `33627432162` @ `0db0865287e5d577c628378aff3b7f64593cdd42` (only missing provider module); focused provider GREEN `33627556140` @ `222905ae86367300cf49c6e78e1195ccd98bacc3`; control-surface RED `33627701249` @ `5ec317f1b746fd18564bd061b97431bf0f3e9192` (359 pass, only two intentional control failures); final exact-head GREEN `33627974053` @ `b15e4b7afc864daba23d0e8b8d77773d1a3e0175`, all four mandatory gates passing. Broader-plan Task 6 complete.

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
- `33615599446` @ `aa34a1681414b0abc6d6b73f84c6de9e3f30b954`
- `33615820124` @ `b73abee97a736a4a53f726635df9d211a5f73986`
- `33623854041` @ `904690f4c97208b1306a48179aba6bb8b689bd48`
- `33625107407` @ `9fb58507c2797c703c967d77648e6c7e5a1d50a0`
- `33625278355` @ `c6c2c14fb3c389b23062d83a1a2240875dd97891`
- `33626149089` @ `e2bc271842a5df1425f3fb879ba0c413bfb180e0`
- `33626665176` @ `01e388ac6d94e2770461d9264340ec1fca7a3ab8`
- `33626927619` @ `a78dc9fbe257f41b67337ad5f06587a018f1d573`
- `33627556140` @ `222905ae86367300cf49c6e78e1195ccd98bacc3`
- `33627974053` @ `b15e4b7afc864daba23d0e8b8d77773d1a3e0175`

Always inspect the exact newest branch-head run before calling the branch green.

## External configuration still required later

No Cloudflare/Zitadel account connector is available in this session; no account-side settings have been changed. Never request secret values in chat.

Container MTProto E2E later requires: review/apply migrations `0003`-`0006`; deploy/recognize Container runtime + `v3` DO migration; create non-live `cloudflare_container_mtproto` source; encrypt provider credentials server-side; set chat IDs and trusted internal handoff settings; use a Telegram test account/channel for reconnect/catch-up/soak. External MTProto real soak later requires a non-live `external_mtproto` source plus customer-owned Telegram API/session credentials on the external host. Pure DO+mtcute real soak requires a non-live `cloudflare_do_mtproto` source and Telegram login/session provisioning through its isolated control boundary. cTrader/MT5 real demo acceptance still requires existing demo-only credentials/gates.

## Current priority

1. Add **Task 8: Zitadel-authorized source admin/default/status APIs**, scoped to the authenticated Trading workspace and never exposing source/provider secrets.
2. Add Task 9 non-live multi-source acceptance, reconnect/soak harness, runbook/CI expansion.
3. Review/apply checked-in Trading migrations and configure non-live staging only when account/runtime access is available.
4. Run external signed-V1 + MTProto source soak acceptance when runtime credentials are available.
5. Run broker demo probes/lifecycles only behind explicit demo gates.
6. Tiny controlled live only after all non-live/demo acceptance is green.

## Exact next safe starting point

Continue `docs/superpowers/plans/2026-09-02-multi-source-provider-foundation.md` at **Task 8: Admin Source Management API**. First inspect the existing V1 admin authorization/route shape and current source connection store. Write `cloudflare-v2/tests/v1_admin_sources.test.mjs` as an intentional RED covering: wrong Zitadel org, missing Trading role, disabled Trading entitlement, exact-workspace source listing/status, family-scoped default changes, enable/disable behavior, and zero secret/ciphertext/session/provider-credential leakage. Writes must stay scoped to Trading-owned `source_connections`; one source mutation must not modify sibling providers/defaults outside the intended family. Confirm the exact RED before creating `src/http/v1_admin_sources.js` or changing V1 routing. After the next meaningful GREEN checkpoint, update this `AGENTS.md` again before proceeding.
