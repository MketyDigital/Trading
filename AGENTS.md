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
- Update this file after every meaningful implementation/testing batch.

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
- No current identity/admin work enables broker execution.

## MTProto availability contract

Preferred first-party runtime: Cloudflare Container + Telethon, one Telegram session listening to many configured chats/channels. Pure DO+mtcute and external MTProto remain alternate providers and must never become platform-wide startup dependencies.

Canonical Telegram identity:

```text
telegram:<accountScope>:<chatId>:<messageId>
```

Container disk is ephemeral and never authoritative durable state. DO storage, Supabase event/idempotency state, Queue delivery, and Telegram catch-up/replay are recovery authorities. Do not claim literal zero interruption/zero loss until real reconnect/restart soak proves it.

Known environment fact: bounded in-memory listener retries can exhaust; durable replay/catch-up/idempotency is the intended recovery path and still needs real environment soak.

## Shared Mkety Zitadel identity contract

- **One managed Mkety Zitadel instance is the global identity authority for MKSaaS and Trading.** Trading is an enterprise Mkety product, not a second identity system.
- MKSaaS and Trading use separate Zitadel projects/apps and separate product databases.
- A Zitadel subject may have MKSaaS access, Trading access, both, or neither.
- A Trading-only user may authenticate through the same Zitadel instance without any MKSaaS database row/profile.
- Immutable Zitadel `sub` is the user identity key; never email.
- Successful Zitadel login alone never grants Trading access.
- `trading_workspace_access` is the Trading workspace/org entitlement switch.
- `trading_workspace_memberships` is the exact subject-to-workspace membership boundary.
- Admin authorization order: workspace entitlement -> cryptographic Zitadel token/issuer/audience/project/org role -> exact enabled `(workspace_id, auth.sub)` membership -> Trading workspace permission.
- When `ZITADEL_PROJECT_ID` is configured, only `urn:zitadel:iam:org:project:<projectId>:roles` may authorize; never fall back to the generic claim.
- Workspace roles are Trading-owned and independent from broad Zitadel product access:
  - owner: workspace/members/sources read-write
  - admin: workspace/members/sources read-write
  - operator: workspace/source read + source write
  - viewer: workspace/source read
  - unknown roles: fail closed
- No workspace role grants `broker.execute`.
- Trading authorization must never query or depend on the MKSaaS database.
- Keep live staging `trading_access_enabled=false` until real positive/negative Zitadel acceptance passes.

Identity spec/plan:
- `docs/superpowers/specs/2026-09-02-mkety-shared-zitadel-enterprise-identity-design.md`
- `docs/superpowers/plans/2026-09-02-mkety-shared-zitadel-enterprise-identity.md`

Other active design/plan docs:
- `docs/superpowers/specs/2026-09-02-multi-source-provider-and-mtproto-runtime-design.md`
- `docs/superpowers/plans/2026-09-02-multi-source-provider-foundation.md`
- `docs/superpowers/specs/2026-09-02-external-mtproto-signed-v1-adapter-design.md`
- `docs/superpowers/plans/2026-09-02-external-mtproto-signed-v1-adapter.md`

Runbooks:
- `cloudflare-v2/docs/STAGING_V1_RUNBOOK.md`
- `cloudflare-v2/docs/NON_LIVE_MULTI_SOURCE_ACCEPTANCE.md`

## Implemented/verified foundation

Already GREEN before the shared-Zitadel slice:
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

## Shared-Zitadel implementation status — 2026-09-02

1. **Architecture approved/planned.** Spec commit `db59d0d…`; plan commit starts `7f1c9fa…`.
2. **Task 1 — subject membership schema GREEN.** Migration `0009_trading_workspace_memberships.sql`. RED `33646617046` @ `f687c9d09fe0c5ff93c05d1a181720895d70f159`: 392 existing tests passed, sole failure migration absent. GREEN `33646729170` @ `471a26615752d5ab0672ba0057f1a2fba84bce4d`, all four gates pass. `0009` is checked in but not yet claimed live-applied.
3. **Task 2 — exact Zitadel-subject membership authorization GREEN.** RED `33647073934` @ `4bb2e9844aac9b6f8cd89783c8c2114edc910f82`: 393 pass with only intended membership-store/gate failures. GREEN `33647392530` @ `f66d806ca9b2ed204c59e417931b8ab5c619d7cf`, all four gates pass. Valid Zitadel identity without exact enabled workspace membership is denied.
4. **Task 3 — workspace role permissions GREEN.** Initial RED `33647710823` @ `a09a4e7…`; final workspace-read RED `33647947785` @ `d4fc01a…` had 404/405 tests passing and sole failure unknown role read. GREEN `33648262293` @ `46a0f038b7c26f66105e515d3b4e5048e91fba05`, all four gates pass.
5. **Task 4 — tenant-safe membership administration GREEN.** RED `33648606711` @ `26d310fa5aa6e7c98d66b04037affb6e3e7fb7d8`: 405 tests pass; only missing admin-store methods and missing membership handler fail. Production adds exact-workspace `listMemberships`, `upsertMembership`, role/enable mutations, owner counting, authenticated routes `GET/POST /api/v1/admin/members` and subject role/enable/disable actions, role validation, Trading-only subjects, independent same-subject multi-workspace membership, permission denial before mutation, and `409 LAST_WORKSPACE_OWNER`. Exact GREEN `33648962778` @ `6a60a457712c858fb2b568b5512ff028ac368f0d`, all four mandatory gates pass.
6. **Task 5 — NOT STARTED.** Next: dual-access acceptance, static MKSaaS-independence contract, operator docs/runbook, final source/CI verification.

## Shared Supabase live state

Connected project previously verified: `Mkety Digital` Trading database.

- Migrations `0001` through `0008` are applied live.
- Migration `0009_trading_workspace_memberships.sql` is checked into the branch but **has not yet been claimed applied live**.
- Do not reapply `0001`-`0008` blindly.
- Existing Trading internal tables are service-role-only with RLS enabled and no anon/authenticated policies.
- `trading_set_default_source` is SECURITY INVOKER, `search_path=''`, service-role only.
- Before `0009` application: source/event/position/delivery/trade-account tables were empty; one `trading_workspace_access` row existed with `trading_access_enabled=false`, `zitadel_org_id=NULL`.
- No source, Telegram, broker, or execution credentials were inserted during migration readiness.

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

Always inspect the exact newest branch-head run before calling the branch green.

## Current priority

1. **Shared-Zitadel Task 5:** write dual-access acceptance proving existing-Mkety logical users and Trading-only users converge on the same Zitadel `sub` + Trading membership gate, with wrong project/org/workspace/disabled membership failing closed.
2. Add static contract proving Trading auth/admin code has no MKSaaS DB dependency and membership provisioning cannot mutate source/destination/trade-account/execution state.
3. Add `SHARED_ZITADEL_ENTERPRISE_IDENTITY.md` and update `STAGING_V1_RUNBOOK.md`.
4. Update active plan and this file; run exact newest-head four-gate CI.
5. Apply/verify migration `0009` to the Trading database when safe, preserving disabled entitlement.
6. Perform real non-live Zitadel project/org/sub acceptance and Cloudflare runtime verification when account-side access exists.
7. Continue MTProto non-live soak and broker demo gates only after identity environment acceptance.
8. Tiny controlled live only after every non-live/demo gate is green and a separate explicit cutover decision.

## Exact next safe starting point

Tasks 1-4 of the shared-Zitadel implementation are source/CI GREEN. Migration `0009` is not yet claimed live-applied.

Start Task 5 with RED acceptance tests only. Do not add more auth/schema behavior unless those tests expose a real gap. No MKSaaS DB dependency, no broker/live execution, no `main` merge.
