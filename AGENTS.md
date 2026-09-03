# Trading V1 – Operational Source of Truth

## Mission
Build and launch an enterprise, multi-tenant trading automation platform with strict isolation, deterministic safety, durable idempotency, provider redundancy, admin controls, and explicit production cutover gates.

## Repository / Branch
- Repository: `MketyDigital/Trading`
- Active branch: `design/enterprise-trading-event-core`
- Draft PR: #2 targeting `main`
- Never merge `main` without explicit user instruction.
- Never enable real-money execution without separate explicit final approval.

## Critical runtime safety defaults
These remain fail closed by default and must not be changed casually:
- `TRADINGVIEW_DIRECT_INGRESS_ENABLED=false`
- `TRADINGVIEW_CERT_PROBE_ENABLED=false`
- `TRADING_ACCESS_ENABLED=false`
- `BROKER_EXECUTION_ENABLED=false`

Admin APIs may mutate scoped source/account controls only; they must not mutate Worker-wide master fuses.

## Production identity / tenancy
- Managed Mkety Zitadel is the global identity authority.
- Trading and MKSaaS remain separate Zitadel projects/apps and separate product databases.
- Trading workspace membership is exact `(workspace_id, zitadel_subject)`.
- Login alone never grants Trading access.
- Roles: owner/admin/operator/viewer; unknown roles fail closed.
- No role grants Worker master-fuse authority.
- Trading authorization never queries MKSaaS DB/shared workspace tables.

## Canonical Trading pipeline
Source Provider/Adapter
→ authenticated/versioned Trading Event
→ persistent canonical event idempotency
→ deterministic normalization / bounded AI ambiguity resolution
→ durable correlation + Trade State
→ canonical intent / management event
→ deterministic validation
→ account safety + risk
→ Position Group / arbitrary TP legs
→ platform translation
→ persistent destination idempotency
→ destination/broker adapter

## Core product / safety contract
- Broker metadata is authoritative.
- Clear machine-readable signals are deterministic; AI is never required for them.
- AI is bounded to ambiguity resolution and optional destination presentation.
- AI failure cannot block deterministic clear work.
- Ambiguous AI failure/circuit-open goes to `NEEDS_REVIEW`; it never guesses execution.
- Telegram presentation is deterministic first; optional AI cannot alter canonical symbol, direction, entry, SL, or TP values.
- Fast-entry policies: `execute_immediately`, `wait_for_complete_signal`, `forward_only`.
- Arbitrary TP counts are represented as Position Groups / legs.
- Event/destination/order idempotency is persistent.
- Account execution requires active account + `execution_enabled` + safety policy + no kill switch + Worker broker fuse.
- Global kill switch semantics remain authoritative.
- cTrader `ProtoOASymbol.lotSize` uses raw protocol-cent semantics; never add an extra x100.
- Identity/admin/database/source/infrastructure operations never enable broker execution.

## Cloudflare deployment topology
Paid `cloudflare-v2/wrangler.toml`:
- Worker `mkety-copier-engine`
- Durable Objects:
  - `MTPROTO_LISTENER_NAMESPACE` → `MTProtoListenerNode`
  - `TRADE_STATE_NAMESPACE` → `TradeStateNode`
  - `MTPROTO_CONTAINER_NAMESPACE` → `MtprotoContainerRuntime`
- Container `MtprotoContainerRuntime`
- Queue `mkety-trading-source-events`
- DLQ `mkety-trading-source-events-dlq`
- crons `*/15 * * * *`, `* * * * *`

Free `wrangler.free.toml`:
- Worker `mkety-copier-engine-free`
- no Container
- isolated queue/DLQ
- 15-minute cron only.

Trading hostname: `trade.mkety.com`.
`mkety.app` remains reserved for MKSaaS customer-owned apps/builds.

## Launch gates
Master plan: `docs/superpowers/plans/2026-09-03-production-v1-launch-master-plan.md`

1. Scope freeze — GREEN
2. Real Cloudflare staging — GREEN
3. TradingView certificate/direct ingress — DEFERRED / FAIL-CLOSED; static production path GREEN
4. Zitadel real non-live identity — STATIC GREEN / real acceptance pending
5. Telegram runtime soak — STATIC GREEN / real soak pending
6. MT5/cTrader source acceptance — probe bridge GREEN / real demo probes pending
7. Broker demo destinations — lifecycle bridge GREEN / real demo lifecycles pending
8. End-to-end staging — static execution + retry bridge GREEN / real acceptance pending
9. Production operations — static observability + account controls + fail-closed execution/recovery + resilience hardening GREEN; real staging monitoring/kill/rollback/recovery acceptance pending
10. Tiny controlled cutover — CLOSED / not started

Final production requires mandatory in-scope gates GREEN or explicit reviewed scope removal. Real-money cutover additionally requires separate explicit approval.

## Gate 1 evidence
GREEN.
- run `33695618717`
- head `aebec4adf71a7f7299b3279d1b4c8b03803e25be`

## Gate 2 evidence
GREEN / exited.
Known-good Worker version:
- `c25e85d5-bfe2-4d17-9ab4-5133d88ecec8`

Final Gate 2:
- head `e2e93aaa131ec2149966e8ca2f480d4fdccc300a`
- run `33725547513`
- job `100553745522` SUCCESS
- temporary version `2608756e-2096-409d-9a2c-8e678503a4dd`
- duplicate source event converged to one persistent event
- processing `READY`
- simulation `SIMULATED`
- 3 simulated actions
- broker execution false
- rollback successful
- all launch safety flags false
- fixture cleanup zero

Do not redo Gate 2 without a specific reason.

## Gate 3 TradingView
User does not currently have a paid TradingView webhook tier, so genuine TradingView-originated acceptance remains unavailable.

Static production path is GREEN:
- exact SHA-256 client certificate fingerprint trust only
- Cloudflare `request.cf.tlsClientAuth` authority only
- spoofed caller certificate headers ignored
- certificate probe is sanitized and always fails closed
- direct ingress false by default
- no IP/header/subject/CN/SAN/url/body-secret fallback

Probe evidence:
- trigger `983bf36732a37a787cc253fec391a6a18d6c4517`
- run `33728657084`
- job `100563529178`
- temporary probe deployed, spoof curl returned 403, rollback to known-good

Keep direct ingress and cert probe OFF until genuine external acceptance can be performed.

## Gate 5 Telegram
Static soak harness GREEN:
- `npm run soak:mtproto:container`
- `tests/mtproto_container_soak.test.mjs`
- reconnect health, catch-up/replay, canonical duplicate identity, latency, secret-free summary, no broker execution commands covered
- cross-provider convergence/isolation covered

Real Telegram account/channel soak still pending protected credentials.

## Gate 6 source probes
Probe bridge GREEN.
Commands:
- `npm run accept:mt5:demo`
- `npm run accept:ctrader:demo`

Key evidence:
- probe/persistence GREEN `705e628eba02d6fb7c5925d4b8a2a0b6ca04c1dd`, run `33731004622`
- cTrader probe deny-execution GREEN `f02ebe449cc13157dadd0c7663e2fc1bee095ec3`, run `33731624548`
- dedicated workflow GREEN `c24a97af7da92981cee37934718d1bde0b8d5778`
- MT5 runtime mapping GREEN `3a082b6da1ae255a2c2aa497eddd192606b947fa`, run `33733468585`

Exact Gate 6 markers:
- `demo: probe mt5 gate 6`
- `demo: probe ctrader gate 6`

Protected `staging` environment required. Probe jobs force `BROKER_EXECUTION_ENABLED=false` and order-test false.

## Gate 7 demo lifecycle bridge
GREEN bridge / real lifecycle pending credentials + explicit markers.
- RED `b71592bd549d105979bb64a51ede07a43dc2b631`, run `33733620119`
- GREEN `a40c4b2ccb45204b1dd4ee24b53c860b78765681`
- dedicated GREEN run `33733929722`
- ordinary CI `33733933644`

Exact markers:
- `demo: lifecycle mt5 gate 7`
- `demo: lifecycle ctrader gate 7`

Workflow is staging-protected, persistent, demo-only, and keeps Worker broker fuse false.

## Production account controls
GREEN.
Commit:
- `76ff17ff00584b6d01deb033917daa4b6526a86f`
Run:
- `33734775292`

Endpoints:
- `GET /api/v1/admin/accounts`
- `POST /api/v1/admin/accounts/:id/execution`
- `POST /api/v1/admin/accounts/:id/kill-switch`

Only owner/admin may mutate account execution or kill-switch state. No endpoint changes `BROKER_EXECUTION_ENABLED`.

## Production execution bridge
Approved design:
- `docs/superpowers/specs/2026-09-03-production-execution-bridge-design.md`
- `docs/superpowers/plans/2026-09-03-production-execution-bridge-implementation-plan.md`

Execution requires all applicable locks:
1. Worker `TRADING_ACCESS_ENABLED`
2. authenticated/active source
3. workspace entitlement
4. active account
5. account `execution_enabled`
6. account safety + kill switch
7. Worker `BROKER_EXECUTION_ENABLED`

TradingView additionally requires direct-ingress fuse + enabled source + exact cert trust.

### Worker-wide Trading access fuse
GREEN.
- RED `ac3820a755323b21e40d8b90c5d9e04651127371`, run `33735957547`: exact 3 new failures
- GREEN `e997b5a92aeb843dab0bd2ade647cd194d772514`, run `33736148469`: Node 537/537, all mandatory suites pass, external jobs skipped

`/api/v1/health` and exact protected internal source handoff remain available while external V1 application APIs fail closed when Trading access is false.

### Production execution coordinator
GREEN.
- RED `c6f162a04f67ce527b457053b6e2849801fc1caa`, run `33736527152`
- GREEN `7d46d4c525023e07f96e49f05cd3bdc57ef85fe4`, run `33736812704`: Node 542/542, all mandatory suites pass

Broker master fuse is checked before account lookup/state/idempotency/adapter dependencies. Account/workspace/safety is revalidated, sibling failures are isolated, broker outcomes are sanitized, and successful broker IDs can be bound to Trade State.

### Server-side production execution dependencies
GREEN.
- RED `428bb64e1141b9477cd0bc5965ba0b723d67dd50`
- GREEN `9b6f5bd59d541b8b7192a778e5dba1905b0a1354`

MT5 uses exact server env + exact DB account authority + persistent destination delivery store.
cTrader decrypts exact DB account token server-side, pins DB environment, and requires separate server-side live opt-in for live accounts.
Unsupported platforms fail closed.

## Hot-path isolation and resilience
Approved design/plan:
- `docs/superpowers/specs/2026-09-03-hot-path-isolation-and-resilience-design.md`
- `docs/superpowers/plans/2026-09-03-hot-path-isolation-and-resilience.md`

### Resilience Task 1 — execution AI isolation
GREEN.
- commit `f7b0653c...`
- fresh regression 593/593 Node; all mandatory suites pass; Cloudflare skipped

Deterministic signals and deterministic management commands never call AI. Ambiguous AI outage returns `NEEDS_REVIEW` rather than guessing.

### Resilience Task 2 — Telegram deterministic-first presentation
GREEN.
- RED `d44f8e30...`
- GREEN `03f6315a...`
- run `33756247175`: Node 600/600; all mandatory suites pass; Cloudflare skipped

Telegram formatting is deterministic first. Optional AI has bounded timeout and must echo exact canonical trade semantics; timeout, provider failure, malformed output, or canonical mismatch falls back deterministically.

### Resilience Task 3 — Telegram fanout isolation
GREEN.
- RED `a841f4d9...`
- GREEN `da235972...`
- run `33756782249`: full regression GREEN; Cloudflare skipped

One Telegram AI/network failure cannot block a sibling destination or broker execution. Non-Telegram destination contract remains unchanged.

### Resilience Task 4 — latency instrumentation
GREEN.
Pure trace:
- RED `3ee62543...`
- GREEN `f1600cf0...`
- Node 609/609; MT5 14/14; Container MTProto 11/11; external MTProto 22/22

Integration:
- RED `98b6ed46...`, run `33757427960`: 612/614 with exactly two intended timing-mark failures
- GREEN `f7baf62dadb0f04b79bf12fc77a17c77a871b6c9`
- run `33757893397` SUCCESS; all mandatory suites pass; every Cloudflare/deploy/probe job skipped

Observed boundaries:
- `BROKER_SEND`
- `BROKER_ACK`
- `DESTINATION_FORMAT_START`
- `DESTINATION_FORMAT_DONE`
- `DESTINATION_ACK`

Telemetry is non-authoritative. Observer errors are swallowed; broker fuse exits before telemetry/dependency work.

### Resilience Task 5 — bounded runtime execution snapshot cache
GREEN as a pure non-authoritative cache.
- RED `fe0f6520be81f3376c7e7caf09c09064ab422450`, run `33758033176`: 614/615, sole missing-module failure
- GREEN `1c55164ed200d24de46f6b23acf748eb191c1609`, run `33758306512`
- Node 620/620
- MT5 14/14
- Container MTProto 11/11
- external MTProto 22/22
- every Cloudflare/deploy/probe job skipped

`runtime_execution_snapshot.js` is exact `(workspaceId, sourceId, accountId, version)` scoped, TTL/version bounded, max-size bounded, secret-stripping, cloned in/out, and supports isolated invalidation.

Important: this cache is not broker safety authority. Final account/safety/fuse checks remain fresh and server-side immediately before broker dispatch.

### Resilience Task 6 — provider-isolated circuit breakers
GREEN.

Pure breaker:
- RED `4d9d634358c9f1b0becbadaa432374f5f070b4d5`, run `33758879231`: 620/621, sole missing-module failure
- GREEN `c080f6fe4d0e2decb254584b225f626cd55ab5df`, run `33759115827`: all mandatory suites pass; every Cloudflare/deploy/probe job skipped

Breaker contract:
- exact `(purpose, provider, workspaceId)` circuit key
- states `CLOSED`, `OPEN`, `HALF_OPEN`
- bounded failure threshold/reset time/Map size
- one half-open probe
- malformed or secret-bearing keys fail open without retained state
- breaker clock/internal failure cannot block dependency work

Integration authority boundary:
- AI breaker integration baseline GREEN `76bea8f94a30935b9fb85cb2d9bb8d6cceffbc90`, run `33759820559`
- authority RED `39d0d94389d71e24fe6d63bfe5704b40dcc6c552`: proves caller event workspace/provider hints must not select circuit identity
- router/factory/interpreter GREEN `cc3a23d3ea4f5551843e7810ad97ea225a883071`
- authenticated production composition GREEN `d6992034b0d8d3b5bd50ce33acaaf473a0a1ce4a`
- exact-head run `33763045959`: Worker/trading-core, pure MT5, and pure MTProto suites all SUCCESS; every Cloudflare inspect/probe/deploy/accept job skipped

Production ambiguity-AI circuit identity is now owned by the server-side workspace router: trusted workspace comes from the authenticated source, provider identity comes from the exact server-loaded database provider row, and caller workspace/provider hints are ignored. Sibling providers are independently attempted/recorded, and deterministic work remains outside the AI breaker path.

### Resilience Task 7 — launch failure-injection matrix
GREEN at implementation head `248607248e0a82dbb7d138813b3cfefccfa275b9`.
- test file: `cloudflare-v2/tests/hot_path_failure_isolation.test.mjs`
- run `33763774552`: Worker/trading-core, pure MT5 bridge, and pure MTProto Python suites all SUCCESS
- every Cloudflare inspect/probe/deploy/accept job skipped

Static launch contracts cover:
- deterministic clear work survives AI outage and telemetry observer failure
- ambiguous AI outage degrades to `NEEDS_REVIEW` and never constructs broker dependencies
- Telegram format/send failure remains destination-local and cannot cancel a healthy broker path
- DB/config planning outage fails closed before broker dependency construction
- stale runtime snapshot never overrides fresh authoritative account state
- persistent MT5 idempotency reservation failure blocks broker transport before send
- broker master fuse, account kill switch, and inactive account each block dispatch
- uncertain broker outcome is not blindly retried inside the coordinator
- duplicate replay exits before planning/execution
- front-door missing authentication rejects before database access

No Task 7 production-runtime modification was required: the existing Task 1–6 isolation primitives already satisfy the matrix, so Task 7 adds composed launch-contract coverage only.

### Resilience Task 8 — secret-free readiness metrics summary
GREEN at implementation head `f3f9a3d11d76beeb4e916970fb544c6ee26327cd`.
- RED `16c9562a7602dbbd2343310bdefc5d0d68a4d647`, run `33764326768`: exactly four intended resilience-summary failures and no unrelated regression
- GREEN run `33764766376`
- Node/trading-core 633/633
- production contract 11/11
- pure MT5 and pure MTProto mandatory suites SUCCESS
- every Cloudflare inspect/probe/deploy/accept job skipped
- documentation synchronization head `070d10740aa46f2760c3b808aae14e406f7ba35c`, run `33765193083`: Node/trading-core 649/649, MT5 14/14, Container MTProto 11/11, external MTProto 22/22; every Cloudflare inspect/probe/deploy/accept job skipped

Operations readiness metrics are read-only and additive. The optional metrics source is queried only for the exact authorized workspace and can expose only an allowlisted secret-free summary: ambiguity-AI review count, destination-AI fallback count, retry rate, uncertain rate, and p50/p95/p99 latency summaries for source-to-broker-send, broker round trip, and source-to-destination-ack. Numeric fields are bounded; cross-workspace metrics fail closed; ordinary metrics-source failure degrades to `{available:false}` and cannot block the durable operations snapshot or trading execution. No execution path consumes readiness metrics.

### Resilience Task 9 — operational handoff and launch gates
STATIC GREEN. Production Gate 9 remains real-acceptance pending.
- runbook: `cloudflare-v2/docs/PRODUCTION_V1_CUTOVER_RUNBOOK.md`
- implementation/documentation head `119c603094f98a33fb4b401675ed38a34236c329`
- exact-head run `33765780100`
- Node/trading-core 649/649
- MT5 14/14
- Container MTProto 11/11
- external MTProto 22/22
- every Cloudflare inspect/probe/deploy/accept job skipped

The production runbook locks the hard hot-path rules, four-fuse default-off state, secret-free readiness signals, narrow-to-global kill hierarchy, deployment rollback procedure, restart/replay recovery authority, staged shadow/demo/tiny-live/beta rollout, and immediate stop conditions. It explicitly forbids inventing universal financial/risk thresholds: tiny-live limits must be owner-reviewed and recorded only at the separately authorized Gate 10 phase.

Static resilience Tasks 1–9 are complete. This does not substitute for real acceptance. Production Gate 9 still requires authorized real staging monitoring, kill-control, rollback, recovery, security, and sustained latency/failure measurements.

Remaining external acceptance blockers include:
- Managed Zitadel real non-live identity acceptance.
- Real Telegram account/channel soak with protected credentials.
- MT5/cTrader real demo source probes and broker lifecycle acceptance with protected staging credentials and explicit workflow markers.
- End-to-end real staging acceptance and sustained failure/latency measurements.
- Gate 9 kill/rollback/recovery/security drills in the authorized staging environment.
- Genuine TradingView-originated acceptance remains deferred while a paid TradingView webhook tier is unavailable; direct ingress stays fail-closed.

Gate 10 is CLOSED / not started. Real-money cutover is forbidden until all applicable mandatory gates are GREEN (or an explicit reviewed scope removal is recorded) and the user separately gives explicit final tiny-live approval.

## Immediate safe next actions
1. Review external acceptance prerequisites for Gates 4–9 and prepare the exact evidence/checklists required for each; do not trigger a real environment gate merely because static CI is GREEN.
2. If credentials/protected environment prerequisites are available and the user separately authorizes the corresponding gate, execute only that gate's bounded acceptance procedure and record exact non-secret evidence here.
3. Keep `TRADINGVIEW_DIRECT_INGRESS_ENABLED=false`, `TRADINGVIEW_CERT_PROBE_ENABLED=false`, `TRADING_ACCESS_ENABLED=false`, and `BROKER_EXECUTION_ENABLED=false` unless a separately authorized acceptance gate explicitly requires otherwise.
4. Do not deploy, mutate Cloudflare, run live probes, merge `main`, place broker orders, or enable real-money execution without the corresponding explicit gate/approval.
5. Keep this `AGENTS.md` synchronized after every verified milestone so repository handoff state remains authoritative.
