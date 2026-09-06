# Trading V1 Frontend Synchronization & Safe Simulation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

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

## Current progress

Current branch: `fix/v1-frontend-sync-simulation`  
Current verified Task 7 SHA before this plan update: `f38189dd6a23a9e663796650e85eb88ec62cb894`  
Verified CI: Trading V1 CI run `34057441296` — success.

Completed commits in this continuation:
- `922f09d777fa68322a2b0148220d617a3e164ad5` — added focused full-stack simulation acceptance coverage.
- `b63265ccd0bfbd9a5b94a0d39eb01804bca8d095` — added duplicate/idempotency and audit-readback Task 6 coverage.
- `f38189dd6a23a9e663796650e85eb88ec62cb894` — added `cloudflare-v2/docs/V1_FRONTEND_SYNC_AUDIT.md`.

---

### Task 1: Frontend Contract Guard — COMPLETE

**Files:**
- `cloudflare-v2/tests/v1_dashboard_contract.test.mjs`
- `cloudflare-v2/src/dashboard.js`

Completion evidence:
- Dashboard no longer references retired Trading admin endpoints.
- Protected frontend calls target `/api/v1/admin/*` and include bearer/workspace headers.
- Settings UI no longer reports fake successful saves.

- [x] Write failing test that asserts rendered dashboard does not contain retired Trading endpoints.
- [x] Write failing test asserting protected frontend calls target `/api/v1/admin/` and include both `Authorization: Bearer ...` and `X-Mkety-Workspace-Id` headers.
- [x] Run focused test and confirm RED against legacy dashboard before implementation.
- [x] Implement minimal V1 browser client and remove retired Trading API calls.
- [x] Run focused test and full test suite.
- [x] Commit `test/feat: synchronize dashboard with v1 api contract`.

### Task 2: V1 Overview, Members, Sources, Accounts and Hostnames Views — COMPLETE

**Files:**
- `cloudflare-v2/src/dashboard.js`
- `cloudflare-v2/tests/v1_dashboard_views.test.mjs`

Completion evidence:
- Workspace, members, sources, accounts and hostnames use V1 admin endpoints.
- Source credential replacement/default selection and account credential replacement are covered.
- Lifecycle mutations refresh canonical server state instead of optimistic browser-only state.

- [x] Write failing tests for supported tabs, endpoint paths, canonical refresh and absence of legacy CRUD.
- [x] Implement workspace overview and resource list/create/edit/lifecycle controls using exact V1 contracts.
- [x] Ensure forms repopulate from server responses and display loading/empty/error states.
- [x] Run focused tests plus full suite.
- [x] Commit `feat: wire core trading views to v1 admin api`.

### Task 3: Operations, Event Audit, Risk/Execution and Settings — COMPLETE

**Files:**
- `cloudflare-v2/src/dashboard.js`
- `cloudflare-v2/tests/v1_dashboard_operations.test.mjs`

Completion evidence:
- Operations view reads `/api/v1/admin/operations`.
- Event audit drill-down reads `/api/v1/admin/events/{eventId}/audit`.
- Account execution and kill-switch controls use supported backend lifecycle endpoints.
- Deployment/security settings are explicitly read-only.

- [x] Write failing tests for operations endpoint, event audit endpoint, supported execution lifecycle actions and removal of fake AI settings success alert.
- [x] Implement operations/audit rendering and supported action controls.
- [x] Make unsupported/read-only settings explicitly read-only.
- [x] Run focused and full tests.
- [x] Commit `feat: synchronize operations audit and settings ui`.

### Task 4: Server-Owned Safe Simulation Adapter Boundary — COMPLETE

**Files:**
- `cloudflare-v2/src/adapters/simulation_execution_adapters.js`
- `cloudflare-v2/tests/simulation_execution_adapters.test.mjs`
- execution factory/boundary changes required by tests

Completion evidence:
- Fake MT5, cTrader and Telegram destination adapters return production-shaped outcomes.
- Fake adapters perform zero external network calls.
- Caller payload cannot select simulation transport; only trusted Worker configuration/dependency injection can.

- [x] Write tests proving fake adapters return canonical results and perform zero external network calls.
- [x] Write test proving caller input such as `simulation=true` cannot select simulation transport.
- [x] Implement minimal adapters and server-owned adapter selection seam.
- [x] Run focused and full tests.
- [x] Commit `feat: add server-owned safe execution simulation adapters`.

### Task 5: Synthetic Mkety Identity Acceptance Seam — COMPLETE

**Files:**
- `cloudflare-v2/tests/v1_synthetic_identity_acceptance.test.mjs`
- test/dependency-injection seams around `src/http/v1_admin.js` / `src/security/mkety_access_assertion.js` where required

Completion evidence:
- Acceptance tests exercise V1 admin authorization with synthetic owner identity and real membership/workspace store behavior.
- Production verifier still fails closed with `MKETY_ACCESS_GATE_NOT_CONFIGURED` when issuer/audience/JWKS are missing.

- [x] Write acceptance test exercising V1 admin authorization with synthetic owner identity and real membership/workspace store behavior.
- [x] Assert production verifier still returns `MKETY_ACCESS_GATE_NOT_CONFIGURED` when issuer/audience/JWKS are missing.
- [x] Implement fixtures/helpers only where necessary.
- [x] Run focused and full tests.
- [x] Commit `test: add synthetic mkety identity acceptance coverage`.

### Task 6: End-to-End Synthetic Source-to-Destination Acceptance — COMPLETE

**Files:**
- `cloudflare-v2/tests/v1_full_stack_simulation.test.mjs`
- `cloudflare-v2/tests/v1_full_stack_simulation_idempotency_audit.test.mjs`

Completion evidence:
- Commit `922f09d777fa68322a2b0148220d617a3e164ad5` proved signed V1 event request -> ingest -> simulation planning -> safe execution-stage handoff without selecting real broker dependencies.
- Commit `b63265ccd0bfbd9a5b94a0d39eb01804bca8d095` proved duplicate source events do not execute destinations twice and simulated provider/account events remain visible through event audit.
- CI run `34057104517` passed Worker/trading-core, MT5 bridge and MTProto Python steps at `b63265ccd0bfbd9a5b94a0d39eb01804bca8d095`.

- [x] Write RED scenario A.
- [x] Implement minimal wiring to GREEN.
- [x] Write RED scenario B and make idempotency GREEN without weakening production rules.
- [x] Write RED scenario C and make event/audit readback GREEN.
- [x] Run full suite.
- [x] Commit `test: prove full stack trading simulation path`.

### Task 7: Frontend/API/Schema Audit Matrix — COMPLETE

**Files:**
- `cloudflare-v2/docs/V1_FRONTEND_SYNC_AUDIT.md`

Completion evidence:
- Commit `f38189dd6a23a9e663796650e85eb88ec62cb894` added the page-by-page/action-by-action matrix.
- Audit maps every visible dashboard control to endpoint, method, permission, persistence and resulting UI state.
- It documents removed/blocked legacy surfaces: generic DB proxy, bot authorize shortcut, bank decision route, legacy signal webhook, fake settings save and browser-selected simulation.
- CI run `34057441296` passed Worker/trading-core, MT5 bridge and MTProto Python steps.

- [x] Inventory every visible tab/button/form in `dashboard.js`.
- [x] Map each to exact V1 endpoint and backend handler.
- [x] Map each backend operation to persisted Trading table/lifecycle state.
- [x] Remove or block unmapped UI controls; no new code change was required during audit.
- [x] Document PASS/BLOCKED/REMOVED for each item.
- [x] Run full suite and commit `docs: record v1 frontend api schema audit`.

### Task 8: Verification and CI — IN PROGRESS / NEXT

**Files:**
- No production changes unless a verification failure requires a test-first fix.

**Interfaces:**
- Produces exact verified feature-branch SHA and CI evidence.

- [ ] Run/trigger complete Worker/trading-core tests, MT5 tests and MTProto tests on the final SHA.
- [ ] Verify CodeQL on the final code-bearing SHA.
- [ ] Confirm grep/contract tests contain no retired Trading frontend endpoint references.
- [ ] Confirm no real provider credentials or real-execution defaults were added.
- [ ] Confirm `main` remains untouched and feature branch remains isolated.
- [ ] Update production handoff classification based on evidence; do not claim staging external gates passed.

## Next pickup

Continue with Task 8 only. Do not redesign. Do not modify MkSaaS. Do not merge to `main`. Do not enable live broker execution. The next worker should verify final CI/CodeQL/status evidence, update `AGENTS.md` and production handoff, then decide whether PR #6 can leave draft or merge into the staging feature branch only.