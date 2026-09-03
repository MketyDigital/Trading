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

The Gate 2 acceptance job uses protected GitHub environment `staging`; it never exposes secret values, passes `--containers-rollout none`, keeps all four safety switches false, creates disposable simulation-only fixtures, cleans them in `finally`, and rolls back the Worker after acceptance.

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

## Gate 3 — exact next safe starting point

TradingView certificate/direct-ingress acceptance is next.

Rules:
- broker execution remains OFF;
- Trading access remains OFF;
- begin with `TRADINGVIEW_DIRECT_INGRESS_ENABLED=false`;
- enable `TRADINGVIEW_CERT_PROBE_ENABLED=true` only temporarily for certificate observation;
- use a dedicated webhook hostname/path as designed;
- do not use BYOCA or Enterprise-only mTLS trust;
- a genuine TradingView webhook must expose sanitized `request.cf.tlsClientAuth` with `certPresented=true` and a stable normalized 64-hex SHA-256 certificate fingerprint;
- spoof attempts must fail closed;
- if fingerprint is absent or unstable, STOP and redesign; never weaken to IP-only, client header, body secret, or URL-secret trust;
- after observation, disable probe and pin only the exact observed fingerprint;
- controlled direct ingress remains non-execution only;
- prove duplicate `event_id` collapse and second-source isolation;
- disable direct ingress again after acceptance unless separately reviewed.

Relevant existing docs/code:
- `docs/superpowers/plans/2026-09-02-lightweight-tradingview-direct-ingress-v2.md`
- `docs/superpowers/specs/2026-09-02-lightweight-tradingview-direct-ingress-design.md`
- `cloudflare-v2/src/http/tradingview_webhook.js`
- `cloudflare-v2/src/security/tradingview_transport.js`
- existing TradingView transport/webhook/ingress acceptance tests.

Before changing Gate 3 configuration, inspect the existing plan/code and build one explicit low-consumption acceptance bridge rather than enabling direct ingress ad hoc.