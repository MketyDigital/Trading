# Source Feeds, Telegram Endpoints, and Multi-Instance MT5 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preserve all current Trading behavior while adding independently routable source feeds under shared Telegram connections, reusable Telegram destination bot credentials/endpoints, and deterministic multi-terminal MT5 connector instances.

**Architecture:** Keep `source_connections` as the credential/runtime boundary, add logical `source_feeds`, and extend persisted routes with optional feed scope plus fail-closed canonical-symbol filters. Keep existing destinations/routes valid while introducing reusable Telegram credentials/endpoints behind compatibility adapters. Run one MT5 connector process per exact terminal/account with independent config and replay ledger.

**Tech Stack:** Cloudflare Worker JavaScript, Supabase/PostgreSQL, Node test runner, Python MetaTrader5 connector, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-09-16-source-feeds-telegram-endpoints-mt5-multi-instance-design.md`

## Global Constraints

- LIVE execution remains disabled globally and per LIVE account.
- No destructive schema migration.
- Existing source connections, routes, destinations, reply/thread correlation, delivery idempotency, position lifecycle, broker normalization, and account policy remain functional.
- Telegram secrets remain encrypted and are never returned to public/admin read APIs.
- Existing connection-level routing remains fallback behavior until a feed has explicit active feed-specific routes.
- Broker route filters fail closed when malformed.

---

### Task 1: Add source-feed persistence and compatibility routing

**Files:**
- Create: `cloudflare-v2/db/migrations/00XX_source_feeds_and_route_scope.sql`
- Create: `cloudflare-v2/src/sources/source_feed_store.js`
- Modify: `cloudflare-v2/src/http/v1_admin_destinations.js`
- Modify: route resolution module used by `v1_destination_delivery_stage.js`
- Test: `cloudflare-v2/tests/source_feed_routing.test.mjs`

**Interfaces:**
- Produces `resolveSourceFeed({ workspaceId, sourceConnectionId, providerFeedId })`.
- Route rows may include nullable `source_feed_id`.
- Route resolver returns feed-specific active routes when any exist, otherwise existing connection-level routes.

- [ ] Write failing migration/store/routing tests for two Telegram feeds under one source, feed-specific override, legacy fallback, workspace isolation, and inactive feed behavior.
- [ ] Run focused tests and confirm RED.
- [ ] Add additive `source_feeds` schema and nullable route scope with indexes/FKs; do not alter existing rows.
- [ ] Implement source-feed store and feed-aware route selection.
- [ ] Run focused tests and confirm GREEN.
- [ ] Commit task.

### Task 2: Materialize Telegram allowed chats as independently routable feeds

**Files:**
- Modify: `cloudflare-v2/src/pipeline/ingest.js`
- Modify: `cloudflare-v2/src/sources/telegram_bot_policy.js`
- Modify: external MTProto authorization/store modules
- Modify: `cloudflare-v2/src/http/telegram_bot_admin.js` if materialization is connection lifecycle scoped
- Test: `cloudflare-v2/tests/telegram_source_feeds.test.mjs`

**Interfaces:**
- Incoming authenticated Telegram event provides provider feed ID equal to persisted Telegram chat/channel ID.
- Authorization remains connection-config based; feed lookup never grants authorization.

- [ ] Write failing tests proving authorized chat A/B resolve to distinct feeds and unauthorized chat remains rejected even if a feed record exists.
- [ ] Run focused tests and confirm RED.
- [ ] Resolve/materialize feeds without changing canonical event identity or reply/thread correlation.
- [ ] Preserve external MTProto transport opacity: Mkety only trusts the authenticated connection plus persisted allowed chat policy.
- [ ] Run focused tests and confirm GREEN.
- [ ] Commit task.

### Task 3: Add route-level canonical-symbol filtering

**Files:**
- Create: `cloudflare-v2/src/destinations/route_filters.js`
- Modify: `cloudflare-v2/src/destinations/v1_destination_delivery_stage.js`
- Test: `cloudflare-v2/tests/route_filters.test.mjs`

**Interfaces:**
- `evaluateRouteFilters(filters, interpretation, destination)` returns `{ allowed, reason }`.
- Supports `allowedCanonicalSymbols` and `blockedCanonicalSymbols` only in first version.

- [ ] Write failing tests for allow, block precedence, empty compatibility, and malformed broker-filter fail-closed behavior.
- [ ] Run tests RED.
- [ ] Implement deterministic canonical-symbol filter evaluator.
- [ ] Apply filter before broker delivery creation/execution, preserving existing idempotency semantics.
- [ ] Run tests GREEN.
- [ ] Commit task.

### Task 4: Reuse one Telegram destination bot credential across many endpoints

**Files:**
- Create: additive migration for reusable destination credential connection/reference if not already representable safely
- Modify: `cloudflare-v2/src/http/v1_admin_destinations.js`
- Modify: destination credential store/decryption module
- Modify: `cloudflare-v2/src/destinations/v1_destination_delivery_stage.js`
- Test: `cloudflare-v2/tests/telegram_destination_credentials_reuse.test.mjs`

**Interfaces:**
- Telegram endpoint/destination resolves `{ botToken, chatId }` from reusable credential reference plus endpoint config.
- Legacy destination-local credential ciphertext remains supported.

- [ ] Write failing tests: one encrypted bot credential -> two destination chat IDs; legacy destination continues to work; cross-workspace references rejected.
- [ ] Run RED.
- [ ] Add minimal additive credential-reference persistence and resolution.
- [ ] Ensure secret reads stay internal and public DTOs never expose bot tokens/ciphertext.
- [ ] Run GREEN.
- [ ] Commit task.

### Task 5: Upgrade source/destination/routing frontend UX without removing existing controls

**Files:**
- Modify: `cloudflare-v2/src/dashboard_telegram_bot_source.js`
- Modify: unified connections/dashboard routing modules
- Modify: destination frontend module(s)
- Test: existing frontend tests plus new `cloudflare-v2/tests/source_feed_routing_frontend.test.mjs`

**Interfaces:**
- Source connection card displays child feeds.
- Routing selector supports a feed or `All feeds (legacy/default)`.
- Telegram Bot API creation always visibly renders Bot Token and allowed chat IDs.
- Telegram destination bot credential can be selected once for multiple endpoints.

- [ ] Write DOM/string contract tests before edits.
- [ ] Confirm RED for missing feed/endpoints UX and token visibility regression path.
- [ ] Implement additive UI controls; preserve all current account/source/destination buttons and data attributes used by existing tests.
- [ ] Run frontend-focused suites GREEN.
- [ ] Commit task.

### Task 6: Add deterministic multi-terminal MT5 connector instance support

**Files:**
- Modify: `mt5-connector/mkety_mt5_connector.py`
- Modify: `mt5-connector/test_first_run.py`
- Modify: `mt5-connector/test_connector.py`
- Modify: `mt5-connector/README.md`
- Test: connector Python tests

**Interfaces:**
- CLI `--terminal PATH` -> `mt5.initialize(path=PATH)`.
- CLI `--ledger PATH` -> isolated `ReplayLedger`.
- Omitting either option preserves existing defaults.

- [ ] Write failing tests for terminal path forwarding, custom ledger path, old invocation compatibility, and independent configs/ledgers for two instances.
- [ ] Run RED.
- [ ] Add CLI arguments and initialization helper with explicit terminal path when supplied.
- [ ] Pass ledger path into `MketyMt5Connector` while retaining existing default ledger.
- [ ] Document three-terminal Windows VPS examples and state Windows is primary; Wine/Linux experimental.
- [ ] Run connector tests GREEN.
- [ ] Commit task.

### Task 7: Documentation, AGENTS/handoff continuity, migration verification, and full CI

**Files:**
- Modify: `AGENTS.md` (append current design/progress; preserve existing content)
- Modify: `CURRENT_HANDOFF.md` (append/update current implementation status without erasing historical evidence)
- Modify: `docs/MT5_CONNECTOR_ACCEPTANCE_RUNBOOK.md` with multi-terminal instance setup notes
- Modify: `docs/MKETY_TRADING_OPERATOR_CUSTOMER_MANUAL.md` with source feeds/routing/Telegram credential reuse

- [ ] Record approved design, branch, completed tasks, open verification, safety posture, and next actions in AGENTS/handoff.
- [ ] Run all repository CI on the feature branch.
- [ ] Fix only evidence-backed regressions; do not refactor unrelated working code.
- [ ] Verify migration applies cleanly against current Supabase schema before production application.
- [ ] Re-query global LIVE control, workspace live entitlement, and LIVE account flags immediately before any DEMO acceptance.
- [ ] Merge/deploy only after full CI and compatibility tests are green.
