# Returning Auth and Admin Runtime Controls Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make returning enterprise owners regain access without repeating onboarding, add a database-backed Mkety owner broker master switch, and align production secret/runtime configuration without weakening fail-closed execution safety.

**Architecture:** Keep `BROKER_EXECUTION_ENABLED` as the outer deployment capability gate, but require a second persisted global runtime control before any broker dispatch. Production may ship with the outer capability enabled while the persisted owner switch defaults OFF. Access-code redemption remains one-time onboarding; successful redemption issues a short bearer plus a signed HttpOnly refresh cookie, and `/api/v1/access/session` renews the short bearer after validating the persisted workspace membership/entitlements.

**Tech Stack:** Cloudflare Worker JavaScript, Node test runner, Supabase/Postgres, GitHub Actions/Wrangler.

**Spec:** User-approved requirements in the 2026-09-08 frontend/database/codebase audit conversation.

## Global Constraints

- Broker dispatch requires both the deployment capability gate and the persisted Mkety owner runtime switch.
- The persisted broker switch defaults OFF and fails closed on lookup errors.
- Enterprise customers never receive or control the global broker switch.
- Access codes remain bounded onboarding credentials and are not converted into permanent passwords.
- Refresh credential is HttpOnly, Secure, SameSite=Lax and never returned to JavaScript.
- Session renewal must revalidate workspace access/membership before issuing a new short bearer.
- Mkety admin API remains secret-guarded and must fail closed when the secret is absent.
- No real broker credentials or real-money execution are introduced by this work.

---

### Task 1: Returning owner session

**Files:**
- Modify: `cloudflare-v2/tests/trading_access_code_onboarding.test.mjs`
- Modify: `cloudflare-v2/tests/enterprise_single_entry.test.mjs`
- Modify: `cloudflare-v2/src/access/trading_access_codes.js`
- Modify: `cloudflare-v2/src/http/v1_access_codes.js`
- Modify: `cloudflare-v2/src/persistence/supabase_access_code_store.js`
- Modify: `cloudflare-v2/src/v1_entry.js`
- Modify: `cloudflare-v2/src/dashboard_enterprise_portal.js`

**Interfaces:**
- Produces: `POST /api/v1/access/session` and `POST /api/v1/access/logout`.
- Produces: HttpOnly refresh cookie `mkety_trading_refresh`.
- Existing `POST /api/v1/access/redeem` still performs onboarding and returns the short bearer.

- [ ] Add failing tests for refresh cookie issuance, session renewal, logout clearing, and portal automatic restoration.
- [ ] Verify tests fail on current branch.
- [ ] Implement signed refresh-token helpers and store lookup for returning membership.
- [ ] Implement session/logout endpoints and portal restoration.
- [ ] Run focused tests and full Node suite.

### Task 2: Database-backed broker owner switch

**Files:**
- Create: `cloudflare-v2/db/migrations/0017_trading_runtime_controls.sql`
- Create: `cloudflare-v2/src/persistence/supabase_runtime_control_store.js`
- Modify: `cloudflare-v2/tests/v1_execution_transport_compatibility.test.mjs`
- Modify: `cloudflare-v2/tests/mkety_admin_access_codes.test.mjs`
- Modify: `cloudflare-v2/src/pipeline/v1_execution_stage.js`
- Modify: `cloudflare-v2/src/http/v1_mkety_admin_access_codes.js`
- Modify: `cloudflare-v2/src/dashboard_mkety_admin_access_codes.js`
- Modify: `cloudflare-v2/src/v1_entry.js`

**Interfaces:**
- Persisted key: `broker_execution_enabled` boolean; singleton/global Trading scope.
- Admin endpoints: `GET /api/v1/mkety-admin/runtime-controls` and `PATCH /api/v1/mkety-admin/runtime-controls`.
- Broker execution is allowed only when `BROKER_EXECUTION_ENABLED=true` AND persisted `broker_execution_enabled=true`.

- [ ] Add failing tests for default-OFF/fail-closed behavior and admin read/write control.
- [ ] Verify tests fail on current branch.
- [ ] Add migration and runtime-control store.
- [ ] Gate execution stage on both controls.
- [ ] Add Mkety admin switch UI/API.
- [ ] Run focused tests and full Node/Python suites.

### Task 3: Production secret/runtime alignment

**Files:**
- Modify: `.github/workflows/production-cloudflare-deploy.yml`
- Modify: `AGENTS.md`
- Modify: `docs/trading-launch-console-manual-e2e.md`

**Interfaces:**
- GitHub secret: `MKETY_TRADING_ADMIN_SECRET`.
- Wrangler secret binding: `MKETY_TRADING_ADMIN_SECRET`.
- Production outer capability: `BROKER_EXECUTION_ENABLED=true`; persisted owner switch remains OFF until explicitly changed in admin UI.

- [ ] Require and deploy the admin secret by name only without logging it.
- [ ] Change production outer broker capability to ON only after the DB control exists and defaults OFF.
- [ ] Update handoff/runbook with exact two-gate semantics and returning-user flow.
- [ ] Run full CI, CodeQL, apply migration, deploy, verify health and owner switch OFF.
