# Trading V1 – Operational Source of Truth

## Mission
Build and launch an enterprise, multi-tenant trading automation platform with strict isolation, deterministic safety, durable idempotency, provider redundancy, admin controls, and explicit production cutover gates.

## Repository / Branch
- Repository: `MketyDigital/Trading`
- Active branch: `design/enterprise-trading-event-core`
- Draft PR: #2 targeting `main`
- This remains development-to-real-production work. Do not use branch-finishing/merge workflow yet.
- Never merge `main` without explicit user instruction.
- Never enable real-money execution without separate explicit final approval.

## Current stage / handoff
- Trusted pre-audit runtime/content tree: `89944d3b6aa4b03f6bb1a1107594e9acfa424fb3`.
- Last exact trusted PR CI for that tree: run `33766769463` SUCCESS.
- That run proved Node/trading-core 649/649, MT5 14/14, Container MTProto 11/11, external MTProto 22/22; Cloudflare inspect/probe/deploy/accept jobs skipped.
- Detailed current audit: `cloudflare-v2/docs/PRODUCTION_V1_DEVELOPMENT_AUDIT.md`.
- Frozen audit-scope document commit: `7b175a548c9134b0e88ba4fa5977de51142b6cd3`.
- Previous detailed audit checkpoints: `9a2b1e05437da8bfb7beacab190092eb5905b649`, `af53fe94bd985843eb47916564642449e94fd4c5`, `e5d83c663afc8e00bb8ba7441d831ac7f6fa0f7d`.
- Previous AGENTS audit syncs: `265684933aede9ffca230457bc9a02ad90f950cd`, `13dc1d4861c106a7c65bbdf2c60f3b2c91a3a9c0`, `c5f58123518d9dd03489b0437e422c97e1817366`.
- Current stage: **LATEST-APPROVED STATIC PRODUCTION AUDIT COMPLETE ENOUGH TO PLAN REMEDIATION / REMEDIATION REQUIRED BEFORE REMAINING REAL ACCEPTANCE**.
- Documentation-only audit heads are not exact-head CI GREEN unless an applicable workflow actually verifies them.

## Document authority order
When wording conflicts, use this order:
1. This `AGENTS.md` + `docs/superpowers/plans/2026-09-03-production-v1-launch-master-plan.md`.
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
4. Sept 2 identity/source/TradingView docs where still referenced by Sept 3.
5. Sept 1 foundation docs are historical context, not final production-readiness authority.

Later Sept 3 resilience/cutover rules control where they tighten older component plans. Important order: execution design -> retry plan -> later hot-path resilience design/plan -> later production cutover runbook.

## Critical runtime safety defaults
Keep fail closed throughout static remediation:
- `TRADINGVIEW_DIRECT_INGRESS_ENABLED=false`
- `TRADINGVIEW_CERT_PROBE_ENABLED=false`
- `TRADING_ACCESS_ENABLED=false`
- `BROKER_EXECUTION_ENABLED=false`

No tenant/admin API may mutate Worker-wide master fuses.

## Production identity / tenancy
- Managed Mkety Zitadel is the global identity authority.
- Trading and MKSaaS remain separate products/projects/databases.
- Trading-only customers must not require an MKSaaS database workspace/profile.
- Trading membership is exact `(workspace_id, zitadel_subject)`.
- Login alone never grants Trading access.
- Roles: owner/admin/operator/viewer; unknown roles fail closed.
- No role grants Worker master-fuse authority.
- Trading authorization never falls back to MKSaaS workspace/membership data.

## Core execution/safety contract
- Clear machine-readable instructions are deterministic; AI is never required for them.
- Ambiguous AI failure/circuit-open -> `NEEDS_REVIEW`; never guess execution.
- Telegram AI is presentation-only and cannot alter canonical execution semantics.
- Caller workspace/account/provider/destination/broker/credential/execution hints are never authority.
- Persistent event/destination/order idempotency is mandatory.
- Broker/platform metadata is authoritative for symbol, precision, tick economics, volume, account mode and execution semantics.
- Final source/workspace/account/safety/risk authority must be revalidated immediately before every broker action.
- Critical source/workspace/account/kill/execution revocation must win immediately.
- A live volume normalization step must never silently increase intended risk.
- Successful broker truth must remain reconcilable with persistent delivery state and exact Trade State without resending solely to repair state.
- Uncertain broker outcomes are reconciled; never blindly retried.
- cTrader `ProtoOASymbol.lotSize` raw protocol-cent semantics remain unchanged.
- Identity/admin/database/source/infrastructure actions never implicitly enable broker execution.

## Production execution locks
Before a broker adapter may be reached, all applicable locks must pass:
1. `TRADING_ACCESS_ENABLED=true`.
2. `BROKER_EXECUTION_ENABLED=true`.
3. exact persisted originating source remains active and workspace-authoritative.
4. exact `trading_workspace_access.trading_access_enabled=true`.
5. exact trade account belongs to workspace and remains active.
6. account `execution_enabled=true`.
7. latest safety/kill/risk/exposure policy allows the action.
8. server-side platform/destination configuration is complete.
9. broker-authoritative symbol/risk/volume metadata validates the final executable action.
10. persistent destination idempotency reservation succeeds.
11. TradingView execution additionally requires its accepted direct-ingress/source/certificate trust path.

## Production V1 launch gates — current interpretation
Master plan: `docs/superpowers/plans/2026-09-03-production-v1-launch-master-plan.md`.

1. Scope freeze — historical GREEN.
2. Real Cloudflare staging — historical GREEN / exited; do not repeat without specific reason.
3. TradingView certificate/direct ingress — DEFERRED / FAIL-CLOSED; genuine origin acceptance unavailable while paid webhook capability is unavailable.
4. Zitadel real non-live identity — static foundation GREEN / real acceptance pending.
5. Telegram MTProto soak — static harness GREEN / real soak pending.
6. MT5/cTrader source acceptance — probe bridge GREEN / real demo probes pending.
7. MT5/cTrader broker demo destinations — lifecycle bridge GREEN / real demo lifecycles pending.
8. End-to-end staging — **STATIC AUDIT REOPENED; remediation required first**, then real acceptance.
9. Production operations/readiness — **STATIC AUDIT REOPENED; remediation required first**, then real monitoring/kill/rollback/recovery/security/sustained measurements.
10. Controlled production cutover — CLOSED / not started.

Production-ready/general launch still requires applicable real gate evidence, shadow production, production-infrastructure demo, separate tiny-live approval, tiny-live acceptance and controlled beta.

## Historical gate evidence retained
### Gate 1
- head `aebec4adf71a7f7299b3279d1b4c8b03803e25be`
- run `33695618717` GREEN.

### Gate 2
- final head `e2e93aaa131ec2149966e8ca2f480d4fdccc300a`
- run `33725547513`, job `100553745522` SUCCESS
- known-good Worker version `c25e85d5-bfe2-4d17-9ab4-5133d88ecec8`
- temporary acceptance version `2608756e-2096-409d-9a2c-8e678503a4dd`
- duplicate convergence, READY processing, SIMULATED planning, broker execution false, rollback and cleanup proven.

### Gate 3 static/probe
- trigger `983bf36732a37a787cc253fec391a6a18d6c4517`
- run `33728657084`, job `100563529178`
- spoof request 403 and rollback proven.

### Gate 6 bridge
- `705e628eba02d6fb7c5925d4b8a2a0b6ca04c1dd`, run `33731004622`
- `f02ebe449cc13157dadd0c7663e2fc1bee095ec3`, run `33731624548`
- workflow baseline `c24a97af7da92981cee37934718d1bde0b8d5778`
- MT5 mapping `3a082b6da1ae255a2c2aa497eddd192606b947fa`, run `33733468585`
- markers: `demo: probe mt5 gate 6`, `demo: probe ctrader gate 6`.

### Gate 7 bridge
- RED `b71592bd549d105979bb64a51ede07a43dc2b631`, run `33733620119`
- bridge GREEN `a40c4b2ccb45204b1dd4ee24b53c860b78765681`
- dedicated GREEN run `33733929722`; ordinary CI `33733933644`
- markers: `demo: lifecycle mt5 gate 7`, `demo: lifecycle ctrader gate 7`.
- Worker broker fuse remains false in dedicated demo workflow.

## Frozen latest-approved static audit findings
Detailed evidence/root-cause trace is in `cloudflare-v2/docs/PRODUCTION_V1_DEVELOPMENT_AUDIT.md`.

### F1 — non-HTTP broker-capable paths do not structurally enforce both Worker master fuses
- external fetch guard checks Trading access;
- Queue processing runs below it;
- production execution stage/retry recovery check broker fuse but not Trading access.
**Status:** confirmed static safety gap.

### F2 — workspace entitlement is not a final broker-dispatch authority check
- admin path checks entitlement;
- source-to-broker path does not revalidate it immediately before dispatch.
**Status:** confirmed static safety gap.

### F3 — account active/execution/safety authority is loaded once per multi-action plan
- later action can miss revocation that occurs after an earlier action.
**Status:** confirmed static safety gap.

### F4 — source disablement is not revalidated before dispatch/retry
- source is authoritative at ingest but not at final execution.
**Status:** confirmed static safety gap.

### F5 — broker success can remain durably unbound from Trade State
- executor persists delivery `SUCCEEDED` first;
- later state binding can fail;
- retry only scans `RETRYABLE`; duplicate path skips state binding;
- no repair path exists.
**Status:** confirmed static recovery gap. Repair must use persisted success; never resend broker action solely to repair state.

### F6 — legacy `trade_accounts` FK reintroduces MKSaaS/Trading coupling
- checked-in `trade_accounts.workspace_id` references legacy/shared `public.workspaces(id) ON DELETE CASCADE`;
- approved Trading identity model requires Trading-only workspaces/accounts independent of MKSaaS.
**Status:** confirmed checked-in schema gap. Verify actual live constraint read-only in an explicitly authorized environment before migration.

### F7 — production risk-to-volume is not revalidated from broker-authoritative live economics
- actual risk-to-lots calculation happens in simulation/planning using static `TRADING_V1_SIMULATION_*` context + DB account row;
- production adapter later loads live broker catalog but only translates already-computed lots;
- current account/catalog structures do not provide a complete live loss-per-lot/equity/exposure authority to the risk engine.
**Status:** confirmed production safety gap.

### F8 — live MT5/cTrader volume normalization can increase planned volume
- current normalizers round/clamp to live broker min/max/step;
- this conflicts with risk engine rule that a broker minimum which would exceed intended risk must fail closed.
**Status:** confirmed production safety gap.

### F9 — normal production stage drops `tradingEventId` before destination-delivery persistence
- coordinator receives event ID;
- production dependency factory supports `tradingEventId`;
- execution stage does not pass it to the dependency factory.
**Status:** confirmed durability/audit/recovery gap.

### F10 — final dispatch policy recheck lacks reliable current lots/risk/daily/open-risk inputs
- policy evaluator expects `totalLots`, `riskPercent`, `currentDailyPnlPercent`, `currentOpenRiskPercent`;
- real execution composition supplies mismatched/missing fields and no fresh broker exposure snapshot;
- coordinator unit tests manually supply values that normal composition does not.
**Status:** confirmed production safety gap.

## Integration incompletions
### I1 — runtime execution snapshot helper not integrated
Unit/helper contract is GREEN, but latest approved resilience Task 5 integration is incomplete.

### I2 — warm broker context/session reuse incomplete
MT5 metadata is reloaded per action; cTrader runtime is authenticated/closed per action. Complete only after safety authority is corrected.

## Unresolved boundary
### U1 — MT5 metadata GET transport
`/v1/account`, `/v1/symbols`, `/v1/tick` are unauthenticated at bridge level. Repo does not prove that the externally consumed HTTPS bridge is strictly private. Static remediation should prefer authenticated metadata requests unless separately authorized staging proves an equally strong private transport contract.

## Root-cause consolidation for remediation planning
Use existing durable/server authority rather than adding caller-controlled state.

### A. Final server-authoritative execution check
Immediately before every broker action, keyed by server-owned `(workspaceId, tradingEventId, accountId)`, revalidate:
- master fuses at the appropriate structural boundary;
- persisted event -> source identity;
- source active/workspace match;
- workspace entitlement;
- account active/execution/safety/kill;
- current broker/account risk/exposure state;
- broker-authoritative symbol/risk/volume metadata for new risk.

### B. Broker-authoritative risk materialization
Simulation remains planning/audit. Final risk-increasing lots must be verified/materialized from current broker/account truth before send. Live normalization may not raise risk.

### C. Successful-delivery state-binding repair
Repair exact Trade State from already-persisted delivery success + trusted group/leg context. No broker resend.

### D. Trading-owned trade-account tenancy
After authorized read-only live-schema confirmation, create an additive migration contract so Trading broker accounts no longer require/cascade from MKSaaS workspace rows.

### E. Bounded warm context
Use snapshot/session reuse only for non-authoritative metadata/performance. Fresh final safety/risk authority always wins.

## External acceptance blockers — do not execute until static remediation GREEN
- real managed Zitadel identity acceptance;
- real Telegram account/channel soak;
- MT5/cTrader real demo source probes with exact Gate 6 markers;
- MT5/cTrader dedicated demo lifecycle acceptance with exact Gate 7 markers;
- real E2E staging and sustained latency/failure/isolation measurements;
- Gate 9 monitoring/kill/rollback/recovery/security drills;
- genuine TradingView-originated acceptance remains deferred;
- Gate 10 shadow/demo/live/beta phases remain unstarted.

## Gate 10
CLOSED / not started.
- Shadow production and production-infrastructure demo precede live money.
- Live cutover requires all applicable prior mandatory gates GREEN or reviewed scope removal plus separate explicit tiny-live approval.
- Owner must explicitly set maximum per-trade risk, maximum volume, max concurrent/open risk, daily loss ceiling, allowed symbols, kill/rollback contacts/procedure.
- Never invent/default live financial thresholds.

## Exact pickup / immediate next safe actions
1. Use the Superpowers writing-plans workflow to create one focused static production-remediation implementation plan for F1–F10, I1–I2 and U1.
2. Do not modify runtime code before the plan is committed/reviewed against latest approved specs.
3. Prioritize safety/durability before performance:
   - dual-fuse gating;
   - exact event/source/workspace/account final authority;
   - event ID propagation;
   - broker-authoritative risk/fail-closed volume;
   - final policy inputs;
   - successful-delivery Trade State repair;
   - Trading-owned trade-account migration contract.
4. Then integrate snapshot/warm context without weakening final authority and harden MT5 metadata transport.
5. Every production-code task: TDD failing regression -> verify RED -> minimal implementation -> focused GREEN -> ordinary full PR CI exact-head GREEN.
6. Keep protected Cloudflare/probe/demo/live exact-marker jobs skipped during static remediation.
7. Synchronize this file and `cloudflare-v2/docs/PRODUCTION_V1_DEVELOPMENT_AUDIT.md` after every meaningful verified milestone with exact SHA/run/test counts and next pickup point.
8. Only after static remediation is exact-head GREEN return to separately authorized real Gates 4–9.

## Safety state during static remediation
Keep all four controls OFF. Do not deploy, mutate Cloudflare, run protected external probes, place demo/live broker orders, merge `main`, or enable real-money execution during this static batch.
