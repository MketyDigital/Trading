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
- Cloudflare infrastructure/security design must use **Free-plan-compatible primitives as the baseline**. Workers Paid may provide capacity/performance benefits, but no Trading trust boundary may depend on Cloudflare Enterprise-only features such as BYOCA or Enterprise-only mTLS trust.
- Cloudflare Containers are an optional Workers Paid MTProto runtime only. A Container binding must never make `cloudflare_container_mtproto` the implicit/default provider and must never start a Container for a source configured as `cloudflare_do_mtproto` or `external_mtproto`.
- `cloudflare-v2/wrangler.toml` is the Workers Paid deployment config and may include the optional Container runtime. `cloudflare-v2/wrangler.free.toml` is the isolated Free-compatible deployment baseline and must contain no Container declaration/binding/migration or Container-recovery cron.

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
- Live Supabase Trading migrations through `trading_0010_tradingview_public_source_handle` are applied/verified as of 2026-09-02. Ledger version for `0010` is `20260902184215`.
- `0010` adds only nullable `source_connections.public_source_handle TEXT` plus unique partial index `idx_source_connections_public_source_handle`; `anon` and `authenticated` still have no `source_connections` table privileges, while `service_role` retains required access.

## MTProto availability contract

Preferred first-party runtime on Workers Paid: Cloudflare Container + Telethon. Pure DO+mtcute and external MTProto are alternate providers and must never become platform-wide startup dependencies. The Free-compatible deployment baseline omits the Container binding entirely and keeps the DO/external provider paths available. Provider selection is explicit per source; merely deploying the Paid Container binding must not start or select a Container.

Canonical Telegram identity:

```text
telegram:<accountScope>:<chatId>:<messageId>
```

Container disk is ephemeral and never authoritative durable state. DO storage, Supabase event/idempotency state, Queue delivery, and Telegram catch-up/replay are recovery authorities. Do not claim literal zero interruption/zero loss until real reconnect/restart soak proves it.

## Implemented foundation

Verified foundations include signed `/api/v1/events`, source HMAC auth, persistent canonical event reservation/idempotency, deterministic parser + bounded AI, encrypted source/provider secrets, MT5/cTrader/Deriv normalization, account safety/risk/kill switch, arbitrary-TP Position Groups, durable Trade State, simulation, destination fan-out isolation, Container Telethon, DO+mtcute, external MTProto signed V1 adapter, source admin, shared-Zitadel memberships, Supabase privilege hardening, isolated MT5/cTrader/custom source capture, and lightweight direct TradingView queue ingress in code.

Active design/plan docs:
- `docs/superpowers/specs/2026-09-02-multi-source-provider-and-mtproto-runtime-design.md`
- `docs/superpowers/plans/2026-09-02-multi-source-provider-foundation.md`
- `docs/superpowers/specs/2026-09-02-external-mtproto-signed-v1-adapter-design.md`
- `docs/superpowers/plans/2026-09-02-external-mtproto-signed-v1-adapter.md`
- `docs/superpowers/specs/2026-09-02-mkety-shared-zitadel-enterprise-identity-design.md`
- `docs/superpowers/plans/2026-09-02-mkety-shared-zitadel-enterprise-identity.md`
- `docs/superpowers/specs/2026-09-02-lightweight-tradingview-direct-ingress-design.md`
- `docs/superpowers/plans/2026-09-02-lightweight-tradingview-direct-ingress-v2.md`
- `docs/superpowers/plans/2026-09-03-production-v1-launch-master-plan.md`
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

## Custom signed API producer isolation — GREEN 2026-09-02

1. Producer RED `33656847755` @ `48d9537a0c72f65b119a60303cb35a7972630bbb`: 458/459 Node tests passed, sole failure was missing `custom_signed_api_producer.js`.
2. Initial implementation `af8329eba16d49697bab85dbcadac29f14adb75b` exposed a test-contract mismatch only: production correctly returned the existing canonical builder error `SOURCE_NATIVE_EVENT_ID_REQUIRED`, while the new test expected an invented error name.
3. Corrected test-contract GREEN `33658279622` @ `1769345919f30f46bc119051f8d63f5863bfa65d`, all four mandatory gates pass.
   - file: `cloudflare-v2/src/sources/nontelegram/custom_signed_api_producer.js`;
   - composes only `createSignedV1SourceClient` + `createNonTelegramSourceRuntime`; no parallel auth stack;
   - caller workspace/source/destination/execution authority is never copied into runtime input;
   - one producer instance closes over one source ID/secret/retry/health state;
   - retry reuses the same normalized event; duplicate is terminal success;
   - invalid caller event fails before transport and cannot poison another event/source;
   - blocked/retrying producer A does not delay producer B;
   - status is secret/source-ID/endpoint free;
   - no database migration, destination coupling, broker command change, execution enablement, or live-money change.

No DB migration, destination coupling, broker command modification, execution enablement, or live-money change was introduced by cTrader/MT5/custom source work.

## Lightweight TradingView direct ingress — CODE + DB GREEN 2026-09-02

The approved direct TradingView trust boundary is implemented in code and is independent of signed external V1 HMAC clients.

- Spec: `docs/superpowers/specs/2026-09-02-lightweight-tradingview-direct-ingress-design.md`.
- Route: `POST /api/v1/webhooks/tradingview/:public_source_handle`.
- Storage migration: `cloudflare-v2/db/migrations/0010_tradingview_public_source_handle.sql`; live Supabase ledger records `trading_0010_tradingview_public_source_handle` version `20260902184215`.
- Live schema verification: `public_source_handle` is nullable `text`; `idx_source_connections_public_source_handle` is a unique partial btree index where handle is non-null.
- Privilege verification after migration: `anon`/`authenticated` have no table privileges on `source_connections`; `service_role` retains required table privileges. Security Advisor adds no TradingView-specific warning; existing Trading-owned RLS/no-client-policy INFO notices remain intentional.
- Source lookup: `getActiveTradingViewSourceByPublicHandle()` resolves only exact active `source_family='tradingview'` + `provider_type='tradingview_webhook'`; it does not decrypt a source secret.
- Transport gate: direct ingress is inert unless `TRADINGVIEW_DIRECT_INGRESS_ENABLED` is explicitly enabled, a SHA-256 client-certificate fingerprint allowlist is configured, Cloudflare `request.cf.tlsClientAuth.certPresented === '1'`, and the Cloudflare-observed `certFingerprintSHA256` exactly matches the configured allowlist after normalization. `certVerified='SUCCESS'` is deliberately **not** required because relying on Cloudflare to trust TradingView's external CA through BYOCA would introduce an Enterprise-only dependency.
- Cloudflare Free compatibility is mandatory for this trust boundary. Do not use BYOCA, Enterprise-only mTLS trust, or another Enterprise-only feature as a prerequisite. Workers Paid can be used for capacity but is not a security dependency.
- Dedicated TradingView-hostname configuration is collection/pass-through, not Cloudflare CA authorization: do not require a WAF `cert_verified` condition for the TradingView route. The request must be allowed to reach the Worker so trusted `request.cf.tlsClientAuth` metadata can be evaluated there; the Worker remains the fingerprint authorization gate.
- A presented but unpinned client certificate must fail with `TRADINGVIEW_TRANSPORT_NOT_VERIFIED`, including when `certVerified` reports an issuer-verification failure. Existing `cloudflare-v2/tests/tradingview_transport.test.mjs` covers this negative case.
- Temporary observation mode: `TRADINGVIEW_CERT_PROBE_ENABLED` is disabled by default and must never be treated as authorization. When enabled, every TradingView POST terminates at HTTP 403 **before** normal transport verification, source-handle/body parsing, database/source lookup, or queueing. Probe mode overrides direct ingress even if both flags are accidentally enabled.
- Probe observations are deliberately narrow: `TRADINGVIEW_CERT_PROBE` logs only `certPresented`, whether a valid normalized SHA-256 fingerprint is available, and that normalized fingerprint when Cloudflare reports a certificate as presented. It never logs subject/issuer, body, source/workspace, broker/destination, credentials, or caller certificate headers; spoofed ordinary headers cannot become probe authority.
- Probe mode must be disabled immediately after the controlled real TradingView certificate observation and before configuring/using direct ingress.
- Ordinary caller headers are never transport authority. There is no reusable secret in the webhook URL or alert body.
- Handler requires stable `event_id`, enforces bounded body size/JSON shape, recursively strips workspace/source/destination/broker/execution/secret/token/password/credential/API-key/private-key authority fields, and queues only a source-native event.
- Successful direct ingress returns `202 { ok: true, queued: true }`; queue/source failures are request-local and do not claim acceptance.
- The queue consumer re-resolves the source server-side and uses the existing signed `/api/v1/events` path; direct ingress does not call interpretation, destination fan-out, broker adapters, or execution code directly.
- Existing dynamic HMAC source auth remains byte-exact and independent.
- Multiple TradingView handles/workspaces remain isolated; same native event ID is scoped by canonical source/workspace identity and one source failure cannot suppress a sibling.
- Production enablement remains **blocked** until the real Cloudflare/TradingView client-certificate presentation and fingerprint behavior are verified non-live on the actual non-Enterprise deployment. If the Worker cannot observe a stable fingerprint for the TradingView-presented certificate, keep ingress disabled and redesign rather than weakening to IP-only or caller-header authentication.
- `cloudflare-v2/docs/NON_LIVE_MULTI_SOURCE_ACCEPTANCE.md` contains the controlled TradingView environment sequence, Free-plan hostname configuration, fail-closed probe procedure, spoof-rejection checks, unpinned-certificate rejection, source-isolation checks, duplicate checks, authority-stripping checks, and stop conditions.

TDD/reconciliation evidence:
- Approved spec head `5c007265c462c7f3aec856e900cf8d51e72df8b3` passed CI (`33660724964`, `33660718778`).
- During plan execution, duplicate tests accidentally assumed alternate names `webhook_handle` / `getActiveTradingViewByHandle`; exact RED `33668236026` @ `7cd66319e312856bceb5255ff0cbb15ecf5930d0` produced 490/493 Node PASS with exactly three duplicate-contract failures. Existing TradingView transport/handler/acceptance/routing tests were already GREEN in that run.
- Root cause was test-contract duplication, not production failure. Tests were aligned to the existing approved `public_source_handle` / `getActiveTradingViewSourceByPublicHandle()` contract; no production/schema duplication was added.
- Reconciliation GREEN `33668462127` @ `8e83294d0578e0278b5f3eea7037faa305fe1503`, all mandatory gates successful.
- First TradingView handoff-doc GREEN `33668686605` @ `54a6155ede8476abcf4d4debe426abbdc390f00c`, all mandatory gates successful.
- Post-Supabase handoff GREEN `33668981424` @ `3626cbe3191c9e95cc9bc5f7a63ee76859efe90e`, all mandatory gates successful.
- Expanded non-live TradingView runbook GREEN `33669172317` @ `deb9b3ee853e5475e454cef1eb75825f00d8be29`, all mandatory gates successful.
- Free-compatible transport RED `33677097755` @ `1f5a04130097df8c20d9ba8843909926bcff21ef`: the new non-Enterprise cases failed exactly because production still required `certVerified='SUCCESS'`.
- Free-compatible transport GREEN `33677199850` @ `6531589c3f5106cf5dddc91080feb34698d09716`: all four mandatory gates passed after removing only the Cloudflare CA-verification requirement while retaining certificate-presentation and exact SHA-256 fingerprint checks.
- Final Free-compatible handoff GREEN `33677530649` @ `cd053e99f11fe680194fff24a09f58adb77e2d5a`: all four mandatory gates passed before the hostname-configuration documentation batch.
- Fail-closed certificate probe RED `33683387828` @ `09959c829d4a975cc8873b7fc125939da3c0ca86`: 496/498 Node tests passed and only the two new probe-observation tests failed because production had no probe observation path yet.
- Fail-closed certificate probe GREEN `33683493798` @ `84bd40e8c714b884f003869693203ea0148e0b85`: all four mandatory gates passed with the probe terminating before source/database/queue work.
- Free-baseline Wrangler RED `33691357344` @ `9d0dafbd097364a96ae153d0252c1d5548d2842c`: 498/499 Node tests passed; the sole failure was the intentionally missing `cloudflare-v2/wrangler.free.toml`.
- Paid+Free deployment GREEN `33691531352` @ `07753802ed80dace07376c3a738d3ff03edcfaa7`: Worker/trading-core, MT5 bridge, both MTProto Python suites, and the combined Wrangler gate passed; that Wrangler gate dry-runs both `wrangler.toml` and `wrangler.free.toml`.
- Production launch Gate 1 scope-freeze GREEN `33695618717` @ `aebec4adf71a7f7299b3279d1b4c8b03803e25be`: Worker/trading-core, MT5 bridge, both MTProto Python suites, and dual Paid+Free Wrangler dry-run all passed after committing the launch master plan and synchronizing the handoff.
- Live Supabase `0010` application/verification completed without creating source rows, credentials, broker settings, destinations, or execution state.

## Cloudflare deployment/provider contract — GREEN 2026-09-02

- `cloudflare-v2/wrangler.toml` remains the Workers Paid deployment config. It retains `MtprotoContainerRuntime`, `MTPROTO_CONTAINER_NAMESPACE`, the Container migration, and the one-minute Container recovery supervisor cron.
- `cloudflare-v2/wrangler.free.toml` is a separate Worker target named `mkety-copier-engine-free`; it contains only the Free-compatible Worker core, SQLite-backed Durable Objects used by the non-Container paths, isolated Free queue/DLQ names, and the ordinary 15-minute scheduler. It contains no `[[containers]]`, no `MTPROTO_CONTAINER_NAMESPACE`, no Container migration, and no one-minute Container recovery cron.
- The Free and Paid queue names are intentionally isolated so an accidental simultaneous deployment cannot make two Workers consume the same source-event queue.
- Container startup is explicit per source. `container_bootstrap.js` server-side resolution requires exact workspace/source identity plus `source_family='telegram'`, `provider_type='cloudflare_container_mtproto'`, and `is_active=true` before a Container namespace is touched.
- Existing Container bootstrap/provider tests prove wrong-provider and disabled/unconfigured sources fail closed before touching a Container binding. A DO or external MTProto source cannot become a Container source merely because the Paid Worker has the binding.
- Do not introduce logic that globally starts Containers on Worker boot, ordinary cron, queue traffic, or the presence of the binding alone. Container lifecycle must remain scoped to explicit active `cloudflare_container_mtproto` sources.
- CI's mandatory Wrangler gate must dry-run both the Paid and Free configs at every meaningful branch head.

## CI rule

Every meaningful branch head must pass:
1. Node Worker/trading-core tests;
2. pure MT5 bridge tests;
3. both MTProto Python suites;
4. Wrangler dry-run of both the Workers Paid config and the Free-compatible config.

Recent exact GREEN checkpoints:
- `33654983528` @ `0027a849fddcf810d6fa541a39b03658773b9925`
- `33655782502` @ `3dcf689b319acc49fd15df7f9174281e48927ade`
- `33656303876` @ `61241796fdc420035e23acfc0d9d744974aff07e`
- `33656669204` @ `5f85bdd209aae1e3ac7461a16a0fe73bc56514e8`
- `33658279622` @ `1769345919f30f46bc119051f8d63f5863bfa65d`
- `33668462127` @ `8e83294d0578e0278b5f3eea7037faa305fe1503`
- `33668686605` @ `54a6155ede8476abcf4d4debe426abbdc390f00c`
- `33668981424` @ `3626cbe3191c9e95cc9bc5f7a63ee76859efe90e`
- `33669172317` @ `deb9b3ee853e5475e454cef1eb75825f00d8be29`
- `33677199850` @ `6531589c3f5106cf5dddc91080feb34698d09716`
- `33677530649` @ `cd053e99f11fe680194fff24a09f58adb77e2d5a`
- `33683493798` @ `84bd40e8c714b884f003869693203ea0148e0b85`
- `33691531352` @ `07753802ed80dace07376c3a738d3ff03edcfaa7`
- `33691801653` @ `1ee0e865939c81c75807d8a0933b0874e79cb008`
- `33695618717` @ `aebec4adf71a7f7299b3279d1b4c8b03803e25be`

Always inspect the exact newest branch-head run before calling the branch green.

## Current priority

1. Execute Gate 2 of `docs/superpowers/plans/2026-09-03-production-v1-launch-master-plan.md`: real Cloudflare staging infrastructure acceptance. Begin with account-side resource/binding names/status only; do not enable TradingView direct ingress or broker execution.
2. Keep direct TradingView ingress disabled until Gate 3 proves real Cloudflare/TradingView TLS client-certificate presentation/fingerprint behavior non-live on the actual non-Enterprise deployment.
3. No Cloudflare Enterprise-only feature may be introduced. In particular, do not use BYOCA or Enterprise mTLS trust; Free-plan-compatible primitives are the baseline.
4. Keep Containers optional and explicit on Workers Paid; never make Container availability a global MTProto dependency and never start a Container for DO/external sources.
5. No Cloudflare or Zitadel account connector/plugin is available in the current session; do not claim account-side verification or invent credentials.
6. When Cloudflare account-side access becomes available, inspect Worker/Queue/binding names/status first, then deploy the exact reviewed staging head with TradingView direct ingress and broker execution disabled.
7. After Gate 2 infrastructure acceptance, execute Gate 3 certificate probe/TradingView acceptance, then Gate 4 Zitadel, Gate 5 Telegram soak, Gate 6 MT5/cTrader sources, Gate 7 broker demo destinations, Gate 8 end-to-end staging, Gate 9 production operations, and Gate 10 controlled cutover.
8. Tiny controlled live still requires a separate explicit user cutover approval after all prior gates are GREEN.

## Exact next safe starting point

Production launch Gate 1 GREEN: `33695618717` @ `aebec4adf71a7f7299b3279d1b4c8b03803e25be`.
Governing launch plan: `docs/superpowers/plans/2026-09-03-production-v1-launch-master-plan.md`.
Live Trading Supabase migration `trading_0010_tradingview_public_source_handle` is applied/verified. No TradingView source row exists.

Next safe source work:
- Gate 2: obtain account-side Cloudflare access/capability and inspect Worker, Queue, DLQ, Durable Object, cron, route/custom-hostname, and optional Container names/status without exposing secret values;
- keep `TRADINGVIEW_DIRECT_INGRESS_ENABLED=false`, `TRADINGVIEW_CERT_PROBE_ENABLED=false`, `trading_access_enabled=false`, and broker/live execution disabled during Gate 2;
- verify the deployed Paid profile retains optional Container semantics while DO/external sources do not start Containers;
- verify the Free profile remains a no-Container baseline with isolated queue/DLQ names;
- send only non-broker/simulation events during infrastructure acceptance;
- do not merge `main` without explicit user instruction.

## Production V1 launch program — IN PROGRESS 2026-09-03

Governing plan: `docs/superpowers/plans/2026-09-03-production-v1-launch-master-plan.md`.

The launch program is the controlling roadmap until general production. Unrelated feature expansion is deferred unless a missing capability is proven necessary to satisfy one of the ten launch gates.

Gate 1 — Freeze Production V1 Scope and Launch Contract: **GREEN**
Evidence: `33695618717` @ `aebec4adf71a7f7299b3279d1b4c8b03803e25be`; all four mandatory gates passed, including dual Paid+Free Wrangler validation.

Production launch gate: **Gate 2 — Real Cloudflare Staging Infrastructure Acceptance**
Status: **BLOCKED ON ACCOUNT-SIDE ACCESS / CAPABILITY**
Exact branch head before this `AGENTS.md` synchronization write: `aebec4adf71a7f7299b3279d1b4c8b03803e25be`
CI/environment evidence: Gate 1 exact-head GREEN `33695618717`; Gate 2 has no account-side Cloudflare evidence yet.
Safety state: `trading_access_enabled=false`; TradingView direct ingress disabled; TradingView certificate probe disabled; broker/live execution disabled.
Blockers: no Cloudflare account connector/plugin is available in the current session, so deployed Worker/Queue/DO/Container/hostname state cannot be truthfully inspected or changed from here. Zitadel account-side acceptance is also unavailable until its environment is accessible.
Exact next safe action: obtain Cloudflare account-side access/capability, then inspect resource names/status only and perform Gate 2 staging deployment/rollback/simulation acceptance without enabling TradingView direct ingress or broker execution.
