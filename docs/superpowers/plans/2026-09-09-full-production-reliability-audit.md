# Full Production Reliability Audit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every customer-facing Trading workspace section reliable end-to-end in production, specifically fixing source encryption, seamless session renewal, white-label login branding, and external MTProto endpoint onboarding, then verify all exposed frontend features against API and database behavior.

**Architecture:** Keep the current Cloudflare Worker + Supabase architecture. Fix each root cause at its source, add production-safe regression coverage, and extend the real Chromium acceptance gate so UI controls are exercised against the deployed APIs instead of only checked for visibility. Browser access tokens remain short-lived, but the authenticated browser session renews them automatically from the signed HttpOnly refresh cookie so the user never sees token expiry while the refresh session is valid.

**Tech Stack:** Cloudflare Workers, JavaScript/Node.js, Supabase/Postgres, Playwright Chromium, GitHub Actions.

**Spec:** User production reliability request dated 2026-09-09 in this chat.

## Global Constraints

- Work only in `MketyDigital/Trading`.
- Do not enable real broker execution.
- Production acceptance must keep persisted owner switch `brokerExecutionEnabled=false` and effective broker execution blocked.
- Never print, commit, or return secret values except intentional one-time onboarding credentials to the authenticated workspace owner.
- Custom hostname routing is workspace context only, never authorization.
- Each fix must have a failing regression before implementation and fresh full verification before merge/deploy.

---

### Task 1: Source encryption runtime readiness

**Files:**
- Modify: `cloudflare-v2/src/config/staging_readiness.js`
- Modify: `cloudflare-v2/src/security/secret_box.js` only if compatibility handling is required by evidence
- Modify: `.github/workflows/production-cloudflare-deploy.yml`
- Test: `cloudflare-v2/tests/staging_readiness.test.mjs`
- Test: `cloudflare-v2/tests/v1_admin_source_production_store.test.mjs`

**Interfaces:**
- Consumes: production `TRADING_MASTER_KEY`.
- Produces: a readiness check that proves the configured key can actually perform the AES-GCM envelope used by sources/destinations/AI credentials, rather than checking only that a string is present.

- [ ] **Step 1: Add a failing regression** proving readiness rejects a present-but-invalid master key and accepts the supported 32-byte key encoding.
- [ ] **Step 2: Run the focused tests and confirm RED.**
- [ ] **Step 3: Add a secret-safe production diagnostic** that validates key usability without logging the key or derived bytes.
- [ ] **Step 4: Implement the smallest compatibility/readiness fix supported by the production diagnostic.**
- [ ] **Step 5: Run focused + Worker suites and confirm GREEN.**

### Task 2: Seamless browser session renewal

**Files:**
- Modify: `cloudflare-v2/src/dashboard_enterprise_portal.js`
- Modify: `cloudflare-v2/src/dashboard_returning_session.js` if shared helper placement is needed
- Test: `cloudflare-v2/tests/returning_session_runtime_controls.test.mjs`
- Test: `cloudflare-v2/tests/enterprise_single_entry.test.mjs`
- Modify/Test: `.github/workflows/production-frontend-e2e.yml`

**Interfaces:**
- Consumes: `POST /api/v1/access/session` and HttpOnly `mkety_trading_refresh` cookie.
- Produces: `api()` automatically performs one refresh-and-retry on an authenticated 401/TOKEN_EXPIRED response, updates sessionStorage with the new bearer, and never forces a logout while the refresh cookie remains valid.

- [ ] **Step 1: Add failing frontend/runtime tests** for an expired 15-minute bearer with a still-valid refresh session.
- [ ] **Step 2: Confirm RED.**
- [ ] **Step 3: Implement single-flight bearer renewal and exactly-one retry per request.**
- [ ] **Step 4: Preserve fail-closed behavior when refresh itself is invalid/revoked.**
- [ ] **Step 5: Extend Chromium E2E to age/replace the bearer with an expired one and prove a later save succeeds without login.**
- [ ] **Step 6: Run focused + full suites GREEN.**

### Task 3: White-label branding before login

**Files:**
- Modify: `cloudflare-v2/src/v1_entry.js`
- Modify: `cloudflare-v2/src/dashboard_enterprise_portal.js`
- Modify: `cloudflare-v2/src/http/v1_branding.js` only if a server-render helper is required
- Test: `cloudflare-v2/tests/enterprise_portal_entitlement_loading.test.mjs`
- Test/Create: `cloudflare-v2/tests/white_label_login_branding.test.mjs`

**Interfaces:**
- Consumes: active custom-hostname -> workspace mapping and persisted `metadata.branding`.
- Produces: first HTML response on an active branded hostname already contains the workspace brand/product/logo/accent/title; `hideMketyBranding=true` removes Mkety naming from the unauthenticated access screen.

- [ ] **Step 1: Add a failing server-render regression** for an active branded hostname whose branding was saved before hostname activation.
- [ ] **Step 2: Confirm RED.**
- [ ] **Step 3: Resolve safe public branding before rendering `/` on custom hosts and pass it into the portal renderer.**
- [ ] **Step 4: Keep canonical `trade.mkety.com` branded as Mkety Trading.**
- [ ] **Step 5: Add production/custom-domain browser assertion and run GREEN.**

### Task 4: External MTProto onboarding endpoint

**Files:**
- Modify: `cloudflare-v2/src/http/v1_admin_sources.js`
- Modify: `cloudflare-v2/src/dashboard_enterprise_portal.js`
- Test: `cloudflare-v2/tests/enterprise_connections_sync.test.mjs`
- Test: `cloudflare-v2/tests/v1_admin_sources.test.mjs` or nearest existing source onboarding test

**Interfaces:**
- Consumes: generated one-time ingress secret and created source ID.
- Produces: authenticated creation response for `external_mtproto` includes a one-time `endpointUrl` such as `/api/v1/external/mtproto/{sourceId}/{oneTimeToken}`; the secret/token is never returned by subsequent list calls.

- [ ] **Step 1: Add failing tests** proving external MTProto creation returns a usable one-time endpoint and later GET/list redacts it.
- [ ] **Step 2: Confirm RED.**
- [ ] **Step 3: Return the endpoint exactly once from source creation and display/copy it immediately in Connections UI.**
- [ ] **Step 4: Add concise payload/usage instructions for the external userbot and a rotation path if supported.**
- [ ] **Step 5: Run signed endpoint -> internal ingress round-trip tests GREEN.**

### Task 5: Complete frontend/API/database acceptance matrix

**Files:**
- Modify: `.github/workflows/production-frontend-e2e.yml`
- Modify: `cloudflare-v2/docs/V1_FRONTEND_SYNC_AUDIT.md`
- Create/Modify focused tests only where acceptance exposes a missing implementation.

**Interfaces:**
- Produces: a durable acceptance matrix covering every currently exposed section and every selectable source/destination/connection path that can be tested safely without real broker execution or third-party credentials.

- [ ] **Step 1: Enumerate every visible control in Overview, Connections, Routing, AI, Branding, Operations, and Team and map it to its API route and backing table/store.**
- [ ] **Step 2: Exercise CRUD/state transitions with disposable workspace data for all safe local paths: source types that need no third-party credentials, audit destination, formatting, routes, branding, members, hostnames where isolated, operations reads, AI validation, and broker connection safe-create validation without activation/execution.**
- [ ] **Step 3: For credential-dependent paths, verify validation/encryption/storage behavior using synthetic credentials and mocks in CI, never live external accounts.**
- [ ] **Step 4: Verify database rows after API actions where persistence is part of the contract and verify secret fields are not exposed back to the browser.**
- [ ] **Step 5: Verify mobile/desktop UI, console errors, 4xx/5xx responses, session renewal, logout, white-label branding, external MTProto endpoint generation, and custom-hostname workspace isolation.**
- [ ] **Step 6: Run the full Worker/trading-core, MT5, MTProto, production deployment, production Chromium E2E, health, and broker-safety gates.**

## Self-review

- Coverage: source encryption, session expiry, custom-domain login branding, external MTProto onboarding, and full frontend/API/database audit are each mapped to a task.
- No placeholders: every task names files, interfaces, and verification behavior.
- Safety: no task enables real broker execution; production acceptance preserves owner switch OFF.
