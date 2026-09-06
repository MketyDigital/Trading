# Trading V1 Frontend Synchronization & Safe Simulation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Synchronize the real Trading frontend with V1 API/database contracts and add a server-owned, no-network simulation mode for end-to-end MT5/cTrader/Telegram acceptance.

**Architecture:** Keep `src/v1_entry.js` and `/api/v1/*` as the production contract. Replace legacy dashboard DB-proxy calls with a V1 browser client and focused Trading views. Add explicit dependency-injected/safe simulation adapters below existing orchestration boundaries so logical execution paths can run with all relevant gates enabled without contacting real providers.

**Tech Stack:** Cloudflare Workers, JavaScript ES modules, React 18 browser bundle rendered by Worker, Node test runner, Supabase client, existing MT5/cTrader/MTProto adapters.

**Spec:** `docs/superpowers/specs/2026-09-06-v1-frontend-sync-simulation-design.md`

## Global Constraints
- Never merge `main` without explicit user approval.
- Never enable real-money execution.
- Never commit real broker/provider credentials.
- Never restore `/api/admin/data/proxy` or other retired Trading admin routes.
- Preserve workspace isolation, Mkety assertion authorization, Supabase final authorization/revocation, server-owned broker config, risk/kill checks, broker-authoritative validation and persistent idempotency.
- Synthetic identity and fake adapters are test/server-owned only and cannot be selected by caller payload.

---

### Task 1: Frontend Contract Guard

**Files:**
- Create: `cloudflare-v2/tests/v1_dashboard_contract.test.mjs`
- Modify: `cloudflare-v2/src/dashboard.js`

**Interfaces:**
- Consumes: `renderDashboard(env)`.
- Produces: dashboard HTML using only supported `/api/v1/*` Trading endpoints and an internal V1 request helper.

- [ ] Write a failing test that asserts rendered dashboard does not contain `/api/admin/data/proxy`, `/api/admin/bot/authorize`, `/api/admin/bank/decision`, or other retired Trading admin endpoints.
- [ ] Write a failing test asserting protected frontend calls target `/api/v1/admin/` and include both `Authorization: Bearer ...` and `X-Mkety-Workspace-Id` headers.
- [ ] Run `node --test tests/v1_dashboard_contract.test.mjs` and confirm RED for the current legacy dashboard.
- [ ] Implement the minimal V1 browser client and remove retired Trading API calls from the real dashboard.
- [ ] Run the focused test and then `npm test`.
- [ ] Commit `test/feat: synchronize dashboard with v1 api contract`.

### Task 2: V1 Overview, Members, Sources, Accounts and Hostnames Views

**Files:**
- Modify: `cloudflare-v2/src/dashboard.js`
- Create: `cloudflare-v2/tests/v1_dashboard_views.test.mjs`
- Read/verify contracts: `src/http/v1_admin.js`, `v1_admin_members.js`, `v1_admin_sources.js`, `v1_admin_accounts.js`, `v1_admin_hostnames.js`

**Interfaces:**
- Consumes: V1 browser client from Task 1.
- Produces: real UI flows for `/workspace`, `/members`, `/sources`, `/accounts`, `/hostnames`.

- [ ] Write failing tests for supported tabs, correct endpoint paths, canonical response refresh and absence of legacy table-name CRUD.
- [ ] Run focused tests and confirm RED.
- [ ] Implement workspace overview and resource list/create/edit/lifecycle controls using exact V1 contracts.
- [ ] Ensure forms repopulate from server responses and display loading/empty/error states.
- [ ] Run focused tests plus full suite.
- [ ] Commit `feat: wire core trading views to v1 admin api`.

### Task 3: Operations, Event Audit, Risk/Execution and Settings

**Files:**
- Modify: `cloudflare-v2/src/dashboard.js`
- Create: `cloudflare-v2/tests/v1_dashboard_operations.test.mjs`
- Read/verify contracts: `src/http/v1_admin_operations.js` and account/source policy modules.

**Interfaces:**
- Consumes: V1 browser client.
- Produces: operations/event audit display, execution-state controls supported by backend, and truthful settings UI.

- [ ] Write failing tests for operations endpoint, event audit endpoint, supported execution lifecycle actions and removal of the fake AI settings success alert.
- [ ] Run focused tests and confirm RED.
- [ ] Implement operations/audit rendering and supported action controls.
- [ ] Make unsupported/read-only settings explicitly read-only; persist only settings with a real V1 backend contract.
- [ ] Run focused and full tests.
- [ ] Commit `feat: synchronize operations audit and settings ui`.

### Task 4: Server-Owned Safe Simulation Adapter Boundary

**Files:**
- Create: `cloudflare-v2/src/adapters/simulation_execution_adapters.js`
- Create: `cloudflare-v2/tests/simulation_execution_adapters.test.mjs`
- Modify only the smallest existing execution factory/boundary required after reading `src/execution/*` and `src/destinations/*`.

**Interfaces:**
- Produces: fake MT5, cTrader and Telegram destination adapters returning production-shaped outcomes without `fetch`, sockets or real credentials.
- Selection: trusted env/dependency injection only, never request payload.

- [ ] Write failing tests proving fake adapters return canonical success/failure/lifecycle results and perform zero external network calls.
- [ ] Write failing test proving caller input such as `simulation=true` cannot select simulation transport.
- [ ] Run focused tests and confirm RED.
- [ ] Implement minimal adapters and server-owned adapter selection seam.
- [ ] Run focused and full tests.
- [ ] Commit `feat: add server-owned safe execution simulation adapters`.

### Task 5: Synthetic Mkety Identity Acceptance Seam

**Files:**
- Create: `cloudflare-v2/tests/v1_synthetic_identity_acceptance.test.mjs`
- Modify only test/dependency-injection seams around `src/http/v1_admin.js` / `src/security/mkety_access_assertion.js` if required.

**Interfaces:**
- Consumes: existing `authenticateFn` injection in `handleV1AdminRequest`.
- Produces: repository acceptance fixtures that return the same authorization shape as a valid Mkety assertion without creating a production fallback.

- [ ] Write failing acceptance test exercising V1 admin authorization with synthetic owner identity and real membership/workspace store behavior.
- [ ] Assert production verifier still returns `MKETY_ACCESS_GATE_NOT_CONFIGURED` when issuer/audience/JWKS are missing.
- [ ] Implement fixtures/helpers only where necessary.
- [ ] Run focused and full tests.
- [ ] Commit `test: add synthetic mkety identity acceptance coverage`.

### Task 6: End-to-End Synthetic Source-to-Destination Acceptance

**Files:**
- Create: `cloudflare-v2/tests/v1_full_stack_simulation.test.mjs`
- Modify: execution/orchestration factory seams only as demanded by RED tests.

**Interfaces:**
- Scenario A: synthetic Telegram/MTProto source event -> canonical event -> persistence -> risk -> simulated cTrader/MT5 result -> audit.
- Scenario B: duplicate source event -> same persistent identity/no duplicate destination execution.
- Scenario C: simulated provider/account event -> persisted event/audit state consumable by frontend operations/event views.

- [ ] Write RED scenario A.
- [ ] Implement minimal wiring to GREEN.
- [ ] Write RED scenario B and make idempotency GREEN without weakening production rules.
- [ ] Write RED scenario C and make event/audit readback GREEN.
- [ ] Run full suite.
- [ ] Commit `test: prove full stack trading simulation path`.

### Task 7: Frontend/API/Schema Audit Matrix

**Files:**
- Create: `cloudflare-v2/docs/V1_FRONTEND_SYNC_AUDIT.md`
- Create or modify tests only for concrete gaps found.

**Interfaces:**
- Produces a page-by-page/action-by-action matrix of UI control -> API -> permission -> store/table -> resulting UI state.

- [ ] Inventory every visible tab/button/form in `dashboard.js`.
- [ ] Map each to exact V1 endpoint and backend handler.
- [ ] Map each backend operation to persisted Trading table/lifecycle state.
- [ ] For any unmapped UI control, remove it or implement a supported V1 contract test-first.
- [ ] Document PASS/BLOCKED/REMOVED for each item.
- [ ] Run full suite and commit `docs: record v1 frontend api schema audit`.

### Task 8: Verification and CI

**Files:**
- No production changes unless a verification failure requires a test-first fix.

**Interfaces:**
- Produces: exact verified feature-branch SHA and CI evidence.

- [ ] Run/trigger complete Worker/trading-core tests, MT5 tests and MTProto tests.
- [ ] Verify CodeQL on the final code-bearing SHA.
- [ ] Confirm grep/contract tests contain no retired Trading frontend endpoint references.
- [ ] Confirm no real provider credentials or real-execution defaults were added.
- [ ] Confirm `main` remains untouched and feature branch remains isolated.
- [ ] Update production handoff classification based on evidence; do not claim staging external gates passed.
