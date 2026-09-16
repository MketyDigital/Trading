# Multi-select Routes and Forward-as-is Restoration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make existing and new routes editable through one simple source → selected feeds → destination model, restore prominent Forward as-is delivery, and preserve all existing trading/management/platform behavior.

**Architecture:** Keep the current `source_destination_routes` schema. Treat compatible route rows for one source+destination as a logical route group in the admin/UI layer, reconcile underlying feed rows on save, and enforce strict selective authority in both destination delivery and broker planning so unselected feeds cannot inherit a default route for that same destination. Formatting remains the existing four-mode engine; the UI exposes plain-language choices and treats `none` as Forward as-is (original).

**Tech Stack:** Cloudflare Worker JavaScript, Supabase/PostgreSQL, Node test runner, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-09-16-multiselect-routes-forward-as-is-design.md`

## Global Constraints

- Preserve stable source, destination, broker-account, credential, template, and unrelated route IDs wherever possible.
- Existing routes and new routes use the same editor.
- Selective mode is strict for a source+destination logical group: selected feeds only; unselected feeds skip that destination.
- Explicit `All channels from this source` preserves connection-wide behavior.
- Blank Allowed Symbols + blank Blocked Symbols means no route-level symbol narrowing; destination catalog/risk/runtime gates remain authoritative.
- Route filters may only narrow capabilities and never make unsupported instruments tradable.
- `Forward as-is (original)` maps to `formatting_mode='none'` and must add/remove/change nothing in source text.
- `clean`, `template`, and `ai_then_fallback` remain available with existing semantics.
- Preserve management, reply/threading, follow-up, fast-signal, replay/idempotency, reconciliation, fanout, cTrader, MT5, multi-terminal MT5, capability-driven symbols/brokers/markets, and access lifecycle behavior.
- LIVE remains globally/workspace/account disabled throughout stabilization and DEMO acceptance.

---

### Task 1: Logical route grouping and strict selective authority

**Files:**
- Modify: `cloudflare-v2/src/destinations/v1_destination_delivery_stage.js`
- Modify: `cloudflare-v2/src/v1_simulation_deps.js`
- Create: `cloudflare-v2/src/routes/logical_route_scope.js`
- Test: `cloudflare-v2/tests/logical_route_scope.test.mjs`
- Test: `cloudflare-v2/tests/feed_scoped_broker_authority.test.mjs`

**Interfaces:**
- Produce `resolveLogicalRouteScope({ routes, sourceConnectionId, sourceFeedId, destinationId })` returning `{ mode: 'all'|'selective'|'none', routes: Route[] }`.
- Both destination delivery and broker planning consume the same helper so routing authority cannot diverge.

- [ ] Write failing tests proving: default route works in all-channels mode; selected feed works in selective mode; unselected feed is skipped; a default row cannot broaden a source+destination pair once selective rows exist; unrelated destinations remain independent.
- [ ] Run targeted tests and confirm RED.
- [ ] Implement `logical_route_scope.js` with workspace/source/destination-safe selection semantics and no broker/platform assumptions.
- [ ] Replace duplicated fallback logic in destination delivery and broker planner with the shared resolver.
- [ ] Run targeted tests and existing feed/broker routing tests to GREEN.
- [ ] Commit only this authority change.

### Task 2: Logical multi-feed route admin reconciliation

**Files:**
- Create: `cloudflare-v2/src/routes/logical_route_admin.js`
- Modify: `cloudflare-v2/src/http/v1_admin_destinations.js`
- Modify: `cloudflare-v2/src/http/v1_admin_edit_in_place.js`
- Test: `cloudflare-v2/tests/logical_route_admin.test.mjs`
- Test: `cloudflare-v2/tests/edit_in_place_admin_contracts.test.mjs`

**Interfaces:**
- Add list shape for logical routes containing `logicalRouteKey`, `sourceConnectionId`, `destinationId`, `mode`, `selectedFeedIds`, `routeName`, `priority`, `filters`, `enabled`.
- Add reconcile operation that updates underlying route rows idempotently without recreating source/destination/account/template objects.

- [ ] Write failing tests for grouping existing feed rows into one logical route and loading a legacy default row as `mode:'all'`.
- [ ] Write failing tests for converting legacy all-channels → selective feeds and selective → all-channels while preserving source/destination IDs.
- [ ] Write failing tests proving removing one selected feed removes/disables only that feed row and unrelated routes remain intact.
- [ ] Implement logical grouping and reconciliation with workspace-scoped validation and idempotency.
- [ ] Preserve current single-row route APIs for backward compatibility while adding logical-route endpoints/response fields for the new UI.
- [ ] Run admin/edit compatibility tests to GREEN.
- [ ] Commit this admin layer independently.

### Task 3: Simplified route editor for existing and new routes

**Files:**
- Modify: `cloudflare-v2/src/dashboard_granular_routing.js`
- Test: `cloudflare-v2/tests/source_feed_routing_frontend.test.mjs`
- Create: `cloudflare-v2/tests/logical_route_editor_frontend.test.mjs`

**Interfaces:**
- UI flow: existing logical route selector → source connection → explicit All channels toggle OR multi-select child feeds → destination → optional filters → priority/enabled → Save.

- [ ] Write failing frontend contract tests for multi-select feeds, explicit All channels, edit existing legacy route, selected-feed prefill, and blank-filter explanatory copy.
- [ ] Replace the one-feed dropdown UX with source selector + checkbox/multi-select feed list while keeping existing destination/bot/template panels intact.
- [ ] Existing routes load into the same form; no delete/recreate requirement.
- [ ] Show help text: `Leave both symbol filters blank to allow every symbol this destination account can actually trade.`
- [ ] Save through logical-route reconcile API; show clear selective/all-channels success text.
- [ ] Run frontend contract and production portal parse tests to GREEN.
- [ ] Commit only UI/editor changes.

### Task 4: Restore and explain all four formatting modes

**Files:**
- Modify: `cloudflare-v2/src/dashboard_granular_routing.js`
- Modify only if needed: `cloudflare-v2/src/destinations/formatting.js`
- Test: `cloudflare-v2/tests/user_controls_verbatim_threading_acceptance.test.mjs`
- Create: `cloudflare-v2/tests/destination_format_modes_frontend.test.mjs`

**Interfaces:**
- Present modes as:
  - `none` → `Forward as-is (original)`
  - `clean` → `Clean original`
  - `template` → `Structured template`
  - `ai_then_fallback` → `AI presentation + safe fallback`

- [ ] Write failing UI tests asserting all four visible names/descriptions.
- [ ] Add `Forward as-is (original)` as a first-class selectable option even when no saved custom template row exists.
- [ ] Ensure `none` delivery returns original `event.text` exactly and never invokes cleanup, deterministic reconstruction, branding, or AI.
- [ ] Preserve saved template IDs and editability for existing templates.
- [ ] Run verbatim/threading and formatting suites to GREEN.
- [ ] Commit formatting/UI restoration.

### Task 5: Non-regression matrix

**Files:**
- Test existing suites; add only narrowly-scoped regressions where coverage is missing.
- Likely tests: `cloudflare-v2/tests/*management*`, `*reply*`, `*followup*`, `*fast*`, `*ctrader*`, `*mt5*`, `*symbol*`, `*replay*`, `*destination*`.

- [ ] Run the full Worker/trading `npm run test:ci` suite on the feature branch.
- [ ] Confirm management actions remain green: SL update, BE, TP update, partial/full close, pending cancellation.
- [ ] Confirm replies/non-replies, Bot API/MTProto thread correlation, unresolved reply fail-closed, fast/follow-up behavior remain green.
- [ ] Confirm cTrader/MT5, multi-terminal MT5, capability-driven symbol resolution, all-broker/account-catalog logic, replay/idempotency, reconciliation and independent fanout remain green.
- [ ] Fix only proven regressions; add a regression before each fix.
- [ ] Commit any compatibility fixes separately.

### Task 6: Documentation and DEMO acceptance

**Files:**
- Modify: `AGENTS.md`
- Modify: `CURRENT_HANDOFF.md`
- Modify: `docs/MKETY_TRADING_OPERATOR_CUSTOMER_MANUAL.md`
- Modify: `docs/MT5_CONNECTOR_ACCEPTANCE_RUNBOOK.md`
- Modify relevant destination/routing acceptance docs.

- [ ] Document logical route semantics, edit-existing behavior, strict selective mode, explicit All channels, and blank symbol-filter semantics.
- [ ] Document all four formatting modes and exact Forward as-is contract.
- [ ] Preserve prior history; append/update current authority rather than deleting historical evidence.
- [ ] Document non-regression acceptance matrix and capability-driven broker/platform rule.
- [ ] Run final exact-head CI and PR diff review.
- [ ] Before any deployment, re-query production LIVE controls/workspace entitlements/LIVE accounts and prove all remain disabled.
- [ ] Merge only a green reviewed head, verify production deploy + Frontend E2E + Connection Readiness + Platform Configuration Verification, then re-check zero-LIVE state.

## Self-review

- Spec coverage: every approved requirement maps to Tasks 1–6.
- No schema migration is planned solely for multi-select UX; existing route rows are reconciled.
- No placeholders/TODOs are left in this plan.
- Shared authority helper prevents destination-vs-broker routing drift.
- Existing single-route APIs remain for backward compatibility while the new UI uses logical grouping.
