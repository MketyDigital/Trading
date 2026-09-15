# Production Stabilization and DEMO Readiness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make PR #89 the verified production-stabilization superset and prepare a fresh real DEMO acceptance run while LIVE execution remains disabled.

**Architecture:** Keep the existing source -> canonical lifecycle -> route fanout -> broker/destination architecture. Fix access rotation at the persistence boundary, preserve metadata by merge rather than replacement, invalidate stale credentials by binding issued sessions to the current workspace access generation/current access identity, consolidate only still-correct management-continuity behavior from older PRs, and add regression tests before each implementation fix. Production cleanup is performed only after dependency mapping and whitelist verification.

**Tech Stack:** Cloudflare Worker JavaScript, Node test runner, Supabase/Postgres/PostgREST, Telegram Bot API/MTProto, cTrader, MT5 connector/bridge, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-09-15-production-stabilization-demo-readiness.md`

## Global Constraints

- LIVE execution stays disabled throughout.
- Fresh broker risk context remains mandatory for broker management actions.
- Persisted authority wins over caller hints.
- Broker success + persistence failure is repaired without resending unless reconciliation proves no broker action occurred.
- Test data must not pollute production.
- Starpips and Mkay are the only legitimate trading-access customers to retain during production cleanup.
- Do not delete unrelated Supabase Auth users.
- Branding/configuration restoration must be evidence-backed; never invent a missing brand value.

---

### Task 1: Access reissue regression coverage

**Files:**
- Modify: `cloudflare-v2/tests/mkety_admin_access_codes*.test.mjs` or the existing admin-access test file discovered in the branch.
- Modify: `cloudflare-v2/tests/access_codes*.test.mjs` or the existing access-session test file discovered in the branch.

**Interfaces:**
- Consumes: current admin create/reissue store and access-session issuance/restore interfaces.
- Produces: executable expectations for same-workspace rotation, additive entitlements, metadata preservation, old-code invalidation, stale-session invalidation, and DEMO-only entitlements.

- [ ] **Step 1: Write failing tests for metadata preservation and additive entitlements**

Create a seeded workspace containing unrelated metadata such as `branding`, an existing destination entitlement set, and a current access-code ID. Reissue with only Telegram added and assert the workspace ID is unchanged, unrelated metadata remains byte-equivalent, prior entitlements remain, Telegram is added, and `liveExecution === false`.

- [ ] **Step 2: Run the focused tests and verify they fail for the current wholesale metadata replacement behavior**

Run the existing Node test command targeting the access-code files. Expected: at least the preservation/rotation assertions fail before implementation.

- [ ] **Step 3: Write failing tests for credential rotation**

Seed two credentials for the same workspace, rotate from the current one, and assert all predecessor active codes are revoked while the replacement is active. Issue a pre-rotation refresh/session credential and assert restoration/authorization fails once workspace access identity/generation changes.

- [ ] **Step 4: Run the focused tests and verify stale access currently remains valid**

Expected: old active code and/or old session still authorizes under current implementation.

- [ ] **Step 5: Commit regression tests**

Commit only the failing regression coverage before the implementation fix.

---

### Task 2: Implement metadata-safe atomic access rotation

**Files:**
- Modify: `cloudflare-v2/src/http/v1_mkety_admin_access_codes.js`
- Modify: `cloudflare-v2/src/dashboard_mkety_admin_access_codes.js`
- Modify: `cloudflare-v2/src/persistence/supabase_access_code_store.js`
- Modify: access-session/bearer verification module(s) discovered by searching `issueSession`, refresh verification, and local trading bearer authorization.
- Create/Modify: Supabase migration only if a dedicated access-generation column/function is required after inspecting current schema.

**Interfaces:**
- Consumes: existing workspace/access-code records and normalized entitlements.
- Produces: explicit reissue/rotate operation with metadata merge, additive entitlements, predecessor revocation, and stale-session rejection.

- [ ] **Step 1: Inspect every authorization path that accepts access-code-issued session/bearer credentials**

Search for `issueSession`, refresh-token verification, bearer verification, `restoreSession`, and workspace membership authorization. Record the minimum common state check that can reject a stale credential on every privileged path.

- [ ] **Step 2: Choose the smallest durable stale-credential binding**

Prefer a dedicated monotonic workspace access generation if schema/query patterns support it cleanly; otherwise bind credentials to the authoritative current access-code ID stored in workspace/membership metadata and validate that binding on every restore/authorization path. The chosen value must change on every rotation.

- [ ] **Step 3: Implement workspace metadata merge instead of replacement**

When creating/reissuing and when redeeming/logging in, read existing workspace/membership metadata and merge only owned access fields (`accessCodeId`, onboarding/provisioning flags, entitlements, access-generation identity) while preserving unrelated keys.

- [ ] **Step 4: Implement additive entitlement merge for reissue**

For source/destination arrays use stable union. For additive booleans preserve existing `true` and allow supplied `true` to add capability. Force `brokerModes=['demo']` and `liveExecution=false` regardless of input.

- [ ] **Step 5: Implement credential rotation transaction semantics**

Create the replacement credential for the same workspace, update the authoritative current access identity/generation, and revoke all predecessor `active` credentials for that workspace. If DB RPC/transaction support is required for correctness, create the smallest internal function/migration with restricted execution privileges and verify security advisors afterward.

- [ ] **Step 6: Make the admin UI call explicit Reissue/Rotate behavior**

Existing-user action must no longer look like a generic create. Preserve/create fields from current workspace state and make the operation semantics clear without adding any permission-removal behavior.

- [ ] **Step 7: Make session/bearer authorization validate current access identity/generation**

A credential issued before rotation must fail even if its cryptographic signature is still valid. New credentials issued after rotation must succeed for the same workspace.

- [ ] **Step 8: Run focused access tests until all new and existing tests pass**

Do not weaken any existing LIVE or entitlement guard to make tests pass.

- [ ] **Step 9: Commit implementation**

Commit access rotation separately from production data cleanup.

---

### Task 3: Durable-state null and close-state regression

**Files:**
- Modify: `cloudflare-v2/tests/supabase_trade_state_persistence.test.mjs`
- Modify: `cloudflare-v2/src/persistence/supabase_trade_state_persistence.js`
- Review: `cloudflare-v2/src/state/trade_state_store.js`
- Review/port if still applicable: PR #86 close/management continuity changes.

**Interfaces:**
- Produces: null-safe durable numeric serialization and lifecycle completion that preserves opening history.

- [ ] **Step 1: Add failing null-preservation tests**

Persist/read a leg with nullable numeric fields set to `null` and assert they remain null; persist an explicit numeric `0` and assert it remains zero.

- [ ] **Step 2: Run the focused persistence tests and verify current `Number(null)` behavior fails**

Expected: at least one null becomes zero before fix.

- [ ] **Step 3: Add/confirm close-state tests**

Assert a successful full close records a non-null close timestamp and zero remaining volume while preserving opening fill/broker identifiers if the close response omits them.

- [ ] **Step 4: Implement a null-safe finite-number serializer/deserializer**

Guard `null`/`undefined` before numeric conversion. Preserve valid zero. Reject/non-materialize non-finite values according to existing persistence conventions.

- [ ] **Step 5: Port only still-needed PR #86 lifecycle changes**

Compare current #89 state/coordinator/dependency code with PR #86. Bring forward only behavior not already superseded and still consistent with current architecture.

- [ ] **Step 6: Run persistence/management tests and commit**

---

### Task 4: Break-even and management continuity CI blocker

**Files:**
- Review: `cloudflare-v2/src/execution/break_even_safety.js`
- Review: `cloudflare-v2/src/execution/production_execution_deps_unified.js`
- Review/port if needed: `cloudflare-v2/src/execution/production_execution_coordinator.js`
- Review/port if needed: `cloudflare-v2/src/execution/production_execution_deps.js`
- Modify tests: `cloudflare-v2/tests/break_even_safety_regressions.test.mjs`
- Modify tests: `cloudflare-v2/tests/production_mt5_connector_risk_context.test.mjs`
- Modify compound/recovery management tests as required.

**Interfaces:**
- Produces: management actions that validate local prerequisites and still load fresh broker risk/position context before broker approval/dispatch.

- [ ] **Step 1: Extract the exact current CI failing assertion from PR #89 logs**

Do not infer the failure from neighboring code.

- [ ] **Step 2: Add/adjust a focused regression reproducing that assertion locally in CI test semantics**

The regression must explicitly prove fresh broker context remains required.

- [ ] **Step 3: Fix ordering/initialization only at the root cause**

If current code materializes broker context before an earlier purely-local validation that should fail first, move only the local validation ahead; still materialize fresh broker context before approving or dispatching `MOVE_SL_TO_BE`.

- [ ] **Step 4: Reconcile PR #86 management-continuity behavior**

Port any still-missing restart/recovery/correlation behavior into #89 and retain current newer safety checks.

- [ ] **Step 5: Run break-even, MT5 risk-context, compound-management, and recovery tests**

Expected: all pass without weakening fail-closed behavior.

- [ ] **Step 6: Commit**

---

### Task 5: Prevent production pollution from tests

**Files:**
- Modify the E2E/acceptance test bootstrap/config files that currently point at production Supabase or create `*.test` customers in the production project.
- Modify CI workflow/env setup only where necessary to force isolated test targets.

**Interfaces:**
- Produces: production guard that refuses destructive/fixture-creation test execution against the production Supabase project unless the test is an explicitly whitelisted read-only acceptance probe.

- [ ] **Step 1: Search test fixture creation for `example.test`, `starpips.test`, `frontend-e2e`, `connection-readiness`, `gateway-config-probe`, and `diag-redemption`**

Map each creator to its environment/project selection.

- [ ] **Step 2: Add a production-project refusal regression/guard**

Fixture-creating tests must fail before insert when project ref equals the production project `vdblajgxrfndjesoyayy`.

- [ ] **Step 3: Route fixtures to isolated/local/test Supabase configuration**

Do not change read-only production acceptance probes into write-enabled tests.

- [ ] **Step 4: Run the affected E2E/bootstrap tests and commit**

---

### Task 6: Dependency-safe production access cleanup

**Database:** Supabase project `vdblajgxrfndjesoyayy`.

**Interfaces:**
- Consumes: foreign-key map and canonical legitimate workspace IDs.
- Produces: production trading-access data containing only legitimate Starpips and Mkay customer state plus required dependencies.

- [ ] **Step 1: Re-query current state before mutation**

Fetch all trading workspace/access rows, access codes/statuses, memberships, destinations/templates, sources/routes, accounts, runtime controls, and row counts for test-pattern owners/workspaces. Reconfirm current canonical IDs; do not rely only on historical notes.

- [ ] **Step 2: Query foreign-key relationships for the trading-access/workspace tables**

Build deletion/migration order from actual constraints and cascade behavior.

- [ ] **Step 3: Audit Starpips and Mkay attached configuration**

Before deleting duplicate Mkay workspaces, identify any legitimate destination/source/route/account/template/config rows attached to them and migrate/preserve only evidence-backed production data.

- [ ] **Step 4: Recover branding only from evidence**

Inspect destination templates, workspace metadata, audit/event history, and prior rows where available. If no previous brand value exists, preserve the current null rather than inventing one.

- [ ] **Step 5: Apply the access rotation repair to Starpips**

Make the latest Starpips credential authoritative and revoke predecessors. Verify old code fails and new access succeeds. Verify Telegram access is additive and pre-existing configuration remains.

- [ ] **Step 6: Delete fake/test data in one dependency-safe transaction or verified sequence**

Match explicit test domains/prefixes and non-canonical duplicate workspaces only after preservation/migration. Do not touch unrelated `auth.users`.

- [ ] **Step 7: Verify whitelist and orphan counts**

Assert trading-access owners are only `fxhighpriest01@gmail.com` and `mkpoikankes@gmail.com`; verify no test-pattern rows remain across dependent trading tables; verify canonical routes/destinations/accounts still resolve.

- [ ] **Step 8: Re-query runtime controls and prove LIVE is false**

---

### Task 7: Consolidated CI verification

**Files:** no source changes unless failures reveal a new root cause.

- [ ] **Step 1: Run/follow the full PR #89 GitHub Actions suite on the latest head**

- [ ] **Step 2: Verify Worker/trading-core tests**

- [ ] **Step 3: Verify Telegram Bot API and MTProto tests**

- [ ] **Step 4: Verify MT5 bridge/connector tests**

- [ ] **Step 5: Verify access rotation and persistence regressions**

- [ ] **Step 6: Verify the latest PR head contains the still-required behavior from PRs #86/#88**

- [ ] **Step 7: Re-query production runtime controls; LIVE must still be disabled**

---

### Task 8: Fresh real DEMO acceptance and observation

**Operational inputs:** current production runtime controls, current DEMO account rows, current source/routes/destinations, connector health.

- [ ] **Step 1: Perform a fresh preflight**

Confirm `trading_access_enabled=true`, DEMO execution controls as intentionally configured, `live_broker_execution_enabled=false`, target DEMO account enabled, every LIVE account execution-disabled, route/source authority valid, and connector/gateway healthy.

- [ ] **Step 2: Observe a normal DEMO open**

Capture source event ID, canonical interpretation, route decisions, broker result, destination result, position/group identifiers, and durable Supabase readback.

- [ ] **Step 3: Observe fast/incomplete -> full completion**

Prove the later full signal promotes/protects the same logical position and does not create a duplicate broker open.

- [ ] **Step 4: Observe management actions**

Exercise safe DEMO TP/SL update, `MOVE_SL_TO_BE`, and partial/full close as applicable. Confirm fresh broker context and durable state after each.

- [ ] **Step 5: Observe Telegram destination behavior and failure isolation**

Verify configured formatting mode and that Telegram success/failure does not alter independent broker execution outcomes.

- [ ] **Step 6: Verify restart/recovery continuity where practical**

Reload/recover state and prove later management still correlates without duplicate broker actions.

- [ ] **Step 7: Final LIVE-off proof**

Re-query runtime controls and every LIVE account after acceptance. Record that LIVE remained disabled before, during, and after the run.

- [ ] **Step 8: Update this plan/spec/AGENTS.md with material final invariants and acceptance evidence**

---

## Self-review

- Spec coverage: access rotation, production cleanup, PR consolidation, Telegram/execution/management, persistence null handling, CI isolation, DEMO acceptance, and LIVE-off proof all map to tasks above.
- Placeholder scan: no implementation step relies on TBD/TODO placeholders.
- Interface consistency: access identity/generation is defined as the credential-rotation authority and is consumed by session/bearer verification; no permission-removal behavior is introduced by reissue.
- Safety consistency: every path keeps `liveExecution=false` and preserves the fresh-broker-context requirement.