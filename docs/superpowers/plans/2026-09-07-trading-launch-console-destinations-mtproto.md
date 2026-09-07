# Trading Launch Console Destinations MTProto Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Mkety-admin access-code manager, enterprise launch console, V1 destinations, Telegram formatting/branding, AI controls, source-to-destination routing, and MTProto setup flows needed for end-to-end launch testing.

**Architecture:** Add missing workspace-scoped database tables for destinations/templates/routes, then expose V1 admin handlers that reuse existing workspace authorization. Extend the dashboard with launch-console tabs. External VM MTProto is handoff-only; Cloudflare Container/DO MTProto stores encrypted Telegram credentials. Broker execution stays disabled.

**Tech Stack:** Cloudflare Worker, JavaScript modules, Supabase/Postgres migrations, node:test, Wrangler deploy workflow.

**Spec:** `docs/superpowers/specs/2026-09-07-trading-launch-console-destinations-mtproto-design.md`

## Global Constraints

- Work only inside `MketyDigital/Trading`.
- Do not touch MkSaaS.
- Keep `BROKER_EXECUTION_ENABLED=false` through this plan.
- Never commit credentials or sessions.
- Never return stored secret values from API responses.
- AI formatting may not alter canonical trading semantics.
- Server-owned workspace/source/account/destination records are authority; caller hints are never authority.
- External VM MTProto must not collect Telegram `apiId`, `apiHash` or `session`.

---

## File Structure

- Modify: `AGENTS.md` — source-of-truth and progress log.
- Create: `cloudflare-v2/db/migrations/0015_trading_destinations_templates_routes.sql` — destination/template/route tables.
- Create: `cloudflare-v2/src/destinations/formatting.js` — deterministic Telegram formatting and semantic drift guards.
- Create: `cloudflare-v2/src/destinations/telegram_destination.js` — Telegram send adapter with safe timeout and sanitized responses.
- Create: `cloudflare-v2/src/http/v1_admin_destinations.js` — destination/template/route V1 admin API.
- Create: `cloudflare-v2/src/http/v1_admin_access_codes.js` — Mkety-admin access-code API.
- Create: `cloudflare-v2/src/http/v1_admin_mtproto.js` — MTProto setup/readiness helper API.
- Modify: `cloudflare-v2/src/http/v1_admin.js` — route new admin endpoints.
- Modify: `cloudflare-v2/src/dashboard.js` — add launch console tabs.
- Create/modify tests under `cloudflare-v2/tests/`.
- Create: `cloudflare-v2/docs/LAUNCH_CONSOLE_TESTING.md` — manual testing guide.

---

### Task 1: Destination and template database migration

**Files:**
- Create: `cloudflare-v2/db/migrations/0015_trading_destinations_templates_routes.sql`

**Interfaces:**
- Produces tables: `trading_destinations`, `trading_destination_templates`, `source_destination_routes`.

- [ ] Write migration with workspace-scoped FKs, RLS enabled, anon/authenticated revoked, service_role granted.
- [ ] Include unique constraints for route idempotency and source/destination workspace isolation.
- [ ] Add indexes by workspace/status/source/destination.

### Task 2: Failing tests for formatting and destination contracts

**Files:**
- Create: `cloudflare-v2/tests/destination_formatting.test.mjs`
- Create: `cloudflare-v2/tests/v1_admin_destinations.test.mjs`

**Interfaces:**
- Expects `formatTelegramDestinationMessage(input, template)`.
- Expects `handleAuthorizedV1AdminDestinationsRequest(request, authorization, deps)`.

- [ ] Test `none` formatting preserves source text.
- [ ] Test `clean` removes configured footers/links without changing trade values.
- [ ] Test `template` renders canonical intent values exactly.
- [ ] Test semantic guard rejects changed symbol/side/entry/SL/TP.
- [ ] Test destination API never returns secret ciphertext.
- [ ] Test source-to-destination routes are workspace-scoped.

### Task 3: Implement deterministic formatting and Telegram adapter

**Files:**
- Create: `cloudflare-v2/src/destinations/formatting.js`
- Create: `cloudflare-v2/src/destinations/telegram_destination.js`

**Interfaces:**
- `formatTelegramDestinationMessage({ mode, rawText, interpretation }, template)` returns `{ ok, text, parseMode, reason? }`.
- `assertSemanticsPreserved(beforeIntent, afterIntent)` returns `{ ok, reason? }`.
- `sendTelegramDestination({ botToken, chatId, text, parseMode, fetchFn, timeoutMs })` returns sanitized delivery result.

- [ ] Implement `none`, `clean`, `template`.
- [ ] Implement AI-safe acceptance helper for later `ai_then_fallback` integration.
- [ ] Telegram adapter returns only `ok`, `messageId`, `status`, `errorCode`.

### Task 4: V1 destination/template/route API

**Files:**
- Create: `cloudflare-v2/src/http/v1_admin_destinations.js`
- Modify: `cloudflare-v2/src/http/v1_admin.js`

**Interfaces:**
- `GET/POST /api/v1/admin/destinations`
- `PUT /api/v1/admin/destinations/{id}`
- `POST /api/v1/admin/destinations/{id}/enable|disable`
- `PUT /api/v1/admin/destinations/{id}/credentials`
- `GET/POST /api/v1/admin/templates`
- `PUT /api/v1/admin/templates/{id}`
- `GET/POST /api/v1/admin/routes`
- `POST /api/v1/admin/routes/{id}/enable|disable`

- [ ] Implement store with Supabase queries.
- [ ] Encrypt destination credentials with `TRADING_MASTER_KEY`.
- [ ] Return `credentialConfigured` only.
- [ ] Route through existing `authorizeV1AdminRequest`.

### Task 5: Mkety-admin access-code manager

**Files:**
- Create: `cloudflare-v2/src/http/v1_admin_access_codes.js`
- Modify: `cloudflare-v2/src/http/v1_admin.js`

**Interfaces:**
- `GET /api/v1/admin/access-codes`
- `POST /api/v1/admin/access-codes`
- `POST /api/v1/admin/access-codes/{id}/revoke`

- [ ] Create code generator/hasher using existing access-code utilities.
- [ ] Return plaintext generated code only once on create.
- [ ] Store only hash.
- [ ] List never returns plaintext.
- [ ] Revoke updates status to `revoked`.

### Task 6: MTProto setup API

**Files:**
- Create: `cloudflare-v2/src/http/v1_admin_mtproto.js`
- Modify: `cloudflare-v2/src/http/v1_admin_sources.js` if needed
- Modify: `cloudflare-v2/src/http/v1_admin.js`

**Interfaces:**
- `GET /api/v1/admin/mtproto/providers`
- `GET /api/v1/admin/mtproto/sources/{sourceId}/handoff`
- `POST /api/v1/admin/mtproto/sources/{sourceId}/restart` for Mkety-owned runtimes only.

- [ ] External VM handoff returns endpoint, source ID, required headers/payload sample and no Telegram credential prompts.
- [ ] Container/DO providers show credential requirements and runtime status.
- [ ] Restart rejects external VM mode.

### Task 7: Dashboard launch console

**Files:**
- Modify: `cloudflare-v2/src/dashboard.js`
- Modify tests: `cloudflare-v2/tests/v1_dashboard_contract.test.mjs`, `cloudflare-v2/tests/v1_dashboard_views.test.mjs`, `cloudflare-v2/tests/v1_dashboard_actions.test.mjs`

**Interfaces:**
- Adds tabs: Access Codes, Destinations, Formatting, MTProto, Trading Logic.

- [ ] Render Mkety-admin access-code screen with create/list/revoke.
- [ ] Render destinations/templates/routes UI.
- [ ] Render MTProto setup wizard with external VM handoff-only mode.
- [ ] Render trading/risk logic inventory.
- [ ] Keep Sources/Accounts existing flows working.

### Task 8: Docs and manual testing guide

**Files:**
- Create: `cloudflare-v2/docs/LAUNCH_CONSOLE_TESTING.md`
- Update: `AGENTS.md`

**Interfaces:**
- Produces a layman end-to-end testing path.

- [ ] Document access-code creation.
- [ ] Document external VM MTProto payload handoff.
- [ ] Document Container/DO setup requirements.
- [ ] Document Telegram destination formatting modes.
- [ ] Document risk/execution checks.

### Task 9: Verification and deployment

**Files:**
- PR branch only until green.

**Interfaces:**
- CI plus deploy workflow.

- [ ] Run targeted tests.
- [ ] Run full Trading V1 CI.
- [ ] Open PR to `main`.
- [ ] Merge only if green and approved.
- [ ] Apply migration to Supabase production.
- [ ] Deploy through production Cloudflare workflow with `BROKER_EXECUTION_ENABLED=false`.
- [ ] Probe `/api/v1/health` and report final test instructions.

## Plan self-review

- Spec coverage: covers access codes, destinations, formatting, AI guard, MTProto modes, domains, risk inventory and deployment.
- Placeholder scan: no TBD/TODO placeholders; task details are concrete.
- Type consistency: endpoint names and table names are stable across spec and plan.
