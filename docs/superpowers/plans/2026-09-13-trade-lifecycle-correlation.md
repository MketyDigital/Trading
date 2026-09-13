# Trade Lifecycle Correlation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Mkety preserve trade identity, use fixed lot per TP leg, correlate fast-entry follow-ups safely, execute management actions safely, and provide auditable parity across cTrader, MT5, Telegram and webhook destinations.

**Architecture:** Keep parsing, correlation, execution, durable state and destination delivery as separate units. Preserve stable group/leg identity across all layers; correlate follow-ups by explicit references first, then deterministic symbol/context rules, and fail closed on ambiguity. Broker adapters remain authoritative for symbol/volume validation while Trade State remains authoritative for lifecycle state.

**Tech Stack:** Cloudflare Worker JavaScript, Node test runner, Supabase/Postgres, cTrader Open API/cBot adapters, MT5 connector/bridge, Telegram MTProto/Bot destinations, existing delivery/retry stores.

**Spec:** `docs/superpowers/specs/2026-09-13-trade-lifecycle-correlation-design.md`

## Global Constraints
- Fixed lot means configured lot per TP leg.
- Risk-based sizing remains trade-level risk distributed across target legs.
- Broker success must never be resent merely because state binding failed.
- Untagged management commands execute only when target correlation is unique and safe.
- Canonical trade semantics are immutable across presentation/rebranding.
- Live-money execution remains disabled unless separately authorized.

---

### Task 1: Preserve leg identity through execution and state binding

**Files:**
- Modify: `cloudflare-v2/src/execution/execution_plan.js`
- Test: `cloudflare-v2/tests/execution_plan.test.mjs`
- Test: `cloudflare-v2/tests/production_execution_coordinator.test.mjs`

**Interfaces:**
- Consumes: `buildPositionGroup()` legs with `legId`.
- Produces: every OPEN_POSITION action includes `legId` and stable `idempotencyKey`.

- [ ] Add failing tests asserting OPEN_POSITION actions preserve each leg's `legId`.
- [ ] Run Worker/trading-core tests and confirm red failure.
- [ ] Add `legId: leg.legId` to `openActionsFromGroup()` without changing existing idempotency keys.
- [ ] Run targeted and full Worker/trading-core tests.
- [ ] Commit.

### Task 2: Fixed lot is per target leg

**Files:**
- Modify: `cloudflare-v2/src/execution/execution_plan.js`
- Test: `cloudflare-v2/tests/execution_plan.test.mjs`

**Interfaces:**
- Consumes: account `sizingMode=FIXED_LOTS`, `fixedLots`, canonical TP count and instrument volume constraints.
- Produces: `group.legs[].lots === normalized fixedLots` for every TP leg; risk-sized paths remain unchanged.

- [ ] Add failing tests: 0.10 fixed lot + 3 TPs => three 0.10 legs and three 0.10 OPEN_POSITION actions.
- [ ] Add regression test: risk-percent three-target sizing still distributes the calculated total volume.
- [ ] Implement fixed-lot per-leg allocation while preserving broker min/max/step validation.
- [ ] Run targeted and full tests.
- [ ] Commit.

### Task 3: Fast-entry promotion to completed multi-TP group

**Files:**
- Modify: `cloudflare-v2/src/execution/position_group.js`
- Modify: correlation/orchestrator module identified by existing matched-group flow.
- Test: `cloudflare-v2/tests/position_group.test.mjs` or existing equivalent.
- Test: orchestrator follow-up tests.

**Interfaces:**
- Consumes: existing incomplete group with one open leg and completed compatible intent.
- Produces: final group with exactly N legs for N TPs; first open leg becomes TP1 and only N-1 new OPEN_POSITION actions are emitted.

- [ ] Add failing tests for 1->3 TP promotion, 1->1 completion, and no N+1 duplicate leg.
- [ ] Add correlation test for un-replied full signal with same source/symbol/direction and unique incomplete group.
- [ ] Implement promotion preserving original broker position identity.
- [ ] Run tests and commit.

### Task 4: Safe correlation engine for follow-ups and management

**Files:**
- Create or extend focused correlation module under `cloudflare-v2/src/pipeline/`.
- Modify: `cloudflare-v2/src/pipeline/v1_orchestrator.js`
- Modify: `cloudflare-v2/src/pipeline/machine_plan.js` only for parsing outputs, not target selection.
- Tests: dedicated correlation tests plus orchestrator integration tests.

**Interfaces:**
- Input: source/chat/reply identity, canonical symbol/side, management intent, open/incomplete groups.
- Output: `{status:'MATCHED', groupId}` or `{status:'AMBIGUOUS'|'NOT_FOUND', reason}`.

- [ ] Test reply reference wins over contextual candidates.
- [ ] Test symbol+direction completion matches one incomplete group.
- [ ] Test `close BTCUSD` matches only one eligible BTCUSD group.
- [ ] Test bare `close`/`BE` only matches when exactly one eligible group exists.
- [ ] Test same-symbol concurrent groups and opposite BUY/SELL groups fail closed when ambiguous.
- [ ] Test stale context fails closed.
- [ ] Implement deterministic candidate filtering and ranking without AI choosing execution targets.
- [ ] Run tests and commit.

### Task 5: Management lifecycle execution

**Files:**
- Modify: `cloudflare-v2/src/execution/position_group.js`
- Modify execution planning/orchestrator modules as required by current management flow.
- Tests: management parser, planner and broker execution integration tests.

**Interfaces:**
- Supports: CLOSE, CLOSE ALL, CLOSE_PARTIAL, MOVE_SL_TO_BE, MOVE_SL price, TP modification, CANCEL_PENDING.
- Requires: correlated durable group/leg identity before broker action.

- [ ] Add parser/correlation tests for concise trader language and safety blockers.
- [ ] Add lifecycle tests proving close/partial/BE operate only on matched brokerPositionId/orderId.
- [ ] Add duplicate management idempotency tests.
- [ ] Implement missing management actions supported by both adapter contracts; unsupported broker operations fail closed with explicit reason.
- [ ] Run tests and commit.

### Task 6: Broker-success state repair parity for cTrader and MT5

**Files:**
- Modify as needed: `cloudflare-v2/src/execution/execution_binding_repair.js`
- Modify as needed: `cloudflare-v2/src/execution/production_binding_repair_recorder.js`
- Tests: repair/runtime/retry integration suites for cTrader and MT5.

**Interfaces:**
- Durable delivery response is the only source of broker IDs during state-only repair.
- Repair never invokes broker executor.

- [ ] Add end-to-end tests where broker succeeds, state binding fails, delivery is marked STATE_BINDING_PENDING, repair binds state, broker dispatch count remains one.
- [ ] Cover cTrader Direct, cTrader cBot, MT5 connector/bridge response shapes.
- [ ] Implement only gaps proven by tests.
- [ ] Run tests and commit.

### Task 7: Telegram/webhook destination idempotency and semantic audit

**Files:**
- Inspect and modify existing destination delivery modules only where tests expose gaps.
- Tests: Telegram destination, raw webhook, signed webhook, retry/idempotency, presentation AI tests.

**Interfaces:**
- Key: source event + destination identity + logical action/version.
- Presentation output cannot mutate canonical semantic fields.

- [ ] Test retry does not duplicate Telegram post/webhook delivery.
- [ ] Test edits use configured edit/new-message policy deterministically.
- [ ] Test AI presentation failure falls back deterministically.
- [ ] Test AI presentation cannot alter side/symbol/entry/SL/TP/risk/routing.
- [ ] Fix only proven gaps; run tests and commit.

### Task 8: Operations visibility and acceptance evidence

**Files:**
- Modify: `cloudflare-v2/src/http/v1_admin_operations.js`
- Modify: `cloudflare-v2/src/dashboard.js`
- Tests: `cloudflare-v2/tests/v1_admin_operations.test.mjs`, dashboard/E2E tests.

**Interfaces:**
- Shows recent event, delivery, state-binding repair, broker IDs status, and management outcome without exposing secrets.

- [ ] Add tests for bounded recent event/management visibility and workspace isolation.
- [ ] Implement secret-free Operations rows and drill-down links/audit IDs.
- [ ] Run full tests and commit.

### Task 9: Production acceptance matrix

**Files:**
- No production code unless acceptance exposes a new defect.

- [ ] Deploy only after full CI and CodeQL pass.
- [ ] Verify global live broker execution OFF and all live account permissions OFF.
- [ ] cTrader demo: fast BUY -> full multi-TP completion -> durable legs -> partial/BE/full close.
- [ ] MT5 demo: same lifecycle with connected MT5 account.
- [ ] Telegram destination: one source event -> one destination message; retry remains single delivery.
- [ ] Raw/signed webhook destinations: idempotent delivery and retry evidence.
- [ ] Verify Operations shows the accepted lifecycle.
- [ ] Record any broker-specific portability deviations as separate defects rather than weakening core safety rules.