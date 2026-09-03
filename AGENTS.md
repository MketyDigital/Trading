# Trading Project Agent Handoff

Operational source of truth for `MketyDigital/Trading`. Read this file before changing the project.

## Hard rules

- Active next-generation work stays in `cloudflare-v2/`.
- Active branch: `design/enterprise-trading-event-core`; draft PR #2 targets `main`.
- Wrangler entrypoint: `cloudflare-v2/src/v1_entry.js`.
- **Never merge `main` without explicit user instruction.**
- **Never enable real-money execution without a separate explicit final cutover approval.**
- Never paste, log, or commit broker, database, auth, Telegram-session, provider, Cloudflare, Zitadel, AI, signing, destination, or transport secret values.
- Update this file after every meaningful implementation/testing/environment batch.
- Batch related edits and avoid unnecessary CI, Wrangler, Container, deployment, or account/API consumption.
- Prefer read-only evidence and local tests where sufficient.
- TDD is mandatory for production feature/bugfix behavior; configuration changes require a regression contract and evidence.
- Cloudflare core/security must remain Free-plan-compatible. Workers Paid may add optional capacity, but no trust boundary may depend on Enterprise-only BYOCA or Enterprise-only mTLS trust.
- Cloudflare Containers are optional Paid MTProto capacity only. A Container binding must never itself select/start `cloudflare_container_mtproto`; only an exact active source configured with that provider may reach Container bootstrap/runtime.
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
- Workspace roles: owner/admin/operator/viewer; unknown fails closed. No workspace role grants broker execution.
- Keep `TRADING_ACCESS_ENABLED=false` until Gate 4 real non-live Zitadel acceptance.
- Supabase Trading migrations through `trading_0010_tradingview_public_source_handle` are applied/verified; ledger `20260902184215`.
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

Default fail-closed runtime state:

```text
TRADINGVIEW_DIRECT_INGRESS_ENABLED=false
TRADINGVIEW_CERT_PROBE_ENABLED=false
TRADING_ACCESS_ENABLED=false
BROKER_EXECUTION_ENABLED=false
```

## GitHub Actions consumption policy

`.github/workflows/trading-v1-ci.yml` keeps ordinary CI lightweight:
- automatic only for meaningful code/config/test paths;
- docs-only `AGENTS.md` / `docs/superpowers/**` edits do not trigger branch/PR CI;
- ordinary `test` runs Node Worker/trading-core, pure MT5 bridge, and both MTProto Python suites;
- ordinary `test` contains no Wrangler command, Cloudflare credential use, or Container build.

Gate 2 Cloudflare operations are exact-marker only:
- `cloudflare: inspect staging gate 2`
- `cloudflare: deploy paid staging gate 2`
- `cloudflare: accept staging gate 2`

Gate 3 Cloudflare operations are also exact-marker only:
- `cloudflare: inspect tradingview gate 3` — read-only active-zone inventory only;
- `cloudflare: probe tradingview gate 3` — controlled certificate-probe deployment only after ordinary tests pass.

The Gate 2 acceptance job uses protected GitHub environment `staging`; it never exposes secret values, passes `--containers-rollout none`, keeps all four safety switches false, creates disposable simulation-only fixtures, cleans them in `finally`, and rolls back the Worker after acceptance.

The Gate 3 certificate-probe job is designed to:
- require ordinary CI first and protected GitHub environment `staging`;
- target only `tradingview.mkety.app`;
- perform read-only Worker-domain and DNS conflict checks before any mutation;
- temporarily deploy with `TRADINGVIEW_DIRECT_INGRESS_ENABLED=false`, `TRADINGVIEW_CERT_PROBE_ENABLED=true`, `TRADING_ACCESS_ENABLED=false`, `BROKER_EXECUTION_ENABLED=false`;
- pass `--containers-rollout none`;
- prove a caller-spoofed certificate header still gets HTTP 403;
- observe only sanitized `TRADINGVIEW_CERT_PROBE` metadata through bounded real-time `wrangler tail`;
- require exactly one stable normalized SHA-256 certificate fingerprint from genuine TradingView certificate evidence;
- always roll back to known-good version `c25e85d5-bfe2-4d17-9ab4-5133d88ecec8` after a successful probe deployment.

## Gate 1 — Scope freeze

**GREEN.**

Evidence:
- `33695618717` @ `aebec4adf71a7f7299b3279d1b4c8b03803e25be`

## Gate 2 — Real Cloudflare staging infrastructure

**GREEN / EXITED on 2026-09-03.**

Governing plan:
`docs/superpowers/plans/2026-09-03-production-v1-launch-master-plan.md`

### First real Paid staging deployment

Run `33720102208`
Deployment commit `bbba25091eb88778fa7243760b704b0b85ab5c6a`
Known-good Worker version `c25e85d5-bfe2-4d17-9ab4-5133d88ecec8`
Worker URL `https://mkety-copier-engine.dry-glitter-7e16.workers.dev`

Verified resources:
- Worker `mkety-copier-engine`
- Queue `mkety-trading-source-events`
- DLQ `mkety-trading-source-events-dlq`
- Container application `mkety-copier-engine-mtprotocontainerruntime`
- producer + consumer attached
- schedules `*/15 * * * *` and `* * * * *`
- safety flags remained false

### Final real Gate 2 acceptance

Trigger/head:
`e2e93aaa131ec2149966e8ca2f480d4fdccc300a`

GitHub Actions run:
`33725547513`

Acceptance job:
`100553745522` — **SUCCESS**

Temporary acceptance Worker version:
`2608756e-2096-409d-9a2c-8e678503a4dd`

Exact accepted behavior:
- newly deployed internal transport secret became active before the test proceeded;
- real `/api/v1/internal/source-event` -> Queue -> consumer path accepted the same source event twice;
- exactly one persistent Trading Event remained;
- persisted event reached `processingStatus=READY`;
- direct non-broker simulation reached `SIMULATED`;
- exactly one READY simulation account;
- exactly three actions, all simulated;
- top-level `executionEnabled=false`;
- `brokerExecution=false`;
- Worker-wide `BROKER_EXECUTION_ENABLED=false` throughout;
- TradingView direct ingress false;
- TradingView cert probe false;
- Trading access false.

Acceptance output:

```json
{"ok":true,"gate":2,"queue":{"acceptedTwice":true,"persistentCount":1,"processingStatus":"READY"},"simulation":{"status":"SIMULATED","executionEnabled":false,"readyAccounts":1,"simulatedActions":3},"brokerExecution":false}
```

Container non-selection proof used concrete instance records, not the coarse application summary:
- before: `0` instance records;
- after external-MTProto Queue/simulation acceptance: `0` instance records;
- new instance IDs: `0`;
- final after rollback: `0` instance records.

Rollback proof:
- SUCCESS to `c25e85d5-bfe2-4d17-9ab4-5133d88ecec8` at 100% traffic.

Post-run Supabase cleanup verification:
- temporary `workspaces`: 0
- temporary `trading_workspace_access`: 0
- temporary `source_connections`: 0
- temporary `trade_accounts`: 0
- Gate 2 temporary `trading_events`: 0

Resolved during real acceptance and protected by regression tests:
1. external MTProto fixture now explicitly allowlists its synthetic Telegram chat;
2. workflow waits for new Worker internal transport secret propagation before Queue acceptance;
3. direct external-MTProto simulation includes a valid allowed Telegram `native_identity`;
4. Container non-selection is verified by concrete instance IDs using `wrangler containers instances`, not by a misleading coarse application count.

Gate 2 exit criteria are satisfied: real staging Worker/bindings accepted, Queue/consumer and canonical dedupe accepted, non-broker simulation accepted, Container non-selection proven, cleanup proven, and rollback proven.

## Production launch gates

1. Scope freeze — **GREEN**
2. Real Cloudflare staging infrastructure — **GREEN**
3. TradingView certificate probe/direct ingress acceptance — **CURRENT**
4. Zitadel real non-live identity acceptance
5. Telegram runtime soak
6. MT5/cTrader source acceptance
7. Broker demo destinations
8. End-to-end staging
9. Production operations
10. Tiny controlled cutover

Real-money execution requires separate explicit user approval after all prior gates are GREEN.

## Gate 3 — TradingView real certificate and source acceptance

**CURRENT / CERTIFICATE PROBE BRIDGE PREPARED, REAL CERTIFICATE NOT YET OBSERVED.**

Governing plan:
`docs/superpowers/plans/2026-09-03-production-v1-launch-master-plan.md`

Existing transport/security behavior remains:
- direct ingress requires an exact configured SHA-256 certificate fingerprint;
- only Cloudflare-provided `request.cf.tlsClientAuth` is authoritative;
- ordinary caller headers cannot self-assert certificate verification;
- certificate probe logs only `certPresented`, `fingerprintAvailable`, and normalized SHA-256 fingerprint;
- probe mode returns HTTP 403 before source lookup/queueing;
- no broker authority is present in TradingView ingress.

### Read-only Cloudflare zone discovery — verified

Contract RED:
- commit `2f5b1eef74c08c22070662772f2473a3290c4971`
- run `33726404506`
- 519/520 Node tests passed; only the new missing Gate 3 zone-job contract failed;
- no Cloudflare Gate 3 action ran.

Implementation GREEN:
- commit `f64e6d8659058f9b1f6c3dc94cbe77ecb4f8cba2`
- run `33726560705` — mandatory suites GREEN; all Cloudflare jobs skipped.

Exact marker zone inventory:
- trigger commit `58235313e78afd5626eb6026567b09deda63a3e6`
- run `33726675933`
- protected `cloudflare-inspect-gate3-zones` succeeded;
- mandatory CI also succeeded;
- direct ingress remained OFF;
- cert probe remained OFF;
- no deployment or DNS/custom-domain mutation occurred.

Active zones discovered on the configured Cloudflare account:
- `mkety.app`
- `mkety.com`

Selected dedicated Gate 3 hostname:
`tradingview.mkety.app`

Pinned zone ID for exact conflict checks:
`111e5cbffce119ece633c104a76a9a15`

Reason: TradingView ingress is application infrastructure; use `.app` and keep `.com` cleaner for public/marketing surfaces.

### Certificate-probe bridge — TDD verified, not yet triggered

Probe contract RED:
- commit `ca48048e86fb751778923ca3e56a23c60e6b2c9c`
- run `33726830159`
- new probe contract failed because the job was absent;
- Cloudflare jobs remained skipped.

Probe implementation:
- commit `8d800be21755001dc58590da1beb91f836c47a4c`
- added `cloudflare-probe-gate3-tradingview` exact-marker job.

First ordinary implementation CI:
- run `33727030013` failed only because the test file over-scoped one job block and required a literal hostname where the workflow used fixed `GATE3_HOSTNAME`;
- the probe job and all other Cloudflare jobs were skipped, so no Cloudflare mutation occurred.

Contract-test correction:
- commit `29ca26ec70e0bc7e3d17afb1431ff37a786a5cba`
- run `33727215432` — **SUCCESS**;
- Node Worker/trading-core GREEN;
- pure MT5 bridge GREEN;
- both MTProto Python suites GREEN;
- all Cloudflare jobs, including Gate 3 probe, skipped on this non-marker head.

### Exact next safe action

Use the dedicated trigger document `cloudflare-v2/docs/GATE3_TRADINGVIEW_TRIGGER.md` and one exact marker commit:

```text
cloudflare: probe tradingview gate 3
```

Then inspect that single run. When the step `Start bounded real-time certificate probe and prove spoof rejection` is actively running:
1. trigger exactly one genuine TradingView HTTPS webhook to `https://tradingview.mkety.app/api/v1/webhooks/tradingview/probe`;
2. expect the HTTP response to remain 403 because direct ingress is still disabled/probe-only;
3. require Cloudflare-observed `certPresented=true`, `fingerprintAvailable=true`, and exactly one stable normalized 64-hex SHA-256 fingerprint;
4. allow the workflow to roll back automatically to known-good Worker version;
5. if fingerprint is missing/malformed/unstable, STOP Gate 3 and do not weaken transport authentication.

Only after a genuine stable certificate fingerprint is proven may the next controlled batch pin that fingerprint, disable probe, create a non-execution TradingView source, and temporarily enable direct ingress for dedupe/authority-stripping/source-isolation acceptance.

Do not enable broker execution, Trading access, or real-money behavior as part of Gate 3.