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

## Production launch gates

1. Scope freeze — **GREEN**
2. Real Cloudflare staging infrastructure — **GREEN**
3. TradingView certificate probe/direct ingress acceptance — **DEFERRED / FAIL-CLOSED**
4. Zitadel real non-live identity acceptance — **AVAILABLE IN PARALLEL**
5. Telegram runtime soak — **STATIC HARNESS GREEN / REAL SOAK PENDING**
6. MT5/cTrader source acceptance — **CURRENT IMPLEMENTATION PRIORITY**
7. Broker demo destinations — **CURRENT IMPLEMENTATION PRIORITY**
8. End-to-end staging
9. Production operations
10. Tiny controlled cutover

Gate execution may proceed out of numerical order where dependencies are independent, but final production launch still requires every mandatory gate to be GREEN or explicitly removed from V1 scope through a reviewed scope change. TradingView remains in V1 scope and therefore its deferred real certificate/direct-ingress acceptance must be completed before final production launch if TradingView ships in V1.

Real-money execution requires separate explicit user approval after all prior mandatory gates are GREEN.

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

**DEFERRED / FAIL-CLOSED. STATIC SECURITY IMPLEMENTATION REMAINS ACCEPTED; GENUINE TRADINGVIEW CERTIFICATE ACCEPTANCE IS EXTERNALLY BLOCKED FOR NOW.**

- Trading hostname `trade.mkety.com`; `mkety.app` remains reserved for MKSaaS/customer builds.
- Static security contract is GREEN: exact fingerprint trust, Cloudflare-only TLS metadata authority, spoof rejection, fail-closed probe, sanitized diagnostics.
- Real probe trigger `983bf36732a37a787cc253fec391a6a18d6c4517`, run `33728657084`, job `100563529178` safely rolled back after observing 0 genuine fingerprints.
- The attempted observation used user-operated curl rather than a TradingView-originated request, so it does not prove genuine TradingView certificate failure.
- Genuine TradingView webhook execution is unavailable to the user at the current subscription tier; resume later without weakening authentication.
- Keep both TradingView runtime flags false outside a future controlled probe.

## Gate 4 — Zitadel real identity acceptance

**NOT YET EXECUTED; MAY PROCEED WHILE GATE 3 IS DEFERRED.**

Keep `TRADING_ACCESS_ENABLED=false` until real non-live Zitadel positive/negative acceptance succeeds. Login alone never grants Trading access and no workspace role may grant broker execution.

## Gate 5 — Telegram real soak and recovery acceptance

**STATIC HARNESS GREEN / REAL TELEGRAM ACCOUNT SOAK PENDING EXTERNAL CREDENTIALS.**

Static harness evidence is covered by ordinary `tests/*.test.mjs`, including `tests/mtproto_container_soak.test.mjs`:
- explicit opt-in and missing-name reporting without secret echo;
- disconnect/reconnect health transitions;
- canonical duplicate identity counting;
- catch-up/replay metrics;
- latency summary;
- secret-free summary with no broker execution state;
- soak command contains no live/broker execution command.

Real account/channel receive/reconnect/restart/catch-up still requires dedicated Telegram test credentials before Gate 5 can be fully GREEN.

## Gates 6–7 — MT5/cTrader sources and broker demo destinations

**CURRENT PRIORITY.**

Existing acceptance surfaces:
- `npm run accept:mt5:demo`
- `npm run accept:ctrader:demo`
- each supports safe probe mode and separately explicit order-lifecycle mode;
- MT5 probe verifies exact demo login/server, broker symbol catalog, and live tick metadata;
- cTrader runtime is pinned to `environment='demo'`, `allowLiveTrading=false`, authoritative account/symbol/quote metadata, and raw protocol `lotSize` semantics;
- actual demo order lifecycle remains explicit opt-in and must preserve persistent delivery idempotency.

Current improvement under TDD:
- safe connectivity/source **probe** mode should not require Supabase delivery-store configuration because it places no order;
- lifecycle/order mode must continue requiring persistent delivery-store configuration;
- RED contract prepared as atomic test commit candidate `e1fcd4e373fcff0ba1c7838d6c90072537086242` for both MT5 and cTrader; branch attachment/CI evidence pending before implementation.

## Exact next safe action

Attach the batched RED contract commit for MT5+cTrader probe decoupling, verify the expected two failures with all Cloudflare jobs skipped, then implement the minimal runner changes and verify exact-head GREEN. After that, real demo probes will need only the platform-specific demo credentials/connectivity, while order lifecycle will remain separately gated behind persistent delivery idempotency and explicit demo-order opt-in.