# Enterprise Single-Entry Auth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `https://trade.mkety.com` the only customer-facing entry point: redeem an access code or later accept Mkety central auth, establish one shared Trading session, and show only workspace-entitled enterprise features without asking customers to copy bearer tokens or workspace IDs between pages.

**Architecture:** Add an enterprise portal shell at `/` that owns customer authentication/session state and loads the existing workspace/launch-console surfaces as same-origin internal views. Access-code redemption remains backed by Supabase and produces the local short-lived Trading bearer; future Mkety signed assertions remain accepted by the existing Trading authorization layer. Both auth methods converge on the same workspace/membership/entitlement checks. Mkety staff access-code administration remains isolated at `/mkety-admin/access-codes` and is not part of the tenant session.

**Tech Stack:** Cloudflare Worker, vanilla JS/HTML, Node 22 tests, Supabase, existing Trading V1 auth APIs.

**Spec:** `docs/superpowers/specs/2026-09-07-trading-launch-console-destinations-mtproto-design.md` plus owner-approved single-entry UX decision on 2026-09-08.

## Global Constraints

- `BROKER_EXECUTION_ENABLED=false` throughout this work and deployment.
- Do not enable customer DNS/custom-hostname production changes.
- Do not expose bearer tokens, access-code hashes, Telegram credentials, API keys, session strings, or encryption keys in rendered HTML/API list responses.
- Supabase remains final Trading workspace/membership/entitlement authority for both local access-code auth and future Mkety-signed auth.
- Mkety staff access-code administration remains separate from tenant authentication.

---

### Task 1: Enterprise portal contract

**Files:**
- Create: `cloudflare-v2/tests/enterprise_portal.test.mjs`
- Create: `cloudflare-v2/src/dashboard_enterprise_portal.js`

**Interfaces:**
- Produces: `renderEnterpriseTradingPortal(env)`.
- Consumes: `POST /api/v1/access/redeem` and the existing shared browser session keys.

- [ ] **Step 1: Write failing tests** asserting the portal renders at the root customer entry, contains access-code redemption fields, contains no manual bearer/workspace inputs for normal customer use, provides a future Mkety-auth handoff hook, persists returned workspace/bearer in session storage, and loads only entitled console sections after authentication.
- [ ] **Step 2: Run the focused test and verify RED.**
- [ ] **Step 3: Implement the minimal enterprise portal.** Access-code redemption POSTs owner/code data to `/api/v1/access/redeem`, writes the returned workspace ID, bearer and entitlements to shared session storage, and transitions to authenticated portal navigation. Existing sessions restore automatically on reload.
- [ ] **Step 4: Run the focused test and verify GREEN.**
- [ ] **Step 5: Commit.**

### Task 2: Root routing and internal compatibility routes

**Files:**
- Modify: `cloudflare-v2/src/v1_entry.js`
- Create/Modify: `cloudflare-v2/tests/v1_enterprise_entrypoint.test.mjs`

**Interfaces:**
- Consumes: `renderEnterpriseTradingPortal(env)`.
- Produces: `/` as the enterprise portal; `/workspace-console` and `/launch-console` remain internal same-origin views for the portal; `/mkety-admin/access-codes` remains isolated.

- [ ] **Step 1: Write failing tests** for root portal routing, staff-route isolation, and compatibility routes.
- [ ] **Step 2: Run and verify RED.**
- [ ] **Step 3: Implement minimal routing.**
- [ ] **Step 4: Run and verify GREEN.**
- [ ] **Step 5: Commit.**

### Task 3: Shared tenant session across existing consoles

**Files:**
- Modify: `cloudflare-v2/src/dashboard.js`
- Modify: `cloudflare-v2/src/dashboard_launch_console.js`
- Modify: existing dashboard/launch-console tests.

**Interfaces:**
- Consumes shared session keys: `mketyTradingWorkspace`, `mketyTradingBearer`, `mketyTradingEntitlements`.
- Produces internal views that authenticate automatically from the portal session and never require the customer to manually paste a bearer or workspace ID.

- [ ] **Step 1: Add failing tests** requiring shared-session restoration and absence of normal-customer manual bearer prompts in internal views.
- [ ] **Step 2: Run and verify RED.**
- [ ] **Step 3: Implement shared-session consumption and portal-directed unauthenticated state.**
- [ ] **Step 4: Run and verify GREEN.**
- [ ] **Step 5: Commit.**

### Task 4: Entitlement-aware enterprise navigation

**Files:**
- Modify: `cloudflare-v2/src/dashboard_enterprise_portal.js`
- Test: `cloudflare-v2/tests/enterprise_portal.test.mjs`

**Interfaces:**
- Consumes safe entitlements returned by access-code redemption or future central-auth bootstrap.
- Produces navigation that hides/disables customer features not granted by the workspace while server-side authorization remains authoritative.

- [ ] **Step 1: Add failing tests** for Telegram, trading-execution destination, custom-subdomain and custom-hostname capability visibility.
- [ ] **Step 2: Run and verify RED.**
- [ ] **Step 3: Implement minimal entitlement-aware navigation.**
- [ ] **Step 4: Run and verify GREEN.**
- [ ] **Step 5: Commit.**

### Task 5: Full verification, docs and safe deployment

**Files:**
- Modify: `AGENTS.md`
- Modify: `docs/trading-launch-console-manual-e2e.md`

- [ ] **Step 1: Update handoff/E2E docs** to describe the single customer entry at `trade.mkety.com`, shared session, local access-code auth now, future Mkety auth later, and isolated staff admin.
- [ ] **Step 2: Run full Node/MT5/MTProto test suite and CodeQL/CI.**
- [ ] **Step 3: Open PR and merge only after green CI.**
- [ ] **Step 4: Deploy production with `BROKER_EXECUTION_ENABLED=false`.**
- [ ] **Step 5: Verify live root portal, access-code redemption, session transition, entitlement-aware console navigation, reload persistence, logout/session clear, and health endpoint.**
