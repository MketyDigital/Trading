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

Mkety Trading is an enterprise/custom **multi-tenant** automation platform, not a Telegram-only copier.

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

Key rules:
- multiple source providers may be active simultaneously;
- default source is preference, not exclusivity;
- unconfigured providers are inert;
- redundant provider replays collapse through persistent canonical idempotency after authentication;
- browser/caller workspace/source/bootstrap fields are never authoritative when trusted server-side identity exists;
- source, destination, broker, AI, retry, health, credentials, and control state stay scoped to the smallest responsible integration boundary;
- fan-out destinations succeed/fail/retry independently and never roll back successful siblings;
- retrying a failed destination must not redispatch successful siblings;
- foreign-workspace or duplicate destinations fail locally without blocking valid siblings.

Provider types:
- Telegram: `cloudflare_container_mtproto`, `cloudflare_do_mtproto`, `external_mtproto`
- TradingView: `tradingview_webhook`
- MT5: `mt5_source_bridge`
- cTrader: `ctrader_source`
- custom: `custom_signed_api`

Design/plan:
- `docs/superpowers/specs/2026-09-02-multi-source-provider-and-mtproto-runtime-design.md`
- `docs/superpowers/plans/2026-09-02-multi-source-provider-foundation.md`
- `docs/superpowers/specs/2026-09-02-external-mtproto-signed-v1-adapter-design.md`
- `docs/superpowers/plans/2026-09-02-external-mtproto-signed-v1-adapter.md`
- `docs/superpowers/specs/2026-09-02-mkety-shared-zitadel-enterprise-identity-design.md`
- `docs/superpowers/plans/2026-09-02-mkety-shared-zitadel-enterprise-identity.md`

Runbooks:
- `cloudflare-v2/docs/STAGING_V1_RUNBOOK.md`
- `cloudflare-v2/docs/NON_LIVE_MULTI_SOURCE_ACCEPTANCE.md`

## MTProto availability contract

Preferred first-party runtime: **Cloudflare Container + Telethon**, one Telegram session listening to many configured chats/channels. Pure DO+mtcute and external MTProto remain alternate providers and must never become platform-wide startup dependencies.

Canonical Telegram native identity:

```text
telegram:<accountScope>:<chatId>:<messageId>
```

Required behavior: reconnect/restart recovery, catch-up, receive/downstream decoupling, Queue/retry-safe handoff, provider-independent native identity, persistent duplicate collapse, and secret-free health.

Container disk is ephemeral and never authoritative durable state. DO storage, Supabase event/idempotency state, Queue delivery, and Telegram catch-up/replay are recovery authorities. Do not claim literal zero interruption or zero-loss recovery until real environment soak proves no known lost recoverable event.

Important unresolved environment fact: current in-memory listener retry exhaustion can drop an event from that local queue after bounded retries; durable replay/catch-up/idempotency is the intended recovery path and still requires real reconnect/restart soak.

## Core safety

- Connected broker metadata is authoritative for symbol/precision/tick economics/volume/order/account-mode semantics.
- Clear signals use deterministic processing; bounded AI is only for ambiguity and must pass deterministic validation.
- AI failure cannot block clear deterministic work.
- Formatting is presentation-only.
- Fast-entry policies: `execute_immediately`, `wait_for_complete_signal`, `forward_only`.
- Completed fast signals reuse the executed first leg as TP1 and add only missing targets.
- Position Groups support arbitrary TP counts and hedged/netted behavior.
- Persistent event/destination/order idempotency is mandatory.
- Every trade account requires explicit execution enablement, safety/risk limits, and kill switch before broker dispatch.
- Fail closed on ambiguity, tenant mismatch, provider outage, missing credentials, unreliable broker economics/metadata, invalid correlation, or unknown execution state.
- Global kill switch blocks everything; protective management may bypass only ordinary drawdown/open-risk locks.
- Legacy Telegram remains until V1/source/broker acceptance is satisfactory.
- Critical cTrader rule: preserve raw `ProtoOASymbol.lotSize` protocol-cent semantics; never add another x100 conversion.

## Zitadel authorization contract

- **One managed Mkety Zitadel instance is the global identity authority for MKSaaS and Trading.** Trading is an enterprise Mkety product, not a second identity system.
- MKSaaS and Trading remain separate Zitadel projects/applications and separate product databases.
- A Zitadel subject may have MKSaaS access, Trading access, both, or neither.
- A Trading-only user may authenticate through the same Mkety Zitadel instance without any MKSaaS database row/profile.
- The immutable Zitadel token subject (`sub`) is the cross-product user identity key; never use email as the permanent authorization link.
- Successful Zitadel authentication is not sufficient for Trading access. Trading-owned workspace entitlement/membership must also authorize the exact subject/workspace.
- `trading_workspace_access` remains the workspace/org entitlement switch; `trading_workspace_memberships` is the subject-to-workspace membership boundary.
- JWT issuer, audience, expiry/not-before, signature, workspace entitlement, required role, and workspace-bound Zitadel organization must all verify before admin access.
- When `ZITADEL_PROJECT_ID` is **unset**, the documented generic current-project role claim `urn:zitadel:iam:org:project:roles` may be used.
- When `ZITADEL_PROJECT_ID` is **set**, authorization must use only `urn:zitadel:iam:org:project:<projectId>:roles`; never fall back to the generic current-project claim.
- A role granted for another project or another organization must never authorize the Trading workspace.
- Trading authorization must never depend on the MKSaaS database being available.
- Keep `trading_access_enabled=false` until real negative/positive Zitadel environment tests pass.
- Written identity design: `docs/superpowers/specs/2026-09-02-mkety-shared-zitadel-enterprise-identity-design.md`.

## Verified V1 foundation

Implemented/tested: legacy shadow compatibility; signed `/api/v1/events`; cryptographic Zitadel/workspace authorization; AES-256-GCM secrets; persistent event reservation; deterministic parser + bounded AI; MT5/cTrader/Deriv normalization; metadata-driven risk/account safety; arbitrary-TP Position Groups; durable Trade State; signal/fast-completion/BE/partial/full-close/pending-cancel simulation; signed simulation acceptance; cTrader/MT5 demo acceptance foundations.

Commands:

```text
npm run accept:v1:simulation
npm run accept:ctrader:demo
npm run accept:mt5:demo
npm run soak:mtproto:container
```

No real broker demo order, real Cloudflare Container/DO MTProto E2E, or real-money execution has been performed in this session.

## Multi-source implementation status — 2026-09-02

1. Provider registry + canonical identity — GREEN (`33598572539` @ `7d62761…`).
2. Source registry/default semantics — GREEN; migration `0003` (`33598900292` @ `215c136…`).
3. Cross-provider native-event idempotency — GREEN; migration `0004` (`33599671009` @ `1f846fd…`).
4. Cloudflare Container/Telethon provider skeleton — GREEN.
5. Cloudflare Queue -> signed V1 path — GREEN (`33603127779` @ `837190d…`).
6. MTProto downstream retry isolation — GREEN (`33612304712` @ `7603956…`).
7. Stateful Cloudflare Container supervisor — GREEN (`33613179989` @ `d65a95a…`).
8. Server-side MTProto bootstrap resolver — GREEN; migration `0005` (`33613707938` @ `4cafbcd…`).
9. Tenant-safe Container lifecycle service — GREEN (`33614019384` @ `03c4385…`).
10. Durable per-source MTProto recovery + scheduled recovery — GREEN; migration `0006` (`33615599446` @ `aa34a16…`).
11. Recovery replay acceptance — GREEN (`33615820124` @ `b73abee…`).
12. External MTProto server-side authorization — GREEN (`33623854041` @ `904690f…`).
13. External signed-V1 HTTPS sink — GREEN.
14. Portable external Telethon runtime — GREEN (`33625107407` @ `9fb5850…`).
15. Cross-provider replay + two-workspace isolation — GREEN (`33625278355` @ `c6c2c14…`).
16. External MTProto CI/operator docs — GREEN (`33626149089` @ `e2bc271…`).
17. Heterogeneous source registration/configuration/coexistence — GREEN (`33626927619` @ `a78dc9f…`). Broader-plan Task 7 complete.
18. Pure DO+mtcute alternate provider — GREEN (`33627974053` @ `b15e4b7…`). Broader-plan Task 6 complete.
19. Zitadel-authorized source administration API — RED `33628546167`; GREEN `33628759094` @ `69b3d89…`. Broader-plan Task 8 complete.
20. Task 9 non-live multi-source operational gate — GREEN in source/CI. Soak GREEN `33629585665` @ `276abbc…`; destination-isolation RED `33630032190` @ `7c27ca5…` (378 pass, sole missing fan-out module); exact GREEN `33630219329` @ `fa253f0…`. Broader-plan Task 9 complete at source/CI level.
21. Shared-Supabase privilege hardening — migration `0007`. Initial RED `33631221854` @ `4722d46…`; `trade_accounts` boundary RED `33631450772` @ `5f1d3ea…`; exact GREEN `33631626956` @ `0cb260c…`.
22. Default-source RPC immutable search path — migration `0008`. Security Advisor found the new Trading-owned mutable-search-path warning after `0007`; RED `33632308325` @ `3215ca1…` (385 pass, sole missing `0008`); exact GREEN `33632407746` @ `bd0a737…`, all four mandatory gates passing.
23. **Strict Zitadel project-role isolation — GREEN.** RED `33633081151` @ `aa3db87…`; exact GREEN `33633316579` @ `ff9980d…`.
24. **First-party MTProto component readiness — GREEN.** RED `33640233999` @ `81788d5…`; exact GREEN `33640530231` @ `b96d974…`. Static/source readiness only, not real environment acceptance.
25. **Shared Mkety Zitadel enterprise identity architecture — APPROVED + PLANNED.** One managed Mkety Zitadel instance; MKSaaS/Trading separate products and DBs; Trading-only users allowed without MKSaaS DB records; entitlement-controlled access; Zitadel `sub` is identity key. Spec `db59d0d…`; implementation plan `7f1c9fa…`.
26. **Trading workspace subject-membership schema — GREEN; migration `0009` checked in, NOT yet claimed live-applied.** RED `33646617046` @ `f687c9d09fe0c5ff93c05d1a181720895d70f159`: 392 existing tests passed and sole failure was missing migration `0009`. GREEN `33646729170` @ `471a26615752d5ab0672ba0057f1a2fba84bce4d`, all four mandatory gates passing. New service-only table is `trading_workspace_memberships`, unique by `(workspace_id, zitadel_subject)`, roles owner/admin/operator/viewer, RLS enabled, anon/authenticated revoked, service-role only.

## Shared Supabase state — verified live 2026-09-02

Connected project: `Mkety Digital`.

Migrations `0001` through `0008` are applied live. Migration `0009_trading_workspace_memberships.sql` is checked into the branch but **has not been claimed applied live**. Do not reapply `0001`-`0008` blindly and do not claim `0009` live until the migration ledger/database is verified after application.

Live migration ledger already includes:
- `trading_0003_multi_source_provider_registry`
- `trading_0004_cross_provider_event_identity`
- `trading_0005_mtproto_provider_credentials`
- `trading_0006_mtproto_recovery_state`
- `trading_0007_internal_privilege_hardening`
- `trading_0008_default_source_search_path`

Verified database isolation/security before `0009` application:
- shared `public.workspaces` retains its original 10-column schema;
- V1 auth authority is `trading_workspace_access`, not shared `workspaces`;
- `source_connections` has provider/default/health/recovery/provider-secret fields and family-scoped indexes;
- `trading_events` has persistent `canonical_event_id` uniqueness per workspace;
- `anon` and `authenticated` have no table privileges on existing Trading internal tables;
- `service_role` retains required access;
- RLS is enabled on existing Trading tables and there are zero client policies by design;
- `trading_set_default_source` is SECURITY INVOKER, `search_path=''`, and executable by `service_role` only;
- Security Advisor no longer reports a mutable-search-path warning for this Trading function;
- remaining Trading Advisor notices are intentional INFO `RLS enabled, no policy`; unrelated pre-existing project warnings are out of scope.

Current live data state before `0009` application:
- `source_connections=0`
- `trading_events=0`
- `position_groups=0`
- `position_legs=0`
- `destination_deliveries=0`
- `trade_accounts=0`
- one `trading_workspace_access` row exists and remains `trading_access_enabled=false`, `zitadel_org_id=NULL`.

No source, Telegram, broker, or execution credentials were inserted during staging migration readiness.

## CI rule

Every meaningful branch head must pass:
1. Node Worker/trading-core tests;
2. pure MT5 bridge tests;
3. both MTProto Python suites;
4. Wrangler dry-run.

Recent exact GREEN checkpoints:
- `33630219329` @ `fa253f04eba80354781a91474a237ebd02c51f34`
- `33631626956` @ `0cb260c35d97548d9af6937645df2cb419672f57`
- `33632407746` @ `bd0a737aaa9ff8318cadeefdd96fab6804074fd9`
- `33633316579` @ `ff9980d8fdcc2866ced208842274568c2be56149`
- `33640530231` @ `b96d974051b8b74a5976f4ad9fc7b56f56c1c24c`
- `33646729170` @ `471a26615752d5ab0672ba0057f1a2fba84bce4d`

Always inspect the exact newest branch-head run before calling the branch green.

## External configuration still required

No Cloudflare/Zitadel secrets or account-side runtime settings have been configured through chat, and no Cloudflare/Zitadel connector or installable plugin is available in this session.

Next non-live staging prerequisites:
- finish Tasks 2-5 of `docs/superpowers/plans/2026-09-02-mkety-shared-zitadel-enterprise-identity.md`;
- apply/verify migration `0009` to the Trading database only when the source/CI membership authorization work is ready for staging; preserve the disabled current entitlement;
- configure intended Zitadel Trading project/application and organization/workspace mapping in the existing Mkety Zitadel instance;
- if `ZITADEL_PROJECT_ID` is set, ensure tokens contain the matching project-specific roles claim;
- keep `trading_access_enabled=false` until wrong-project, wrong-org, missing-role, wrong-subject/workspace, disabled-membership, and exact authorized project/org/subject tests pass in the real environment;
- create one deliberately non-live source only after Worker encryption/auth configuration is ready;
- deploy/verify V1 Worker, Queue, Container, DO and cron bindings before first-party Container E2E;
- call `/api/v1/health` after deployment and require `ready=true` plus `mtprotoContainerReady=true` before first-party Container E2E;
- use Telegram test accounts/channels for Container/external/DO reconnect/catch-up/soak;
- run signed V1 simulation acceptance;
- run cTrader/MT5 actual demo probes/lifecycles only with demo credentials and explicit demo gates.

## Current priority

1. **Shared-Zitadel implementation Task 2:** add server-side membership store and require exact enabled `(workspace_id, Zitadel sub)` membership after JWT project/org authentication and before admin operations.
2. Task 3: workspace role permissions independent from broad Zitadel product role.
3. Task 4: tenant-safe membership admin APIs.
4. Task 5: dual-access acceptance + MKSaaS-independence/static docs.
5. Apply/verify `0009` and perform real non-live Zitadel project/org/subject acceptance when account-side access exists.
6. Continue non-live source/MTProto soak and broker demo gates only after identity gate is green.
7. Tiny controlled live only after every non-live/demo gate is green and after separate explicit cutover decision.

## Exact next safe starting point

Task 1 of the shared-Zitadel implementation is source/CI GREEN. Migration `0009` is **not yet claimed live-applied**.

Start Task 2 with exact RED tests:
- create `trading_membership_store.js` only after failing store tests exist;
- make `authorizeV1AdminRequest` authenticate token/project/org first, then resolve exact `auth.subject` membership for the selected Trading workspace;
- missing/disabled/cross-workspace membership must fail before any source/admin operation;
- never use email or query the MKSaaS database;
- preserve `trading_access_enabled=false` in live staging until real authorization acceptance;
- broker execution remains disabled;
- after the batch, rerun all four mandatory gates and update this file plus the implementation plan.
