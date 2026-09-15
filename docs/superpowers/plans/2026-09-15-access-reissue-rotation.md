# Access Reissue Rotation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make access reissue preserve workspace state, add permissions without destructive replacement, revoke predecessor credentials immediately, invalidate old sessions, and remove production test pollution without affecting real customer work.

**Architecture:** Treat the workspace as the durable identity and access codes as rotatable credentials. Reissue merges existing workspace/access metadata and entitlements, rotates current access-code identity, and validates returning sessions against that current identity. Production cleanup is explicit and dependency-aware.

**Tech Stack:** Cloudflare Worker JavaScript, Node test runner, Supabase/PostgreSQL, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-09-15-access-reissue-rotation-design.md`

## Global Constraints

- LIVE execution remains disabled throughout.
- Preserve the existing PR #89 stabilization work and branch.
- Preserve canonical Starpips and Mkay workspace state.
- Reissue cannot silently remove existing entitlements.
- Old credential/session access must fail after successful rotation.
- Test/diagnostic records must not persist as production customers.

---

### Task 1: Access rotation regression tests

**Files:**
- Modify: `cloudflare-v2/tests/mkety_admin_access_codes.test.mjs`
- Modify: `cloudflare-v2/tests/trading_access_code_onboarding.test.mjs`

**Interfaces:**
- Consumes: `createMketyAdminAccessCodeStore`, `handleMketyAdminAccessCodesRequest`, `createTradingAccessCodeStore`, access session helpers.
- Produces: failing regression coverage for metadata preservation, additive entitlements, old-code revocation, same-workspace rotation, and stale-session rejection.

- [ ] **Step 1: Write failing admin-store tests**
  Add cases where an existing workspace contains unrelated branding/config metadata and existing entitlements. Reissue the same workspace with Telegram newly enabled and assert the persisted workspace retains existing metadata, keeps old entitlements, adds Telegram, and revokes prior active codes.
- [ ] **Step 2: Run targeted admin tests and confirm they fail for current overwrite/additive behavior**
  Run: `node --test tests/mkety_admin_access_codes.test.mjs`
  Expected: new rotation assertions fail against current create/upsert implementation.
- [ ] **Step 3: Write failing returning-session test**
  Issue/restore a session under access-code A, rotate workspace to access-code B, and assert restoring A-bound session is denied while B succeeds.
- [ ] **Step 4: Run targeted onboarding tests and confirm the new stale-session assertion fails**
  Run: `node --test tests/trading_access_code_onboarding.test.mjs`
  Expected: stale-session test fails until current-code binding is enforced.

### Task 2: Implement non-destructive access rotation

**Files:**
- Modify: `cloudflare-v2/src/http/v1_mkety_admin_access_codes.js`
- Modify: `cloudflare-v2/src/persistence/supabase_access_code_store.js`
- Modify: `cloudflare-v2/src/access/trading_access_codes.js` only if token payload helpers require current-code binding.

**Interfaces:**
- Consumes: existing workspace/access rows and normalized entitlements.
- Produces: rotation operation that preserves workspace state, merges entitlements, revokes predecessors, and writes current access-code identity.

- [ ] **Step 1: Load existing workspace on reissue and verify owner/workspace identity**
  Reject mismatched owner for an existing workspace.
- [ ] **Step 2: Merge existing workspace metadata instead of replacing it**
  Preserve all unrelated keys and update only access-specific keys (`accessCodeId`, entitlement/access flags, requested subdomain fields).
- [ ] **Step 3: Merge reissue entitlements additively**
  Preserve previously true capabilities/destinations/source types and union newly selected values. Keep `liveExecution: false` and `brokerModes: ['demo']` unless an existing stricter demo-only posture already applies.
- [ ] **Step 4: Revoke predecessor active codes for the same workspace as part of rotation**
  Ensure only the newly created code remains current/active after successful rotation.
- [ ] **Step 5: Bind workspace/membership metadata to the new current access-code identity**
  Return/use the new identity on subsequent sessions.
- [ ] **Step 6: Run targeted admin/onboarding tests**
  Run: `node --test tests/mkety_admin_access_codes.test.mjs tests/trading_access_code_onboarding.test.mjs`
  Expected: PASS.

### Task 3: Invalidate superseded sessions

**Files:**
- Modify: `cloudflare-v2/src/access/trading_access_codes.js`
- Modify: `cloudflare-v2/src/http/v1_access_codes.js`
- Modify: `cloudflare-v2/src/persistence/supabase_access_code_store.js`
- Modify: `cloudflare-v2/tests/trading_access_code_onboarding.test.mjs`

**Interfaces:**
- Consumes: current access-code identity stored in workspace/membership metadata.
- Produces: refresh/bearer/session payload binding checked at restoration time.

- [ ] **Step 1: Include credential binding in newly issued local access/refresh tokens**
  Include the current access-code ID/generation as a signed claim.
- [ ] **Step 2: Verify binding during returning-session restoration**
  Compare signed token binding with current workspace/membership access-code identity; deny on mismatch.
- [ ] **Step 3: Preserve compatibility only where safe**
  New-customer/new-session paths must work; unbound stale sessions must not remain valid after rotation.
- [ ] **Step 4: Run targeted session tests**
  Run: `node --test tests/trading_access_code_onboarding.test.mjs tests/trading_access_code_owner_binding.test.mjs`
  Expected: PASS.

### Task 4: Make the staff UI explicitly rotate rather than accidentally recreate

**Files:**
- Modify: `cloudflare-v2/src/dashboard_mkety_admin_access_codes.js`
- Modify: `cloudflare-v2/tests/mkety_admin_access_codes.test.mjs` or dashboard-specific test if present.

**Interfaces:**
- Consumes: existing access-code list and same backend endpoint/rotation semantics.
- Produces: clear Create vs Reissue/Rotate action, current entitlements prefilled, same workspace reused.

- [ ] **Step 1: Add regression assertion for reissue payload semantics**
  Confirm reissue carries existing workspace ID and does not imply removing unchecked pre-existing grants.
- [ ] **Step 2: Change UI language/action state to `Reissue / Rotate access` for existing workspace**
  Keep new-customer create behavior separate.
- [ ] **Step 3: Run UI/admin tests**
  Run the relevant Node tests; expected PASS.

### Task 5: Fix nullable numeric persistence regression already identified by AGENTS audit

**Files:**
- Modify: `cloudflare-v2/tests/supabase_trade_state_persistence.test.mjs`
- Modify: `cloudflare-v2/src/persistence/supabase_trade_state_persistence.js`

**Interfaces:**
- Consumes: nullable trade-leg numeric fields.
- Produces: serializer/deserializer that preserves null as null while preserving valid zero.

- [ ] **Step 1: Add failing null-preservation tests**
  Assert nullable `requestedLots`, `executedLots`, `fillPrice`, `volumeStepLots`, and `minimumLots` remain null across persistence serialization/readback.
- [ ] **Step 2: Run targeted persistence test and confirm failure**
  Run: `node --test tests/supabase_trade_state_persistence.test.mjs`
  Expected: current `Number(null)` paths produce zero and fail.
- [ ] **Step 3: Add null-safe numeric conversion helper at persistence boundary**
  Guard `null`/`undefined` before numeric conversion; preserve finite `0`.
- [ ] **Step 4: Audit corresponding readback conversions for the same coercion and fix only confirmed cases**
- [ ] **Step 5: Run targeted persistence tests**
  Expected: PASS.

### Task 6: Resolve the existing PR #89 Worker/trading-core CI failure without weakening BE safety

**Files:**
- Modify only the exact production/test files implicated by the failing assertion after log extraction.

**Interfaces:**
- Consumes: exact failing GitHub Actions assertion from run tied to the PR head.
- Produces: minimal BE/order fix that retains fresh broker risk context before an actual `MOVE_SL_TO_BE` is approved/sent.

- [ ] **Step 1: Extract exact failing assertion from GitHub Actions logs**
- [ ] **Step 2: Add/adjust focused regression test reproducing that assertion**
- [ ] **Step 3: Implement minimal ordering/scoping fix if evidence confirms the materializer-order hypothesis**
  Local validation may precede broker-context materialization, but fresh broker context remains mandatory before approving/sending BE.
- [ ] **Step 4: Run targeted Worker/trading-core tests**
  Expected: PASS.

### Task 7: Production data cleanup and isolation

**Files:**
- Supabase production rows only after code-level protection is in place.
- Modify acceptance/test cleanup code if tests are confirmed to target production data.

**Interfaces:**
- Consumes: canonical workspace IDs and dependency graph.
- Produces: only legitimate Starpips/Mkay customer state remains; test records cannot accumulate again.

- [ ] **Step 1: Snapshot/count all dependent rows for canonical Starpips, canonical Mkay, legacy Mkay, and synthetic workspaces**
- [ ] **Step 2: Verify LIVE runtime control is false before mutations**
- [ ] **Step 3: Revoke the superseded Starpips access code and repair current workspace metadata/entitlements non-destructively if needed**
- [ ] **Step 4: Inspect legacy Mkay dependencies and migrate/preserve any real data before deleting obsolete duplicate workspace rows**
- [ ] **Step 5: Delete synthetic E2E/diagnostic/probe records dependency-first inside controlled SQL transaction(s)**
- [ ] **Step 6: Re-query to prove only legitimate customer workspaces/access remain**
- [ ] **Step 7: Verify LIVE remains false after cleanup**

### Task 8: Full verification and DEMO acceptance

**Files:**
- No new feature files unless verification exposes a specific defect.

**Interfaces:**
- Consumes: completed PR branch.
- Produces: CI evidence, DEMO acceptance, durable readback, destination isolation, and LIVE-off proof.

- [ ] **Step 1: Run/observe full PR GitHub Actions suite**
- [ ] **Step 2: Verify durable state readback for access rotation and trade-state null preservation**
- [ ] **Step 3: Run fresh DEMO acceptance according to `AGENTS.md`**
- [ ] **Step 4: Verify destination isolation and no cross-account/live leakage**
- [ ] **Step 5: Verify LIVE disabled before/during/after acceptance**
- [ ] **Step 6: Run verification-before-completion checklist before any completion claim**
