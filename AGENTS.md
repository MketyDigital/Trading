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
3. TradingView certificate/direct ingress — **DEFERRED / FAIL-CLOSED; STATIC PRODUCTION PATH GREEN**
4. Zitadel real non-live identity — **AVAILABLE IN PARALLEL**
5. Telegram runtime soak — **STATIC GREEN / REAL SOAK PENDING**
6. MT5/cTrader source acceptance — **PROBE BRIDGE GREEN / REAL DEMO PROBES PENDING**
7. Broker demo destinations — **LIFECYCLE BRIDGE GREEN / REAL DEMO LIFECYCLES PENDING**
8. End-to-end staging
9. Production operations — **ADMIN ACCOUNT CONTROL LAYER GREEN; REMAINING OPS ACCEPTANCE PENDING**
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
**DEFERRED / FAIL-CLOSED; STATIC PRODUCTION PATH GREEN.**
- static security implementation GREEN: exact SHA-256 fingerprint trust, Cloudflare `request.cf.tlsClientAuth` authority only, caller-header spoof rejection, fail-closed sanitized probe.
- hostname corrected/pinned to `trade.mkety.com`; `mkety.app` excluded.
- real probe run `33728657084`, job `100563529178`: temporary probe deployed, curl spoof rejected 403, 0 genuine fingerprints, safe rollback succeeded.
- user later confirmed the request was Windows `curl`, not TradingView-originated. Genuine TradingView webhook currently unavailable due subscription tier.
- production contract: keep TradingView fully built/tested behind explicit admin/runtime enablement; default direct ingress and certificate probe OFF. Do not weaken authentication. Resume genuine external acceptance later before enabling it for production traffic.

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
RED:
- head `540d272dc9d8f2cd84d382c7fc99a2e37aef9195`
- run `33730750537`, job `100569873364`
- Node 523/525; exactly the MT5/cTrader probe persistence contracts failed; Cloudflare skipped.

GREEN:
- head `705e628eba02d6fb7c5925d4b8a2a0b6ca04c1dd`
- run `33731004622`, job `100570687765` — SUCCESS
- Node/Worker, MT5 bridge, MTProto suites GREEN; Cloudflare skipped.

Contract: default probe mode does not construct Supabase delivery dependencies; lifecycle mode still requires Supabase/workspace persistent idempotency and explicit demo-order opt-in.

### cTrader real probe-path execution deny store — GREEN
Runner decoupling exposed that `createCTraderRuntime` structurally requires a delivery store even when probe never executes an order. The probe now supplies a deny-execution store only when no persistent store is provided; `reserve`, `complete`, and `fail` all throw `cTrader probe execution disabled`. Lifecycle behavior is unchanged and still requires the real persistent store.

RED:
- head `383151a0ea760624afb7c19c6c218b7eb3dc3b34`
- run `33731354031`, job `100571788514`
- Node 525/526; only the fail-closed cTrader probe-store integration test failed; Cloudflare skipped.

GREEN:
- head `f02ebe449cc13157dadd0c7663e2fc1bee095ec3`
- run `33731624548`, job `100572704852` — SUCCESS
- Node/Worker, MT5 bridge, MTProto suites GREEN; Cloudflare skipped.

### Gate 6 protected demo-probe bridge — GREEN
Dedicated workflow: `.github/workflows/gate6-demo-probes.yml`.
Dedicated trigger: `cloudflare-v2/docs/GATE6_DEMO_PROBE_TRIGGER.md`.

Exact probe markers:
- `demo: probe mt5 gate 6`
- `demo: probe ctrader gate 6`

Safety contract:
- one platform probe at a time;
- protected GitHub environment `staging`;
- mandatory Node/Worker + MT5 + MTProto tests first;
- probe mode forced;
- demo-order flag forced false;
- `BROKER_EXECUTION_ENABLED=false`;
- no Supabase/workspace state;
- no Cloudflare credentials or Wrangler;
- no lifecycle/order action in the probe jobs.

RED:
- head `c588445f329981b940093e92f05a045524e6e7aa`
- run `33731808116`, job `100573224493`
- Node 526/528; exactly two missing Gate 6 job contracts failed; Cloudflare skipped.

GREEN bridge:
- head `c24a97af7da92981cee37934718d1bde0b8d5778`
- ordinary push run `33732167256`: mandatory Node/Worker, MT5 bridge, MTProto suites GREEN; Cloudflare jobs skipped.
- dedicated Gate 6 run `33732167285`: mandatory test job GREEN; both real probe jobs SKIPPED because implementation commit was not an exact marker.

MT5 runtime mapping regression:
- RED head `560394823233c2cf0cd06c230565ef11b0bb657e`, run `33732387061`, job `100575069854`: Node 527/528; only missing `MT5_DEMO_SERVER` runtime mapping failed; all Cloudflare jobs skipped.
- GREEN head `3a082b6da1ae255a2c2aa497eddd192606b947fa`, run `33733468585`, job `100578505896`: Node/Worker, MT5 bridge, both MTProto suites GREEN; every Cloudflare/deploy/probe job skipped.
- protected secret remains named `MT5_EXPECTED_DEMO_SERVER`; workflow maps it to runtime `MT5_DEMO_SERVER`.

Required `staging` secrets for an MT5 probe:
- `MT5_BRIDGE_URL`
- `MT5_BRIDGE_SECRET`
- `MT5_ACCOUNT_ID`
- `MT5_EXPECTED_DEMO_SERVER`

Required `staging` secrets for a cTrader probe:
- `CTRADER_CLIENT_ID`
- `CTRADER_CLIENT_SECRET`
- `CTRADER_ACCESS_TOKEN`
- `CTRADER_ACCOUNT_ID`

### Gate 7 protected demo-destination lifecycle bridge — GREEN
Dedicated workflow: `.github/workflows/gate7-demo-destinations.yml`.
Dedicated trigger: `cloudflare-v2/docs/GATE7_DEMO_DESTINATION_TRIGGER.md`.

Exact lifecycle markers:
- `demo: lifecycle mt5 gate 7`
- `demo: lifecycle ctrader gate 7`

Safety contract:
- one broker lifecycle at a time;
- protected `staging` environment;
- mandatory Node/Worker + MT5 + MTProto tests first;
- acceptance mode forced `lifecycle` and platform demo-order gate forced true only inside the matching exact-marker job;
- MT5 exact expected demo server required; cTrader remains hard-pinned `environment='demo'` / `allowLiveTrading=false` in production code;
- persistent Supabase delivery idempotency required and scoped by exact workspace/account/destination;
- Worker-wide `BROKER_EXECUTION_ENABLED=false` remains pinned;
- no Wrangler or Cloudflare deployment;
- default lifecycle volume `0.01` lots, protected environment variable override only when broker demo minimum/step requires it.

RED:
- head `b71592bd549d105979bb64a51ede07a43dc2b631`
- run `33733620119`, job `100578987551`
- Node 528/530; exactly the two absent Gate 7 workflow contracts failed; Cloudflare skipped.

GREEN:
- head `a40c4b2ccb45204b1dd4ee24b53c860b78765681`
- dedicated Gate 7 run `33733929722`: mandatory Node/Worker, MT5 bridge, and both MTProto suites GREEN; `mt5-demo-lifecycle-gate7` SKIPPED; `ctrader-demo-lifecycle-gate7` SKIPPED because implementation commit was not an exact lifecycle marker.
- ordinary CI run `33733933644`: mandatory suite GREEN; Cloudflare inspection jobs skipped.

Additional Gate 7 `staging` secrets:
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `TRADING_WORKSPACE_ID`
plus the relevant Gate 6 platform secrets above.

Optional protected environment variables:
- `MT5_DEMO_TEST_LOTS` (default `0.01`)
- `MT5_DEMO_SYMBOL` (default `XAUUSD`)
- `CTRADER_DEMO_TEST_LOTS` (default `0.01`)
- `CTRADER_DEMO_SYMBOL` (default `XAUUSD`)

Never paste any protected values in chat or commits.

## Production admin execution controls — GREEN
Existing durable account fields are reused; no schema migration was required. `trade_accounts.execution_enabled` remains default `FALSE`, and `safety_policy.killSwitch` remains an independent account safety control.

Admin API:
- `GET /api/v1/admin/accounts` — owner/admin only, exact-workspace list, credential-free response.
- `POST /api/v1/admin/accounts/:id/execution` with boolean `enabled` — owner/admin only; mutates only exact-workspace `execution_enabled`.
- `POST /api/v1/admin/accounts/:id/kill-switch` with boolean `enabled` — owner/admin only; preserves all other safety-policy fields.
- operator/viewer receive no account-control permission.
- no role has `broker.master.enable` and there is **no API route capable of mutating `BROKER_EXECUTION_ENABLED`**.
- account/source enablement can therefore prepare production configuration without granting the Worker-wide live-execution fuse.

RED:
- head `b0f32834dd897dd3f2c322f1575be32b88eb1e15`
- run `33734418406`, job `100581520858`
- Node 530/534; exactly four account-control contracts failed; Cloudflare inspection jobs skipped.

GREEN:
- head `76ff17ff00584b6d01deb033917daa4b6526a86f`
- run `33734775292`, job `100582660782` — SUCCESS
- Node **534/534**; MT5 bridge 14/14; Container MTProto 11/11; external MTProto 22/22; all Cloudflare/deploy/probe jobs skipped.

## Exact next safe action
Continue Gate 9 production operations and Gate 8 staging completion without spending external broker credentials prematurely. Audit the deployed runtime-control semantics so `TRADING_ACCESS_ENABLED`, TradingView source state, per-account execution, account kill switch, and Worker-wide `BROKER_EXECUTION_ENABLED` form an explicit fail-closed activation chain. Then prepare/run real Gate 4/5/6/7 acceptance only when the relevant protected external credentials or genuine external provider event are available. Do not enable `BROKER_EXECUTION_ENABLED` and do not merge `main` without explicit user instruction.