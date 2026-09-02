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
- No identity/admin/database acceptance work enables broker execution.

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

## CI rule

Every meaningful branch head must pass:
1. Node Worker/trading-core tests;
2. pure MT5 bridge tests;
3. both MTProto Python suites;
4. Wrangler dry-run.

Recent shared-Zitadel GREEN checkpoints:
- `33646729170` @ `471a26615752d5ab0672ba0057f1a2fba84bce4d`
- `33647392530` @ `f66d806ca9b2ed204c59e417931b8ab5c619d7cf`
- `33648262293` @ `46a0f038b7c26f66105e515d3b4e5048e91fba05`
- `33648962778` @ `6a60a457712c858fb2b568b5512ff028ac368f0d`
- `33649915332` @ `e093e8db37b0df03352f320b2dc51f048a209cf2`
- `33650151789` @ `8c80ec649f550f8c5eb0cd4690e3cf138118bc2b`

Always inspect the exact newest branch-head run before calling the branch green.

## Current priority

1. Verify the docs-only live-`0009` handoff head in all four CI gates.
2. Configure/verify the Trading project/application and exact workspace-bound organization in the existing managed Mkety Zitadel instance if an appropriate connector/account-side path is available.
3. Run real non-live project/org/`sub` positive/negative acceptance, including a Trading-only test identity with no MKSaaS DB profile.
4. Keep entitlement disabled until the negative/positive identity setup is ready; enable only the intended non-live entitlement after evidence passes.
5. Deploy/verify Cloudflare V1/Queue/Container/DO runtime configuration without enabling broker execution.
6. Continue MTProto non-live soak/reconnect/replay and signed V1 simulation acceptance.
7. Run cTrader/MT5 demo gates only after identity/runtime acceptance is green.
8. Tiny controlled live only after every non-live/demo gate is green and a separate explicit cutover decision.

## Exact next safe starting point

Migration `0009` is now **live-applied and verified**. Shared-Zitadel Tasks 1–5 are source/CI GREEN. The existing Trading workspace entitlement remains disabled/unbound.

Next safe work is real non-live identity environment acceptance:
- configure the Trading-specific Zitadel project/app and exact organization binding without relying on MKSaaS DB state;
- create/provision only deliberate test identities/memberships;
- prove wrong project, wrong org, missing/disabled/wrong-workspace membership all fail;
- prove an existing-Mkety logical user and a Trading-only subject both succeed through the same immutable `sub` gate;
- keep broker/live execution disabled;
- keep source/destination/integration isolation unchanged;
- do not merge `main` without explicit user instruction.
