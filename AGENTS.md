# Trading V1 – Operational Source of Truth

## Mission
Build and launch an enterprise, multi-tenant trading automation SaaS with strict tenant/provider/account/destination isolation, deterministic safety, durable idempotency, provider redundancy, admin controls, and explicit production cutover gates.

## Production-flow intent
1. Telegram MTProto, TradingView, MT5 source, cTrader source, and custom API normalize into one canonical Trading Event.
2. Clear instructions are deterministic; AI is ambiguity/presentation assistance only. Ambiguous AI failure becomes `NEEDS_REVIEW`, never guessed execution.
3. Source/event/destination/order identity is durable and workspace-scoped.
4. Human delivery and broker destinations are isolated sibling fan-out paths.
5. Immediately before every broker action, reload exact persisted event/source, Trading workspace entitlement, exact account state, kill/safety policy, fresh risk/exposure, broker economics, and final executable volume.
6. Dispatch only the canonical validated action through exact platform authority with persistent idempotency.
7. Broker success must converge to durable delivery truth and Trade State. State repair uses persisted successful broker truth and never resends solely to repair state.
8. Zitadel identity may be shared across Mkety products, but Trading tenancy/authorization/data authority is Trading-owned.
9. Optional subsystem failures degrade locally; money-moving uncertainty fails closed only on the affected path. Uncertain broker outcomes are reconciled, never blindly retried.

Caller-supplied workspace/account/provider/destination/broker/credential/execution hints are never authority. cTrader raw `ProtoOASymbol.lotSize` protocol-cent semantics remain unchanged.

## Repository / branch
- Repository: `MketyDigital/Trading`
- Active branch: `design/enterprise-trading-event-core`
- Draft PR: #2 targeting `main`
- Current verified implementation/static-acceptance head before this documentation sync: `a7da981a5daec426b5aad840739555edfbc68819`
- Verified ordinary PR run: `33865341673`; test job `100998803951` SUCCESS.
- Node/trading-core **685/685 PASS**; MT5 **14/14 PASS**; Container MTProto **11/11 PASS**; external MTProto **22/22 PASS**.
- Protected Cloudflare inspect/probe/deploy/accept jobs all **SKIPPED**.
- This remains development-to-real-production work. Do not merge/finish the branch yet.
- Never merge `main` without explicit user instruction.
- Never enable real-money execution without separate explicit final approval.

## Current stage / handoff
- Trusted pre-audit runtime/content tree: `89944d3b6aa4b03f6bb1a1107594e9acfa424fb3`.
- Frozen audit-scope commit: `7b175a548c9134b0e88ba4fa5977de51142b6cd3`.
- Static remediation plan: `docs/superpowers/plans/2026-09-03-production-readiness-remediation.md` at `567d8fe06c291eb393b5c23b3bd2d2dfbb65dbe4`.
- Launch master plan: `docs/superpowers/plans/2026-09-03-production-v1-launch-master-plan.md` at blob `48983550b3c33a7c3517c236370ffbc3d1d1788d`.
- Detailed evidence record: `cloudflare-v2/docs/PRODUCTION_V1_DEVELOPMENT_AUDIT.md`.
- Current stage: **STATIC PRODUCTION REMEDIATION COMPLETE — GATE 4 REAL ZITADEL IDENTITY ACCEPTANCE READINESS NEXT**.
- Gate 4 real environment actions are **not yet authorized in this handoff**. Static inspection/preparation is allowed; do not mutate Zitadel/Cloudflare/Supabase or enable Trading access merely from this status.

## Critical runtime safety defaults
Keep fail closed until an exact later gate explicitly changes the corresponding control:
- `TRADINGVIEW_DIRECT_INGRESS_ENABLED=false`
- `TRADINGVIEW_CERT_PROBE_ENABLED=false`
- `TRADING_ACCESS_ENABLED=false`
- `BROKER_EXECUTION_ENABLED=false`

No tenant/admin API may mutate Worker-wide master fuses.

## Core execution/safety contract
- Deterministic parsing/planning is primary; AI never authorizes clear machine-readable execution.
- Persistent event/destination/order idempotency is mandatory.
- Broker metadata is authoritative for symbol, precision, tick economics, volume, account mode, and execution semantics.
- Final source/workspace/account/safety/risk authority is revalidated immediately before every broker action.
- Critical source/workspace/account/kill/execution revocation wins immediately.
- Risk-increasing live volume normalization never silently increases intended risk.
- Risk-reducing protective actions remain permitted under drawdown/open-risk locks unless the kill switch blocks them.
- Successful broker truth remains repairable into Trade State without resending solely to repair state.
- `SUCCEEDED + STATE_BINDING_PENDING` belongs to the separate binding-repair plane, not broker retry.
- Runtime execution snapshots are advisory, non-secret, non-authoritative optimization only.
- Warm broker/session reuse is bounded to exact safe action/batch scope and never replaces fresh per-action authority/risk checks.

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
11. TradingView additionally requires its accepted ingress/source/certificate path.

## Production V1 launch gates
1. Scope freeze — historical GREEN.
2. Real Cloudflare staging — historical GREEN / exited; do not repeat without reason.
3. TradingView direct ingress — DEFERRED / FAIL-CLOSED.
4. Zitadel real non-live identity/workspace authorization — **NEXT; real acceptance pending**.
5. Telegram MTProto soak/recovery — real acceptance pending.
6. MT5/cTrader source acceptance — real demo source probes pending.
7. MT5/cTrader broker demo destinations — real demo lifecycle pending.
8. End-to-end staging/failure soak — real acceptance pending.
9. Production operations/readiness — monitoring/kill/rollback/recovery/security drills and sustained measurements pending.
10. Controlled production cutover — CLOSED / not started: A shadow, B production infrastructure + dedicated demo, C tiny controlled live only after separate explicit approval and explicit owner thresholds, D controlled beta, E general production.

Production-ready/general launch still requires applicable real gate evidence and no unresolved severity-1/2 trading-safety issue.

## Static remediation status
- **Task 1 / F1 — STATIC GREEN / RESOLVED.** Dual Worker master fuses. Final GREEN head `1632889c6b26e88451ece25ba13c649b43357c5a`, run `33783267187`, job `100741828652`.
- **Task 2 / F2/F3/F4/F9 — STATIC GREEN / RESOLVED.** Durable per-action event/source/workspace/account authority. Final implementation head `9ba95eea33748aea1ab641e2aab4e0aec67068dc`, run `33784508546`, job `100745907350`.
- **Task 3 / F7/F8/F10 — STATIC GREEN / RESOLVED.** Broker-authoritative risk, strict no-upward OPEN volume, canonical final policy. Head `a3a507b569499524d6de75ad8c519db5dd944efb`, run `33843616430`, job `100930741996`.
- **Task 4 / F5 — STATIC GREEN / RESOLVED.** Broker-success Trade State repair without resend. Head `30be3bddb586e6a9bf02dea4520c338e3510287c`, run `33850696335`, job `100952562634`.
- **Task 5 / F6 — STATIC GREEN / RESOLVED.** Trading-owned trade-account workspace FK migration contract. Head `9a13bd2fa928d39cce826d05b005129fa10a68f3`, run `33851400665`.
- **Task 6 / I1 — STATIC GREEN / RESOLVED.** Advisory production execution snapshots. Head `400880cab6502c75ac487830bc3a90bb022f485c`, run `33853785408`, job `100962282286`.
- **Task 7 / I2/U1 — STATIC GREEN / RESOLVED.** Authenticated MT5 metadata + bounded warm MT5/cTrader contexts. Head `619fa842ee29addecc9cbbd3fad6bec6efe59f60`, run `33856378784`, job `100970541404`.
- **Task 8 — STATIC GREEN / RESOLVED.** Integrated failure matrix and durable production event-linkage assertion. Acceptance head `a7da981a5daec426b5aad840739555edfbc68819`, run `33865341673`, job `100998803951` SUCCESS: **685/685 + 14/14 + 11/11 + 22/22**, protected jobs skipped.

### Task 8 exact matrix evidence
1. Trading access false blocks execution and retry broker-capable paths.
2. Source revocation is re-resolved from durable event/retry authority and blocks dispatch.
3. Workspace entitlement is part of exact fresh authority and stale snapshots cannot override revocation.
4. Account active/execution/kill authority is reloaded per action; revocation after action one blocks action two.
5. MT5/cTrader risk-increasing OPEN refuses below-minimum and off-step volume rather than increasing risk.
6. Fresh broker economics/risk authority blocks stale/unsafe sizing and fails closed when reliable loss-at-stop economics are unavailable.
7. Normal production delivery now explicitly asserts durable `tradingEventId` linkage at the persistent delivery-store boundary; retry authority reconstructs from durable event linkage.
8. Broker success + state-bind failure records repair work; repair binds persisted successful broker truth and dispatch remains exactly-once/no-resend.

No production code change was required for Task 8 beyond the explicit durable-event-linkage regression assertion. No deployment, Cloudflare mutation, protected external probe, database mutation, demo broker order, or live broker order occurred.

## Frozen finding status
F1–F10, I1, I2, and U1 are all **STATIC RESOLVED** by Tasks 1–8. This does not substitute for real environment acceptance.

## Gate 4 controlling contract
Use immutable Zitadel `sub`, never email. Successful login proves identity only. Real Gate 4 must prove:
- intended managed Mkety Zitadel issuer;
- Trading-specific application/audience and exact Trading project claim;
- exact workspace-bound Zitadel organization;
- exact enabled `(workspace_id, zitadel_subject)` Trading membership;
- documented owner/admin/operator/viewer permissions;
- no workspace role implicitly grants broker execution;
- wrong project, wrong organization/workspace, absent/revoked membership, unknown role, disabled entitlement, and second-tenant access all fail closed;
- second-tenant source/account/destination/health/retry/idempotency/control isolation;
- broker execution remains separately disabled.

Current source/CI already proves these composition rules with deterministic test doubles, but that is not real Zitadel/deployed-environment evidence.

## External acceptance blockers / later gates
- managed Zitadel real non-live acceptance (Gate 4);
- real Telegram account/channel soak (Gate 5);
- MT5/cTrader real demo source probes with exact Gate 6 markers;
- MT5/cTrader dedicated demo lifecycle with exact Gate 7 markers;
- real E2E staging and sustained latency/failure/isolation measurements (Gate 8);
- Gate 9 monitoring/kill/rollback/recovery/security drills;
- genuine TradingView-originated Gate 3 acceptance remains deferred;
- Gate 10 shadow/demo/live/beta phases remain unstarted.

## Gate 10 safety
CLOSED / not started.
- Shadow production and production-infrastructure demo precede live money.
- Live cutover requires applicable prior gates GREEN or explicitly reviewed scope removal plus separate explicit tiny-live approval.
- Owner must explicitly set max per-trade risk, max volume, max concurrent/open risk, daily loss ceiling, allowed symbols, and kill/rollback contacts/procedure.
- Never invent/default live financial thresholds.

## Exact startup / pickup point for any future session
1. Read this file first, then `cloudflare-v2/docs/PRODUCTION_V1_DEVELOPMENT_AUDIT.md`, then the Sept 3 launch master plan and current acceptance runbooks.
2. Confirm PR #2 still targets `main`, branch is `design/enterprise-trading-event-core`, and reconcile current branch head before any write.
3. Trust static remediation completion only from Task 8 acceptance head `a7da981a5daec426b5aad840739555edfbc68819`, run `33865341673`, job `100998803951`: 685/685 + 14/14 + 11/11 + 22/22 passing, protected jobs skipped.
4. Current next work is **Gate 4 real Zitadel identity/workspace authorization readiness/acceptance**.
5. Re-read `cloudflare-v2/docs/SHARED_ZITADEL_ENTERPRISE_IDENTITY.md`, `cloudflare-v2/docs/STAGING_V1_RUNBOOK.md`, current Zitadel/membership/admin tests, and the Gate 4 section of the launch master plan.
6. Static preparation may continue. Do not invoke real/protected identity/environment mutation or enable `TRADING_ACCESS_ENABLED` without the exact Gate 4 authorization contract.
7. If adding a new Gate 4 protected workflow/harness, use TDD and preserve marker-only, protected-environment, secret-free, broker-disabled semantics; obtain design approval before implementation.
8. After any verified Gate 4 preparation/acceptance batch, synchronize this file and `cloudflare-v2/docs/PRODUCTION_V1_DEVELOPMENT_AUDIT.md` with exact head/run/evidence.

## Safety state
Do not deploy, mutate Cloudflare/Zitadel/Supabase, run protected external probes, place demo/live broker orders, merge `main`, or enable real-money execution unless the exact later gate/approval explicitly authorizes that action.