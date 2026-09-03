# Production Safety Audit Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Correct production-safety and hot-path gaps found during a full re-audit of `AGENTS.md`, the Production V1 launch plans/specs, and draft PR #2 before any remaining real acceptance gate is attempted.

**Architecture:** Preserve the current fail-closed event, simulation, idempotency, account-policy, and broker-adapter boundaries. Make the two Worker master fuses authoritative on every broker-capable path, revalidate mutable account safety immediately before every broker action, then separately harden the runtime snapshot/warm broker context and MT5 metadata transport boundary without enabling any external environment or broker operation.

**Tech Stack:** Cloudflare Workers ES modules, Node 22 tests, Supabase service-side data access, MT5 signed HTTP bridge, cTrader Open API runtime, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-09-03-production-execution-bridge-design.md`; `docs/superpowers/specs/2026-09-03-hot-path-isolation-and-resilience-design.md`

## Global Constraints

- Work only on `design/enterprise-trading-event-core` / draft PR #2; never merge `main` without explicit user instruction.
- `TRADINGVIEW_DIRECT_INGRESS_ENABLED=false`, `TRADINGVIEW_CERT_PROBE_ENABLED=false`, `TRADING_ACCESS_ENABLED=false`, and `BROKER_EXECUTION_ENABLED=false` remain deployment defaults.
- No Cloudflare deployment/probe, real Telegram/Zitadel action, broker demo order, or real-money operation is authorized by this plan.
- Broker execution requires both Worker master fuses plus exact server-side source/workspace/account/safety/idempotency authority.
- Safety revocation must win immediately before each broker dispatch; cached or previously loaded state cannot override a later disable/kill.
- Persistent destination idempotency and broker reconciliation remain mandatory.
- TDD RED first, exact-head GREEN second; ordinary PR CI only; external jobs must remain skipped.
- Do not weaken current cTrader lot-size semantics or TradingView certificate trust.

---

### Task 1: Enforce both Worker master fuses on every broker-capable path

**Files:**
- Modify: `cloudflare-v2/src/pipeline/v1_execution_stage.js`
- Modify: `cloudflare-v2/src/execution/destination_retry_runtime.js`
- Test: `cloudflare-v2/tests/production_execution_integration.test.mjs`
- Test: `cloudflare-v2/tests/destination_retry_runtime.test.mjs`
- Test: `cloudflare-v2/tests/hot_path_failure_isolation.test.mjs`

**Interfaces:**
- `runV1ProductionExecutionStage()` must construct no production dependencies unless both `TRADING_ACCESS_ENABLED` and `BROKER_EXECUTION_ENABLED` are true.
- Destination retry runtime must scan/claim/dispatch nothing unless both master fuses are true.
- Disabled summaries remain secret-free and broker-free.

- [ ] **Step 1: Write failing execution-stage tests**

Add a case with `BROKER_EXECUTION_ENABLED=true` and `TRADING_ACCESS_ENABLED=false` that supplies a READY simulated account and asserts zero production dependency/executor calls and a fail-closed execution summary.

- [ ] **Step 2: Write failing retry-runtime tests**

Add a case with broker fuse true but Trading access false and assert zero Supabase/list/claim/recover calls.

- [ ] **Step 3: Verify RED**

Run the focused Node tests. Expected: the new cases fail because the current non-HTTP broker-capable paths inspect only `BROKER_EXECUTION_ENABLED`.

- [ ] **Step 4: Implement the minimum dual-fuse guard**

Reuse `isTradingAccessEnabled(env)` for Trading access and keep the existing broker-fuse parsing. Return before constructing dependencies or scanning retry state when either fuse is off. Do not move authentication or source authority into the retry layer.

- [ ] **Step 5: Verify focused and full GREEN**

Run focused tests, then ordinary PR CI. Confirm Worker/trading-core, MT5, Container MTProto, and external MTProto suites pass and all external Cloudflare/probe/deploy/accept jobs are skipped.

---

### Task 2: Revalidate account execution/safety immediately before every broker action

**Files:**
- Modify: `cloudflare-v2/src/execution/production_execution_coordinator.js`
- Test: `cloudflare-v2/tests/production_execution_coordinator.test.mjs`
- Test: `cloudflare-v2/tests/hot_path_failure_isolation.test.mjs`

**Interfaces:**
- Each action in a multi-action account plan reloads or revalidates exact authoritative account state immediately before policy evaluation and dispatch.
- A revocation after action N blocks action N+1 without duplicating/reversing already completed action N.

- [ ] **Step 1: Write failing revocation-between-actions test**

Use an account loader whose first call returns active/execution-enabled/no-kill and whose second call returns kill-switch enabled or execution disabled. Provide two actions. Assert action 1 dispatches exactly once, action 2 never dispatches, and the account result records the subsequent authority block without replaying action 1.

- [ ] **Step 2: Verify RED**

Expected: current coordinator dispatches both actions because it loads account state once before the loop.

- [ ] **Step 3: Implement minimum per-action authority refresh**

Retain the initial exact account identity check, then refresh the same exact `(workspaceId, accountId)` before each action and re-check workspace, ID, active state, execution enablement, and safety policy. Do not invent a second account ID or fall back to cached state.

- [ ] **Step 4: Verify GREEN**

Run focused coordinator/failure-injection tests and full ordinary CI.

---

### Task 3: Integrate bounded runtime execution snapshots only for non-authoritative reusable context

**Files:**
- Modify: `cloudflare-v2/src/execution/production_execution_deps.js`
- Modify: `cloudflare-v2/src/execution/runtime_execution_snapshot.js` only if interface extension is necessary
- Test: `cloudflare-v2/tests/runtime_execution_snapshot.test.mjs`
- Test: `cloudflare-v2/tests/production_execution_deps.test.mjs`

**Interfaces:**
- Reuse bounded, non-secret MT5 symbol/context metadata and cTrader non-authoritative metadata where safe.
- Final account/safety authority continues to be freshly loaded by Task 2.
- No credential/token/session secret is stored in the snapshot.

- [ ] **Step 1: Write failing integration tests**

Prove repeated actions for the same exact workspace/source/account/version can reuse non-secret broker metadata without repeated full hydration, while an account disable/kill still takes effect through the fresh authority loader.

- [ ] **Step 2: Verify RED**

Expected: current production dependency path does not consume the snapshot cache.

- [ ] **Step 3: Implement minimal bounded reuse**

Integrate the existing cache only around non-authoritative metadata. Never cache away account enablement, kill-switch, workspace entitlement, broker master fuse, persistent idempotency, or broker reconciliation.

- [ ] **Step 4: Verify GREEN**

Run focused and full CI.

---

### Task 4: Reuse cTrader runtime safely within a bounded execution context

**Files:**
- Modify: `cloudflare-v2/src/execution/production_execution_deps.js`
- Test: `cloudflare-v2/tests/production_execution_deps.test.mjs`
- Test: `cloudflare-v2/tests/ctrader_runtime.test.mjs`

**Interfaces:**
- A bounded production dependency context may reuse one authenticated cTrader runtime for multiple actions on the same exact configured account/environment.
- Runtime is never shared across workspace/account/environment/credential identity.
- Teardown remains explicit at the end of the execution context.

- [ ] **Step 1: Write failing reuse/isolation tests**

Prove two same-account actions do not create two sessions, while different accounts/workspaces create isolated sessions. Prove live environment still requires server-side `CTRADER_LIVE_TRADING_ENABLED`.

- [ ] **Step 2: Verify RED**

Expected: current dispatch creates/closes a runtime per action.

- [ ] **Step 3: Implement bounded runtime reuse**

Cache the runtime only inside the dependency object created for one execution context, keyed by exact server-authoritative account identity/environment. Provide/execute a cleanup function from the caller so sessions close after the plan completes.

- [ ] **Step 4: Verify GREEN**

Run focused cTrader/production dependency tests and full CI.

---

### Task 5: Harden MT5 metadata endpoints or prove an explicit private-only boundary

**Files:**
- Modify: `cloudflare-v2/bridges/mt5_bridge.py`
- Modify: `cloudflare-v2/src/execution/production_execution_deps.js`
- Test: `cloudflare-v2/bridges/test_mt5_bridge.py`
- Test: `cloudflare-v2/tests/production_execution_deps.test.mjs`
- Modify documentation if private topology is intentionally retained.

**Interfaces:**
- `/v1/account`, `/v1/symbols`, and `/v1/tick` must not expose broker metadata over an untrusted network without authentication.
- Preferred implementation: authenticate metadata GETs with the same scoped bridge secret using a bounded request-signature contract, or document/test a strictly private transport boundary that makes public reachability impossible.

- [ ] **Step 1: Write failing bridge-security tests**

Exercise metadata requests without valid bridge authentication and require fail-closed behavior. Add client-side tests proving the production context loader sends the required authentication.

- [ ] **Step 2: Verify RED**

Expected: current GET metadata endpoints are unauthenticated.

- [ ] **Step 3: Implement the minimal authenticated metadata contract**

Use a request method/path/timestamp signature or another narrowly scoped bridge-auth contract. Do not log the secret or full authorization material. Preserve `/health` behavior only if its exposure is intentionally non-sensitive and documented.

- [ ] **Step 4: Verify GREEN**

Run Python bridge tests, Node production dependency tests, and full ordinary CI.

---

### Task 6: Reconcile documentation and production-readiness status

**Files:**
- Modify: `AGENTS.md`
- Modify: `cloudflare-v2/docs/PRODUCTION_V1_ACCEPTANCE_READINESS.md` only if gate prerequisites need clarification
- Modify: `cloudflare-v2/docs/PRODUCTION_V1_CUTOVER_RUNBOOK.md` only if runtime behavior changed

**Interfaces:**
- `AGENTS.md` remains the operational source of truth.

- [ ] **Step 1: Record audit findings before claiming remediation GREEN**

State that the full branch/spec audit found dual-fuse non-HTTP enforcement, per-action revocation, snapshot/warm-context integration, and MT5 metadata-boundary items requiring static remediation before real Gates 4–9.

- [ ] **Step 2: Record exact RED/GREEN evidence for each completed remediation task**

Include exact commit SHA, workflow run ID, test counts, and confirmation that all external jobs were skipped.

- [ ] **Step 3: Re-state real acceptance status**

Keep Gates 4–9 real acceptance pending and Gate 10 CLOSED. Static remediation does not authorize Cloudflare mutation, external credentials, broker demo lifecycle, or real-money cutover.

- [ ] **Step 4: Exact-head verification**

Confirm ordinary PR CI SUCCESS on the final synchronization head. Do not trigger any protected environment workflow.