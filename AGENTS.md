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
- TDD is mandatory for production/config behavior: prove RED first, then exact GREEN.
- Do not claim a branch head GREEN without exact-head verification.
- Cloudflare core/security must remain Free-plan-compatible. No trust boundary may depend on Enterprise-only BYOCA or Enterprise-only mTLS trust.
- Cloudflare Containers are optional Paid MTProto capacity only and may be reached only by an exact active `cloudflare_container_mtproto` source.
- `cloudflare-v2/wrangler.toml` is Paid; `cloudflare-v2/wrangler.free.toml` is the isolated no-Container Free-compatible profile.
- Trading infrastructure uses the `mkety.com` domain family. The Trading application hostname is **`trade.mkety.com`**.
- `mkety.app` is reserved for customer-owned apps/builds under the main Mkety/MKSaaS product and must not be used for Trading infrastructure.

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

## Deployment profiles and default safety

Paid `cloudflare-v2/wrangler.toml`:
- Worker `mkety-copier-engine`
- DOs `MTPROTO_LISTENER_NAMESPACE`, `TRADE_STATE_NAMESPACE`, optional `MTPROTO_CONTAINER_NAMESPACE`
- Queue `mkety-trading-source-events`
- DLQ `mkety-trading-source-events-dlq`
- Container application `mkety-copier-engine-mtprotocontainerruntime`
- 15-minute scheduler + one-minute Container recovery supervisor

Free `cloudflare-v2/wrangler.free.toml`:
- Worker `mkety-copier-engine-free`
- DOs `MTPROTO_LISTENER_NAMESPACE`, `TRADE_STATE_NAMESPACE`
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

## GitHub Actions policy

`.github/workflows/trading-v1-ci.yml` keeps ordinary CI lightweight. Ordinary `test` runs Node Worker/trading-core, pure MT5 bridge, and both MTProto Python suites. Ordinary test runs contain no Cloudflare mutation.

Gate 2 markers:
- `cloudflare: inspect staging gate 2`
- `cloudflare: deploy paid staging gate 2`
- `cloudflare: accept staging gate 2`

Gate 3 markers:
- `cloudflare: inspect tradingview gate 3` — read-only zone inventory
- `cloudflare: probe tradingview gate 3` — controlled certificate-probe deployment only after mandatory tests pass

The Gate 3 probe job:
- uses protected environment `staging`;
- targets only `trade.mkety.com` in the owned `mkety.com` zone;
- checks Worker-domain and DNS conflicts read-only before mutation;
- temporarily enables only `TRADINGVIEW_CERT_PROBE_ENABLED=true` while direct ingress, Trading access, and broker execution remain false;
- passes `--containers-rollout none`;
- requires a spoofed client-certificate header to receive HTTP 403;
- observes only sanitized `TRADINGVIEW_CERT_PROBE` metadata through bounded `wrangler tail`;
- requires exactly one stable normalized SHA-256 fingerprint from genuine TradingView certificate evidence;
- rolls back to known-good Worker version `c25e85d5-bfe2-4d17-9ab4-5133d88ecec8` after any successful temporary probe deployment.

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

## Gate 1 — Scope freeze

**GREEN.** Evidence: run `33695618717` @ `aebec4adf71a7f7299b3279d1b4c8b03803e25be`.

## Gate 2 — Real Cloudflare staging infrastructure

**GREEN / EXITED on 2026-09-03.**

Governing plan: `docs/superpowers/plans/2026-09-03-production-v1-launch-master-plan.md`.

First Paid staging deployment:
- run `33720102208`
- deployment commit `bbba25091eb88778fa7243760b704b0b85ab5c6a`
- known-good Worker version `c25e85d5-bfe2-4d17-9ab4-5133d88ecec8`
- Worker URL `https://mkety-copier-engine.dry-glitter-7e16.workers.dev`

Final Gate 2 acceptance:
- trigger/head `e2e93aaa131ec2149966e8ca2f480d4fdccc300a`
- run `33725547513`
- job `100553745522` — **SUCCESS**
- temporary acceptance Worker version `2608756e-2096-409d-9a2c-8e678503a4dd`
- real internal handoff -> Queue -> consumer accepted same event twice with exactly one persistent Trading Event
- event reached `READY`; non-broker simulation reached `SIMULATED`
- exactly one READY simulation account and three simulated actions
- `executionEnabled=false`, `brokerExecution=false`
- all four launch safety gates remained false
- Container instance records before/after/final: 0/0/0
- rollback to known-good Worker succeeded at 100% traffic
- temporary Supabase fixtures were cleaned to zero

Gate 2 is complete; do not redo it.

## Gate 3 — TradingView real certificate and source acceptance

**CURRENT / FIRST REAL PROBE FAILED CLOSED; DIAGNOSTIC RERUN READY, GENUINE CERTIFICATE NOT YET PROVEN.**

### Domain and zone evidence

Read-only inventory proved the configured Cloudflare account owns both `mkety.app` and `mkety.com`. Trading uses only `mkety.com`; `mkety.app` remains reserved for MKSaaS/customer builds.

Current Gate 3 target:
- hostname `trade.mkety.com`
- zone ID `98c7228a0457b1f454881c149e2df6ce`

Trading-hostname correction TDD:
- RED `e0945a97f3d756cfba46e10787b2e289cdd0e613`, run `33727975091`: 520/522 Node tests; only stale old-host references failed; no Cloudflare action ran
- GREEN `26e2e7e789319a5ef81f7b8870bd36c53c7a77f1`, run `33728255826`: mandatory suites GREEN; all Cloudflare jobs skipped
- documentation boundary head `cbc00eaf01c5352e95d5b140f1e83040fa7bbcaa`, run `33728466285`: exact-head GREEN

### First real certificate probe — fail-closed, rollback proven

Trigger:
- commit `983bf36732a37a787cc253fec391a6a18d6c4517`
- exact message `cloudflare: probe tradingview gate 3`
- run `33728657084`
- probe job `100563529178`

Observed behavior:
- mandatory CI GREEN before probe
- `trade.mkety.com` temporary probe deployment succeeded
- spoofed caller certificate header received expected HTTP 403
- bounded five-minute tail found **0 usable SHA-256 fingerprints**
- certificate requirement failed closed; direct ingress was never enabled
- rollback and rollback verification both succeeded to `c25e85d5-bfe2-4d17-9ab4-5133d88ecec8` at 100% traffic
- Trading access and broker execution stayed disabled
- no secret value was exposed

The first probe cannot distinguish whether no genuine TradingView request reached the Worker or a request reached it without Cloudflare exposing a client certificate. Do not infer either case without new evidence.

### Sanitized arrival diagnostics — TDD verified

Purpose: distinguish request-arrival failure from missing client-certificate evidence without logging body data, credentials, raw certificate material, or weakening authentication.

Diagnostic output fields:
- `totalProbeLogs`
- `expectedSpoofLogs=1`
- `additionalProbeLogs`
- `certPresentedCount`
- `fingerprintCount`

Interpretation:
- `totalProbeLogs=1`, `additionalProbeLogs=0` => only the workflow spoof probe was observed; no additional probe request reached the instrumented path
- `additionalProbeLogs>0`, `certPresentedCount=0` => at least one additional request reached the probe path but Cloudflare exposed no presented client certificate
- `certPresentedCount>0` with `fingerprintCount!=1` => certificate evidence is malformed, missing a stable fingerprint, or unstable; STOP and redesign rather than weaken auth
- success remains exactly one stable normalized SHA-256 fingerprint

TDD evidence:
- RED `73ae4b62148bceeac54aa7c7df9be111b3e389a1`, run `33729322404`: 522/523 Node tests; only the missing diagnostic contract failed; all Cloudflare jobs skipped
- implementation `dc69600b3a768da50b5fed607d54edee9537d389`: added sanitized diagnostic counts; first GREEN candidate exposed only an over-strict source-text assertion
- corrected test `8b06a3b3379e4cb44c583848906f31298e9f42ec`, run `33729772610`: **SUCCESS**; 523/523 Node tests, MT5 GREEN, both MTProto suites GREEN, all Cloudflare jobs skipped

### Next safe action

Coordinate one more exact-marker Gate 3 probe. During the active bounded probe step, trigger exactly one genuine TradingView HTTPS webhook from TradingView itself to:

```text
https://trade.mkety.com/api/v1/webhooks/tradingview/probe
```

Browser/Postman/curl requests do not satisfy the genuine-source observation. Probe mode should still return HTTP 403. After the run, use only the sanitized diagnostic counts and Cloudflare-observed certificate metadata to decide whether certificate pinning is viable.

If Cloudflare does not expose exactly one stable normalized SHA-256 fingerprint from a genuine TradingView request, **STOP Gate 3 and redesign transport authentication; never weaken to IP-only, header-only, body-secret-only, or URL-secret-only trust.**

Only after a genuine stable certificate fingerprint is proven may a later controlled batch pin it, disable probe mode, create a non-execution TradingView source, and temporarily enable direct ingress for dedupe/authority-stripping/source-isolation acceptance.

Do not start Gate 4, broker execution, or real-money work while Gate 3 remains unresolved.