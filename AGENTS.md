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
- Frozen audit-scope commit: `7b175a548c9134b0e88ba4fa5977de51142b6cd3`.
- Static remediation plan: `docs/superpowers/plans/2026-09-03-production-readiness-remediation.md` at `567d8fe06c291eb393b5c23b3bd2d2dfbb65dbe4`.
- Detailed audit/remediation record: `cloudflare-v2/docs/PRODUCTION_V1_DEVELOPMENT_AUDIT.md`.
- Task 1 detailed/AGENTS sync: `905ec9ba10a35a7fb0ea6e6337da2364c73b049b` / `531c96fc469fdb9944ba1afce6d81988bc16cda3`.
- Task 2 detailed evidence sync: `c39588b33cedfaa1ffd2741bb25afc1aeee0114f`.
- Current stage: **STATIC PRODUCTION REMEDIATION IN PROGRESS — TASK 2 GREEN / TASK 3 NEXT**.

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
- RED head `7961849db8355c67801db5f68c3d5357f0768f99`, run `33782879644`, job `100740562007`.
- Final GREEN head `1632889c6b26e88451ece25ba13c649b43357c5a`, PR run `33783267187`, job `100741828652` SUCCESS.
- Worker/trading-core, MT5 and MTProto suites succeeded; protected Cloudflare jobs skipped.

### Task 2 / F2/F3/F4/F9 — final durable execution authority
**STATIC GREEN / RESOLVED.**

RED:
- authority contract `85ba2c9352bc81b209227bd98d8d5e97a06dda84`;
- event-propagation test `d94e98a1fa79bb0f557e8561676985146b41225b`;
- per-action revocation test `903e53e6db4a22b9fbe40ee7b98d775595898644`;
- final RED head `71be214f260adf9800bee362ede92ebe62888d5e`;
- PR run `33783879937`, job `100743853586`; Worker/trading-core failed intended missing-authority tests; protected jobs skipped.

Implementation:
- authority loader `543830329988630d7aef1e63cd292a93b568a76c`;
- persisted event propagation `2b3bcba4a6cc8b84830f471eecd783ece7be1b2f`;
- dependency/delivery composition `de30aec9263d4000a204abe83952018294de9f0a`;
- final per-action authority head `9ba95eea33748aea1ab641e2aab4e0aec67068dc`.

GREEN:
- normal push run `33784443633` was SKIPPED by workflow design and is not evidence;
- exact feature head `9ba95eea33748aea1ab641e2aab4e0aec67068dc` validated by PR run `33784508546`;
- PR merge ref `4648138510fc4d97e07817d05d3cae72d91ae4fe` contained that head;
- test job `100745907350` SUCCESS;
- Worker/trading-core, pure MT5 bridge, Container/external MTProto Python SUCCESS;
- all Cloudflare inspect/probe/deploy/accept jobs SKIPPED.

Resolved behavior:
- exact persisted event ID reaches production dependencies/destination delivery context;
- final authority resolves server-owned event -> originating source -> exact Trading workspace entitlement -> exact trade account;
- source disablement/workspace entitlement/account execution revocation fails closed;
- authority is reloaded before each action, so revocation after action N can stop N+1;
- scheduled retry uses durable delivery workspace/event/account authority, not caller/request source/workspace hints.

### Task 3 — F7/F8/F10 broker-authoritative risk/volume/final policy
**NEXT / RED not started.**
Required RED coverage:
- real production composition proves max lots, max risk %, daily loss and max open risk each block broker send;
- MT5 below-minimum/off-step lots throw instead of clamp/round upward;
- cTrader below-minimum/off-step protocol volume throws instead of clamp/round upward;
- risk-percent OPEN is revalidated against current server-loaded account + broker-authoritative economics before send;
- changed broker metadata that makes planned volume exceed configured risk blocks;
- missing reliable loss-at-stop model blocks.

### Task 4 — F5 successful-broker-result Trade State repair without resend
OPEN.

### Task 5 — F6 Trading-owned trade-account workspace FK migration contract
OPEN; do not apply to real DB until authorized read-only schema/ledger inspection.

### Task 6 — I1 runtime snapshot production integration
OPEN; non-authoritative optimization only.

### Task 7 — I2/U1 warm broker contexts + authenticated MT5 metadata requests
OPEN.

### Task 8 — integrated failure matrix + exact-head static acceptance
OPEN.

### Task 9 — real production acceptance path
After static remediation GREEN: Gates 4 -> 9, then Gate 10 shadow/demo phases, separate tiny-live approval, tiny live, beta, general production.

## Remaining findings
- F1 — RESOLVED Task 1.
- F2 — RESOLVED Task 2.
- F3 — RESOLVED Task 2.
- F4 — RESOLVED Task 2.
- F5 successful delivery / missing Trade State repair — OPEN.
- F6 legacy shared-workspace FK — OPEN.
- F7 live broker-authoritative risk sizing — OPEN.
- F8 unsafe upward live volume normalization — OPEN.
- F9 `tradingEventId` propagation — RESOLVED Task 2.
- F10 final policy/risk/exposure inputs — OPEN.
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
1. Continue from **Task 3 RED** in `docs/superpowers/plans/2026-09-03-production-readiness-remediation.md`.
2. Add Task 3 tests only; do not change production risk/volume code until exact RED is verified.
3. Verify RED using ordinary PR CI; protected jobs must remain skipped.
4. Then implement broker-authoritative final risk/policy validation and strict no-clamp-up execution volume semantics minimally.
5. Synchronize this file and `cloudflare-v2/docs/PRODUCTION_V1_DEVELOPMENT_AUDIT.md` after Task 3 exact-head GREEN.
6. Continue Tasks 4–8 with RED -> minimal GREEN -> exact-head CI.
7. Only after static remediation is fully GREEN return to separately authorized real Gates 4–9.

## Safety state during static remediation
Do not deploy, mutate Cloudflare, run protected external probes, place demo/live broker orders, merge `main`, or enable real-money execution during this static batch.
