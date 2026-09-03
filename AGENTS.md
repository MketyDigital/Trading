# Trading Project Agent Handoff

Operational source of truth for `MketyDigital/Trading`. Read this file before changing the project.

## Hard rules

- Active next-generation work stays in `cloudflare-v2/` unless a deliberate migration says otherwise.
- Preserve the legacy root runtime and `cloudflare-v2/src/index.js` until V1 is independently proven.
- Active branch: `design/enterprise-trading-event-core`; draft PR #2 targets `main`.
- Wrangler entrypoint: `cloudflare-v2/src/v1_entry.js`.
- **Never merge `main` without explicit user instruction.**
- Real-money execution remains disabled.
- TDD is mandatory for feature/bugfix production changes: exact RED first, then exact-head GREEN.
- Never paste, log, or commit broker, database, auth, source, Telegram-session, provider, transport, signing, destination, Cloudflare, Zitadel, or AI secret values.
- Update this file after every meaningful implementation/testing/environment batch with current evidence and the exact next safe action.
- Cloudflare core/security must remain Free-plan-compatible. Workers Paid may add optional capacity, but no trust boundary may depend on Enterprise-only BYOCA or Enterprise-only mTLS trust.
- Cloudflare Containers are optional Workers Paid MTProto capacity only. Merely having the Container binding must never select or start `cloudflare_container_mtproto`; only an exact active source configured with that provider may touch the Container runtime.
- `cloudflare-v2/wrangler.toml` is the Paid profile. `cloudflare-v2/wrangler.free.toml` is the isolated no-Container Free-compatible profile.

## Product / tenancy contract

Mkety Trading is an enterprise multi-tenant trading automation product. Isolation is mandatory across workspace, user, source, provider runtime, Telegram session/chat, event, trade account, destination, AI provider, retry, queue, idempotency, Position Group, health, control state, and credentials. One integration failure must never receive, mutate, stall, disable, reorder, duplicate, roll back, or corrupt unrelated tenants/integrations.

Canonical pipeline:

```text
Source Provider / Adapter
 -> authenticated/versioned Trading Event
 -> persistent canonical event idempotency
 -> deterministic normalization / bounded AI ambiguity resolution
 -> correlation + durable Trade State
 -> canonical intent / management event
 -> deterministic validation
 -> account safety + risk
 -> Position Group / arbitrary TP legs
 -> platform translation
 -> persistent destination idempotency
 -> destination / broker adapter
```

Provider scope:
- Telegram: `cloudflare_container_mtproto`, `cloudflare_do_mtproto`, `external_mtproto`
- TradingView: `tradingview_webhook`
- MT5: `mt5_source_bridge`
- cTrader: `ctrader_source`
- custom: `custom_signed_api`

Core safety:
- deterministic processing handles clear signals; bounded AI is ambiguity-only and must pass deterministic validation;
- connected broker metadata is authoritative for symbols, precision, tick economics, volume/order/account-mode semantics;
- persistent event/destination/order idempotency is mandatory;
- Position Groups support arbitrary TP counts and hedged/netted behavior;
- global kill switch blocks everything; protective management may bypass only ordinary drawdown/open-risk locks;
- critical cTrader rule: preserve raw `ProtoOASymbol.lotSize` protocol-cent semantics; never add another x100 conversion;
- identity/admin/database/source-adapter/infrastructure work never enables broker execution.

## Identity / database boundary

- One managed Mkety Zitadel instance is the global identity authority; Trading and MKSaaS use separate projects/apps and separate product databases.
- Immutable Zitadel `sub` is the Trading user identity key; never email.
- Login alone never grants Trading access.
- `trading_workspace_access` is the Trading entitlement switch; `trading_workspace_memberships` is exact `(workspace_id, zitadel_subject)` membership.
- When `ZITADEL_PROJECT_ID` is configured, only its exact project-specific role claim may authorize.
- Workspace roles are owner/admin/operator/viewer; unknown fails closed. No workspace role grants `broker.execute`.
- Trading auth must never query/depend on the MKSaaS user DB or shared Mkety workspace table.
- Keep `trading_access_enabled=false` / `TRADING_ACCESS_ENABLED=false` until real non-live Zitadel acceptance passes.
- Live Supabase Trading migrations through `trading_0010_tradingview_public_source_handle` are already applied and verified. Ledger version for `0010` is `20260902184215`; do not re-run foundation migrations blindly.
- `anon` and `authenticated` retain no direct internal Trading table authority; service-side access remains the intended model.

## Implemented foundation

PR #2 already contains and has CI evidence for:
- signed `/api/v1/events` and source HMAC authentication;
- persistent canonical event reservation/idempotency and cross-provider native identity;
- deterministic parser plus bounded AI ambiguity path;
- encrypted source/provider credentials;
- account safety/risk/kill switches;
- arbitrary-TP Position Groups and durable Trade State;
- simulation and isolated destination fan-out/retry;
- MT5/cTrader/Deriv symbol/account normalization;
- Container Telethon, DO+mtcute, and external MTProto providers;
- shared-Zitadel Trading memberships/roles;
- Supabase privilege hardening;
- isolated MT5/cTrader/custom source capture/delivery;
- lightweight direct TradingView queue ingress in code, still disabled in real environment.

Historical detailed RED/GREEN evidence remains preserved in prior `AGENTS.md` revisions and git history. Current governing documents are:
- `docs/superpowers/plans/2026-09-03-production-v1-launch-master-plan.md`
- `cloudflare-v2/docs/STAGING_V1_RUNBOOK.md`
- `cloudflare-v2/docs/NON_LIVE_MULTI_SOURCE_ACCEPTANCE.md`
- TradingView / MTProto / Zitadel specs and plans under `docs/superpowers/`.

## Deployment profiles

Paid profile `cloudflare-v2/wrangler.toml`:
- Worker: `mkety-copier-engine`
- DOs: `MTPROTO_LISTENER_NAMESPACE`, `TRADE_STATE_NAMESPACE`, optional `MTPROTO_CONTAINER_NAMESPACE`
- source queue: `mkety-trading-source-events`
- DLQ: `mkety-trading-source-events-dlq`
- optional Container app/image contract: `mkety-copier-engine-mtprotocontainerruntime`
- crons: 15-minute legacy scheduler + one-minute Container recovery supervisor.

Free profile `cloudflare-v2/wrangler.free.toml`:
- Worker: `mkety-copier-engine-free`
- DOs: `MTPROTO_LISTENER_NAMESPACE`, `TRADE_STATE_NAMESPACE`
- source queue: `mkety-trading-source-events-free`
- DLQ: `mkety-trading-source-events-free-dlq`
- **no Container declaration/binding/migration/recovery cron**
- ordinary 15-minute scheduler only.

Paid and Free queues are intentionally isolated; do not make both Workers consume the same queue.

## GitHub → Cloudflare staging bridge

There is no direct Cloudflare connector in the current ChatGPT environment. GitHub Actions is the approved controlled Cloudflare capability.

- GitHub environment: `staging`
- environment secrets referenced by name only: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`
- values must remain masked and must never be copied into chat/docs/issues/PR comments.
- `.github/workflows/cloudflare-staging-gate.yml` is a manual workflow on the PR branch, but GitHub does not surface branch-only `workflow_dispatch` workflows until the workflow exists on the default branch. Do **not** copy/merge it to `main` solely for UI visibility.
- Active PR #2 therefore uses the push-only `cloudflare-inspect` job in `.github/workflows/trading-v1-ci.yml` for account inspection.
- PR-triggered copies skip `cloudflare-inspect`; only direct pushes to `design/enterprise-trading-event-core` may consume the protected staging environment secrets.
- `cloudflare-inspect` has no real deployment command. It authenticates, dry-runs both profiles, inventories queues/containers, inspects both Worker histories, classifies Cloudflare Worker-not-found `10007` as a valid pre-deploy state, and fails closed on other API failures.

Safety environment for Gate 2 remains:

```text
TRADINGVIEW_DIRECT_INGRESS_ENABLED=false
TRADINGVIEW_CERT_PROBE_ENABLED=false
TRADING_ACCESS_ENABLED=false
BROKER_EXECUTION_ENABLED=false
```

## CI rule

Every meaningful branch head must pass:
1. Node Worker/trading-core tests;
2. pure MT5 bridge tests;
3. both MTProto Python suites;
4. Wrangler dry-run of Paid and Free configs.

Always inspect the exact newest branch-head run before calling the branch GREEN.

Key recent evidence:
- Gate 1 scope freeze: GREEN `33695618717` @ `aebec4adf71a7f7299b3279d1b4c8b03803e25be`.
- manual staging bridge contract RED: `33698444759` @ `189f86c5cfb6e74e71323b7db081395e84cdb13f`.
- manual staging bridge implementation GREEN: `33698530495` @ `d8af226cc0ee1117cfd404d0f98aaaec6ffccff3`.
- PR-branch inspect fallback RED: `33718333743` @ `d9a1920f168ff338e83512215d2d6067ece2b3be` — 506/507 Node tests passed; sole failure was the intentionally absent inspect job.
- authenticated account preflight GREEN: `33718622191` @ `aa05a902006001845826dd9a70c9374350350000` — Cloudflare auth, both profile dry-runs, and both absent Worker classifications passed.
- resource-inventory RED: `33718839137` @ `0c2aad135ce961cb0385c9d769fcbef5898fafc7` — new read-only Queue/Container inventory contract was intentionally absent.
- resource-inventory GREEN: push run `33718900390` @ `31281abd511e80c9b37cf2dc1c4d75f38f5637ee` — mandatory CI and real Cloudflare inspect both passed.

## Gate 2 — Real Cloudflare Staging Infrastructure Acceptance

Governing plan: `docs/superpowers/plans/2026-09-03-production-v1-launch-master-plan.md`.

Current status: **ACCOUNT AUTH + COLLISION INVENTORY GREEN; FIRST STAGING DEPLOYMENT NOT YET PERFORMED.**

Real account evidence from `33718900390`:
- `wrangler whoami`: authenticated successfully through the dedicated Account API Token;
- Paid Wrangler dry-run: GREEN;
- Free Wrangler dry-run: GREEN;
- `wrangler queues list`: completed successfully and returned no existing Queues;
- `wrangler containers list`: completed successfully and returned `No containers found.`;
- Paid Worker `mkety-copier-engine`: Cloudflare code `10007`, correctly classified as **not deployed yet**;
- Free Worker `mkety-copier-engine-free`: Cloudflare code `10007`, correctly classified as **not deployed yet**;
- therefore there are no account-side naming collisions with the planned Paid/Free Workers, source queues/DLQs, or optional Container application at this point;
- no Worker, Queue, DLQ, DO namespace, Container app, route, hostname, source, or broker execution state was created by the inspection batch.

Authenticated dry-run confirmed expected capability shape:
- Paid exposes `MTPROTO_LISTENER_NAMESPACE`, `TRADE_STATE_NAMESPACE`, optional `MTPROTO_CONTAINER_NAMESPACE`, queue `mkety-trading-source-events`, and the Container build contract;
- Free exposes `MTPROTO_LISTENER_NAMESPACE`, `TRADE_STATE_NAMESPACE`, queue `mkety-trading-source-events-free`, and no Container binding.

## First staging deployment prerequisite

Do **not** deploy a half-configured Worker merely because Cloudflare resource names are free.

`cloudflare-v2/docs/STAGING_V1_RUNBOOK.md` requires server-side runtime configuration before meaningful non-live health/identity acceptance, including capability names such as:
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE` (or supported service-role alias)
- `TRADING_MASTER_KEY`
- `TRADE_STATE_INTERNAL_TOKEN`
- later Zitadel values: `ZITADEL_ISSUER`, `ZITADEL_AUDIENCE`, `ZITADEL_JWKS_URL`, `ZITADEL_PROJECT_ID`
- simulation context later requires `TRADING_V1_SIMULATION_INSTRUMENTS` and `TRADING_V1_SIMULATION_PRICES`.

Never commit these secret values. Cloudflare account authentication secrets are not substitutes for Worker runtime secrets.

Before the first real Gate 2 deploy, verify the exact runtime secrets/vars already present vs missing by **name only**, choose the intended staging profile (Paid is the profile needed to prove optional Container semantics), and provision only the minimum non-live runtime configuration required for health/infrastructure acceptance. TradingView, Trading entitlement, simulation, and broker execution must remain disabled unless the relevant later acceptance step explicitly enables them.

## Exact next safe starting point

1. Inspect/prove required Worker runtime configuration presence by **name only** through the GitHub→Cloudflare bridge; never output values.
2. Determine which required Gate 2 core settings are missing. Do not create source rows or broker destinations yet.
3. Provision missing staging runtime secrets/vars through the controlled Cloudflare/GitHub secret-management path, keeping all four safety gates false.
4. Deploy the exact reviewed **Paid staging profile** only after core runtime readiness is sufficient for `/api/v1/health` infrastructure acceptance.
5. Verify Worker, queue/DLQ, DO bindings, crons, and optional Container capability after deployment.
6. Prove DO/external traffic does not start Containers; only a deliberately configured active Container source may touch Container bootstrap.
7. Send only non-broker/simulation acceptance traffic when the runbook reaches that step.
8. Prove rollback to the prior known-good deployment before closing Gate 2.
9. Do not begin Gate 3 TradingView certificate acceptance, Gate 4 Zitadel acceptance, or any broker demo/live work early.
10. Do not merge `main` without explicit user instruction.
