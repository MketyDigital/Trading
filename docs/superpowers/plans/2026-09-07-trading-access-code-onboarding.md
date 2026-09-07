# Trading Access-Code Onboarding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a production-safe Trading Enterprise access-code onboarding path that creates one workspace owner and returns a short-lived local Trading bearer for the existing dashboard.

**Architecture:** Add a public redemption endpoint that is fail-closed behind explicit environment flags. Keep access-code redemption separate from normal admin authorization, then allow the returned local bearer to satisfy the same workspace-scoped admin boundary without enabling broker execution.

**Tech Stack:** Cloudflare Worker, Node test runner, Supabase service-role database access, Web Crypto HMAC signing, existing Trading V1 admin APIs.

**Spec:** `cloudflare-v2/docs/TRADING_ACCESS_CODE_ONBOARDING.md`

## Global Constraints

- Access code is onboarding only, not a permanent password.
- Store only code hashes, never plaintext codes.
- Redemption must be disabled unless `TRADING_ACCESS_CODE_REDEMPTION_ENABLED=true`.
- Local bearer requires `TRADING_ACCESS_CODE_SESSION_SECRET`.
- Broker execution remains controlled by existing broker fuses and account/risk locks.
- Existing Mkety/Zitadel Auth Gateway remains the long-term identity target.
- Do not merge to `main` until preflight tests pass and owner completes real frontend/demo testing.

---

### Task 1: Access-code validation and local session tokens

**Files:**
- Create: `cloudflare-v2/src/access/trading_access_codes.js`
- Test: `cloudflare-v2/tests/trading_access_code_onboarding.test.mjs`

**Interfaces:**
- Produces: `normalizeTradingAccessCode(code)`, `validateTradingAccessCodeRecord(record, now)`, `createLocalTradingBearer(payload, secret, nowSec)`, `verifyLocalTradingBearer(token, secret, options)`

- [ ] **Step 1: Write failing tests**

Tests must assert valid code plans are accepted, expired/used/wrong-product codes are rejected, and local bearer verification is workspace-scoped.

- [ ] **Step 2: Run failing tests**

Run: `cd cloudflare-v2 && npm test -- tests/trading_access_code_onboarding.test.mjs`
Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement minimal module**

Implement normalization, record validation, HMAC SHA-256 bearer signing/verification, short expiry, product=`trading`, access=`owner`, and exact workspace matching.

- [ ] **Step 4: Run tests**

Run: `cd cloudflare-v2 && npm test -- tests/trading_access_code_onboarding.test.mjs`
Expected: PASS.

---

### Task 2: Supabase redemption store and HTTP endpoint

**Files:**
- Create: `cloudflare-v2/src/persistence/supabase_access_code_store.js`
- Create: `cloudflare-v2/src/http/v1_access_codes.js`
- Modify: `cloudflare-v2/src/v1_entry.js`
- Test: `cloudflare-v2/tests/trading_access_code_onboarding.test.mjs`

**Interfaces:**
- Produces: `createTradingAccessCodeStore(supabase)` and `handleTradingAccessCodeRedeemRequest(request, env, options)`

- [ ] **Step 1: Add endpoint tests**

Tests must assert redemption is disabled unless explicitly enabled, POST-only, requires code/email, calls store once, returns workspace/membership/entitlements/bearer, and never enables broker execution.

- [ ] **Step 2: Run failing tests**

Expected: FAIL because endpoint/store do not exist.

- [ ] **Step 3: Implement store and route**

Store hashes code, looks up active record, creates or reuses workspace ID from record, creates owner membership subject, increments redemption count, and writes audit row.

- [ ] **Step 4: Wire entrypoint**

Route exact `POST /api/v1/access/redeem` before the global Trading access gate. Keep all admin/events/webhook routes protected as before.

- [ ] **Step 5: Run tests**

Expected: PASS.

---

### Task 3: Database migration

**Files:**
- Create: `cloudflare-v2/db/migrations/0014_trading_access_code_onboarding.sql`
- Test: `cloudflare-v2/tests/trading_access_code_onboarding.test.mjs`

**Interfaces:**
- Produces tables: `public.trading_access_codes`, `public.trading_access_code_redemptions`

- [ ] **Step 1: Add migration contract tests**

Assert migration includes RLS enablement, anon/authenticated revokes, service_role grant, unique code hash, workspace FK, and audit table.

- [ ] **Step 2: Add migration SQL**

Create tables, indexes, grants, RLS, and constraints.

- [ ] **Step 3: Run tests**

Expected: PASS.

---

### Task 4: Package script and PR status

**Files:**
- Modify: `cloudflare-v2/package.json`
- Modify: PR body after test evidence is available

**Interfaces:**
- Produces script: `accept:access-code:preflight`

- [ ] **Step 1: Add package script**

Add `"accept:access-code:preflight": "node --test tests/trading_access_code_onboarding.test.mjs"`.

- [ ] **Step 2: Run full CI**

Run: `cd cloudflare-v2 && npm test`
Expected: PASS.

- [ ] **Step 3: Update PR body**

Record access-code onboarding status, test run IDs, and remaining real frontend/demo test requirement.
