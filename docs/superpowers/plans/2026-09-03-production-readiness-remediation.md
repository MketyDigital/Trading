# Production Readiness Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Resolve the latest-approved static production audit findings F1-F10, complete the approved runtime snapshot/warm-context integrations, harden the MT5 metadata boundary, and return the branch to a verified static-GREEN state before any remaining real acceptance gate.

**Architecture:** Keep simulation as the deterministic planning authority, but introduce one final server-authoritative execution authority check immediately before every broker action. Broker-reported metadata remains authoritative at the send boundary; persistent delivery state remains the idempotency/recovery ledger; Trade State repair consumes already-persisted successful broker results and never resends merely to repair state. Performance caches/sessions remain non-authoritative and may never bypass fresh revocation, risk, idempotency, or broker-reconciliation checks.

**Tech Stack:** Cloudflare Worker JavaScript/ESM, Node.js 22 test runner, Supabase/PostgreSQL migrations, Cloudflare Durable Objects/Queues, Python MT5 bridge, cTrader Open API runtime, GitHub Actions.

**Spec:** `cloudflare-v2/docs/PRODUCTION_V1_DEVELOPMENT_AUDIT.md`; controlling launch requirements remain `docs/superpowers/plans/2026-09-03-production-v1-launch-master-plan.md`, `docs/superpowers/specs/2026-09-03-production-execution-bridge-design.md`, and `docs/superpowers/specs/2026-09-03-hot-path-isolation-and-resilience-design.md`.

## Global Constraints

- Keep `TRADINGVIEW_DIRECT_INGRESS_ENABLED=false` by default.
- Keep `TRADINGVIEW_CERT_PROBE_ENABLED=false` by default.
- Keep `TRADING_ACCESS_ENABLED=false` by default.
- Keep `BROKER_EXECUTION_ENABLED=false` by default.
- No task may deploy, mutate Cloudflare, run a protected external probe, place a broker order, merge `main`, or enable real-money execution.
- `TRADING_ACCESS_ENABLED=false` or `BROKER_EXECUTION_ENABLED=false` must make broker invocation structurally impossible.
- Critical source/workspace/account/safety revocation must win immediately before each broker dispatch and retry dispatch.
- Caller-provided workspace/source/account/provider/broker/credential/execution hints are never authority.
- Persistent destination idempotency is mandatory before broker send.
- Broker-success/Trade-State-repair must never resend an order solely to obtain broker identifiers again.
- Broker metadata is authoritative for symbol mapping, precision, volume constraints, account mode, and risk-to-volume validation at send time.
- Risk-sized orders must never be rounded/clamped upward above the risk-approved quantity.
- Runtime snapshots and warm sessions are optimizations only; final authority checks remain fresh and server-side.
- Every runtime-code task follows RED -> verify RED -> minimal GREEN -> focused GREEN -> ordinary PR CI.
- Synchronize `cloudflare-v2/docs/PRODUCTION_V1_DEVELOPMENT_AUDIT.md` and `AGENTS.md` after every verified milestone.

---

### Task 1: Enforce both Worker master fuses on every broker-capable path (F1)

**Files:**
- Modify: `cloudflare-v2/src/pipeline/v1_execution_stage.js`
- Modify: `cloudflare-v2/src/execution/destination_retry_production.js`
- Test: `cloudflare-v2/tests/production_execution_integration.test.mjs`
- Test: `cloudflare-v2/tests/destination_retry_production.test.mjs`
- Test: `cloudflare-v2/tests/hot_path_failure_isolation.test.mjs`

**Interfaces:**
- Consumes: `env.TRADING_ACCESS_ENABLED`, `env.BROKER_EXECUTION_ENABLED`.
- Produces: no production dependency construction or broker dispatch unless both are explicitly true.

- [ ] **Step 1: Write failing first-dispatch test**

Add an integration case where `TRADING_ACCESS_ENABLED='false'`, `BROKER_EXECUTION_ENABLED='true'`, simulation contains a READY account, and both `executionDepsFactory` and `executeProductionFn` increment counters. Assert returned execution is disabled and both counters stay zero.

- [ ] **Step 2: Write failing retry-dispatch test**

Add a retry case with a due retry row, `TRADING_ACCESS_ENABLED='false'`, `BROKER_EXECUTION_ENABLED='true'`, and counters around retry claim/execution dependency construction. Assert no claim/dependency/broker path is reached.

- [ ] **Step 3: Verify RED**

Run ordinary PR CI on the RED commit. Expected: new master-access-fuse assertions fail while protected Cloudflare/demo jobs remain skipped.

- [ ] **Step 4: Implement minimal dual-fuse guards**

Use one local `enabled()` boolean interpretation matching existing code. In `runV1ProductionExecutionStage()`, return a fail-closed execution summary before `trustedReadyPlans()` can construct broker dependencies when Trading access is disabled. In production retry runtime, return before due-row scan/claim when either master fuse is false.

- [ ] **Step 5: Verify focused/full GREEN and commit**

Expected focused tests PASS, then ordinary PR CI PASS. Commit message: `fix: enforce trading access fuse on broker paths`.

---

### Task 2: Preserve exact event identity and add one final server-authoritative execution authority loader (F2, F3, F4, F9)

**Files:**
- Create: `cloudflare-v2/src/execution/production_execution_authority.js`
- Modify: `cloudflare-v2/src/pipeline/v1_execution_stage.js`
- Modify: `cloudflare-v2/src/execution/production_execution_deps.js`
- Modify: `cloudflare-v2/src/execution/production_execution_coordinator.js`
- Modify: `cloudflare-v2/src/execution/destination_retry_production.js`
- Test: `cloudflare-v2/tests/production_execution_authority.test.mjs`
- Test: `cloudflare-v2/tests/production_execution_integration.test.mjs`
- Test: `cloudflare-v2/tests/production_execution_coordinator.test.mjs`
- Test: `cloudflare-v2/tests/destination_retry_production.test.mjs`
- Test: `cloudflare-v2/tests/production_execution_retry_context.test.mjs`

**Interfaces:**
- Produce `createProductionExecutionAuthorityLoader({ supabase, workspaceId, tradingEventId })`.
- Produce `authorityLoader({ workspaceId, tradingEventId, accountId }) -> { event, source, workspace, account }` or throw a bounded fail-closed authority error.
- Authority loader must query server-owned records only: exact `trading_events(id,workspace_id,source_connection_id)`, exact `source_connections(id,workspace_id,is_active)`, exact `trading_workspace_access(id,trading_access_enabled)`, exact `trade_accounts(id,workspace_id,is_active,execution_enabled,safety_policy,...)`.

- [ ] **Step 1: Write failing event-link propagation test**

Assert `runV1ProductionExecutionStage()` passes `tradingEventId: result.eventId` into `executionDepsFactory`, and the resulting delivery store receives that same event ID.

- [ ] **Step 2: Write failing exact-authority tests**

Cover event/workspace mismatch, missing event, inactive source, source/workspace mismatch, disabled workspace entitlement, missing account, account/workspace mismatch, inactive account, execution-disabled account, and active valid authority.

- [ ] **Step 3: Write failing per-action revocation test**

Create a two-action account plan whose authority loader returns enabled for action 1 and kill-switched/disabled for action 2. Assert exactly one dispatch occurs and action 2 is blocked before broker reservation/send.

- [ ] **Step 4: Write failing retry authority test**

For a claimed retry, assert the runtime rebuilds authority from `destination_deliveries.trading_event_id` + exact account ID before dispatch and fails terminally without broker send if source/workspace/account authority is revoked.

- [ ] **Step 5: Verify RED**

Run ordinary PR CI on the RED commit. Expected failures are limited to the new authority/event-link contracts.

- [ ] **Step 6: Implement authority loader and compose it immediately before each action**

The coordinator must call `authorityLoader()` inside the action loop, not once before the loop. Use the returned current account row for policy/dispatch. Initial account lookup may remain for early shape validation but is not final authority.

- [ ] **Step 7: Compose the same loader into retry execution**

Use the claimed row's durable `workspace_id`, `trading_event_id`, trusted destination/account context, and exact server-side account identity. Never derive source/workspace from `request_payload`.

- [ ] **Step 8: Verify focused/full GREEN and commit**

Commit message: `fix: revalidate production execution authority per action`.

---

### Task 3: Restore complete final policy/risk context and fail closed on unsafe volume normalization (F7, F8, F10)

**Files:**
- Create: `cloudflare-v2/src/execution/production_risk_authority.js`
- Modify: `cloudflare-v2/src/pipeline/v1_execution_stage.js`
- Modify: `cloudflare-v2/src/execution/production_execution_coordinator.js`
- Modify: `cloudflare-v2/src/execution/production_execution_deps.js`
- Modify: `cloudflare-v2/src/execution/platform_translation.js`
- Modify: `cloudflare-v2/src/normalization/trading_normalizer.js`
- Modify as needed: `cloudflare-v2/src/adapters/ctrader_market_data.js`
- Modify as needed: `cloudflare-v2/bridges/mt5_bridge.py`
- Test: `cloudflare-v2/tests/production_risk_authority.test.mjs`
- Test: `cloudflare-v2/tests/production_execution_integration.test.mjs`
- Test: `cloudflare-v2/tests/production_execution_coordinator.test.mjs`
- Test: `cloudflare-v2/tests/platform_translation.test.mjs`
- Test: `cloudflare-v2/tests/normalization.test.mjs`
- Test: MT5 Python bridge tests if broker profit/tick-value metadata is added.

**Interfaces:**
- Final policy request shape must use exact names consumed by `evaluateAccountPolicy`: `totalLots`, `riskPercent`, `currentDailyPnlPercent`, `currentOpenRiskPercent`.
- Produce strict volume validators that never raise requested quantity: MT5 canonical lots must be within min/max and exactly on step; cTrader canonical lots converted to protocol volume must be within min/max and exactly on step.
- Produce a broker-authoritative risk assertion for risk-sized OPEN actions. It must compare planned lots/risk against current server-loaded account configuration and connected-broker metadata before send; if reliable monetary loss-at-stop cannot be established, block rather than guess.

- [ ] **Step 1: Write failing real-composition policy-shape tests**

Use an actual `runV1ProductionExecutionStage()` -> `executeProductionPlan()` path. Assert max lots, max risk %, daily loss, and max open risk each block when configured. Do not hand-construct coordinator-only fields that production does not emit.

- [ ] **Step 2: Write failing strict-volume tests**

Assert MT5 planned `0.01` against broker minimum `0.10` throws instead of becoming `0.10`; assert non-step MT5 lots throw instead of rounding upward. Add equivalent cTrader protocol-volume cases.

- [ ] **Step 3: Write failing broker-authoritative risk tests**

For a risk-percent account, provide current broker account equity/balance + symbol loss model and prove the final allowed lots are no greater than the risk-approved lots. Provide changed live metadata that would make the planned lots exceed configured risk and assert zero broker send.

- [ ] **Step 4: Verify RED**

Run PR CI on the RED commit.

- [ ] **Step 5: Implement exact final policy field propagation**

Carry deterministic risk/policy data from simulation output only as non-authoritative intent/context, then recompute/reload dynamic exposure/account/broker facts server-side before dispatch. Never trust request body fields.

- [ ] **Step 6: Replace live volume clamp-up behavior with strict execution validation**

Keep permissive normalization helpers only where they are explicitly simulation/display utilities. Production order translation must reject below-minimum, above-maximum, or non-step quantity; it may normalize price precision but may not increase risk-sized volume.

- [ ] **Step 7: Implement broker-authoritative risk assertion**

Use broker/account metadata already available from MT5 context/cTrader runtime. For simple instruments use reliable tick-value/loss-per-lot data; for broker-specific models use platform-authoritative profit/loss calculation where exposed. If neither is reliable, return a fail-closed risk-context error for risk-sized OPEN actions. Fixed-lot accounts still require strict broker volume constraints and final safety policy.

- [ ] **Step 8: Verify focused/full GREEN and commit**

Commit message: `fix: enforce broker authoritative risk and volume`.

---

### Task 4: Repair successful broker deliveries that failed Trade State binding without resending (F5)

**Files:**
- Create: `cloudflare-v2/src/execution/execution_binding_repair.js`
- Modify: `cloudflare-v2/src/persistence/supabase_delivery_store.js`
- Modify: `cloudflare-v2/src/execution/production_execution_coordinator.js`
- Modify: `cloudflare-v2/src/execution/destination_retry_runtime.js` or scheduled composition only where needed for a separate binding-repair scan.
- Test: `cloudflare-v2/tests/execution_binding_repair.test.mjs`
- Test: `cloudflare-v2/tests/production_execution_coordinator.test.mjs`
- Test: `cloudflare-v2/tests/hot_path_failure_isolation.test.mjs`

**Interfaces:**
- Persist enough bounded, non-secret binding context with successful delivery: exact workspace, event, destination/account, group, leg, idempotency key, normalized broker IDs/fill.
- Produce `repairExecutionBindings({ supabase, stateBinder, limit, now })` that scans only successful broker deliveries explicitly marked as binding-pending/failed, binds existing broker result to exact state, and marks binding repaired.
- No repair path may call MT5/cTrader executor.

- [ ] **Step 1: Write failing post-broker-bind-failure test**

Simulate successful broker delivery persistence followed by `stateBinder` failure. Assert delivery remains broker-successful but gains explicit binding-repair state rather than becoming broker-retryable.

- [ ] **Step 2: Write failing repair test**

Feed the repair runtime a successful persisted delivery with exact group/leg and broker IDs. Assert stateBinder is called once, broker executor count stays zero, and repair state is marked complete.

- [ ] **Step 3: Write failing idempotent repair test**

Run the same repair twice; second run must not duplicate state mutation or broker work.

- [ ] **Step 4: Verify RED**

Run PR CI.

- [ ] **Step 5: Implement additive persistent binding-repair state**

Prefer additive columns/migration only if the existing response/request payload cannot represent bounded repair status safely. Never overwrite broker `SUCCEEDED` with a broker-failure state solely because Trade State binding failed.

- [ ] **Step 6: Compose repair into scheduled recovery independently of destination retry**

Destination retry continues to own `RETRYABLE` broker sends. Binding repair owns only already-successful broker outcomes.

- [ ] **Step 7: Verify focused/full GREEN and commit**

Commit message: `fix: repair successful broker state bindings safely`.

---

### Task 5: Remove Trading broker-account dependency on shared MKSaaS workspaces (F6)

**Files:**
- Create: `cloudflare-v2/db/migrations/0012_trade_accounts_trading_workspace_fk.sql`
- Test: `cloudflare-v2/tests/trade_accounts_trading_workspace_migration.test.mjs`
- Modify docs: `cloudflare-v2/docs/STAGING_V1_RUNBOOK.md`

**Interfaces:**
- `trade_accounts.workspace_id` must reference Trading-owned `trading_workspace_access(id)`, not shared `public.workspaces(id)`.
- Preserve existing rows; migration must fail safely if an existing account references a workspace not present in `trading_workspace_access` rather than silently creating shared/product state.
- Do not mutate/drop shared `public.workspaces`.

- [ ] **Step 1: Write failing migration contract test**

Assert migration drops only the legacy `trade_accounts.workspace_id -> public.workspaces(id)` FK and creates the Trading-owned FK with reviewed delete semantics. Assert it never alters shared `public.workspaces`.

- [ ] **Step 2: Add existing-row precondition contract**

Migration SQL must explicitly detect orphaned `trade_accounts.workspace_id` values relative to `trading_workspace_access` and raise/abort before constraint replacement.

- [ ] **Step 3: Verify RED**

Run PR CI.

- [ ] **Step 4: Implement additive numbered migration**

Use explicit constraint discovery/drop only for the relevant trade-account workspace FK, then add `REFERENCES public.trading_workspace_access(id)`. Preserve account rows and all non-FK columns.

- [ ] **Step 5: Verify focused/full GREEN and commit**

Commit message: `fix: isolate trade accounts to trading workspaces`.

- [ ] **Step 6: Environment note**

Do not apply the migration to the real shared Supabase project during this static task. Record that authorized read-only schema/ledger inspection is required before later environment application.

---

### Task 6: Integrate runtime execution snapshots without weakening final authority (I1)

**Files:**
- Modify: `cloudflare-v2/src/execution/runtime_execution_snapshot.js` only if interface additions are needed.
- Modify: `cloudflare-v2/src/execution/production_execution_deps.js`
- Modify: `cloudflare-v2/src/pipeline/v1_execution_stage.js`
- Test: `cloudflare-v2/tests/runtime_execution_snapshot.test.mjs`
- Test: `cloudflare-v2/tests/hot_path_failure_isolation.test.mjs`
- Test: `cloudflare-v2/tests/production_execution_integration.test.mjs`

**Interfaces:**
- Snapshot may cache only non-secret, versioned, bounded configuration useful before final authority: symbol mappings/catalog version, non-secret platform metadata, static account planning config.
- Final Task 2 authority loader and Task 3 risk assertion remain mandatory immediately before dispatch.

- [ ] **Step 1: Write failing production-integration cache test**

Prove repeated actions can reuse an eligible non-secret snapshot/config object while final authority loader is still called for every action.

- [ ] **Step 2: Write stale/revocation test**

Populate an enabled snapshot, then make final authority return source/workspace/account revoked. Assert zero dispatch despite cache hit.

- [ ] **Step 3: Verify RED**

Run PR CI.

- [ ] **Step 4: Compose bounded snapshot cache**

Do not cache secrets or final allow/deny authority. Invalidation/version changes may evict optimization state, but correctness cannot depend on eviction timing.

- [ ] **Step 5: Verify focused/full GREEN and commit**

Commit message: `perf: compose nonauthoritative execution snapshots`.

---

### Task 7: Reuse broker contexts safely and close the MT5 metadata transport boundary (I2, U1)

**Files:**
- Modify: `cloudflare-v2/src/execution/production_execution_deps.js`
- Modify: `cloudflare-v2/src/adapters/ctrader_runtime.js` / session lifecycle as needed.
- Modify: `cloudflare-v2/bridges/mt5_bridge.py`
- Modify: `cloudflare-v2/src/testing/mt5_demo_acceptance.js`
- Test: `cloudflare-v2/tests/production_execution_deps.test.mjs`
- Test: cTrader runtime/session tests.
- Test: `cloudflare-v2/bridges/test_mt5_bridge.py`
- Test: MT5 demo acceptance tests.

**Interfaces:**
- Warm context/session scope must be bounded by exact broker account/environment/workspace and must be disposable on auth/runtime failure.
- No warm context may cache final source/workspace/account kill authority.
- MT5 metadata requests must be authenticated unless an explicit tested private-only topology contract is committed. Static remediation chooses authenticated metadata requests because repository topology currently does not prove private-only reachability.

- [ ] **Step 1: Write failing MT5 metadata-auth tests**

Require the same server bridge secret (or a purpose-separated derived request signature) for `/v1/account`, `/v1/symbols`, and `/v1/tick`; unsigned/wrong signatures return unauthorized without account/symbol data.

- [ ] **Step 2: Write failing MT5 production/demo client tests**

Assert metadata GETs carry the expected authentication header/signature and never log/expose the secret.

- [ ] **Step 3: Write failing warm cTrader lifecycle test**

For two sequential actions on the same exact account/environment within one execution batch, assert one runtime/session construction can serve both; workspace/account/environment change must not reuse it.

- [ ] **Step 4: Write failing MT5 metadata reuse test**

Within one bounded account execution batch, health/account/catalog context should not be fetched again for every leg unless invalidated/failed. Broker command idempotency remains per action.

- [ ] **Step 5: Verify RED**

Run Node + Python PR CI.

- [ ] **Step 6: Implement authenticated MT5 metadata requests**

Reuse existing secret authority server-side; do not place secrets in URLs. Keep POST command HMAC/replay contract unchanged.

- [ ] **Step 7: Implement bounded per-batch warm broker contexts**

Prefer request/batch-scoped reuse over indefinite global state. Close cTrader runtime at batch completion/error. Cache MT5 account/catalog context only for the current validated account batch or short bounded context; fresh Task 2/3 authority remains per action.

- [ ] **Step 8: Verify focused/full GREEN and commit**

Commit message: `perf: harden and reuse broker execution contexts`.

---

### Task 8: Expand failure-injection coverage, static acceptance, and exact-head evidence

**Files:**
- Modify: `cloudflare-v2/tests/hot_path_failure_isolation.test.mjs`
- Modify/add production acceptance tests as needed.
- Modify: `cloudflare-v2/docs/PRODUCTION_V1_DEVELOPMENT_AUDIT.md`
- Modify: `AGENTS.md`

**Interfaces:**
- Must prove all F1-F10 regressions fail closed and I1-I2 optimizations cannot become authority.

- [ ] **Step 1: Add integrated failure matrix**

Include: Trading access off on queue/retry; source disabled after ingest; workspace entitlement revoked after planning; account kill between two actions; max-lot/risk/daily-loss/open-risk change before send; broker metadata min/step change; mandatory idempotency unavailable; broker success followed by state-binding failure and repair; stale snapshot; warm-context failure; MT5 metadata auth rejection.

- [ ] **Step 2: Run complete static suites**

Expected commands represented by ordinary CI: Node/trading-core, pure MT5 Python, Container MTProto Python, external MTProto Python.

- [ ] **Step 3: Verify ordinary exact-head PR CI**

Record exact head SHA, workflow run ID, job IDs/test counts, and confirm all Cloudflare inspect/probe/deploy/accept and dedicated demo jobs are skipped.

- [ ] **Step 4: Re-audit call graph**

Trace HTTP, Queue, scheduled retry, authority loader, coordinator, broker adapters, delivery store, binding repair, snapshots, and warm contexts against the latest Sept 3 contracts. Any new safety gap reopens remediation before external gates.

- [ ] **Step 5: Synchronize handoff docs**

Update `cloudflare-v2/docs/PRODUCTION_V1_DEVELOPMENT_AUDIT.md` with RED/GREEN SHAs/run IDs and mark each F/I/U item resolved or explicitly externally pending. Update `AGENTS.md` with concise operational truth and the next exact gate.

- [ ] **Step 6: Commit documentation synchronization**

Commit message: `docs: record static production remediation evidence`.

---

### Task 9: Return to real acceptance gates without skipping production-launch requirements

**Files:**
- Reference/update only after actual authorized evidence: `cloudflare-v2/docs/PRODUCTION_V1_ACCEPTANCE_READINESS.md`
- Reference/update: `cloudflare-v2/docs/STAGING_V1_RUNBOOK.md`
- Reference/update: `cloudflare-v2/docs/NON_LIVE_MULTI_SOURCE_ACCEPTANCE.md`
- Modify after each verified real milestone: `AGENTS.md`

**Interfaces:**
- No environment mutation occurs merely because static remediation is GREEN.
- Each real gate requires its existing protected prerequisites/authorization/cleanup contract.

- [ ] **Step 1: Gate 4** — managed Zitadel real non-live identity acceptance.
- [ ] **Step 2: Gate 5** — real Telegram account/channel soak and restart/replay acceptance.
- [ ] **Step 3: Gate 6** — real MT5/cTrader demo source probes with exact protected markers.
- [ ] **Step 4: Gate 7** — real demo broker lifecycle acceptance, now including broker-authoritative risk-to-volume evidence from Task 3.
- [ ] **Step 5: Gate 8** — end-to-end real staging/failure soak including source/workspace/account revocation and binding-repair cases.
- [ ] **Step 6: Gate 9** — monitoring, kill controls, rollback, recovery, security and sustained latency/failure acceptance.
- [ ] **Step 7: Gate 10 Phase A/B** — only after applicable prior gates are GREEN and deployment is separately authorized: shadow production, then production-infrastructure dedicated demo broker.
- [ ] **Step 8: Gate 10 Phase C** — remains CLOSED until separate explicit user tiny-live approval plus owner-recorded max per-trade risk, max volume, max concurrent/open risk, daily loss ceiling, allowed symbols, and kill/rollback contacts/procedure.
- [ ] **Step 9: Tiny-live -> controlled beta -> general production** — advance only on recorded evidence and no unresolved severity-1/2 trading-safety issue.

## Self-review result

- F1 is covered by Task 1.
- F2/F3/F4/F9 are covered together by Task 2 because they share one final durable authority boundary.
- F7/F8/F10 are covered together by Task 3 because they share the final risk/volume/policy boundary.
- F5 is isolated in Task 4 because broker-success state repair must never share broker-send retry semantics.
- F6 is isolated in Task 5 because it is a schema-tenancy change and must remain independently reviewable.
- I1 and I2 remain separate performance tasks after safety correctness is restored.
- U1 is resolved by static authenticated metadata hardening rather than relying on undocumented topology.
- Task 8 supplies the cross-cutting regression/evidence gate.
- Task 9 preserves all real-production launch stages and separate tiny-live approval.
- No task enables a master fuse, invokes a protected acceptance marker, applies a real migration, deploys, or places an order during static remediation.