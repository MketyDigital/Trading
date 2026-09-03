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

PR #2 already contains and has CI evidence for signed V1 ingest/HMAC, persistent canonical idempotency, deterministic+bounded-AI interpretation, encrypted credentials, account safety/risk/kill switches, arbitrary-TP Position Groups, durable Trade State, simulation, isolated destination fan-out, MT5/cTrader/Deriv normalization, Container/DO/external MTProto providers, shared-Zitadel Trading memberships, Supabase privilege hardening, isolated MT5/cTrader/custom source capture, and disabled-by-default direct TradingView queue ingress.

Historical detailed RED/GREEN evidence remains preserved in prior `AGENTS.md` revisions and git history. Current governing documents are:
- `docs/superpowers/plans/2026-09-03-production-v1-launch-master-plan.md`
- `cloudflare-v2/docs/STAGING_V1_RUNBOOK.md`
- `cloudflare-v2/docs/NON_LIVE_MULTI_SOURCE_ACCEPTANCE.md`
- TradingView / MTProto / Zitadel specs and plans under `docs/superpowers/`.

## Deployment profiles

Paid profile `cloudflare-v2/wrangler.toml`:
- Worker `mkety-copier-engine`;
- DOs `MTPROTO_LISTENER_NAMESPACE`, `TRADE_STATE_NAMESPACE`, optional `MTPROTO_CONTAINER_NAMESPACE`;
- source queue `mkety-trading-source-events`, DLQ `mkety-trading-source-events-dlq`;
- optional Container image contract `mkety-copier-engine-mtprotocontainerruntime`;
- 15-minute scheduler + one-minute Container recovery supervisor.

Free profile `cloudflare-v2/wrangler.free.toml`:
- Worker `mkety-copier-engine-free`;
- DOs `MTPROTO_LISTENER_NAMESPACE`, `TRADE_STATE_NAMESPACE`;
- source queue `mkety-trading-source-events-free`, DLQ `mkety-trading-source-events-free-dlq`;
- **no Container declaration/binding/migration/recovery cron**;
- ordinary 15-minute scheduler only.

Paid and Free queues are intentionally isolated.

Both profiles now pin these Worker-runtime vars explicitly fail-closed:

```text
TRADINGVIEW_DIRECT_INGRESS_ENABLED=false
TRADINGVIEW_CERT_PROBE_ENABLED=false
TRADING_ACCESS_ENABLED=false
BROKER_EXECUTION_ENABLED=false
```

This is defense-in-depth at the actual Worker deployment configuration, not merely GitHub process environment state.

## GitHub → Cloudflare staging bridge

There is no direct Cloudflare connector in the current ChatGPT environment. GitHub Actions is the approved controlled Cloudflare capability.

- GitHub environment `staging` contains `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` by name only; values stay masked.
- branch-only manual workflow `.github/workflows/cloudflare-staging-gate.yml` is not surfaced by GitHub until present on the default branch; do not merge/copy it to `main` merely for UI visibility.
- active PR #2 uses push-only `cloudflare-inspect` in `.github/workflows/trading-v1-ci.yml`.
- PR-triggered copies skip Cloudflare account access; only direct pushes to `design/enterprise-trading-event-core` may consume the protected staging environment.
- inspector authenticates, dry-runs both profiles, inventories queues/containers, inspects Worker histories, treats only Cloudflare code `10007` as valid undeployed state, and fails closed on other API errors.
- inspect job contains no real deployment command.

## CI rule

Every meaningful branch head must pass:
1. Node Worker/trading-core tests;
2. pure MT5 bridge tests;
3. both MTProto Python suites;
4. Wrangler dry-run of Paid and Free configs.

Always inspect the exact newest branch-head run before calling the branch GREEN.

Key current evidence:
- Gate 1 scope freeze GREEN `33695618717` @ `aebec4adf71a7f7299b3279d1b4c8b03803e25be`.
- staging bridge RED `33698444759` @ `189f86c5cfb6e74e71323b7db081395e84cdb13f`; implementation GREEN `33698530495` @ `d8af226cc0ee1117cfd404d0f98aaaec6ffccff3`.
- PR-branch inspect RED `33718333743` @ `d9a1920f168ff338e83512215d2d6067ece2b3be`; authenticated account preflight GREEN `33718622191` @ `aa05a902006001845826dd9a70c9374350350000`.
- resource inventory RED `33718839137` @ `0c2aad135ce961cb0385c9d769fcbef5898fafc7`; resource inventory GREEN `33718900390` @ `31281abd511e80c9b37cf2dc1c4d75f38f5637ee`.
- Worker-runtime safety-var RED `33719360745` @ `6499d6ce8bf88a18d9326de72e332fccd5c1142e`: 509/510 Node tests passed; sole failure was absent explicit runtime safety vars.
- Paid safety vars added `92cd40b6a6fe68daccadbacafde299f69f7f8625`; Free safety vars added `475ac52f24d4db80892bbc48b1f296f9cd462a0b`.
- exact-head safety-var GREEN `33719452508` @ `475ac52f24d4db80892bbc48b1f296f9cd462a0b`: full test job GREEN and authenticated `cloudflare-inspect` GREEN, including both real-account dry-runs and clean inventory.

## Gate 2 — Real Cloudflare Staging Infrastructure Acceptance

Governing plan: `docs/superpowers/plans/2026-09-03-production-v1-launch-master-plan.md`.

Current status: **ACCOUNT AUTH + COLLISION INVENTORY + RUNTIME SAFETY CONFIG GREEN; FIRST PAID STAGING DEPLOYMENT PENDING.**

Real Cloudflare account state most recently confirmed:
- authenticated dedicated Account API Token works;
- Paid/Free dry-runs work against the account;
- no existing Queues;
- no Container applications;
- neither planned Worker exists (`10007` undeployed state);
- no naming collisions found;
- no real Worker/Queue/DLQ/DO/Container infrastructure has yet been created by Gate 2.

`cloudflare-v2/src/config/staging_readiness.js` reports full application readiness using Supabase, Zitadel and optional simulation/runtime config names. **Do not confuse full application readiness with Gate 2 infrastructure deployment readiness:** Zitadel acceptance belongs to Gate 4. The first Gate 2 deployment may intentionally expose missing readiness names through health while authentication/TradingView/broker execution remain disabled.

Never commit runtime secret values. Cloudflare account API credentials are not Worker runtime secrets.

## Exact next safe starting point

1. TDD a one-shot **Paid-only staging deployment gate** in the active branch CI. It must require the exact PR branch, protected `staging` environment, successful mandatory tests, an explicit one-shot trigger marker, and a final pre-deploy Paid dry-run.
2. The deployment job may run real `wrangler deploy --config wrangler.toml` only for the Paid profile; it must contain no real Free deployment command.
3. Keep all four Worker runtime safety vars pinned `false`; do not create source rows, destinations, TradingView handles, or broker execution state.
4. Use a separate harmless trigger commit only after the deployment-job contract is GREEN, so implementation commits cannot accidentally deploy.
5. Observe the first real deployment result rather than guessing whether Cloudflare requires queue/DLQ pre-creation or additional write permissions. If it fails, treat the exact Cloudflare error as Gate 2 evidence and fix minimally.
6. After deployment succeeds, verify Worker, queue/DLQ, DO bindings, crons, optional Container application/capability, and that no Container instance starts merely because the binding exists.
7. Only then perform non-broker health/simulation infrastructure acceptance and prove rollback.
8. Gate 3 TradingView certificate acceptance, Gate 4 Zitadel, broker demos/live, and `main` merge remain out of scope until their explicit gates/approval.
