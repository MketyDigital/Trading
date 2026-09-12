# Routing, AI Provider, Presentation Prompt, and Hostname Audit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete and verify user-facing routing lifecycle, secure AI provider CRUD, presentation-only AI rebranding instructions, and multi-host connection behavior without changing TradingView or enabling live broker execution.

**Architecture:** Keep canonical trading authority and execution logic unchanged. Add route/destination deletion to the existing workspace-scoped admin API, store AI presentation instructions inside the existing template `layout` JSON, pass those instructions only into Telegram presentation AI, and repair the legacy AI provider database constraint with an additive migration. Preserve the existing cTrader canonical OAuth relay; audit every other connection path and add regression coverage showing non-OAuth connectors remain same-origin/token based.

**Tech Stack:** Cloudflare Workers JavaScript, Node test runner, Supabase/PostgreSQL migrations, browser-generated enterprise portal JavaScript, GitHub Actions.

**Spec:** User-approved requirements in PR #47 and the existing trading connection/destination design documents.

## Global Constraints

- TradingView is out of scope and must remain untouched.
- Canonical symbol, side, entry/order type, stop loss, take profits, risk, routing authority, and broker execution must never be altered by presentation AI.
- Workspace authorization remains mandatory for route/destination mutation.
- Live broker execution remains OFF throughout this change and acceptance pass.
- Existing signed webhook behavior and all previously working connection behavior must remain backward compatible.
- Custom-host fixes must not weaken OAuth state/relay integrity or expose secrets.

---

### Task 1: Secure AI provider schema compatibility

**Files:**
- Create: `cloudflare-v2/db/migrations/0030_ai_provider_secure_key_compat.sql`
- Test: `cloudflare-v2/tests/routing_ai_product_gaps.test.mjs`

**Interfaces:**
- Consumes encrypted `api_key_ciphertext` written by `v1_admin_ai.js`.
- Produces a nullable legacy `api_key` column so secure inserts do not require plaintext credentials.

- [ ] Add the failing migration contract test.
- [ ] Confirm production currently has `ai_providers.api_key NOT NULL` while `api_key_ciphertext` is nullable.
- [ ] Add `ALTER TABLE public.ai_providers ALTER COLUMN api_key DROP NOT NULL;` without copying ciphertext into plaintext.
- [ ] Run the AI admin and migration contract tests.

### Task 2: Route and destination lifecycle

**Files:**
- Modify: `cloudflare-v2/src/http/v1_admin_destinations.js`
- Modify: `cloudflare-v2/src/dashboard_enterprise_enhancements.js`
- Test: `cloudflare-v2/tests/routing_ai_product_gaps.test.mjs`
- Test: `cloudflare-v2/tests/v1_admin_destinations.test.mjs`

**Interfaces:**
- Produces `DELETE /api/v1/admin/routes/:id` and `DELETE /api/v1/admin/destinations/:id`.
- Database destination deletion relies on the existing FK cascade from `source_destination_routes.destination_id`.

- [ ] Add failing owner delete tests.
- [ ] Add workspace-scoped store delete methods and 404 behavior for absent rows.
- [ ] Add explicit Remove controls with confirmation in the enterprise portal.
- [ ] Render route source/destination display names instead of raw UUIDs, retaining IDs only as secondary diagnostics when needed.
- [ ] Verify deleting a destination removes dependent current routes while deleting a route leaves source/destination intact.

### Task 3: User AI rebranding/formatting instructions

**Files:**
- Modify: `cloudflare-v2/src/dashboard_enterprise_enhancements.js`
- Modify: `cloudflare-v2/src/destinations/v1_destination_delivery_stage.js`
- Modify: `cloudflare-v2/src/destinations/telegram_ai_formatter.js`
- Test: `cloudflare-v2/tests/routing_ai_product_gaps.test.mjs`
- Test: `cloudflare-v2/tests/telegram_destination_ai_mode_v1.test.mjs`

**Interfaces:**
- Stores user text as `template.layout.aiInstructions`.
- `templatePresentation()` exposes it as `presentation.aiInstructions`.
- Telegram formatter sends it as `presentationInstructions` while retaining the immutable canonical-value system prompt.

- [ ] Add failing formatter and UI contract tests.
- [ ] Add an `AI rebranding/formatting instructions` textarea to formatting template creation/edit presentation.
- [ ] Persist the field through existing `layout` JSON; no new schema column.
- [ ] Feed the instruction to presentation AI only.
- [ ] Verify semantic validation/fallback still rejects canonical drift.

### Task 4: Multi-host connection audit

**Files:**
- Verify: `cloudflare-v2/src/http/ctrader_oauth_relay.js`
- Verify: `cloudflare-v2/src/http/v1_admin_connections.js`
- Verify connection UI and tests.
- Add/extend regression tests only where coverage is missing.

**Interfaces:**
- cTrader Direct OAuth uses the signed relay to preserve initiating HTTPS origin while cTrader callback remains canonical.
- cTrader cBot, MT5 connector, Telegram source setup, external MTProto endpoint generation, and ordinary admin API calls remain same-origin or pairing-token/WSS based and do not require OAuth return-host restoration.

- [ ] Search every callback/redirect/authorize/return-origin path in the repository.
- [ ] Verify only cTrader Direct leaves the browser for a third-party OAuth provider.
- [ ] Verify external MTProto endpoint generation uses the current request/custom host where appropriate.
- [ ] Verify cBot/MT5 pairing URLs and WebSocket endpoints remain environment-configured and do not redirect the user to the canonical web portal.
- [ ] Add regression coverage for any uncovered host-sensitive path; otherwise document why no code change is required.

### Task 5: Full regression, merge, deployment, and production verification

**Files:**
- No TradingView files may change.
- Update docs/tests only if verification identifies a concrete gap.

**Interfaces:**
- Produces a clean PR with no temporary patch workflow.

- [ ] Run the complete Trading V1 test suite and cTrader CI.
- [ ] Review PR diff for unrelated changes and confirm no TradingView modifications.
- [ ] Remove temporary patch workflow if one is used.
- [ ] Re-run CI on the clean head and mark the PR ready.
- [ ] Merge to `main` only after green CI.
- [ ] Verify post-merge Worker deploy, health, production migration, route controls, provider create contract, and custom-host behavior.
- [ ] Verify persisted runtime controls still show Trading ON, Broker ON, Live OFF.
- [ ] Stop before live broker execution; proceed next to real demo connector/broker acceptance.
