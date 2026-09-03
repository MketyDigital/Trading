# Trading V1 – Operational Source of Truth

## Mission
Build and launch an enterprise, multi-tenant trading automation platform with strict isolation, deterministic safety, durable idempotency, provider redundancy, admin controls, and explicit production cutover gates.

## Repository / Branch
- Repository: `MketyDigital/Trading`
- Active branch: `design/enterprise-trading-event-core`
- Draft PR: #2 targeting `main`
- PR remains development-to-production work; do not use branch-finishing/merge workflow yet.
- Never merge `main` without explicit user instruction.
- Never enable real-money execution without separate explicit final approval.

## Current operational head / audit state
- Trusted pre-audit content tree: `89944d3b6aa4b03f6bb1a1107594e9acfa424fb3`.
- Last exact trusted PR CI on that tree: run `33766769463` SUCCESS.
- The temporary audit-plan add/remove pair advanced history without changing the tree; compare from `89944d3...` to `44a524bd...` reported zero file differences.
- Detailed latest-approved production audit checkpoint: `cloudflare-v2/docs/PRODUCTION_V1_DEVELOPMENT_AUDIT.md`.
- Audit checkpoint document commit: `9a2b1e05437da8bfb7beacab190092eb5905b649`.
- Current stage: **LATEST-APPROVED STATIC PRODUCTION AUDIT / REMEDIATION REQUIRED BEFORE REMAINING REAL ACCEPTANCE**.
- No Cloudflare mutation, protected external probe, broker order, `main` merge, or live-money action is authorized by this state.

## Document authority order
When wording conflicts, use this order:
1. This `AGENTS.md` plus `docs/superpowers/plans/2026-09-03-production-v1-launch-master-plan.md` for current launch/operational truth.
2. Latest approved Sept 3 technical specs/plans:
   - `docs/superpowers/specs/2026-09-03-production-execution-bridge-design.md`
   - `docs/superpowers/plans/2026-09-03-production-execution-bridge-implementation-plan.md`
   - `docs/superpowers/specs/2026-09-03-hot-path-isolation-and-resilience-design.md`
   - `docs/superpowers/plans/2026-09-03-hot-path-isolation-and-resilience.md`
   - `docs/superpowers/plans/2026-09-03-destination-retry-outbox.md`
3. Current acceptance/cutover runbooks:
   - `cloudflare-v2/docs/PRODUCTION_V1_ACCEPTANCE_READINESS.md`
   - `cloudflare-v2/docs/PRODUCTION_V1_CUTOVER_RUNBOOK.md`
   - `cloudflare-v2/docs/NON_LIVE_MULTI_SOURCE_ACCEPTANCE.md`
4. Sept 2 source/identity/TradingView documents only where the Sept 3 launch program still references them.
5. Sept 1 foundation docs are historical context, not the definition of final production readiness.

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
- Event/destination/order idempotency is persistent.
- Fast-entry policies: `execute_immediately`, `wait_for_complete_signal`, `forward_only`.
- Arbitrary TP counts are represented as Position Groups / legs.
- cTrader `ProtoOASymbol.lotSize` uses raw protocol-cent semantics; never add an extra x100.
- Caller workspace/account/provider/destination/broker/credential/execution hints are never authority.
- Critical source/workspace/account/safety revocation must win before broker dispatch.
- Identity/admin/database/source/infrastructure operations never implicitly enable broker execution.

## Cloudflare deployment topology
Paid `cloudflare-v2/wrangler.toml`:
- Worker `mkety-copier-engine`
- Durable Objects: `MTPROTO_LISTENER_NAMESPACE`, `TRADE_STATE_NAMESPACE`, `MTPROTO_CONTAINER_NAMESPACE`
- optional `MtprotoContainerRuntime`
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

## Production V1 launch gates — current interpretation
Master plan: `docs/superpowers/plans/2026-09-03-production-v1-launch-master-plan.md`

1. Scope freeze — GREEN.
2. Real Cloudflare staging — GREEN / exited; do not repeat without a specific reason.
3. TradingView certificate/direct ingress — DEFERRED / FAIL-CLOSED; static path GREEN, genuine TradingView-originated acceptance unavailable while webhook tier is unavailable.
4. Zitadel real non-live identity — STATIC FOUNDATION GREEN / real acceptance pending.
5. Telegram runtime soak — STATIC HARNESS GREEN / real soak pending.
6. MT5/cTrader source acceptance — PROBE BRIDGE GREEN / real demo probes pending.
7. MT5/cTrader broker demo destinations — LIFECYCLE BRIDGE GREEN / real demo lifecycles pending.
8. End-to-end staging — **STATIC AUDIT REOPENED**; real acceptance pending.
9. Production operations/readiness — **STATIC AUDIT REOPENED**; real monitoring/kill/rollback/recovery/security/sustained-measurement acceptance pending.
10. Controlled production cutover — CLOSED / not started.

Do not call Trading production-ready until applicable master-plan requirements are evidenced, including real identity/source/demo-broker acceptance, end-to-end staging soak, operations drills, shadow production, production-infrastructure demo, separate tiny-live approval, tiny-live acceptance, and controlled beta before general launch.

## Historical verified gate evidence that remains valid
### Gate 1
- head `aebec4adf71a7f7299b3279d1b4c8b03803e25be`
- run `33695618717` GREEN.

### Gate 2
- final head `e2e93aaa131ec2149966e8ca2f480d4fdccc300a`
- run `33725547513`, job `100553745522` SUCCESS
- known-good Worker version `c25e85d5-bfe2-4d17-9ab4-5133d88ecec8`
- temporary acceptance version `2608756e-2096-409d-9a2c-8e678503a4dd`
- duplicate convergence, READY processing, SIMULATED planning, broker execution false, rollback and fixture cleanup proven.

### Gate 3 static/probe evidence
- trigger `983bf36732a37a787cc253fec391a6a18d6c4517`
- run `33728657084`, job `100563529178`
- spoof request 403 and rollback proven.
- Keep direct ingress and certificate probe OFF until genuine external acceptance.

### Gate 6 bridge evidence
- `705e628eba02d6fb7c5925d4b8a2a0b6ca04c1dd`, run `33731004622`
- `f02ebe449cc13157dadd0c7663e2fc1bee095ec3`, run `33731624548`
- dedicated workflow baseline `c24a97af7da92981cee37934718d1bde0b8d5778`
- MT5 runtime mapping `3a082b6da1ae255a2c2aa497eddd192606b947fa`, run `33733468585`
- exact markers: `demo: probe mt5 gate 6`, `demo: probe ctrader gate 6`.

### Gate 7 bridge evidence
- RED `b71592bd549d105979bb64a51ede07a43dc2b631`, run `33733620119`
- bridge GREEN `a40c4b2ccb45204b1dd4ee24b53c860b78765681`
- dedicated GREEN run `33733929722`; ordinary CI `33733933644`
- exact markers: `demo: lifecycle mt5 gate 7`, `demo: lifecycle ctrader gate 7`.
- Worker `BROKER_EXECUTION_ENABLED=false` remains pinned during dedicated demo workflow.

## Production execution bridge — approved locks
Approved design: `docs/superpowers/specs/2026-09-03-production-execution-bridge-design.md`.
A broker adapter may be reached only when all applicable locks pass:
1. Worker `TRADING_ACCESS_ENABLED=true`.
2. Worker `BROKER_EXECUTION_ENABLED=true`.
3. authenticated source is active and workspace-authoritative.
4. `trading_workspace_access.trading_access_enabled=true` for the exact workspace.
5. exact account/destination belongs to the workspace and is active.
6. `trade_accounts.execution_enabled=true`.
7. account safety policy allows the action and kill switch does not block it.
8. server-side platform/destination configuration is complete.
9. persistent destination delivery idempotency reservation succeeds before broker dispatch.
10. TradingView-originated execution additionally requires its accepted ingress/source/certificate path.

## Latest-approved static production audit findings
Detailed evidence: `cloudflare-v2/docs/PRODUCTION_V1_DEVELOPMENT_AUDIT.md`.

### F1 — all broker-capable paths do not yet structurally enforce both Worker master fuses
CONFIRMED STATIC GAP.
- `v1_entry.fetch()` correctly guards external business routes with `TRADING_ACCESS_ENABLED`.
- Queue processing calls `handleV1EventsRequest()` below that fetch guard.
- `runV1ProductionExecutionStage()` checks `BROKER_EXECUTION_ENABLED` but not `TRADING_ACCESS_ENABLED`.
- scheduled destination retry checks the broker fuse but not the Trading access fuse.
- Current deployment defaults still keep both false; this finding is a static contract issue, not evidence of live execution.

### F2 — workspace entitlement is not yet proven as a final production execution lock
CONFIRMED STATIC GAP.
- ingest rebinds caller workspace hints to authenticated `source.workspace_id`.
- production account loader is exact workspace/account scoped.
- inspected production execution path does not query `trading_workspace_access.trading_access_enabled` immediately before broker dispatch.
- admin authorization has entitlement checks, but admin authorization is not the live source-to-broker authority.

### F3 — account safety/kill authority is loaded once per multi-action plan
CONFIRMED STATIC GAP.
- coordinator loads account state before the action loop and reuses its safety policy for all actions.
- latest resilience/cutover contract requires critical revocation to win immediately before broker dispatch.
- a disable/kill change after action N is therefore not yet proven to block action N+1 immediately.

### I1 — runtime execution snapshot production integration incomplete
- `runtime_execution_snapshot.js` and isolated tests are GREEN.
- latest approved resilience Task 5 requires production integration for bounded non-authoritative configuration reuse plus fresh final authority.
- current production composition inspected so far does not instantiate/use the snapshot cache.
- treat previous “Task 5 GREEN as a pure cache” as helper-level GREEN, not full latest-approved Task 5 completion.

### I2 — warm broker-context performance composition incomplete
- MT5 persistent bridge exists, but production dispatch currently reloads health/account/symbol metadata per action.
- cTrader production dispatch currently creates/authenticates/closes a runtime per action.
- latest resilience design calls for warm sessions and bounded metadata reuse.
- classify as performance/resilience integration incomplete pending final audit; do not weaken safety to optimize it.

## Important contracts re-confirmed during the audit
- Signed source ingest loads an active source, verifies HMAC and replaces caller `workspace_hint` with `source.workspace_id`.
- Broker master fuse remains the first structural guard inside `executeProductionPlan()` before account lookup/dispatch/state/latency work.
- Coordinator validates loaded account workspace/id, active state and `execution_enabled`.
- Persistent destination idempotency/retry remains the execution ledger; uncertain broker outcomes are not intended for blind retry.
- cTrader live environment still requires a separate server-side live opt-in.
- all Wrangler launch controls remain false by default.
- no real external environment action was performed by the latest static audit.

## Previous resilience evidence — retain as component evidence, not blanket production-complete proof
- deterministic execution AI isolation GREEN.
- Telegram deterministic-first presentation and fanout isolation GREEN.
- latency trace/integration GREEN.
- runtime snapshot helper/unit contract GREEN, but production integration reopened by latest audit.
- provider-isolated circuit breaker GREEN.
- failure-injection matrix GREEN for its covered cases; latest audit identified missing latest-approved execution-lock cases to add.
- secret-free operations readiness metrics GREEN.
- production cutover runbook and external acceptance readiness matrix exist and remain the operator contracts.
- last trusted broad regression on `89944d3...`: run `33766769463` SUCCESS; Node/trading-core 649/649, MT5 14/14, Container MTProto 11/11, external MTProto 22/22; Cloudflare inspect/probe/deploy/accept jobs skipped.

## External acceptance blockers — unchanged, but do not execute until static audit remediation is GREEN
- Managed Zitadel real non-live identity acceptance.
- Real Telegram account/channel soak with protected credentials.
- MT5/cTrader real demo source probes with protected staging credentials and exact Gate 6 markers.
- MT5/cTrader dedicated demo broker lifecycle acceptance with exact Gate 7 markers.
- End-to-end real staging acceptance and sustained latency/failure/isolation measurements.
- Gate 9 staging monitoring, kill-control, rollback, recovery and security drills.
- Genuine TradingView-originated acceptance remains deferred while paid webhook capability is unavailable.
- Gate 10 shadow/demo/live/beta phases remain unstarted.

## Gate 10
CLOSED / not started.
- Shadow production and production-infrastructure demo still belong to Gate 10 before live-money cutover.
- Real-money cutover is forbidden until every applicable mandatory prior gate is GREEN (or explicit reviewed scope removal is recorded) and the user gives separate explicit tiny-live approval.
- Before tiny live, the owner must explicitly approve and record maximum per-trade risk, maximum volume, maximum concurrent/open risk, daily loss ceiling, allowed symbols and kill/rollback contacts/procedure.
- Never invent/default live financial thresholds.

## Exact pickup / immediate safe next actions
1. Continue the read-only/latest-approved runtime audit from `cloudflare-v2/docs/PRODUCTION_V1_DEVELOPMENT_AUDIT.md`; finish tracing execution locks, source/workspace revocation, retry recovery, MT5 metadata boundary and warm broker-context requirements.
2. Do not propose/implement fixes until root causes are complete. Then write one focused remediation plan based only on confirmed Sept 3 requirements.
3. Implement each safety fix with Superpowers TDD: failing regression first, verify RED, minimal production change, focused GREEN, then ordinary PR CI exact-head GREEN.
4. Synchronize this `AGENTS.md` and `cloudflare-v2/docs/PRODUCTION_V1_DEVELOPMENT_AUDIT.md` after every meaningful verified milestone with exact SHA/run/test counts and next pickup point.
5. Keep all four launch controls OFF throughout static remediation.
6. Do not deploy, mutate Cloudflare, run protected external probes, place demo/live broker orders, merge `main`, or enable real-money execution during this static audit/remediation.
7. Only after latest-approved static audit/remediation is GREEN return to separately authorized real Gates 4–9.
