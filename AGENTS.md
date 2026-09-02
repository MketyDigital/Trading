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

- JWT issuer, audience, expiry/not-before, signature, workspace entitlement, required role, and workspace-bound Zitadel organization must all verify before admin access.
- When `ZITADEL_PROJECT_ID` is **unset**, the documented generic current-project role claim `urn:zitadel:iam:org:project:roles` may be used.
- When `ZITADEL_PROJECT_ID` is **set**, authorization must use only `urn:zitadel:iam:org:project:<projectId>:roles`; never fall back to the generic current-project claim.
- A role granted for another project or another organization must never authorize the Trading workspace.
- Keep `trading_access_enabled=false` until real negative/positive Zitadel environment tests pass.

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
23. **Strict Zitadel project-role isolation — GREEN.** Current Zitadel docs distinguish generic current-project roles from explicit project-ID roles. RED `33633081151` @ `aa3db87a2eb9cef89050da6cd582993718baaa77`: 387 pass, sole failure proved a configured project ID incorrectly fell back to the generic role claim. Production fix `ff9980d8fdcc2866ced208842274568c2be56149` makes a configured `ZITADEL_PROJECT_ID` require the exact project-specific role claim while preserving generic-claim behavior when no project ID is configured. Exact GREEN `33633316579`, all four mandatory gates passing.
24. **First-party MTProto component readiness — GREEN.** `/api/v1/health` now reports first-party Container readiness independently from core V1 readiness. Required runtime dependencies are checked by configuration name only: `MTPROTO_CONTAINER_NAMESPACE`, `MTPROTO_INTERNAL_SOURCE_URL`, `INTERNAL_SOURCE_TRANSPORT_TOKEN`, and `SOURCE_EVENT_QUEUE`, in addition to existing core requirements. Missing Container/Telegram runtime configuration does not degrade unrelated core V1 health. RED `33640233999` @ `81788d52d7f43162264427e674d1081e8cb34d0d`: 388 existing tests passed and only the four new readiness assertions failed. Exact GREEN `33640530231` @ `b96d974051b8b74a5976f4ad9fc7b56f56c1c24c`, all four mandatory gates passing. This is static/source readiness only, not real Cloudflare/Zitadel environment acceptance.

## Shared Supabase state — verified live 2026-09-02

Connected project: `Mkety Digital`.

Migrations `0001` through `0008` are now applied. The live migration ledger explicitly includes:
- `trading_0003_multi_source_provider_registry`
- `trading_0004_cross_provider_event_identity`
- `trading_0005_mtproto_provider_credentials`
- `trading_0006_mtproto_recovery_state`
- `trading_0007_internal_privilege_hardening`
- `trading_0008_default_source_search_path`

Do **not** reapply them blindly.

Verified database isolation/security:
- shared `public.workspaces` retains its original 10-column schema;
- V1 auth authority is `trading_workspace_access`, not shared `workspaces`;
- `source_connections` has provider/default/health/recovery/provider-secret fields and family-scoped indexes;
- `trading_events` has persistent `canonical_event_id` uniqueness per workspace;
- `anon` and `authenticated` have no table privileges on `trading_workspace_access`, `source_connections`, `trading_events`, `position_groups`, `position_legs`, `destination_deliveries`, or `trade_accounts`;
- `service_role` retains required access;
- RLS is enabled on all seven Trading tables and there are zero client policies by design;
- `trading_set_default_source` is SECURITY INVOKER, `search_path=''`, and executable by `service_role` only;
- Security Advisor no longer reports a mutable-search-path warning for this Trading function;
- remaining Trading Advisor notices are intentional INFO `RLS enabled, no policy`; unrelated pre-existing project warnings are out of scope.

Current data state:
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

Always inspect the exact newest branch-head run before calling the branch green.

## External configuration still required

Supabase migration readiness is complete. No Cloudflare/Zitadel secrets or account-side runtime settings have been configured through chat, and no Cloudflare/Zitadel connector or installable plugin is available in this session.

Next non-live staging prerequisites:
- configure intended Zitadel organization/workspace mapping;
- decide whether the deployment uses an explicit `ZITADEL_PROJECT_ID`; if set, ensure tokens contain the matching project-specific roles claim;
- keep `trading_access_enabled=false` until wrong-project, wrong-org, missing-role, and exact authorized project/org tests pass;
- create one deliberately non-live source with encrypted server-side credentials only when the Worker encryption/auth configuration is ready;
- deploy/verify V1 Worker, Queue, Container, DO and cron bindings before first-party Container E2E;
- call `/api/v1/health` after deployment and require `ready=true` plus `mtprotoContainerReady=true` before first-party Container E2E; inspect missing configuration names only, never values;
- use Telegram test accounts/channels for Container/external/DO reconnect/catch-up/soak;
- run signed V1 simulation acceptance;
- run cTrader/MT5 actual demo probes/lifecycles only with demo credentials and explicit demo gates.

## Current priority

1. **Non-live authorization/runtime configuration**: verify real Zitadel project/org/role mapping and Worker/Cloudflare readiness without enabling real execution.
2. Configure one non-live source identity with strict tenant/chat scope and encrypted credentials.
3. Run signed V1 + MTProto non-live soak/replay/isolation acceptance.
4. Run cTrader/MT5 demo probes/lifecycles behind existing explicit demo-only gates.
5. Tiny controlled live only after every non-live/demo gate is green and after a separate explicit cutover decision.

## Exact next safe starting point

Shared-Supabase migrations/readiness are complete through `0008`; static Zitadel project-role isolation is fail-closed; first-party MTProto component readiness is now exposed independently through `/api/v1/health`. Do not add more schema/provider/fan-out/auth/readiness code speculatively.

Start with real non-live auth/runtime readiness when account access exists:
- inspect actual Worker/Cloudflare deployment/bindings and Zitadel configuration by **configuration names/status only**, never secret values;
- verify `/api/v1/health` reports `ready=true` and inspect `mtprotoContainerReady`/`mtprotoContainerMissing` independently so an optional Telegram runtime never becomes a global V1 dependency;
- verify exact project-specific role behavior if `ZITADEL_PROJECT_ID` is configured;
- keep the existing Trading entitlement disabled until exact organization/role/project authorization is verified;
- do not create a live trade account or enable broker execution;
- Cloudflare/Zitadel account access is unavailable in the current session, so stop short of claiming environment acceptance and continue only with static work directly required by a newly identified environment gate;
- after any repo change, rerun all four mandatory CI gates.
