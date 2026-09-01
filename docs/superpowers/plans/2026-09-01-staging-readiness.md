# Trading V1 Staging Readiness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a non-secret staging readiness validator, safe V1 health endpoint, and explicit staging migration/config runbook before any staging database mutation.

**Architecture:** Keep validation pure and side-effect-free in `src/config/staging_readiness.js`. Expose only boolean readiness and missing configuration names through a wrapper-owned `/api/v1/health` endpoint, never values. Document the exact migration order, staging records, simulation variables, and verification sequence without applying migrations automatically.

**Tech Stack:** Cloudflare Workers ES modules, Node built-in test runner, Wrangler, Supabase/PostgreSQL migrations.

**Spec:** `AGENTS.md`

## Global Constraints

- Active work stays in `cloudflare-v2/` except repository docs/plans.
- Do not change `main`.
- Do not broad-refactor legacy `cloudflare-v2/src/index.js`.
- Do not apply staging or production migrations automatically.
- Do not expose secret values in readiness/health output.
- `TRADING_V1_SHADOW` and `TRADING_V1_SIMULATION` remain off unless explicitly configured.
- Real-money execution remains disabled.

---

### Task 1: Pure staging readiness validator

**Files:**
- Create: `cloudflare-v2/src/config/staging_readiness.js`
- Test: `cloudflare-v2/tests/staging_readiness.test.mjs`

**Interfaces:**
- Consumes: Worker env object.
- Produces: `validateStagingReadiness(env, { requireSimulation = false }) -> { ready, missing, optionalMissing, features }`.

- [ ] **Step 1: Write the failing test**

Test that required configuration names are reported without values, simulation adds Trade State/simulation context requirements, and complete configuration returns `ready=true`.

- [ ] **Step 2: Run test to verify it fails**

Expected: module-not-found failure for `src/config/staging_readiness.js`.

- [ ] **Step 3: Write minimal implementation**

Validate names only. Core required keys: Supabase URL/service role alias, `TRADING_MASTER_KEY`, Zitadel issuer/audience/JWKS. Simulation additionally requires `TRADE_STATE_INTERNAL_TOKEN`, `TRADE_STATE_NAMESPACE`, `TRADING_V1_SIMULATION_INSTRUMENTS`, and `TRADING_V1_SIMULATION_PRICES`.

- [ ] **Step 4: Run full CI**

Expected: Worker/core, MT5 bridge, Wrangler dry-run green.

- [ ] **Step 5: Commit**

Commit validator implementation after RED is confirmed.

### Task 2: Safe V1 health endpoint

**Files:**
- Modify: `cloudflare-v2/src/v1_entry.js`
- Test: `cloudflare-v2/tests/worker_shadow_integration.test.mjs`

**Interfaces:**
- Consumes: `validateStagingReadiness`.
- Produces: `GET /api/v1/health` JSON with service status, readiness booleans, missing config names, V1 feature flags, and no secret values.

- [ ] **Step 1: Write the failing wrapper test**

Require the endpoint to bypass legacy Worker and return no env values or credential-shaped fields.

- [ ] **Step 2: Run test to verify it fails**

Expected: route delegates legacy/does not return V1 readiness payload.

- [ ] **Step 3: Implement wrapper-owned health route**

Return readiness diagnostics only. Do not initialize Supabase or broker clients.

- [ ] **Step 4: Run full CI**

Expected: all three CI stages green.

- [ ] **Step 5: Commit**

Commit the endpoint after verification.

### Task 3: Staging migration/config runbook

**Files:**
- Create: `cloudflare-v2/docs/STAGING_V1_RUNBOOK.md`
- Modify: `AGENTS.md`

**Interfaces:**
- Consumes: migrations `0001` and `0002`, V1 health/readiness contract.
- Produces: exact manual staging sequence and verification evidence checklist.

- [ ] **Step 1: Document preflight**

Require isolated staging Supabase/Worker configuration, backup/snapshot where applicable, health output review, and confirmation that no production URL/project is selected.

- [ ] **Step 2: Document migration order and verification SQL**

Apply `0001_enterprise_trading_foundation.sql` then `0002_trade_correlation_and_account_policy.sql`; verify expected tables/columns/indexes/constraints before creating records.

- [ ] **Step 3: Document staging records/config**

Create one staging workspace, Zitadel org mapping, encrypted source connection, inactive/non-live trade account, explicit simulation instrument/price context, and signed test-event procedure.

- [ ] **Step 4: Document acceptance matrix**

Cover valid signal, duplicate event, invalid signature, ambiguous signal, kill switch, disabled account, fast-wait policy, reply/thread correlation, and missing-market-context block.

- [ ] **Step 5: Update AGENTS handoff**

Record branch/PR status, CI run, no migrations applied, remaining external staging setup, and exact next safe starting point.
