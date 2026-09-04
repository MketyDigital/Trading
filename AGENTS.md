# Trading V1 – Operational Source of Truth

## Mission
Build and launch an enterprise, multi-tenant trading automation SaaS with strict tenant/provider/account/destination isolation, deterministic safety, durable idempotency, provider redundancy, admin controls, and explicit production cutover gates.

## Product / production-flow intent
The intended production system is not a single broker copier. It is a Trading-owned multi-tenant event platform:

1. **Sources** — Telegram MTProto (container provider plus external fallback), TradingView, MT5 source, cTrader source, and custom API normalize into one canonical Trading Event.
2. **Canonical planning** — clear machine-readable instructions are parsed deterministically; AI is optional for ambiguity/presentation only. Ambiguous AI failure/circuit-open becomes `NEEDS_REVIEW`, never guessed execution.
3. **Persistence/idempotency** — source/event/destination/order identity is durable so duplicate ingress, retries, restarts, or failover cannot create duplicate money-moving actions.
4. **Destinations** — Telegram/human delivery and broker destinations are sibling fan-out paths. A Telegram destination failure must not cancel or roll back a healthy broker path, and one broker/account/destination/provider/workspace failure must remain isolated from siblings.
5. **Final execution authority** — immediately before every broker action, the runtime revalidates the exact durable event/source, Trading-owned workspace entitlement, exact account active/execution state, kill/safety policy, fresh risk/exposure context, broker symbol/economic metadata, and final executable volume.
6. **Broker send** — only the canonical validated action is dispatched through the exact platform adapter with persistent destination/order idempotency.
7. **State convergence** — successful broker truth must become durable delivery truth and exact Trade State. If state binding fails after broker success, repair must use persisted successful broker truth and must never resend the broker action merely to repair state.
8. **Identity/tenancy** — Mkety Trading may share Zitadel identity with the wider Mkety ecosystem, but Trading authorization/runtime/data/workspace authority is Trading-owned; MKSaaS rows are not Trading tenancy authority.
9. **Failure model** — optional subsystem failures degrade gracefully; safety/correctness uncertainty fails closed only on the affected money-moving path. Uncertain broker outcomes are reconciled, never blindly retried.

Telegram AI is presentation-only and cannot mutate canonical execution semantics. Caller-supplied workspace/account/provider/destination/broker/credential/execution hints are never authority. cTrader raw `ProtoOASymbol.lotSize` protocol-cent semantics remain unchanged.

## Repository / branch
- Repository: `MketyDigital/Trading`
- Active branch: `design/enterprise-trading-event-core`
- Draft PR: #2 targeting `main`
- Current verified implementation head before this documentation sync: `a3a507b569499524d6de75ad8c519db5dd944efb`
- PR merge ref for that verified head: `acae950fa02f509ecf69fb5c8d9ba5949da6513b`
- This remains development-to-real-production work. Do not merge/finish the branch yet.
- Never merge `main` without explicit user instruction.
- Never enable real-money execution without separate explicit final approval.

## Current stage / handoff
- Trusted pre-audit runtime/content tree: `89944d3b6aa4b03f6bb1a1107594e9acfa424fb3`.
- Frozen audit-scope commit: `7b175a548c9134b0e88ba4fa5977de51142b6cd3`.
- Static remediation plan: `docs/superpowers/plans/2026-09-03-production-readiness-remediation.md` at `567d8fe06c291eb393b5c23b3bd2d2dfbb65dbe4`.
- Detailed continuation/evidence record: `cloudflare-v2/docs/PRODUCTION_V1_DEVELOPMENT_AUDIT.md`.
- Current stage: **STATIC PRODUCTION REMEDIATION IN PROGRESS — TASK 3 GREEN / TASK 4 ACTIVE NEXT**.

## Critical runtime safety defaults
Keep fail closed throughout static remediation:
- `TRADINGVIEW_DIRECT_INGRESS_ENABLED=false`
- `TRADINGVIEW_CERT_PROBE_ENABLED=false`
- `TRADING_ACCESS_ENABLED=false`
- `BROKER_EXECUTION_ENABLED=false`

No tenant/admin API may mutate Worker-wide master fuses.

## Core execution/safety contract
- Deterministic parsing/planning is primary; AI never authorizes clear machine-readable execution.
- Ambiguous AI failure/circuit-open -> `NEEDS_REVIEW`; never guess execution.
- Persistent event/destination/order idempotency is mandatory.
- Broker metadata is authoritative for symbol, precision, tick economics, volume, account mode, and execution semantics.
- Final source/workspace/account/safety/risk authority must be revalidated immediately before every broker action.
- Critical source/workspace/account/kill/execution revocation must win immediately.
- Risk-increasing live volume normalization must never silently increase intended risk.
- Risk-reducing protective actions remain permitted under drawdown/open-risk locks unless the kill switch blocks them.
- Successful broker truth must remain reconcilable with persistent delivery state and exact Trade State without resending solely to repair state.
- Uncertain broker outcomes are reconciled; never blindly retried.

## Production execution locks
Before a broker adapter may be reached, all applicable locks must pass:
1. `TRADING_ACCESS_ENABLED=true`.
2. `BROKER_EXECUTION_ENABLED=true`.
3. exact persisted originating source remains active/workspace-authoritative.
4. exact Trading workspace entitlement remains enabled.
5. exact trade account belongs to that Trading workspace and remains active.
6. account `execution_enabled=true`.
7. latest kill/safety/risk/exposure policy allows the action.
8. server-owned platform/destination configuration is complete.
9. broker-authoritative symbol/risk/volume metadata validates the final executable action.
10. persistent destination/order idempotency reservation succeeds.
11. TradingView execution additionally requires its accepted ingress/source/certificate path.

## Production V1 launch gates
1. Scope freeze — historical GREEN.
2. Real Cloudflare staging — historical GREEN / exited; do not repeat without reason.
3. TradingView direct ingress — DEFERRED / FAIL-CLOSED.
4. Zitadel real non-live identity — real acceptance pending.
5. Telegram MTProto soak/recovery — real acceptance pending.
6. MT5/cTrader source acceptance — real demo source probes pending.
7. MT5/cTrader broker demo destinations — real demo lifecycle pending.
8. End-to-end staging/failure soak — static remediation first, then real acceptance.
9. Production operations/readiness — static remediation first, then monitoring/kill/rollback/recovery/security drills and sustained measurements.
10. Controlled production cutover — CLOSED / not started: A shadow, B production infrastructure + dedicated demo, C tiny controlled live only after separate explicit approval and explicit owner thresholds, D controlled beta, E general production.

Production-ready/general launch still requires applicable real gate evidence and no unresolved severity-1/2 trading-safety issue.

## Static remediation status

### Task 1 / F1 — dual master fuses
**STATIC GREEN / RESOLVED.**
- RED head `7961849db8355c67801db5f68c3d5357f0768f99`, run `33782879644`, job `100740562007`.
- GREEN head `1632889c6b26e88451ece25ba13c649b43357c5a`, run `33783267187`, job `100741828652` SUCCESS.

### Task 2 / F2/F3/F4/F9 — durable final execution authority
**STATIC GREEN / RESOLVED.**
- Final RED head `71be214f260adf9800bee362ede92ebe62888d5e`, run `33783879937`, job `100743853586`.
- Final implementation head `9ba95eea33748aea1ab641e2aab4e0aec67068dc`.
- GREEN run `33784508546`, job `100745907350` SUCCESS.
- Exact persisted event -> source -> Trading workspace entitlement -> exact account authority is reloaded per action and retry.

### Task 3 / F7/F8/F10 — broker-authoritative risk, strict volume, canonical final policy
**STATIC GREEN / RESOLVED.**

RED evidence:
- initial broker-risk contract commit `825f8839b2ac53265547af547bc790e753f3f0da`, run `33785080713`, job `100747771938`;
- strict MT5/cTrader volume RED commit `e9a4729699b7617ea44d12f9b15708264fe573b5`;
- canonical final policy RED head `fc1496e7b62b4e11c385d0a8fed3ca8a783b8c24`, run `33785495528`, job `100749133738`;
- RED result: Node/trading-core 665 total, 659 passed, exactly 6 intended Task 3 failures; no unrelated regression; protected Cloudflare jobs skipped.
- additional real-composition RED guard `83ed3dcb6b739efff3077b9242d5f972af528f5f` required `createProductionExecutionDependencies()` itself to expose the broker-authoritative materializer so unit-only GREEN could not hide a runtime bypass.

Implemented contract:
- `production_risk_authority.js` revalidates risk-increasing OPENs using current broker account truth and broker symbol economics before send;
- planned volume above current broker-authoritative allowed volume blocks;
- missing reliable monetary loss-at-stop model fails closed;
- MT5 and cTrader OPEN translation uses strict execution validators: below-minimum, above-maximum, or off-step risk-increasing volume blocks rather than clamp/round upward;
- partial-close/protective management keeps separate de-risking semantics;
- coordinator order is final durable authority -> broker/risk materialization -> canonical account policy -> dispatch;
- MT5 catalog preserves loss-side tick economics (`trade_tick_value_loss`, fallback generic broker tick value), min/max/step and contract metadata;
- if max daily loss or max open-risk policy is configured, authoritative exposure context is mandatory; stale simulation values are not accepted as final authority;
- current cTrader runtime does not expose a reliable monetary loss-at-stop model, therefore risk-percent/fixed-risk cTrader OPEN fails closed instead of using guessed economics. Fixed-lot and risk-reducing paths remain subject to their applicable broker-volume/policy checks.

Exact-head GREEN:
- implementation head `a3a507b569499524d6de75ad8c519db5dd944efb`;
- PR run `33843616430`;
- mandatory test job `100930741996` SUCCESS;
- Node/trading-core **669/669 PASS**;
- pure MT5 bridge **14/14 PASS**;
- Container MTProto **11/11 PASS**;
- external MTProto **22/22 PASS**;
- protected Cloudflare inspect/probe/deploy/accept jobs all SKIPPED;
- no deployment, external protected probe, demo/live broker order, or Cloudflare mutation occurred.

### Task 4 / F5 — successful-broker-result Trade State repair without resend
**ACTIVE NEXT / RED required first.**
Required contract:
- broker action succeeds and durable delivery retains exact broker IDs;
- Trade State bind fails afterward;
- durable repair work remains discoverable without turning the broker delivery back into a resendable broker action;
- repair binds exact persisted broker IDs to exact workspace/account/group/leg;
- repair performs **zero broker dispatches**;
- repair is idempotent and already-bound state converges;
- cross-workspace/event/account/group/leg mismatch fails closed.

### Task 5 / F6 — Trading-owned trade-account workspace FK migration contract
OPEN. Static migration contract only; do not apply to real DB until separately authorized read-only schema/ledger inspection confirms prerequisites.

### Task 6 / I1 — runtime snapshot production integration
OPEN. Non-secret/non-authoritative optimization only; snapshots must never override source status, workspace entitlement, account execution state, kill switch, broker fuse, or dynamic risk/exposure.

### Task 7 / I2/U1 — warm broker contexts + authenticated MT5 metadata
OPEN. Add bounded context/session reuse without weakening final fresh authority; authenticate MT5 metadata boundary. Any cTrader monetary risk model must be broker-native/reliable, never invented.

### Task 8 — integrated failure matrix + exact-head static acceptance
OPEN. Must cover master fuses, source/workspace/account revocation, broker-min/off-step volume, stale/missing risk exposure, event linkage, and broker-success/state-bind repair, then all ordinary suites exact-head GREEN with protected jobs skipped.

### Task 9 — real production acceptance path
Only after static remediation GREEN: Gates 4 -> 9, then Gate 10 shadow/demo phases, separate tiny-live approval, tiny live, beta, general production.

## Finding status
- F1 RESOLVED Task 1.
- F2 RESOLVED Task 2.
- F3 RESOLVED Task 2 for mutable account authority; final dynamic risk/exposure authority resolved in Task 3.
- F4 RESOLVED Task 2.
- F5 OPEN / Task 4.
- F6 OPEN / Task 5.
- F7 RESOLVED Task 3.
- F8 RESOLVED Task 3.
- F9 RESOLVED Task 2.
- F10 RESOLVED Task 3.
- I1 OPEN / Task 6.
- I2 OPEN / Task 7.
- U1 OPEN / Task 7.

## External acceptance blockers — do not execute during static remediation
- managed Zitadel real non-live acceptance;
- real Telegram account/channel soak;
- MT5/cTrader real demo source probes with exact Gate 6 markers;
- MT5/cTrader dedicated demo lifecycle with exact Gate 7 markers;
- real E2E staging and sustained latency/failure/isolation measurements;
- Gate 9 monitoring/kill/rollback/recovery/security drills;
- genuine TradingView-originated acceptance remains deferred;
- Gate 10 shadow/demo/live/beta phases remain unstarted.

## Gate 10 safety
CLOSED / not started.
- Shadow production and production-infrastructure demo precede live money.
- Live cutover requires applicable prior gates GREEN or explicitly reviewed scope removal plus separate explicit tiny-live approval.
- Owner must explicitly set max per-trade risk, max volume, max concurrent/open risk, daily loss ceiling, allowed symbols, and kill/rollback contacts/procedure.
- Never invent/default live financial thresholds.

## Exact startup / pickup point for any future session
1. Read this file first, then `cloudflare-v2/docs/PRODUCTION_V1_DEVELOPMENT_AUDIT.md`, then the Sept 3 launch master/remediation plans. Later Sept 3 resilience/cutover rules override older component plans where stricter.
2. Confirm PR #2 still targets `main`, branch is `design/enterprise-trading-event-core`, and reconcile current branch head before any write.
3. Trust Task 3 GREEN only from exact implementation head `a3a507b...` and PR run `33843616430` / job `100930741996` with counts 669 + 14 + 11 + 22 all passing and protected jobs skipped.
4. Continue **Task 4/F5 RED first**. Trace delivery persistence, coordinator state-bind failure, Trade State binding API, and retry/recovery scanners before designing persistence changes.
5. RED must prove broker success followed by state-bind failure leaves durable repair work, repair uses persisted successful broker IDs, and broker dispatch count remains zero during repair.
6. Verify exact intended RED through ordinary PR CI before production repair implementation.
7. Implement minimal durable state-repair path; do not convert successful broker delivery into ordinary RETRYABLE broker delivery.
8. Require exact-head full ordinary PR CI GREEN, with protected jobs skipped, before calling Task 4 GREEN.
9. Immediately synchronize this file and `cloudflare-v2/docs/PRODUCTION_V1_DEVELOPMENT_AUDIT.md`, then proceed Tasks 5–8 under the same RED -> minimal GREEN -> exact-head CI cycle.
10. Only after all static remediation is GREEN return to separately authorized real Gates 4–9.

## Safety state during static remediation
Do not deploy, mutate Cloudflare, run protected external probes, place demo/live broker orders, merge `main`, or enable real-money execution during this static batch.