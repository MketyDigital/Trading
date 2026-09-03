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

### Explicit Gate 2 acceptance
Real Gate 2 non-broker acceptance is opt-in only with exact commit message:

```text
cloudflare: accept staging gate 2
```

The `cloudflare-accept-gate2` job:
- requires ordinary tests first;
- runs only on the exact active branch using protected environment `staging`;
- requires GitHub staging secret `SUPABASE_SERVICE_ROLE` in addition to the existing Cloudflare credentials;
- generates `TRADING_MASTER_KEY`, source-signing secret, internal transport token, and Trade State token ephemerally inside the runner and masks them;
- temporarily deploys the reviewed Worker with simulation enabled using a runner-only secrets file;
- passes `--containers-rollout none`, so this acceptance run does not update/build/roll out the Container application;
- uses a temporary isolated `external_mtproto` source, never `cloudflare_container_mtproto`;
- sends the same native source event twice through `/api/v1/internal/source-event` and proves the real Queue/consumer path persists exactly one canonical Trading Event;
- runs a separate signed simulation probe against the same temporary source and proves one READY simulation account with three `simulated=true` actions while top-level `executionEnabled=false`;
- uses only a random placeholder broker ciphertext for the disposable simulation account; no live broker credential is present;
- keeps Worker-wide `BROKER_EXECUTION_ENABLED=false`, `TRADING_ACCESS_ENABLED=false`, TradingView direct ingress false, and cert probe false;
- proves the Container application remains `Ready` with `0` live instances;
- deletes temporary acceptance database fixtures in `finally`;
- always rolls the Worker back to known-good version `c25e85d5-bfe2-4d17-9ab4-5133d88ecec8` if the temporary acceptance deployment succeeded.

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
- Worker URL: `https://mkety-copier-engine.dry-glitter-7e16.workers.dev`
- Queue created: `mkety-trading-source-events`
- DLQ created: `mkety-trading-source-events-dlq`
- Container application created: `mkety-copier-engine-mtprotocontainerruntime`
- Producer and consumer attached to the source queue
- schedules deployed: `*/15 * * * *` and `* * * * *`
- all four runtime safety flags remained false

User subsequently verified Cloudflare Container dashboard state after provisioning settled:
- application state: `Ready`
- live instances: `0`

The earlier temporary 7-instance provisioning reading is therefore recorded as rollout/provisioning activity, not persistent application MTProto selection.

### Gate 2 acceptance harness/gate — ready, not yet run

Acceptance harness commit:
`9eb3e26e69d308070515583f0f98e54a1fb19342`

Files prepared for the explicit gate:
- `cloudflare-v2/scripts/gate2_queue_acceptance.mjs`
- `cloudflare-v2/tests/gate2_acceptance_workflow.test.mjs`
- `.github/workflows/trading-v1-ci.yml`

Local RED before implementation proved the new acceptance contract was absent without consuming GitHub Actions or Cloudflare resources. The implementation is marker-gated so ordinary pushes cannot run the Cloudflare acceptance job.

## Gate 2 current status

**PAID STAGING INFRASTRUCTURE DEPLOYED; CONTAINER SETTLED READY/0; ACCEPTANCE HARNESS/GATE IMPLEMENTED; WAITING ONLY FOR `SUPABASE_SERVICE_ROLE` IN GITHUB `staging` BEFORE ONE EXPLICIT ACCEPTANCE RUN.**

Still required before Gate 2 exit:
1. add GitHub environment `staging` secret `SUPABASE_SERVICE_ROLE` without exposing it in chat;
2. create one harmless exact-marker commit `cloudflare: accept staging gate 2`;
3. inspect one acceptance run for Queue dedupe, non-broker simulation, Container Ready/0, cleanup, and rollback;
4. read-only query Supabase after run to prove temporary fixtures were removed;
5. update this file with exact evidence and mark Gate 2 GREEN only if all checks pass.

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
- low-consumption CI GREEN `33721886584` @ `3b6f427760cca72325c1603399f130e7897a8013`

## Exact next safe starting point

Do not run Cloudflare acceptance until GitHub environment `staging` contains `SUPABASE_SERVICE_ROLE`.

After that secret exists:
- use one exact marker commit `cloudflare: accept staging gate 2`;
- inspect the single acceptance run rather than issuing separate deploy/inspect runs;
- if GREEN, prove Supabase cleanup read-only and mark Gate 2 complete;
- if it fails, use existing logs/read-only SQL first and fix only the proven issue, avoiding repeated builds/deployments.