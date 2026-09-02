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
- Update this file after every meaningful implementation/testing/environment batch.

## Product / tenancy contract

Mkety Trading is an enterprise multi-tenant automation product. Isolation is mandatory at workspace, user, source, provider runtime, Telegram session, chat, event, trade account, destination, AI provider, retry, queue, idempotency, Position Group, health, control-state, and credential boundaries. One tenant/integration failure must never receive, mutate, stall, disable, reorder, duplicate, roll back, or corrupt unrelated tenants/integrations.

Pipeline:

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

Critical isolation rules:
- multiple source providers may remain active simultaneously;
- default source is preference, not exclusivity;
- unconfigured providers are inert;
- redundant provider replays collapse only after authentication through persistent canonical identity;
- caller workspace/source/bootstrap fields are never authority when trusted server identity exists;
- fan-out destinations succeed/fail/retry independently; retrying one failure never redispatches successful siblings;
- foreign-workspace or duplicate destinations fail locally without blocking valid siblings.

Provider types:
- Telegram: `cloudflare_container_mtproto`, `cloudflare_do_mtproto`, `external_mtproto`
- TradingView: `tradingview_webhook`
- MT5: `mt5_source_bridge`
- cTrader: `ctrader_source`
- custom: `custom_signed_api`

## Core trading safety

- Connected broker metadata is authoritative for symbols, precision, tick economics, volume/order/account-mode semantics.
- Deterministic processing handles clear signals; bounded AI is only for ambiguity and must pass deterministic validation.
- AI failure cannot block clear deterministic work.
- Fast-entry policies: `execute_immediately`, `wait_for_complete_signal`, `forward_only`.
- Completed fast signals reuse the executed first leg as TP1 and add only missing targets.
- Position Groups support arbitrary TP counts and hedged/netted behavior.
- Persistent event/destination/order idempotency is mandatory.
- Every trade account requires explicit execution enablement, safety/risk limits, and kill switch before broker dispatch.
- Global kill switch blocks everything; protective management may bypass only ordinary drawdown/open-risk locks.
- Critical cTrader rule: preserve raw `ProtoOASymbol.lotSize` protocol-cent semantics; never add another x100 conversion.
- No identity/admin/database/source-adapter acceptance work enables broker execution.

## Identity / database boundary

- One managed Mkety Zitadel instance is the global identity authority; Trading and MKSaaS use separate projects/apps and separate product databases.
- Immutable Zitadel `sub` is the user identity key; never email.
- Successful login alone never grants Trading access.
- `trading_workspace_access` is the Trading entitlement switch; `trading_workspace_memberships` is exact `(workspace_id, zitadel_subject)` membership.
- When `ZITADEL_PROJECT_ID` is configured, only its project-specific role claim may authorize.
- Workspace roles are owner/admin/operator/viewer; unknown fails closed. No workspace role grants `broker.execute`.
- Trading authorization must never query/depend on the MKSaaS user database/shared Mkety workspace table.
- Keep `trading_access_enabled=false` until real non-live Zitadel acceptance passes.
- Live Supabase Trading migrations through `0009_trading_workspace_memberships` are applied/verified. No cTrader/MT5 source work in this batch added a migration.

## MTProto availability contract

Preferred first-party runtime: Cloudflare Container + Telethon. Pure DO+mtcute and external MTProto are alternate providers and must never become platform-wide startup dependencies.

Canonical Telegram identity:

```text
telegram:<accountScope>:<chatId>:<messageId>
```

Container disk is ephemeral and never authoritative durable state. DO storage, Supabase event/idempotency state, Queue delivery, and Telegram catch-up/replay are recovery authorities. Do not claim literal zero interruption/zero loss until real reconnect/restart soak proves it.

## Implemented foundation

Verified foundations include signed `/api/v1/events`, source HMAC auth, persistent canonical event reservation/idempotency, deterministic parser + bounded AI, encrypted source/provider secrets, MT5/cTrader/Deriv normalization, account safety/risk/kill switch, arbitrary-TP Position Groups, durable Trade State, simulation, destination fan-out isolation, Container Telethon, DO+mtcute, external MTProto signed V1 adapter, source admin, shared-Zitadel memberships, and Supabase privilege hardening.

Active design/plan docs:
- `docs/superpowers/specs/2026-09-02-multi-source-provider-and-mtproto-runtime-design.md`
- `docs/superpowers/plans/2026-09-02-multi-source-provider-foundation.md`
- `docs/superpowers/specs/2026-09-02-external-mtproto-signed-v1-adapter-design.md`
- `docs/superpowers/plans/2026-09-02-external-mtproto-signed-v1-adapter.md`
- `docs/superpowers/specs/2026-09-02-mkety-shared-zitadel-enterprise-identity-design.md`
- `docs/superpowers/plans/2026-09-02-mkety-shared-zitadel-enterprise-identity.md`
- `cloudflare-v2/docs/NON_LIVE_MULTI_SOURCE_ACCEPTANCE.md`
- `cloudflare-v2/docs/STAGING_V1_RUNBOOK.md`

## Non-Telegram source foundation — GREEN 2026-09-02

1. Pure event builder: RED `33651565078` @ `e50f4e5d6731c8e7dcec4cec0130e3a2e54a8c9e`; GREEN `33651715322` @ `27b2c706ea3d98e56b5dcf7c2eab0c41ccb8a276`.
2. Real signed-ingest composition: corrected GREEN `33652188423` @ `0c0a34d3ce6a278486d919c886437c85c21c9d66`.
3. Isolated JS signed-V1 client: RED `33652397788` @ `632094dbd3c2651e6e11c9e0a8d67b532b932d56`; GREEN `33652558801` @ `f0bae16e24e0abe46ca7a35ecc4e0c6b9e366b7b`.
4. Per-source producer runtime: RED `33652942204` @ `2d5fa8bd810be5f431f093ceb40283bb3eccf0cf`; GREEN `33653159677` @ `2871e195eaf2b7aea2a4db9695e7af8e0073b27a`.

The generic builder/client/runtime supports `mt5_source_bridge`, `ctrader_source`, and `custom_signed_api`; strips caller workspace/source/destination/execution/credential authority; performs deterministic serialization; and owns retry/health state per source instance only.

## cTrader source-capture isolation — GREEN 2026-09-02

1. Non-destructive session event tap: corrected RED `33654023354` @ `bec542b9062e22e582b5dd27282e68c84663a953`; GREEN `33654538322` @ `69ea76310689db9890534f1ef520b9fc24d88442`.
   - `subscribeEvents()` is observer-only and never consumes `waitForEvent()` events.
   - subscriber exceptions/unsubscribe/state are session-local and cannot break request correlation or execution waiters.
2. Exact-account cTrader capture: RED `33654765459` @ `fb05e447c3064e4b2e2621384a31d9fad5563d4e`; GREEN `33654983528` @ `0027a849fddcf810d6fa541a39b03658773b9925`.
   - only `ProtoOAExecutionEvent` deal events for exact `ctidTraderAccountId`;
   - stable `dealId` + `executionTimestamp` required;
   - per-capture serial ordering/health/failure containment;
   - account ID remains a local filter and is not exposed as authority or health data;
   - no destination/execution coupling or live enablement.

## MT5 source-capture and delivery isolation — GREEN 2026-09-02

The source path is physically/logically separate from execution-oriented `bridges/mt5_bridge.py`. Do not merge their credentials, ledgers, retry state, or lifecycle.

1. **Exact-account polling capture GREEN.** RED `33655502440` @ `67e1661ae8fe1e6ec56bef1b70444daca4fbdd7f`: Node 458/458 passed and the only failing gate was missing `mt5_source_capture`. GREEN `33655782502` @ `3dcf689b319acc49fd15df7f9174281e48927ade`, all four gates pass.
   - file: `cloudflare-v2/bridges/mt5_source_capture.py`;
   - exact `account_info().login` must match configured source account before history access;
   - polls `history_deals_get` with overlap, sorts by native `(time_msc,ticket)`;
   - native source identity is deal ticket; timestamp is `time_msc` UTC;
   - successful overlap duplicates are suppressed in a bounded capture-local seen set;
   - failed delivery is deliberately **not** marked seen, so a later overlap can retry it;
   - persistent V1 server idempotency remains restart/replay authority;
   - one deal delivery failure never blocks later deals; captures keep independent seen/health/failure state;
   - source status contains no account/login/credential data.
2. **MT5-local signed V1 delivery GREEN.** RED `33656149292` @ `ba7bee0ce159ce35c54c8ed9b294db713178ec2c`: Node 458/458 passed and the only failing gate was missing `mt5_source_delivery`. GREEN `33656303876` @ `61241796fdc420035e23acfc0d9d744974aff07e`, all four gates pass.
   - file: `cloudflare-v2/bridges/mt5_source_delivery.py`;
   - consumes only `providerType=mt5_source_bridge` capture events;
   - builds exact V1 event with `metadata.native_identity.transaction_id` from native deal ticket;
   - recursively strips secret/workspace/source-connection/account/broker/execution-authority fields;
   - exact HMAC basis is `v1:<timestamp_ms>:<raw_json_body>`;
   - exact HTTPS `/api/v1/events` endpoint only;
   - serializes body once and reuses byte-identical JSON across retries;
   - network/429/5xx retry on only this sender's configured schedule; ordinary 4xx is permanent;
   - duplicate is terminal success;
   - errors never echo response body or source secret;
   - each sender instance closes over its own source ID/secret/transport/retry/clock;
   - it does **not** use `MKETY_MT5_BRIDGE_SECRET`, `ReplayLedger`, `MT5Engine`, `/v1/command`, or any broker execution state.

No DB migration, destination coupling, broker command modification, execution enablement, or live-money change was introduced by cTrader/MT5 source work.

## TradingView caveat

Do not route direct TradingView alerts through the current dynamic-HMAC client. TradingView webhooks cannot supply the dynamic Mkety HMAC headers used by signed V1. Direct TradingView ingress requires a separate reviewed authentication design. Never weaken V1 by putting reusable secrets in URLs/bodies merely for compatibility.

## CI rule

Every meaningful branch head must pass:
1. Node Worker/trading-core tests;
2. pure MT5 bridge tests;
3. both MTProto Python suites;
4. Wrangler dry-run.

Recent exact GREEN checkpoints:
- `33653159677` @ `2871e195eaf2b7aea2a4db9695e7af8e0073b27a`
- `33654538322` @ `69ea76310689db9890534f1ef520b9fc24d88442`
- `33654983528` @ `0027a849fddcf810d6fa541a39b03658773b9925`
- `33655301310` @ `87c504087ed03243ade095bc2f337037d5d7f54d`
- `33655782502` @ `3dcf689b319acc49fd15df7f9174281e48927ade`
- `33656303876` @ `61241796fdc420035e23acfc0d9d744974aff07e`

Always inspect the exact newest branch-head run before calling the branch green.

## Current priority

1. Verify this MT5 handoff/documentation head in all four CI gates.
2. Continue `custom_signed_api` source composition using the existing generic event builder + isolated signed client + per-source runtime; do not introduce destination/execution coupling.
3. Add an executable MT5 source-only runtime/runner only if needed for deployment: initialize MT5 observation, load source-only config, compose `MT5SourceCapture` + `create_mt5_signed_v1_delivery`, poll safely, and never import/use `MT5Engine` or command-secret state.
4. Design TradingView direct webhook authentication separately before adding any public route.
5. Configure/verify Trading Zitadel project/application and exact workspace-bound organization when an account-side connector/path is available.
6. Run real non-live Zitadel positive/negative acceptance when environment access exists.
7. Deploy/verify Cloudflare V1/Queue/Container/DO runtime configuration when Cloudflare account-side access exists.
8. Continue MTProto non-live soak/reconnect/replay and signed V1 simulation acceptance where credentials/environment are available.
9. Run cTrader/MT5 demo gates only after identity/runtime acceptance is green.
10. Tiny controlled live only after every non-live/demo gate is green and a separate explicit cutover decision.

## Exact next safe starting point

Latest implementation GREEN: `33656303876` @ `61241796fdc420035e23acfc0d9d744974aff07e`.

Next safe source work:
- keep MT5/cTrader/custom ingress source-only;
- retain cTrader capture as a non-destructive observer with exact account filtering;
- retain MT5 source capture/sender entirely separate from execution bridge secret, ledger, commands and lifecycle;
- continue custom signed API composition with per-instance credentials/retries/health and authenticated V1 server authority;
- prove one custom producer's invalid request/retry/failure/health cannot affect sibling custom/MT5/cTrader/Telegram sources;
- do not create TradingView direct ingress until its auth contract is separately designed/reviewed;
- keep entitlement disabled until real Zitadel environment acceptance;
- keep broker/live execution disabled;
- do not merge `main` without explicit user instruction.
