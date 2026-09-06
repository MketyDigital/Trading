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

### Task 1: Frontend Contract Guard — DONE

**Files:**
- Create: `cloudflare-v2/tests/v1_dashboard_contract.test.mjs`
- Modify: `cloudflare-v2/src/dashboard.js`

**Interfaces:**
- Consumes: `renderDashboard(env)`.
- Produces: dashboard HTML using only supported `/api/v1/*` Trading endpoints and an internal V1 request helper.

- [x] Wrote coverage that asserts rendered dashboard does not contain `/api/admin/data/proxy`, `/api/admin/bot/authorize`, `/api/admin/bank/decision`, or other retired Trading admin endpoints.
- [x] Wrote coverage asserting protected frontend calls target `/api/v1/admin/` and include both `Authorization: Bearer ...` and `X-Mkety-Workspace-Id` headers.
- [x] Implemented the V1 browser client and removed retired Trading API calls from the real dashboard.
- [x] Verified through Trading V1 CI.

### Task 2: V1 Overview, Members, Sources, Accounts and Hostnames Views — DONE

**Files:**
- Modify: `cloudflare-v2/src/dashboard.js`
- Create: `cloudflare-v2/tests/v1_dashboard_views.test.mjs`
- Read/verify contracts: `src/http/v1_admin.js`, `v1_admin_members.js`, `v1_admin_sources.js`, `v1_admin_accounts.js`, `v1_admin_hostnames.js`

**Interfaces:**
- Consumes: V1 browser client from Task 1.
- Produces: real UI flows for `/workspace`, `/members`, `/sources`, `/accounts`, `/hostnames`.

- [x] Added supported tab/endpoint/canonical refresh coverage.
- [x] Implemented workspace overview and resource list/create/edit/lifecycle controls using exact V1 contracts.
- [x] Forms repopulate from server responses and display loading/empty/error states.
- [x] Verified through Trading V1 CI.

### Task 3: Operations, Event Audit, Risk/Execution and Settings — DONE

**Files:**
- Modify: `cloudflare-v2/src/dashboard.js`
- Create: `cloudflare-v2/tests/v1_dashboard_operations.test.mjs`
- Read/verify contracts: `src/http/v1_admin_operations.js` and account/source policy modules.

**Interfaces:**
- Consumes: V1 browser client.
- Produces: operations/event audit display, execution-state controls supported by backend, and truthful settings UI.

- [x] Added operations endpoint, event audit endpoint, supported execution lifecycle and settings truthfulness coverage.
- [x] Implemented operations/audit rendering and supported action controls.
- [x] Unsupported/read-only settings are explicitly read-only.
- [x] Verified through Trading V1 CI.

### Task 4: Server-Owned Safe Simulation Adapter Boundary — DONE

**Files:**
- Create: `cloudflare-v2/src/adapters/simulation_execution_adapters.js`
- Create: `cloudflare-v2/tests/simulation_execution_adapters.test.mjs`
- Modify only the smallest existing execution factory/boundary required after reading `src/execution/*` and `src/destinations/*`.

**Interfaces:**
- Produces: fake MT5, cTrader and Telegram destination adapters returning production-shaped outcomes without `fetch`, sockets or real credentials.
- Selection: trusted env/dependency injection only, never request payload.

- [x] Added fake adapter coverage proving canonical outcomes and zero external network calls.
- [x] Added coverage proving caller input such as `simulation=true` cannot select simulation transport.
- [x] Implemented minimal adapters and server-owned adapter selection seam.
- [x] Verified through Trading V1 CI.

### Task 5: Synthetic Mkety Identity Acceptance Seam — DONE

**Files:**
- Create: `cloudflare-v2/tests/v1_synthetic_identity_acceptance.test.mjs`
- Modify only test/dependency-injection seams around `src/http/v1_admin.js` / `src/security/mkety_access_assertion.js` if required.

**Interfaces:**
- Consumes: existing `authenticateFn` injection in `handleV1AdminRequest`.
- Produces: repository acceptance fixtures that return the same authorization shape as a valid Mkety assertion without creating a production fallback.

- [x] Added acceptance coverage exercising V1 admin authorization with synthetic owner identity and real membership/workspace store behavior.
- [x] Asserted production verifier still returns `MKETY_ACCESS_GATE_NOT_CONFIGURED` when issuer/audience/JWKS are missing.
- [x] Verified through Trading V1 CI.

### Task 6: End-to-End Synthetic Source-to-Destination Acceptance — DONE

**Files:**
- Create: `cloudflare-v2/tests/v1_full_stack_simulation.test.mjs`
- Create: `cloudflare-v2/tests/v1_full_stack_simulation_idempotency_audit.test.mjs`
- Modify: execution/orchestration factory seams only as demanded by RED tests.

**Interfaces:**
- Scenario A: synthetic Telegram/MTProto source event -> canonical event -> persistence -> risk -> simulated cTrader/MT5 result -> audit.
- Scenario B: duplicate source event -> same persistent identity/no duplicate destination execution.
- Scenario C: simulated provider/account event -> persisted event/audit state consumable by frontend operations/event views.

- [x] Scenario A covered by `v1_full_stack_simulation.test.mjs`.
- [x] Scenario B covered by `v1_full_stack_simulation_idempotency_audit.test.mjs`.
- [x] Scenario C covered by `v1_full_stack_simulation_idempotency_audit.test.mjs`.
- [x] Verified through Trading V1 CI run `34057104517` and later full runs.

### Task 7: Frontend/API/Schema Audit Matrix — DONE

**Files:**
- Create: `cloudflare-v2/docs/V1_FRONTEND_SYNC_AUDIT.md`
- Create or modify tests only for concrete gaps found.

**Interfaces:**
- Produces a page-by-page/action-by-action matrix of UI control -> API -> permission -> store/table -> resulting UI state.

- [x] Inventoried visible tabs/buttons/forms in `dashboard.js`.
- [x] Mapped controls to exact V1 endpoint and backend handler.
- [x] Mapped backend operation to persisted Trading table/lifecycle state.
- [x] Documented PASS/BLOCKED/REMOVED for each item.
- [x] Verified through Trading V1 CI run `34057441296` and later full runs.

### Task 8: Verification and CI — DONE / CODEQL SETTINGS BLOCKED

**Files:**
- `cloudflare-v2/docs/PRODUCTION_FAST_PATH_HANDOFF.md`

**Interfaces:**
- Produces: exact verified feature-branch SHA and CI evidence.

- [x] Ran/triggered complete Worker/trading-core tests, MT5 tests and MTProto tests.
- [x] Confirmed Trading V1 CI success for latest verified PR #6 head `6da2232f666ae8129f9909f7604128a5e86e823d` with run `34058536767`, job `101554777002`.
- [x] Confirmed grep/contract coverage contains no retired Trading frontend endpoint references through dashboard contract tests.
- [x] Confirmed no real provider credentials or real-execution defaults were added; rollout fuses remain false in repo config.
- [x] Confirmed `main` remains untouched and PR #6 remains isolated against `design/enterprise-trading-event-core`.
- [x] Updated production handoff classification based on evidence.
- [ ] CodeQL fresh success is blocked by repository Code Security configuration, not by a confirmed runtime code finding. Default CodeQL run `34058536874` failed Python and JavaScript/TypeScript SARIF processing because GitHub reports default setup conflicts with advanced configuration. Resolve the repository CodeQL default-vs-advanced settings conflict, then rerun CodeQL.
