# Trading V1 – Operational Source of Truth

## Mission
Build and launch an enterprise, multi-tenant trading automation platform with strict isolation, deterministic safety, durable idempotency, provider redundancy, admin controls, and explicit production cutover gates.

## Repository / Branch
- Repository: `MketyDigital/Trading`
- Active branch: `design/enterprise-trading-event-core`
- Draft PR: #2 targeting `main`
- This remains development-to-real-production work. Do not merge/finish the branch yet.
- Never merge `main` without explicit user instruction.
- Never enable real-money execution without separate explicit final approval.

## Current stage / handoff
- Trusted pre-audit runtime/content tree: `89944d3b6aa4b03f6bb1a1107594e9acfa424fb3`.
- Last broad pre-remediation CI on that tree: run `33766769463` SUCCESS; Node/trading-core 649/649, MT5 14/14, Container MTProto 11/11, external MTProto 22/22; protected Cloudflare jobs skipped.
- Frozen audit-scope commit: `7b175a548c9134b0e88ba4fa5977de51142b6cd3`.
- Pre-remediation AGENTS sync: `a9eecb4b9f843dbdbfc36c81961c7efa76c255af`.
- Detailed audit/remediation record: `cloudflare-v2/docs/PRODUCTION_V1_DEVELOPMENT_AUDIT.md`.
- Static remediation plan: `docs/superpowers/plans/2026-09-03-production-readiness-remediation.md` at `567d8fe06c291eb393b5c23b3bd2d2dfbb65dbe4`.
- Task 1 detailed evidence sync: `905ec9ba10a35a7fb0ea6e6337da2364c73b049b`.
- Current stage: **STATIC PRODUCTION REMEDIATION IN PROGRESS — TASK 1 GREEN / TASK 2 NEXT**.

## Critical runtime safety defaults
Keep fail closed throughout static remediation:
- `TRADINGVIEW_DIRECT_INGRESS_ENABLED=false`
- `TRADINGVIEW_CERT_PROBE_ENABLED=false`
- `TRADING_ACCESS_ENABLED=false`
- `BROKER_EXECUTION_ENABLED=false`

No tenant/admin API may mutate Worker-wide master fuses.

## Core execution/safety contract
- Clear machine-readable instructions are deterministic; AI is never required for them.
- Ambiguous AI failure/circuit-open -> `NEEDS_REVIEW`; never guess execution.
- Telegram AI is presentation-only and cannot alter canonical execution semantics.
- Caller workspace/account/provider/destination/broker/credential/execution hints are never authority.
- Persistent event/destination/order idempotency is mandatory.
- Broker metadata is authoritative for symbol, precision, tick economics, volume, account mode, and execution semantics.
- Final source/workspace/account/safety/risk authority must be revalidated immediately before every broker action.
- Critical source/workspace/account/kill/execution revocation must win immediately.
- Live volume normalization must never silently increase intended risk.
- Successful broker truth must remain reconcilable with persistent delivery state and exact Trade State without resending solely to repair state.
- Uncertain broker outcomes are reconciled; never blindly retried.
- cTrader raw `ProtoOASymbol.lotSize` protocol-cent semantics remain unchanged.

## Production execution locks
Before a broker adapter may be reached, all applicable locks must pass:
1. `TRADING_ACCESS_ENABLED=true`.
2. `BROKER_EXECUTION_ENABLED=true`.
3. exact persisted originating source remains active/workspace-authoritative.
4. exact workspace entitlement remains enabled.
5. exact trade account belongs to workspace and remains active.
6. account `execution_enabled=true`.
7. latest safety/kill/risk/exposure policy allows the action.
8. server-side platform/destination configuration is complete.
9. broker-authoritative symbol/risk/volume metadata validates final executable action.
10. persistent destination idempotency reservation succeeds.
11. TradingView execution additionally requires its accepted ingress/source/certificate path.

## Production V1 launch gates — current interpretation
1. Scope freeze — historical GREEN.
2. Real Cloudflare staging — historical GREEN / exited; do not repeat without reason.
3. TradingView direct ingress — DEFERRED / FAIL-CLOSED.
4. Zitadel real non-live identity — real acceptance pending.
5. Telegram MTProto soak — real soak pending.
6. MT5/cTrader source acceptance — real demo probes pending.
7. MT5/cTrader broker demo destinations — real demo lifecycles pending.
8. End-to-end staging — static remediation first, then real acceptance.
9. Production operations/readiness — static remediation first, then real monitoring/kill/rollback/recovery/security/sustained measurements.
10. Controlled production cutover — CLOSED / not started.

Production-ready/general launch still requires applicable real gate evidence, shadow production, production-infrastructure demo, separate tiny-live approval, tiny-live acceptance, controlled beta, and no unresolved severity-1/2 trading-safety issue.

## Static remediation status

### Task 1 / F1 — dual master fuses on every production broker-capable path
**STATIC GREEN / RESOLVED.**

RED:
- test commits `3bc54e60b85c065dfade8039fe0c9e0303aabacd` and `7961849db8355c67801db5f68c3d5357f0768f99`;
- exact RED run `33782879644`, job `100740562007`;
- Worker/trading-core failed on the new missing-access-fuse regressions; protected Cloudflare jobs skipped.

Implementation:
- execution-stage guard `fc69dafa78803429c49028a31457a75746faf187`;
- production retry guard `11a143abc7c71e55beb5b2505048a1e3963d16f0`.

First GREEN attempt:
- run `33783066190`, job `100741166130` failed because older positive hot-path fixtures enabled only the broker fuse.
- systematic debugging found fixture drift; production guard was not weakened.

Final GREEN:
- exact head `1632889c6b26e88451ece25ba13c649b43357c5a`;
- run `33783267187`;
- test job `100741828652` SUCCESS;
- Worker/trading-core SUCCESS;
- pure MT5 bridge SUCCESS;
- Container/external MTProto Python SUCCESS;
- Cloudflare inspect/probe/deploy/accept jobs SKIPPED.

Resolved behavior:
- Trading access false/missing blocks normal production execution before dependency construction even if broker fuse is true.
- Trading access false/missing blocks production retry before Supabase/due-scan/claim/dependency/broker work.
- Broker fuse remains a separate structural denial when Trading access is true.

### Task 2 — F2/F3/F4/F9 final durable execution authority
**NEXT / not started.**
Required TDD regressions:
- exact persisted `eventId` must become `tradingEventId` in production dependency/delivery context;
- missing/mismatched event, inactive source, source/workspace mismatch, disabled workspace entitlement, missing/mismatched/inactive/execution-disabled account fail closed;
- final authority reload occurs inside every account action loop so revocation after action 1 blocks action 2;
- scheduled retry derives authority from durable delivery workspace/event/account identity and never request-payload source/workspace hints.

### Task 3 — F7/F8/F10 broker-authoritative risk/volume/policy
OPEN after Task 2.

### Task 4 — F5 successful-broker-result Trade State repair without resend
OPEN.

### Task 5 — F6 Trading-owned trade-account workspace FK migration contract
OPEN; do not apply to real DB until authorized read-only schema/ledger inspection.

### Task 6 — I1 runtime snapshot production integration
OPEN; non-authoritative optimization only.

### Task 7 — I2/U1 warm broker contexts + authenticated MT5 metadata requests
OPEN.

### Task 8 — complete integrated failure matrix + exact-head static acceptance
OPEN.

### Task 9 — real production acceptance path
After static remediation GREEN: Gates 4 -> 9, then Gate 10 shadow/demo phases, separate tiny-live approval, tiny live, beta, general production.

## Remaining frozen findings
- F2 workspace entitlement final check — OPEN.
- F3 per-action account/safety revocation — OPEN.
- F4 source revocation before dispatch/retry — OPEN.
- F5 successful delivery / missing Trade State repair — OPEN.
- F6 legacy shared-workspace FK — OPEN.
- F7 live broker-authoritative risk sizing — OPEN.
- F8 unsafe upward live volume normalization — OPEN.
- F9 `tradingEventId` propagation — OPEN.
- F10 final policy inputs — OPEN.
- I1 snapshot integration — OPEN.
- I2 warm broker contexts — OPEN.
- U1 MT5 metadata GET authentication — OPEN.

## External acceptance blockers — do not execute until static remediation GREEN
- managed Zitadel real non-live acceptance;
- real Telegram account/channel soak;
- MT5/cTrader real demo source probes with exact Gate 6 markers;
- MT5/cTrader dedicated demo lifecycle with exact Gate 7 markers;
- real E2E staging and sustained latency/failure/isolation measurements;
- Gate 9 monitoring/kill/rollback/recovery/security drills;
- genuine TradingView-originated acceptance remains deferred;
- Gate 10 shadow/demo/live/beta phases remain unstarted.

## Gate 10
CLOSED / not started.
- Shadow production and production-infrastructure demo precede live money.
- Live cutover requires all applicable prior mandatory gates GREEN or reviewed scope removal plus separate explicit tiny-live approval.
- Owner must explicitly set max per-trade risk, max volume, max concurrent/open risk, daily loss ceiling, allowed symbols, and kill/rollback contacts/procedure.
- Never invent/default live financial thresholds.

## Exact pickup / immediate next safe actions
1. Continue from Task 2 in `docs/superpowers/plans/2026-09-03-production-readiness-remediation.md`.
2. Write Task 2 tests only; do not change production authority code until exact RED is verified.
3. Verify RED on ordinary PR CI, keeping protected jobs skipped.
4. Implement one final server-authoritative loader keyed by exact `(workspaceId, tradingEventId, accountId)` and call it immediately before every action/retry dispatch.
5. Synchronize this file and `cloudflare-v2/docs/PRODUCTION_V1_DEVELOPMENT_AUDIT.md` after Task 2 exact-head GREEN.
6. Continue Tasks 3–8 with the same RED -> minimal GREEN -> exact-head CI discipline.
7. Only after static remediation is GREEN return to separately authorized real Gates 4–9.

## Safety state during static remediation
Do not deploy, mutate Cloudflare, run protected external probes, place demo/live broker orders, merge `main`, or enable real-money execution during this static batch.
