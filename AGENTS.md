# Trading Project Agent Handoff

Operational source of truth for `MketyDigital/Trading`.

## Hard rules
- Active work: `cloudflare-v2/` on `design/enterprise-trading-event-core`, draft PR #2 -> `main`.
- **Never merge `main` without explicit user instruction.**
- **Never enable real-money execution without a separate explicit final cutover approval.**
- Never expose broker/database/auth/Telegram/provider/Cloudflare/Zitadel/AI/signing/destination/transport secrets.
- TDD for production/config behavior: exact RED first, then exact-head GREEN.
- Update this file after every meaningful implementation/testing/environment batch.
- Batch work and minimize CI/Cloudflare consumption.
- Trading hostname: **`trade.mkety.com`** under `mkety.com`.
- `mkety.app` is reserved for customer-owned apps/builds under Mkety/MKSaaS.
- Cloudflare security/core remains Free-plan-compatible; no Enterprise-only trust dependency.
- Containers are optional Paid MTProto capacity only and may be selected only by an exact active `cloudflare_container_mtproto` source.

## Product / tenancy contract
Mkety Trading is multi-tenant. Isolation is mandatory across workspace, user, source, provider runtime, Telegram session/chat, event, account, destination, AI, retries, queue, idempotency, Position Group, health/control state, and credentials.

Canonical pipeline:
`source -> authenticated Trading Event -> persistent canonical idempotency -> deterministic normalization/bounded AI -> durable trade state -> validated intent -> account safety/risk -> Position Group -> platform translation -> persistent destination idempotency -> destination adapter`.

Providers:
- Telegram: `cloudflare_container_mtproto`, `cloudflare_do_mtproto`, `external_mtproto`
- TradingView: `tradingview_webhook`
- MT5: `mt5_source_bridge`
- cTrader: `ctrader_source`
- custom: `custom_signed_api`

Safety invariants:
- clear signals remain deterministic; AI is ambiguity-only and post-validated;
- connected broker metadata is authoritative;
- persistent event/destination/order idempotency is mandatory;
- Position Groups support arbitrary TP legs;
- global kill switch blocks everything;
- preserve raw cTrader `ProtoOASymbol.lotSize` protocol-cent semantics; never add another x100;
- identity/admin/database/source/infrastructure work never grants broker execution.

## Identity / database boundary
- Managed Mkety Zitadel is global identity authority; Trading and MKSaaS remain separate projects/apps/product DBs.
- immutable Zitadel `sub` is the key, never email.
- login alone never grants Trading access.
- `trading_workspace_access` is entitlement; memberships are exact `(workspace_id, zitadel_subject)`.
- roles owner/admin/operator/viewer; unknown fails closed; no role grants broker execution.
- keep `TRADING_ACCESS_ENABLED=false` until Gate 4 real acceptance.
- Trading Supabase migrations through `trading_0010_tradingview_public_source_handle` are applied/verified; ledger `20260902184215`.

## Default runtime safety
```text
TRADINGVIEW_DIRECT_INGRESS_ENABLED=false
TRADINGVIEW_CERT_PROBE_ENABLED=false
TRADING_ACCESS_ENABLED=false
BROKER_EXECUTION_ENABLED=false
```

Paid profile: `cloudflare-v2/wrangler.toml`; Free no-Container profile: `cloudflare-v2/wrangler.free.toml`. Paid/Free queue names remain isolated.

Ordinary `.github/workflows/trading-v1-ci.yml` test runs Node Worker/trading-core, pure MT5 bridge, and both MTProto Python suites and does not invoke Cloudflare. Cloudflare actions are exact-marker-only.

## Production launch gates
1. Scope freeze — **GREEN**
2. Real Cloudflare staging infrastructure — **GREEN**
3. TradingView certificate/direct ingress — **DEFERRED / FAIL-CLOSED**
4. Zitadel real non-live identity — **AVAILABLE IN PARALLEL**
5. Telegram runtime soak — **STATIC GREEN / REAL SOAK PENDING**
6. MT5/cTrader source acceptance — **CURRENT**
7. Broker demo destinations — **CURRENT**
8. End-to-end staging
9. Production operations
10. Tiny controlled cutover

Independent gates may proceed out of number order. Final production still requires every mandatory in-scope gate GREEN or an explicit reviewed V1 scope change. Real-money cutover additionally requires separate user approval.

## Gate 1
**GREEN.** Run `33695618717` @ `aebec4adf71a7f7299b3279d1b4c8b03803e25be`.

## Gate 2 — real Cloudflare staging
**GREEN / EXITED 2026-09-03.**
- first Paid deployment run `33720102208`, commit `bbba25091eb88778fa7243760b704b0b85ab5c6a`
- known-good Worker version `c25e85d5-bfe2-4d17-9ab4-5133d88ecec8`
- final acceptance run `33725547513`, job `100553745522`, head `e2e93aaa131ec2149966e8ca2f480d4fdccc300a`
- real internal handoff -> Queue -> consumer accepted duplicate source event with exactly one persistent Trading Event
- event `READY`; simulation `SIMULATED`; 3 simulated actions; `executionEnabled=false`; `brokerExecution=false`
- Container concrete instance records 0 before/after/final
- rollback to known-good version succeeded at 100% traffic
- temporary Supabase fixtures cleaned to zero

Do not redo Gate 2.

## Gate 3 — TradingView
**DEFERRED / FAIL-CLOSED.**
- static security implementation GREEN: exact SHA-256 fingerprint trust, Cloudflare `request.cf.tlsClientAuth` authority only, caller-header spoof rejection, fail-closed sanitized probe.
- hostname corrected/pinned to `trade.mkety.com`; `mkety.app` excluded.
- real probe run `33728657084`, job `100563529178`: temporary probe deployed, curl spoof rejected 403, 0 genuine fingerprints, safe rollback succeeded.
- user later confirmed the request was Windows `curl`, not TradingView-originated. Genuine TradingView webhook currently unavailable due subscription tier.
- keep direct ingress/probe OFF; do not weaken authentication. Resume later with genuine TradingView-originated HTTPS request before shipping TradingView in V1.

## Gate 4 — Zitadel
**NOT YET REAL-ACCEPTED; MAY PROCEED IN PARALLEL.**
Static tests already cover signed JWT verification, issuer/audience/exp/nbf, exact project role claim, organization/workspace binding, membership, roles, disabled entitlement/member, second-workspace isolation, and no MKSaaS DB dependency. Real managed-Zitadel positive/negative acceptance remains required.

## Gate 5 — Telegram MTProto
**STATIC HARNESS GREEN / REAL ACCOUNT SOAK PENDING.**
`npm run soak:mtproto:container` and `tests/mtproto_container_soak.test.mjs` cover explicit opt-in, reconnect health, catch-up/replay, canonical duplicate identity, latency, secret-free summaries, and no broker execution commands. Existing suites also prove cross-provider canonical convergence and provider/source isolation. Dedicated Telegram test account/channel credentials are still needed for real receive/restart/catch-up evidence.

## Gates 6–7 — MT5/cTrader sources + demo destinations
Acceptance commands:
- `npm run accept:mt5:demo`
- `npm run accept:ctrader:demo`

MT5 probe verifies exact demo login/server, broker symbol catalog and live tick. cTrader is pinned to `environment='demo'`, `allowLiveTrading=false`, authoritative account/symbol/quote metadata and raw protocol `lotSize` semantics. Actual demo order lifecycle remains separately explicit and persistent-idempotent.

### Probe/persistence decoupling — GREEN
Goal: safe connectivity/source probes must not require Supabase delivery state because they place no orders; lifecycle/order mode must still require persistent delivery idempotency.

RED:
- head `540d272dc9d8f2cd84d382c7fc99a2e37aef9195`
- run `33730750537`, job `100569873364`
- Node tests: **523/525 passed, exactly 2 failed**:
  - `MT5 probe mode does not require Supabase delivery-store configuration`
  - `cTrader probe mode does not require Supabase delivery-store configuration`
- every Cloudflare job skipped.

GREEN implementation:
- head `705e628eba02d6fb7c5925d4b8a2a0b6ca04c1dd`
- run `33731004622`, job `100570687765` — **SUCCESS**
- Node Worker/trading-core GREEN
- pure MT5 bridge GREEN
- both MTProto Python suites GREEN
- every Cloudflare job skipped

Resulting contract:
- MT5/cTrader default `probe` mode does **not** construct Supabase/delivery-store dependencies.
- lifecycle mode still validates `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `TRADING_WORKSPACE_ID`, builds persistent destination idempotency, and remains behind explicit demo-order gates.
- no real-money behavior was enabled.

## Exact next safe action
Add one exact-marker, protected `staging` demo-probe bridge that can run MT5 or cTrader **probe-only** using platform-specific GitHub environment secrets. It must contain no lifecycle/order flag, no Supabase dependency, no Cloudflare deployment, and no real-money capability. After its regression contract is GREEN, real MT5/cTrader connectivity can be accepted as soon as the relevant demo credentials are added.