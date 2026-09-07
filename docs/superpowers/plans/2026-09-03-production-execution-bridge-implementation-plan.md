# Production Execution Bridge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Connect the already-built Mkety Trading V1 planning, safety, idempotency, and broker-adapter components through an explicit fail-closed execution boundary while keeping all deployment master fuses off until later launch approval.

**Architecture:** Keep `/api/v1/events` planning/simulation executor-free and introduce separate runtime guards and an execution coordinator. Every broker action requires Worker access/broker fuses plus exact workspace/source/account/safety/destination/idempotency checks; tenant admin controls remain limited to workspace-scoped account execution and kill-switch state.

**Tech Stack:** Cloudflare Workers ES modules, Node 22 tests, Supabase service-side data access, Durable Objects Trade State, MT5 signed HTTP bridge, cTrader Open API JSON protocol, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-09-03-production-execution-bridge-design.md`

## Global Constraints
- Work only on `design/enterprise-trading-event-core` / draft PR #2; never merge `main` without explicit user instruction.
- `TRADINGVIEW_DIRECT_INGRESS_ENABLED=false`.
- `TRADINGVIEW_CERT_PROBE_ENABLED=false`.
- `TRADING_ACCESS_ENABLED=false` in deployed profiles until Gate 4 acceptance/explicit launch progression.
- `BROKER_EXECUTION_ENABLED=false` in deployed profiles until Gate 10 and separate explicit user approval.
- No real-money execution or live broker credentials during implementation.
- No admin API may mutate `TRADING_ACCESS_ENABLED` or `BROKER_EXECUTION_ENABLED`.
- Exact workspace isolation and persistent destination idempotency are mandatory.
- Preserve raw cTrader `ProtoOASymbol.lotSize` protocol-cent semantics.
- Batch commits and avoid Cloudflare/real broker actions unless an exact later acceptance marker is intentionally chosen.

---

### Task 1: Enforce Worker-wide Trading access fuse

**Files:**
- Create: `cloudflare-v2/src/security/trading_runtime_access.js`
- Modify: `cloudflare-v2/src/v1_entry.js`
- Test: `cloudflare-v2/tests/v1_entry.test.mjs`

**Interfaces:**
- Produces: `isTradingAccessEnabled(env): boolean`
- Produces: `tradingAccessDisabledResponse(): Response`
- `v1_entry.fetch()` consumes the guard for externally authenticated Trading business/admin/webhook routes; `/api/v1/health` and exact `/api/v1/internal/*` behavior remain independently controlled.

- [ ] **Step 1: Write failing tests**

Add tests proving:
```js
const env = { TRADING_ACCESS_ENABLED: 'false' };
const response = await worker.fetch(new Request('https://worker/api/v1/admin/workspace'), env, {});
assert.equal(response.status, 503);
assert.equal((await response.json()).reason, 'TRADING_ACCESS_DISABLED');
assert.equal(adminCalls, 0);
```

Also prove `/api/v1/events` and TradingView webhook paths stop before handlers when access is disabled, while `/api/v1/health` remains readable and exact internal source-event routing remains delegated to its existing token-protected handler.

- [ ] **Step 2: Run targeted tests and verify RED**

Run:
```bash
node --test tests/v1_entry.test.mjs
```
Expected: only new access-fuse contracts fail because V1 routes still delegate while the flag is false.

- [ ] **Step 3: Implement minimal runtime guard**

Create:
```js
export function isTradingAccessEnabled(env = {}) {
  return ['1', 'true', 'yes', 'on'].includes(String(env.TRADING_ACCESS_ENABLED ?? '').trim().toLowerCase());
}

export function tradingAccessDisabledResponse() {
  return new Response(JSON.stringify({ ok: false, reason: 'TRADING_ACCESS_DISABLED' }), {
    status: 503,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}
```

In `v1_entry.fetch()`, after health/internal routing but before `/api/v1/events`, `/api/v1/admin/*`, and `/api/v1/webhooks/tradingview/*` handler delegation, return the disabled response when the fuse is off. Keep legacy routing unchanged in this task.

- [ ] **Step 4: Run targeted and full tests**

Run:
```bash
node --test tests/v1_entry.test.mjs
npm run test:ci
```
Expected: PASS with no Cloudflare action.

- [ ] **Step 5: Commit**

Commit message:
```text
feat: enforce Trading runtime access fuse
```

### Task 2: Add hard-disabled production execution coordinator

**Files:**
- Create: `cloudflare-v2/src/execution/production_execution_coordinator.js`
- Test: `cloudflare-v2/tests/production_execution_coordinator.test.mjs`

**Interfaces:**
- Produces: `executeProductionPlan(input, deps): Promise<ExecutionSummary>`
- `input`: `{ workspaceId, eventId, accountPlans, brokerExecutionEnabled }`
- `deps`: `{ accountLoader, destinationLoader, dispatchAction, stateBinder }`
- `ExecutionSummary`: `{ executionEnabled, status, accounts, succeeded, failed, blocked }`

- [ ] **Step 1: Write failing tests**

Test broker fuse first:
```js
const summary = await executeProductionPlan({
  workspaceId: 'ws-a',
  eventId: 'evt-1',
  accountPlans: [{ accountId: 'acct-a', actions: [{ type: 'OPEN_POSITION', idempotencyKey: 'k1' }] }],
  brokerExecutionEnabled: false,
}, {
  accountLoader: async () => { throw new Error('must not load'); },
  destinationLoader: async () => { throw new Error('must not load'); },
  dispatchAction: async () => { throw new Error('must not dispatch'); },
  stateBinder: async () => { throw new Error('must not bind'); },
});
assert.equal(summary.executionEnabled, false);
assert.equal(summary.status, 'BROKER_EXECUTION_DISABLED');
```

Add tests for exact workspace mismatch, inactive account, account execution disabled, kill switch blocked, inactive destination, and one sibling failure not blocking another.

- [ ] **Step 2: Verify RED**

Run:
```bash
node --test tests/production_execution_coordinator.test.mjs
```
Expected: module/function missing.

- [ ] **Step 3: Implement coordinator with ordered locks**

Implement the coordinator so the first line of broker-capable work checks `brokerExecutionEnabled === true`. Only then load exact workspace accounts/destinations. Reject any plan/account/destination whose workspace differs from `workspaceId`. Require active account and `execution_enabled === true`; evaluate existing `safety_policy`; require active destination. Dispatch actions independently and call `stateBinder` only for successful non-duplicate broker results containing bindable IDs.

Do not import MT5/cTrader executors in this coordinator; use injected `dispatchAction` so the broker-disabled proof is structural and testable.

- [ ] **Step 4: Run targeted and full tests**

Run:
```bash
node --test tests/production_execution_coordinator.test.mjs
npm run test:ci
```
Expected: PASS.

- [ ] **Step 5: Commit**

Commit message:
```text
feat: add fail-closed production execution coordinator
```

### Task 3: Build server-side execution dependencies

**Files:**
- Create: `cloudflare-v2/src/execution/production_execution_deps.js`
- Modify only if needed: existing persistent delivery-store factory modules
- Test: `cloudflare-v2/tests/production_execution_deps.test.mjs`

**Interfaces:**
- Produces: `createProductionExecutionDependencies({ env, supabase, workspaceId }): Promise<deps>`
- Returned `deps` satisfies Task 2 coordinator interface and resolves MT5/cTrader destination execution server-side.

- [ ] **Step 1: Write failing tests**

Prove account/destination queries include exact `workspace_id`, active status, and never accept credentials from event/action payloads. Prove MT5 dispatch requires server-side bridge URL/secret plus persistent delivery store. Prove cTrader dispatch constructs only demo/live mode allowed by server-side destination configuration and never by caller hints. Prove missing dependencies fail before broker executor invocation.

- [ ] **Step 2: Verify RED**

Run:
```bash
node --test tests/production_execution_deps.test.mjs
```
Expected: module/function missing.

- [ ] **Step 3: Implement dependency builder**

Use Supabase service client for exact workspace account/destination records, existing persistent destination idempotency store, `executeMT5Action`, and `executeCTraderAction`. Credentials remain server-side environment/encrypted-record authority only. Reuse existing platform symbol catalogs and existing cTrader lot-size semantics.

- [ ] **Step 4: Run tests**

Run:
```bash
node --test tests/production_execution_deps.test.mjs
npm run test:ci
```
Expected: PASS.

- [ ] **Step 5: Commit**

Commit message:
```text
feat: compose production execution dependencies
```

### Task 4: Integrate execution stage behind both master fuses

**Files:**
- Modify: `cloudflare-v2/src/http/v1_events.js`
- Create if separation is clearer: `cloudflare-v2/src/pipeline/v1_execution_stage.js`
- Test: `cloudflare-v2/tests/v1_events.test.mjs`
- Test: `cloudflare-v2/tests/production_execution_integration.test.mjs`

**Interfaces:**
- Existing ingest/simulation response contract is preserved.
- When access is enabled but `BROKER_EXECUTION_ENABLED=false`, event responses may include a sanitized execution summary with status `BROKER_EXECUTION_DISABLED`; no broker dependencies are constructed.
- When both fuses are true, only simulation/planning results whose account actions are `READY` are converted to trusted coordinator plans.

- [ ] **Step 1: Write failing integration tests**

Prove broker-disabled event acceptance:
```js
assert.equal(result.ok, true);
assert.equal(result.simulation.status, 'SIMULATED');
assert.equal(result.execution.status, 'BROKER_EXECUTION_DISABLED');
assert.equal(executionDepsCalls, 0);
assert.equal(brokerCalls, 0);
```

Prove duplicates/rejected/NEEDS_REVIEW events never enter execution. Prove only exact `READY` account actions are forwarded and caller payload cannot set execution fuses.

- [ ] **Step 2: Verify RED**

Run:
```bash
node --test tests/v1_events.test.mjs tests/production_execution_integration.test.mjs
```
Expected: missing execution summary/stage contracts fail.

- [ ] **Step 3: Implement minimal integration**

After successful non-duplicate interpretation and simulation planning, call a tiny execution-stage function. The stage checks `BROKER_EXECUTION_ENABLED` before constructing production execution dependencies. It derives account plans only from trusted simulation output and exact server-side event workspace. It never accepts executor configuration from request body.

- [ ] **Step 4: Run full verification**

Run:
```bash
npm run test:ci
PYTHONPATH=bridges python -m unittest bridges/test_mt5_bridge.py -v
PYTHONPATH=containers/mtproto-listener python -m unittest containers/mtproto-listener/test_listener.py -v
PYTHONPATH=external/mtproto-adapter python -m unittest discover -s external/mtproto-adapter -p 'test_*.py' -v
```
Expected: all GREEN.

- [ ] **Step 5: Commit**

Commit message:
```text
feat: wire broker-gated production execution stage
```

### Task 5: Bind broker results to exact Trade State legs

**Files:**
- Modify: `cloudflare-v2/src/execution/production_execution_deps.js`
- Test: `cloudflare-v2/tests/production_execution_coordinator.test.mjs`
- Test: `cloudflare-v2/tests/trade_state_node.test.mjs` only if existing API needs additive behavior

**Interfaces:**
- `stateBinder({ workspaceId, groupId, legId, brokerPositionId, brokerOrderId, brokerDealId, fillPrice })`
- Uses existing internal Trade State token/namespace and exact workspace DO shard.

- [ ] **Step 1: Write failing tests**

Prove only successful exact-leg outcomes bind. Duplicate results with previously persisted IDs do not create a second broker action. Workspace/group/leg mismatch fails closed. Secret/raw broker response bodies are not persisted as authoritative state.

- [ ] **Step 2: Verify RED**

Run targeted coordinator/Trade State tests and confirm only new binding contracts fail.

- [ ] **Step 3: Implement binding**

Reuse existing Trade State internal execution-binding endpoint. Persist normalized broker IDs and fill price only. Do not persist bridge secrets, access tokens, or arbitrary broker response objects.

- [ ] **Step 4: Run full tests**

Run `npm run test:ci` plus Python suites above.

- [ ] **Step 5: Commit**

Commit message:
```text
feat: bind production broker results to Trade State
```

### Task 6: Prove admin/master-fuse separation and deployment defaults

**Files:**
- Test: `cloudflare-v2/tests/v1_admin_accounts.test.mjs`
- Test: `cloudflare-v2/tests/wrangler_profiles.test.mjs`
- Modify only if a regression is found: `cloudflare-v2/src/security/trading_permissions.js`, `cloudflare-v2/wrangler.toml`, `cloudflare-v2/wrangler.free.toml`

**Interfaces:**
- No new mutation endpoint.

- [ ] **Step 1: Add regression tests**

Assert owner/admin account-control permissions exist but no role has `broker.master_fuse.write` or `trading.master_fuse.write`. Assert both Wrangler profiles pin `TRADING_ACCESS_ENABLED=false` and `BROKER_EXECUTION_ENABLED=false`.

- [ ] **Step 2: Run targeted tests**

Expected: PASS if current invariant remains intact; if RED, fix only the regression.

- [ ] **Step 3: Run full verification**

Run all Node/Python suites. No Cloudflare exact marker.

- [ ] **Step 4: Commit only if files changed**

Commit message:
```text
test: lock production execution master fuses
```

### Task 7: Broker-disabled staging acceptance harness

**Files:**
- Create: `cloudflare-v2/src/acceptance/production_execution_disabled_acceptance.js`
- Test: `cloudflare-v2/tests/production_execution_disabled_acceptance.test.mjs`
- Add npm script in: `cloudflare-v2/package.json`
- Add exact marker workflow only if external staging proof is required after local/static acceptance; do not trigger it during implementation.

**Interfaces:**
- Acceptance runner exercises signed event -> simulation -> execution stage with broker fuse false and reports secret-free booleans/counts only.

- [ ] **Step 1: Write failing acceptance tests**

Require one deterministic signal to produce simulation actions while execution reports disabled, zero broker calls, zero destination reservations, and unchanged broker-bound state.

- [ ] **Step 2: Verify RED**

Run the new test only.

- [ ] **Step 3: Implement harness**

Use injected fixtures and existing V1 handler. Never require real broker credentials.

- [ ] **Step 4: Verify full suite**

Run all Node/Python tests. No Cloudflare marker.

- [ ] **Step 5: Commit**

Commit message:
```text
test: add broker-disabled production execution acceptance
```

### Task 8: Documentation and exact-head verification

**Files:**
- Modify: `AGENTS.md`
- Modify: `docs/superpowers/plans/2026-09-03-production-v1-launch-master-plan.md` only if gate wording needs synchronization.

**Interfaces:**
- Records exact RED/GREEN commit/run evidence and explicitly states that broker execution remains disabled and Gate 10 is not approved.

- [ ] **Step 1: Run exact-head verification**

Use ordinary CI only. Do not use any Cloudflare/deployment/broker marker. Verify Node/Worker, MT5 bridge, and both MTProto Python suites GREEN and all external-action jobs skipped.

- [ ] **Step 2: Update handoff docs**

Record execution-bridge implementation status, test evidence, remaining real Gate 4/5/6/7/8/9/10 work, and next safe action.

- [ ] **Step 3: Verify docs-only commit triggers no expensive workflow**

Confirm path filters prevent unnecessary Cloudflare/build activity.

- [ ] **Step 4: Do not merge or enable master fuses**

Leave PR #2 draft/open and deployment safety defaults unchanged.
