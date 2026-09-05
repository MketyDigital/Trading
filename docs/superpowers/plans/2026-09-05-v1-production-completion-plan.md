# Mkety Trading V1 Production Completion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish the Mkety Trading V1 repository so all approved production source, routing, execution, retry, destination, workspace/admin, hostname and access paths are fully wired and testable as enabled flows, while real external credentials/connections remain absent until deployment/acceptance.

**Architecture:** Preserve the existing Trading V1 architecture and authority model. Development/tests may exercise all production-capable paths with gates injected as enabled, but authorization, workspace isolation, risk, kill-switch, broker-authoritative validation and durable idempotency remain mandatory. No new framework, workflow or parallel architecture is introduced.

**Tech Stack:** Cloudflare Workers, Node.js ESM, node:test, Supabase/Postgres, Wrangler, MTProto/MT5/cTrader/TradingView/Custom Signed API adapters already present in the repository.

**Spec:** `cloudflare-v2/docs/PRODUCTION_AUDIT_PROGRESS_2026-09-05.md`

## Global Constraints

- Repository: `MketyDigital/Trading`.
- Branch: `design/enterprise-trading-event-core`.
- Do not merge runtime to `main` without explicit owner instruction.
- Build production-capable code paths as enabled/fully operational in development and tests.
- Do not add real external broker/provider credentials or external connectivity during repository-only implementation.
- Preserve exact workspace authorization, persisted source/account authority, risk controls, kill-switches, broker-authoritative validation and destination idempotency.
- Existing Worker-wide runtime fuses remain deployment controls; tests may inject them as enabled to exercise the full path.
- No new architecture/framework/gate unless a concrete blocker requires it.
- GitHub Actions quota is currently exhausted; accumulate implementation and tests, then perform one consolidated local/full-CI verification when capacity is available.

---

### Task 1: Finish TradingView source readiness semantics

**Files:**
- Modify: `cloudflare-v2/src/http/v1_admin_sources.js`
- Modify only if required by existing boundary: `cloudflare-v2/src/security/tradingview_transport.js`
- Test: `cloudflare-v2/tests/v1_admin_sources.test.mjs`
- Test: existing TradingView ingress tests under `cloudflare-v2/tests/`

**Interfaces:**
- Consumes: persisted TradingView source rows, existing source enable/disable admin route, existing certificate/fingerprint transport checks.
- Produces: deterministic readiness status for TradingView sources and enable behavior that does not pretend transport readiness when required configuration is absent.

- [ ] **Step 1: Add regression coverage for TradingView readiness**

Add tests proving that TradingView source activation/readiness is derived from server-owned transport configuration rather than caller-provided hints, and that enabled development tests can exercise the accepted ingress path with the direct-ingress and certificate conditions injected as satisfied.

- [ ] **Step 2: Implement the smallest readiness integration**

Reuse existing transport configuration helpers; do not create a second certificate/authorization system. Return explicit lifecycle/readiness state through the admin source representation where the existing API shape permits it.

- [ ] **Step 3: Review all TradingView enable/disable call sites**

Confirm no caller can bypass certificate/fingerprint checks merely by toggling an active database row.

- [ ] **Step 4: Commit**

Commit message: `feat: complete tradingview source readiness lifecycle`

---

### Task 2: Complete source ingestion and event-pipeline parity

**Files:**
- Review/modify as needed: `cloudflare-v2/src/http/v1_events.js`
- Review/modify as needed: `cloudflare-v2/src/http/internal_source_event.js`
- Review/modify as needed: `cloudflare-v2/src/sources/source_queue_runtime.js`
- Review/modify as needed: source-normalization modules already used by Telegram/MTProto, MT5, cTrader, TradingView and Custom Signed API
- Tests: corresponding source/event tests under `cloudflare-v2/tests/`

**Interfaces:**
- Consumes: authenticated/authorized source events.
- Produces: one canonical persisted Trading event shape with durable reservation/idempotency before downstream processing.

- [ ] **Step 1: Build a source-family parity matrix from current code**

For Telegram/MTProto, MT5, cTrader, TradingView and Custom Signed API, verify exact ingress/handoff -> active persisted source lookup -> workspace authority -> normalized event -> durable reservation -> downstream processing.

- [ ] **Step 2: Add missing parity tests only where current coverage is absent**

Each approved source family must have at least one success-path test and one fail-closed authority/identity test.

- [ ] **Step 3: Fix only proven parity gaps**

Do not add new transport protocols. Normalize error/status output where two equivalent source paths currently return materially different lifecycle outcomes.

- [ ] **Step 4: Commit**

Commit message: `feat: complete source event pipeline parity`

---

### Task 3: Complete destination/broker account lifecycle and execution wiring

**Files:**
- Review/modify: `cloudflare-v2/src/execution/production_execution_authority.js`
- Review/modify: `cloudflare-v2/src/execution/production_execution_coordinator.js`
- Review/modify: `cloudflare-v2/src/execution/production_execution_deps.js`
- Review/modify: MT5/cTrader/other existing broker executor modules
- Review/modify: `cloudflare-v2/src/http/v1_admin_accounts.js`
- Tests: broker-account, coordinator and adapter tests under `cloudflare-v2/tests/`

**Interfaces:**
- Consumes: persisted account plans, workspace/source/account authority, encrypted server-owned credentials, broker-authoritative metadata.
- Produces: deterministic broker execution result per account/action and durable destination result state.

- [ ] **Step 1: Trace every supported destination from admin onboarding to executor dispatch**

Verify account creation -> inactive/disabled default -> explicit lifecycle update -> persisted credential load -> production dependency composition -> adapter selection -> broker result mapping.

- [ ] **Step 2: Exercise production-capable execution paths with injected enabled gates in tests**

Tests must set the relevant gates true and use fake/in-memory adapters so the real production path is executed without a real broker connection.

- [ ] **Step 3: Close any missing lifecycle or result-mapping gaps**

Ensure unsupported provider/account configuration fails explicitly before adapter dispatch; ensure account/platform/destination authority always comes from persisted state.

- [ ] **Step 4: Commit**

Commit message: `feat: complete broker destination execution wiring`

---

### Task 4: Finish retry, recovery and reconciliation behavior

**Files:**
- Review/modify: `cloudflare-v2/src/execution/destination_retry_runtime.js`
- Review/modify: `cloudflare-v2/src/execution/destination_retry_production.js`
- Review/modify: `cloudflare-v2/src/persistence/supabase_delivery_store.js`
- Review/modify: `cloudflare-v2/src/execution/destination_retry_composition.js`
- Tests: retry/recovery tests under `cloudflare-v2/tests/`

**Interfaces:**
- Consumes: persisted failed/retryable deliveries with exact workspace/destination/event authority.
- Produces: terminal success/failure or a persisted future retry with explicit due time.

- [ ] **Step 1: Cover retry lifecycle end-to-end using fake adapters**

Test due scan -> claim/lease -> authority reload -> execution -> success, terminal authority revocation, dependency failure reschedule, account reload failure reschedule, max-attempt handling and duplicate claim resistance.

- [ ] **Step 2: Normalize retry result semantics**

A retry must never become silently lost because setup/recovery itself failed. Every recoverable failure receives a future `nextAttemptAt`; every terminal failure receives a durable terminal code.

- [ ] **Step 3: Review scheduled runtime gate behavior with gates enabled and disabled**

Keep deployment fuse support, but prove the complete execution path runs when test env injects gates enabled.

- [ ] **Step 4: Commit**

Commit message: `feat: complete destination retry recovery lifecycle`

---

### Task 5: Finish workspace/admin and customer-hostname lifecycle

**Files:**
- Review/modify: `cloudflare-v2/src/http/v1_admin.js`
- Review/modify: `cloudflare-v2/src/http/v1_admin_hostnames.js`
- Review/modify: `cloudflare-v2/src/security/cloudflare_custom_hostnames.js`
- Review/modify: `cloudflare-v2/src/security/trading_hostname_resolver.js`
- Review/modify: `cloudflare-v2/src/security/trading_permissions.js`
- Tests: admin/hostname/permission tests under `cloudflare-v2/tests/`

**Interfaces:**
- Consumes: Mkety-authorized exact workspace/membership and server-side Cloudflare configuration.
- Produces: safe customer hostname provisioning/verification state and routing-context resolution that never replaces authorization.

- [ ] **Step 1: Complete hostname lifecycle states**

Ensure create/list/verify output is sufficient for a future UI to show CNAME/ownership/SSL instructions and clear pending/active/error state without exposing provider credentials.

- [ ] **Step 2: Exercise hostname routing with the custom-hostname gate injected enabled in tests**

Prove active hostname -> exact workspace routing context; pending/unknown hostname -> fail closed; hostname/workspace mismatch -> forbidden; canonical hostname remains supported.

- [ ] **Step 3: Verify owner/admin permissions and exact workspace scoping**

No operator/viewer mutation. No caller-supplied workspace/provider identifier may override persisted authority.

- [ ] **Step 4: Commit**

Commit message: `feat: complete customer hostname lifecycle`

---

### Task 6: Complete Mkety access-gateway consumption path

**Files:**
- Review/modify: `cloudflare-v2/src/security/mkety_access_assertion.js`
- Review/modify: `cloudflare-v2/src/security/trading_membership_store.js`
- Review/modify: `cloudflare-v2/src/http/v1_admin.js`
- Tests: Mkety access/admin authorization tests under `cloudflare-v2/tests/`

**Interfaces:**
- Consumes: signed Mkety Trading bearer assertion with issuer, audience, immutable subject, `product=trading`, exact workspace and owner access.
- Produces: exact Trading workspace/member authorization object used by admin routes.

- [ ] **Step 1: Exercise the real verifier path with local fake JWKS/fetch fixtures**

Tests must cover valid token, invalid signature, issuer, audience, expiry/not-before, wrong product, wrong workspace and disabled/missing membership without contacting the real Mkety gateway.

- [ ] **Step 2: Remove any remaining caller-trust ambiguity**

Workspace selector and hostname may select context, but signed assertion plus persisted enabled membership remains authority.

- [ ] **Step 3: Commit**

Commit message: `feat: complete mkety trading access boundary`

---

### Task 7: Retire stale legacy broker-capable paths and normalize externally reachable routes

**Files:**
- Review/modify: `cloudflare-v2/src/v1_entry.js`
- Review/modify only where necessary: `cloudflare-v2/src/index.js`
- Review/modify: routing tests under `cloudflare-v2/tests/worker_shadow_integration.test.mjs` and adjacent route tests
- Documentation: legacy route references under `cloudflare-v2/docs/`

**Interfaces:**
- Consumes: incoming Worker HTTP requests.
- Produces: only supported V1/admin/internal endpoints; retired broker-capable legacy endpoints return explicit non-executing responses.

- [ ] **Step 1: Inventory every externally reachable route in the current Worker**

Classify each as supported V1, authenticated internal, intentionally public health/status, or retired legacy.

- [ ] **Step 2: Retire remaining stale broker-capable legacy routes proved unnecessary**

Do not remove a route still used by a supported first-party flow.

- [ ] **Step 3: Add route-boundary regression coverage**

Tests must prove retired execution routes cannot reach database/broker side effects.

- [ ] **Step 4: Commit**

Commit message: `chore: finish legacy execution surface retirement`

---

### Task 8: Final consolidated static audit, documentation and verification handoff

**Files:**
- Update: `AGENTS.md`
- Update: `cloudflare-v2/docs/PRODUCTION_FAST_PATH_HANDOFF.md`
- Update: `cloudflare-v2/docs/PRODUCTION_AUDIT_PROGRESS_2026-09-05.md`
- Update/create only if needed: deployment/environment documentation under `cloudflare-v2/docs/`

**Interfaces:**
- Consumes: completed V1 repository state.
- Produces: one exact implementation head, verification instructions, deployment configuration list, external acceptance checklist and rollback/kill procedure.

- [ ] **Step 1: Compare final head against the last verified GREEN baseline**

Review all changed production files for authorization, workspace isolation, credential handling, risk, idempotency, retry and legacy-route regressions.

- [ ] **Step 2: Record complete environment/config contract**

Document all required Supabase, Mkety access, TradingView, custom-hostname and broker/provider bindings; clearly distinguish required deployment configuration from secrets/real accounts that are intentionally not connected during repository build.

- [ ] **Step 3: Prepare one consolidated verification command set**

Primary local verification:

```bash
cd cloudflare-v2
npm install
npm test
```

Then use only the existing relevant acceptance scripts during later external staging acceptance; do not create another acceptance framework.

- [ ] **Step 4: Update handoffs with exact state**

Use the labels `IMPLEMENTED / MANUAL VERIFICATION PENDING`, `MANUALLY VERIFIED`, or `CI GREEN` accurately. Never label runner-less Actions failures as code failures.

- [ ] **Step 5: Commit**

Commit message: `docs: hand off completed trading v1 build`
