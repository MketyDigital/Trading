# Trading Project Agent Handoff

Operational source of truth for `MketyDigital/Trading`. Read before changing the project.

## Hard rules

- Active next-generation work stays in `cloudflare-v2/` unless a deliberate migration says otherwise.
- Preserve the legacy root runtime and `cloudflare-v2/src/index.js` until V1 is independently proven.
- Active branch: `design/enterprise-trading-event-core`; draft PR #2 targets `main`.
- Wrangler entrypoint: `cloudflare-v2/src/v1_entry.js`.
- **Never merge `main` without explicit user instruction.**
- Real-money execution remains disabled.
- TDD is mandatory: exact RED before production code; full GREEN before completion claims.
- Never paste/log/commit broker, database, auth, source, Telegram-session, provider, transport, signing, destination, or AI secrets.
- Update this file after every meaningful implementation/testing/environment batch.

## Product / tenancy contract

Mkety Trading is an enterprise/custom multi-tenant automation product. Isolation is mandatory at workspace, user, source, provider runtime, Telegram session, chat, event, trade account, destination, AI provider, retry, queue, idempotency, Position Group, health, control-state, and credential boundaries. One tenant/integration failure must never receive, mutate, stall, disable, reorder, duplicate, roll back, or corrupt unrelated tenants/integrations.

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

## MTProto availability contract

Preferred first-party runtime: Cloudflare Container + Telethon, one Telegram session listening to many configured chats/channels. Pure DO+mtcute and external MTProto remain alternate providers and must never become platform-wide startup dependencies.

Canonical Telegram identity:

```text
telegram:<accountScope>:<chatId>:<messageId>
```

Container disk is ephemeral and never authoritative durable state. DO storage, Supabase event/idempotency state, Queue delivery, and Telegram catch-up/replay are recovery authorities. Do not claim literal zero interruption/zero loss until real reconnect/restart soak proves it.

Known environment fact: bounded in-memory listener retries can exhaust; durable replay/catch-up/idempotency is the intended recovery path and still needs real environment soak.

## Shared Mkety Zitadel identity contract

- **One managed Mkety Zitadel instance is the global identity authority for MKSaaS and Trading.**
- MKSaaS and Trading use separate Zitadel projects/apps and separate product databases.
- A Zitadel subject may have MKSaaS access, Trading access, both, or neither.
- A Trading-only user may authenticate through the same Zitadel instance without any MKSaaS database row/profile.
- Immutable Zitadel `sub` is the user identity key; never email.
- Successful Zitadel login alone never grants Trading access.
- `trading_workspace_access` is the Trading workspace/org entitlement switch.
- `trading_workspace_memberships` is the exact subject-to-workspace membership boundary.
- Admin authorization order: workspace entitlement -> cryptographic Zitadel token/issuer/audience/project/org role -> exact enabled `(workspace_id, auth.sub)` membership -> Trading workspace permission.
- When `ZITADEL_PROJECT_ID` is configured, only `urn:zitadel:iam:org:project:<projectId>:roles` may authorize; never fall back to the generic claim.
- Workspace roles:
  - owner: workspace/members/sources read-write
  - admin: workspace/members/sources read-write
  - operator: workspace/source read + source write
  - viewer: workspace/source read
  - unknown: fail closed
- No workspace role grants `broker.execute`.
- Trading authorization must never query or depend on the MKSaaS database/shared Mkety workspace table.
- Keep `trading_access_enabled=false` until real non-live positive/negative Zitadel acceptance passes.

Identity docs:
- `docs/superpowers/specs/2026-09-02-mkety-shared-zitadel-enterprise-identity-design.md`
- `docs/superpowers/plans/2026-09-02-mkety-shared-zitadel-enterprise-identity.md`
- `cloudflare-v2/docs/SHARED_ZITADEL_ENTERPRISE_IDENTITY.md`
- `cloudflare-v2/docs/STAGING_V1_RUNBOOK.md`

Other active design/plan docs:
- `docs/superpowers/specs/2026-09-02-multi-source-provider-and-mtproto-runtime-design.md`
- `docs/superpowers/plans/2026-09-02-multi-source-provider-foundation.md`
- `docs/superpowers/specs/2026-09-02-external-mtproto-signed-v1-adapter-design.md`
- `docs/superpowers/plans/2026-09-02-external-mtproto-signed-v1-adapter.md`
- `cloudflare-v2/docs/NON_LIVE_MULTI_SOURCE_ACCEPTANCE.md`

## Implemented/verified foundation

GREEN before the shared-Zitadel slice:
- signed `/api/v1/events`, legacy shadow compatibility, cryptographic Zitadel/workspace auth, AES-256-GCM secrets;
- persistent event reservation/idempotency, deterministic parser + bounded AI;
- MT5/cTrader/Deriv normalization, metadata-driven risk/account safety;
- arbitrary-TP Position Groups, durable Trade State, simulation orchestration;
- cTrader/MT5 demo acceptance foundations;
- multi-source provider registry/default semantics and canonical cross-provider identity;
- Container Telethon, Queue -> signed V1, retry isolation, Container supervisor/bootstrap/lifecycle/recovery/replay;
- external MTProto signed-V1 adapter + portable Telethon runtime;
- pure DO+mtcute alternate provider;
- Zitadel-authorized source admin;
- destination fan-out isolation;
- Supabase privilege hardening migrations `0007`/`0008`;
- strict Zitadel project-role isolation;
- first-party MTProto static component readiness.

Notable prior exact GREEN checkpoints include `33630219329`, `33631626956`, `33632407746`, `33633316579`, `33640530231`.

## Shared-Zitadel source/CI implementation — complete 2026-09-02

1. **Task 1 — subject membership schema GREEN.** Migration `0009_trading_workspace_memberships.sql`. RED `33646617046` @ `f687c9d09fe0c5ff93c05d1a181720895d70f159`; GREEN `33646729170` @ `471a26615752d5ab0672ba0057f1a2fba84bce4d`.
2. **Task 2 — exact Zitadel-subject membership authorization GREEN.** RED `33647073934` @ `4bb2e9844aac9b6f8cd89783c8c2114edc910f82`; GREEN `33647392530` @ `f66d806ca9b2ed204c59e417931b8ab5c619d7cf`.
3. **Task 3 — workspace role permissions GREEN.** RED `33647710823` / final workspace-read RED `33647947785`; GREEN `33648262293` @ `46a0f038b7c26f66105e515d3b4e5048e91fba05`.
4. **Task 4 — tenant-safe membership administration GREEN.** RED `33648606711` @ `26d310fa5aa6e7c98d66b04037affb6e3e7fb7d8`; GREEN `33648962778` @ `6a60a457712c858fb2b568b5512ff028ac368f0d`.
5. **Task 5 — dual-access/static MKSaaS-independence acceptance + operator docs GREEN.** RED `33649663301` @ `e5f1df41a31e1467c64304f59e09684694c73e66`: 426/427 passed, sole failure was deliberately missing identity guide. GREEN `33649915332` @ `e093e8db37b0df03352f320b2dc51f048a209cf2`.
6. Final source/CI handoff head before live DB application: `33650151789` @ `8c80ec649f550f8c5eb0cd4690e3cf138118bc2b`, all four mandatory gates GREEN.

Source/CI acceptance proves existing-Mkety and Trading-only logical users converge on the same immutable `sub` + Trading membership gate, wrong project/org/workspace/disabled membership fails closed, workspace roles remain isolated, no MKSaaS DB dependency exists, and membership provisioning does not mutate trading execution/source state.

## Shared Supabase live state — `0009` verified 2026-09-02

Connected project: `Mkety Digital` (`vdblajgxrfndjesoyayy`, PostgreSQL 17.6.1).

Live Trading migrations now include `0003` through `0009`. Verified `0009` ledger entry:

```text
20260902154413  trading_0009_workspace_memberships
```

`public.trading_workspace_memberships` live verification:
- expected columns/defaults are present;
- FK `workspace_id -> trading_workspace_access(id) ON DELETE CASCADE` present;
- role check allows only `owner/admin/operator/viewer`;
- unique `(workspace_id, zitadel_subject)` present;
- expected subject/workspace indexes present;
- RLS enabled;
- zero RLS policies by design;
- `anon`/`authenticated` have zero table privileges;
- `service_role` retains required access;
- membership row count remains `0`.

Post-migration isolation verification:
- shared `public.workspaces` remains exactly 10 columns;
- `source_connections=0`;
- `trading_events=0`;
- `position_groups=0`;
- `position_legs=0`;
- `destination_deliveries=0`;
- `trade_accounts=0`;
- existing workspace entitlement remains `trading_access_enabled=false`;
- `zitadel_org_id` remains `NULL`;
- no source, Telegram, broker, execution, or membership credentials/data inserted.

Advisor review after `0009`:
- new Trading membership table has expected INFO `RLS enabled, no policy` because it is service-only;
- two new empty-table indexes have expected unused-index INFO;
- no new Trading-specific WARN requiring a migration fix was introduced;
- pre-existing unrelated WARNs include public `vector`, `public.rls_auto_enable()` SECURITY DEFINER executability, and unrelated policy/performance findings; do not modify them from this Trading repo without a separate Mkety security plan.

Exact live-`0009` handoff CI: `33650914537` @ `3ded017581693a4e660b57dbfc9b729cafe78188`, all four mandatory gates GREEN.

## Non-Telegram signed source adapter checkpoint — 2026-09-02

Scope: source-side MT5, cTrader, and custom signed API producers only. No broker/destination/execution behavior was added.

1. **Pure event builder GREEN.** RED `33651565078` @ `e50f4e5d6731c8e7dcec4cec0130e3a2e54a8c9e`: 427 existing tests passed, sole failure was missing `src/sources/nontelegram/source_event_adapter.js`. GREEN `33651715322` @ `27b2c706ea3d98e56b5dcf7c2eab0c41ccb8a276`, all four gates pass.
   - Supports `mt5_source_bridge`, `ctrader_source`, `custom_signed_api`.
   - Emits V1 event body only; MT5 uses native `transaction_id`, cTrader/custom use native `event_id`.
   - Strips caller workspace/source authority, broker/destination/execution fields, and secret-like metadata.
   - Same native event remains deterministic across retries.
2. **Real signed-ingest composition GREEN.** Initial acceptance head `8a9309a92591c4914c7bc33c0b89888c408620b5` failed only because the new test harness called positional `signSourcePayload(rawBody,timestamp,secret)` as an object; production code was not implicated. Harness correction `0c0a34d3ce6a278486d919c886437c85c21c9d66`; exact GREEN `33652188423`, all four gates pass.
   - MT5/cTrader/custom sources authenticate and reserve independently through real `ingestTradingEvent`.
   - Duplicate in one family is terminal locally and does not suppress sibling families.
   - Bad credential cannot reserve/poison another source.
   - Authenticated source workspace overrides caller hints.
   - Same scoped native event remains isolated across workspaces.
3. **Isolated external signed-V1 client GREEN.** RED `33652397788` @ `632094dbd3c2651e6e11c9e0a8d67b532b932d56`: 437/438 passed, sole failure missing `signed_v1_client.js`. GREEN `33652558801` @ `f0bae16e24e0abe46ca7a35ecc4e0c6b9e366b7b`, all four gates pass.
   - Exact HMAC/header parity with `/api/v1/events`.
   - HTTPS exact `/api/v1/events` endpoint only.
   - Duplicate response is terminal success.
   - Network/429/5xx classified retryable; other non-2xx and invalid 2xx bodies permanent.
   - Errors never echo response bodies or source secrets.
   - Client performs one attempt only; retry/backoff ownership remains source-runtime-local, preventing hidden global retry coupling.
   - Each client instance closes over its own source ID/secret; no global mutable credential state.
4. **Per-source producer runtime GREEN.** RED `33652942204` @ `2d5fa8bd810be5f431f093ceb40283bb3eccf0cf`: 442/443 Node tests passed; sole failure was missing `src/sources/nontelegram/source_runtime.js`. GREEN `33653159677` @ `2871e195eaf2b7aea2a4db9695e7af8e0073b27a`, all four gates pass.
   - Builds the source event payload once and retries the same object only for retryable delivery failures.
   - Retry delays, counters, health, clock and sleep are local to each runtime instance.
   - Permanent rejections are terminal and consume no retry schedule.
   - Retry exhaustion degrades only the owning runtime.
   - Status exposes only local safe counters/timestamps/event id; no credentials or transport details.
   - Concurrency acceptance proves runtime A may remain blocked in its own retry sleep while runtime B completes successfully and updates only B health.
   - Provider mismatch is rejected before any client delivery; duplicate V1 success remains healthy terminal success.

## cTrader source-capture isolation checkpoint — 2026-09-02

1. **Non-destructive cTrader session event subscriptions GREEN.** Corrected RED `33654023354` @ `bec542b9062e22e582b5dd27282e68c84663a953`: all prior cTrader/request/waiter behavior passed and the five new tests failed only because `subscribeEvents()` did not exist. GREEN `33654538322` @ `69ea76310689db9890534f1ef520b9fc24d88442`, all four mandatory gates pass.
   - `CTraderJsonSession.subscribeEvents()` is a per-session observation tap; it does not consume `waitForEvent()` events or alter request correlation.
   - Multiple observers receive the same event independently.
   - One observer exception is swallowed locally and cannot block sibling observers, request correlation, or execution waiters.
   - Unsubscribe is idempotent and subscriptions never cross session instances.
2. **Exact-account cTrader source capture GREEN.** RED `33654765459` @ `fb05e447c3064e4b2e2621384a31d9fad5563d4e`: 452/453 Node tests passed; sole failure was the deliberately missing `src/sources/nontelegram/ctrader_source_capture.js`. GREEN push run `33654983528` @ `0027a849fddcf810d6fa541a39b03658773b9925`; matching PR run `33654989002` also passed.
   - Capture accepts only `ProtoOAExecutionEvent` (`payloadType=2126`) for its exact configured `ctidTraderAccountId`.
   - Initial source semantics are deal-only: a stable native `dealId` plus `deal.executionTimestamp` is required; malformed/non-deal/wrong-account events are ignored locally.
   - Broker account ID is a local capture filter only and is not forwarded as workspace/source authority or exposed in health.
   - Forwarded structured data contains execution type and cloned deal/order/position payloads; source runtime still performs the canonical V1 build/sign/delivery boundary.
   - Each capture owns its own serial promise chain so native order is preserved within that source; blocked capture A cannot delay capture B even when both observe one shared websocket session.
   - Delivery failure degrades/counts only the owning capture and later events still proceed; a later successful event restores healthy status.
   - Start/stop are idempotent; health is source-local and contains no credentials/account ID.
   - No database migration, destination coupling, broker execution path, or live enablement was introduced by this slice.

**TradingView caveat:** do not route direct TradingView alerts through this HMAC client. TradingView webhooks cannot supply the dynamic Mkety HMAC headers used by the signed V1 contract. Direct TradingView ingress requires a separate reviewed authentication design; do not weaken V1 by placing reusable secrets in URLs/bodies merely to force compatibility.

## CI rule

Every meaningful branch head must pass:
1. Node Worker/trading-core tests;
2. pure MT5 bridge tests;
3. both MTProto Python suites;
4. Wrangler dry-run.

Recent GREEN checkpoints:
- `33649915332` @ `e093e8db37b0df03352f320b2dc51f048a209cf2`
- `33650151789` @ `8c80ec649f550f8c5eb0cd4690e3cf138118bc2b`
- `33650914537` @ `3ded017581693a4e660b57dbfc9b729cafe78188`
- `33651715322` @ `27b2c706ea3d98e56b5dcf7c2eab0c41ccb8a276`
- `33652188423` @ `0c0a34d3ce6a278486d919c886437c85c21c9d66`
- `33652558801` @ `f0bae16e24e0abe46ca7a35ecc4e0c6b9e366b7b`
- `33652790629` @ `927511f822ad6b9593ad248cebb50b6225df7c9a`
- `33653159677` @ `2871e195eaf2b7aea2a4db9695e7af8e0073b27a`
- `33654538322` @ `69ea76310689db9890534f1ef520b9fc24d88442`
- `33654983528` @ `0027a849fddcf810d6fa541a39b03658773b9925`

Always inspect the exact newest branch-head run before calling the branch green.

## Current priority

1. Verify this updated handoff/documentation head in all four CI gates.
2. Add an MT5 source observation/capture boundary that is physically and logically separate from the existing execution-oriented `bridges/mt5_bridge.py` command path; do not share command retry/execution state with source delivery.
3. Compose MT5 native event capture into the existing non-Telegram source runtime with stable native transaction/deal/order identity, exact account scope, per-instance ordering/retry/health, and no destination/execution authority.
4. Continue custom signed API composition after MT5 capture acceptance.
5. Design TradingView direct webhook authentication separately before adding any public route; never weaken signed V1 auth to accommodate TradingView limitations.
6. Configure/verify the Trading project/application and exact workspace-bound organization in managed Mkety Zitadel when an appropriate account connector/path exists; none is currently available in this chat.
7. Run real non-live project/org/`sub` positive/negative acceptance when account-side Zitadel access exists.
8. Deploy/verify Cloudflare V1/Queue/Container/DO runtime configuration when Cloudflare account-side access exists; no connector is currently available in this chat.
9. Continue MTProto non-live soak/reconnect/replay and signed V1 simulation acceptance where credentials/environment are available.
10. Run cTrader/MT5 demo gates only after identity/runtime acceptance is green.
11. Tiny controlled live only after every non-live/demo gate is green and a separate explicit cutover decision.

## Exact next safe starting point

Latest implementation GREEN: `33654983528` @ `0027a849fddcf810d6fa541a39b03658773b9925`.

Next safe source work:
- keep MT5/cTrader/custom ingress source-only;
- retain cTrader source capture as a non-destructive observer; never replace execution `waitForEvent()` semantics with source-consumer behavior;
- when one cTrader websocket authenticates multiple accounts, every source capture must enforce its own exact account ID before delivery;
- add MT5 provider-native source observation separately from `MT5Engine` command execution and its replay ledger;
- use stable provider-native IDs/timestamps and compose into `buildSignedSourceEventPayload` + `createSignedV1SourceClient` + `createNonTelegramSourceRuntime` with per-instance state only;
- prove one MT5 source's capture/retry/failure/health cannot block or mutate another source or execution bridge;
- do not create TradingView direct ingress until its auth contract is separately designed/reviewed;
- keep entitlement disabled until real Zitadel environment acceptance;
- keep broker/live execution disabled;
- do not merge `main` without explicit user instruction.
