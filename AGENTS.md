# Trading Project Agent Handoff

Operational source of truth for `MketyDigital/Trading`. Read this file before changing the project.

## Hard rules

- Active next-generation work stays in `cloudflare-v2/`.
- Active branch: `design/enterprise-trading-event-core`; draft PR #2 targets `main`.
- Wrangler entrypoint: `cloudflare-v2/src/v1_entry.js`.
- **Never merge `main` without explicit user instruction.**
- Real-money execution remains disabled.
- Never paste, log, or commit broker, database, auth, Telegram-session, provider, Cloudflare, Zitadel, AI, signing, destination, or transport secret values.
- Update this file after every meaningful implementation/testing/environment batch.
- Batch related edits. Avoid unnecessary commits, GitHub Actions runs, Wrangler dry-runs, Container builds, deployments, or account/API calls.
- Prefer read-only evidence and local tests where they are sufficient.
- TDD remains mandatory for production feature/bugfix behavior; configuration changes should still have a regression contract and evidence before claiming success.
- Cloudflare core/security must remain Free-plan-compatible. Workers Paid may add optional capacity, but no trust boundary may depend on Enterprise-only BYOCA or Enterprise-only mTLS trust.
- Cloudflare Containers are optional Paid MTProto capacity only. Merely having the Container binding must never select/start `cloudflare_container_mtproto`; only an exact active source configured with that provider may reach Container bootstrap/runtime.
- `cloudflare-v2/wrangler.toml` is Paid. `cloudflare-v2/wrangler.free.toml` is the isolated no-Container Free-compatible profile.

## Product / tenancy contract

Mkety Trading is an enterprise multi-tenant trading automation product. Isolation is mandatory across workspace, user, source, provider runtime, Telegram session/chat, event, trade account, destination, AI provider, retry, queue, idempotency, Position Group, health, control state, and credentials.

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
- connected broker metadata is authoritative;
- persistent event/destination/order idempotency is mandatory;
- Position Groups support arbitrary TP counts and hedged/netted behavior;
- global kill switch blocks everything; protective management may bypass only ordinary drawdown/open-risk locks;
- preserve raw cTrader `ProtoOASymbol.lotSize` protocol-cent semantics; never add another x100 conversion;
- identity/admin/database/source-adapter/infrastructure work never enables broker execution.

## Identity / database boundary

- Managed Mkety Zitadel is the global identity authority; Trading and MKSaaS remain separate projects/apps and product DBs.
- Immutable Zitadel `sub` is the user key; never email.
- Login alone never grants Trading access.
- `trading_workspace_access` is the Trading entitlement switch.
- `trading_workspace_memberships` is exact `(workspace_id, zitadel_subject)`.
- Workspace roles owner/admin/operator/viewer; unknown fails closed. No workspace role grants broker execution.
- Keep `TRADING_ACCESS_ENABLED=false` until Gate 4 real non-live Zitadel acceptance.
- Supabase Trading migrations through `trading_0010_tradingview_public_source_handle` are already applied/verified; ledger `20260902184215`.
- `anon` and `authenticated` retain no direct internal Trading table authority.

## Deployment profiles

Paid `cloudflare-v2/wrangler.toml`:
- Worker `mkety-copier-engine`
- DOs: `MTPROTO_LISTENER_NAMESPACE`, `TRADE_STATE_NAMESPACE`, optional `MTPROTO_CONTAINER_NAMESPACE`
- Queue `mkety-trading-source-events`
- DLQ `mkety-trading-source-events-dlq`
- Container application `mkety-copier-engine-mtprotocontainerruntime`
- 15-minute scheduler + one-minute Container recovery supervisor

Free `cloudflare-v2/wrangler.free.toml`:
- Worker `mkety-copier-engine-free`
- DOs: `MTPROTO_LISTENER_NAMESPACE`, `TRADE_STATE_NAMESPACE`
- isolated Free queue/DLQ
- no Container declaration/binding/migration/recovery cron
- ordinary 15-minute scheduler only

Both profiles pin these runtime variables fail-closed:

```text
TRADINGVIEW_DIRECT_INGRESS_ENABLED=false
TRADINGVIEW_CERT_PROBE_ENABLED=false
TRADING_ACCESS_ENABLED=false
BROKER_EXECUTION_ENABLED=false
```

## GitHub Actions consumption policy

The user explicitly requested that tiny edits must not cause unnecessary builds, Cloudflare calls, Container builds, or quota/limit consumption.

Current policy in `.github/workflows/trading-v1-ci.yml`:

### Ordinary CI
- automatic only for meaningful code/config/test paths;
- docs-only `AGENTS.md` / `docs/superpowers/**` edits do not trigger branch or PR CI;
- ordinary `test` job runs Node Worker/trading-core, pure MT5 bridge, and both MTProto Python suites;
- ordinary `test` job contains **no Wrangler command, no Cloudflare credential use, no Container image dry-run/build**.

### Explicit Cloudflare inspect
Cloudflare account inspection is opt-in only with exact commit message:

```text
cloudflare: inspect staging gate 2
```

and only on:
`design/enterprise-trading-event-core`

The inspect job:
- uses protected GitHub environment `staging`;
- uses `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` by name only;
- authenticates;
- dry-runs Paid and Free profiles;
- inventories Queues and Container applications;
- inspects Worker histories;
- contains no real deployment command;
- keeps all four safety switches false.

### Explicit Paid deployment
Real Paid staging deploy remains opt-in only with exact commit message:

```text
cloudflare: deploy paid staging gate 2
```

It:
- requires the ordinary test job first;
- uses the exact active branch and protected `staging` environment;
- re-verifies all four fail-closed runtime vars;
- performs one final Paid dry-run;
- deploys Paid only;
- never deploys Free in that job.

`cloudflare-v2/docs/GATE2_PAID_DEPLOY_TRIGGER.md` is the dedicated trigger-document path for explicit Gate 2 marker commits. Do not use random docs edits as trigger commits.

## Gate 2 — Real Cloudflare staging infrastructure

Governing plan:
`docs/superpowers/plans/2026-09-03-production-v1-launch-master-plan.md`

### First real Paid deployment — verified

GitHub Actions run:
`33720102208`

Deployment commit:
`bbba25091eb88778fa7243760b704b0b85ab5c6a`

Results:
- mandatory test job: SUCCESS
- authenticated Cloudflare inspection: SUCCESS
- `cloudflare-deploy-paid`: SUCCESS
- Worker deployed: `mkety-copier-engine`
- Worker version: `c25e85d5-bfe2-4d17-9ab4-5133d88ecec8`
- Worker URL created on workers.dev
- Queue created: `mkety-trading-source-events`
- DLQ created: `mkety-trading-source-events-dlq`
- Container application created: `mkety-copier-engine-mtprotocontainerruntime`
- Producer and consumer attached to the source queue
- schedules deployed: `*/15 * * * *` and `* * * * *`
- all four runtime safety flags remained false

Immediately after deployment Cloudflare reported the Container application as `provisioning` with 7 live instances even though the deployment configuration requested `instances = 0`. This was treated as a Gate 2 stop-condition until settled.

User subsequently verified Cloudflare dashboard state:
- application state: `Ready`
- live instances: `0`

Therefore the earlier 7-instance reading is recorded as transient deployment/provisioning activity, not persistent application MTProto selection. Code-side Container start remains fail-closed: bootstrap requires an active Telegram source with provider type exactly `cloudflare_container_mtproto`, and the runtime only calls `ctx.container.start()` through explicit start/restart paths after valid bootstrap.

## Gate 2 current status

**PAID STAGING INFRASTRUCTURE DEPLOYED; CONTAINER SETTLED READY/0; REMAINING NON-BROKER ACCEPTANCE + ROLLBACK EVIDENCE PENDING.**

Still required before Gate 2 exit:
1. check deployed Worker health/readiness without enabling Trading access, TradingView ingress, cert probe, or broker execution;
2. perform one non-broker simulation event and verify single canonical acceptance/delivery behavior;
3. prove Container non-selection during that non-Container simulation;
4. record prior known-good Worker version and prove rollback path;
5. batch resulting evidence and any necessary implementation changes;
6. update this file after that meaningful batch.

Do not start Gate 3 TradingView certificate acceptance, Gate 4 Zitadel acceptance, broker demos/live execution, or `main` merge until their explicit gates/approval.

## Key historical evidence

- Gate 1 scope freeze GREEN `33695618717` @ `aebec4adf71a7f7299b3279d1b4c8b03803e25be`
- staging bridge RED `33698444759`; implementation GREEN `33698530495`
- authenticated Cloudflare preflight GREEN `33718622191`
- resource inventory GREEN `33718900390`
- Worker-runtime safety GREEN `33719452508`
- one-shot deploy-gate GREEN `33719868426`
- first Paid deployment SUCCESS `33720102208` @ `bbba25091eb88778fa7243760b704b0b85ab5c6a`
- post-deploy Container state manually verified by user: `Ready`, `0` live instances

## Exact next safe starting point

Do **not** trigger another deploy or Cloudflare inspect just to gather routine evidence.

Next:
- use read-only/direct Worker health probing where possible;
- determine the minimum non-broker simulation prerequisites;
- batch any required code/config/test/runbook/AGENTS changes;
- only when account-side verification is actually needed, trigger the exact explicit inspect marker once;
- only deploy again if a proven code/config change requires it.
