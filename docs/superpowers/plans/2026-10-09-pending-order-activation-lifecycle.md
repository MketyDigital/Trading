# Pending Order Activation Lifecycle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep cTrader and MT5 pending-order state synchronized after fills so later management targets the broker-confirmed open quantity and any still-pending remainder correctly.

**Architecture:** Add a read-only lifecycle snapshot contract for cTrader OAuth, cTrader cBot, and MT5 connector accounts. Broker events and a one-minute recovery sweep feed the same exact-identity-checked Durable Object transition; partial fills become deterministic filled-position and pending-remainder child legs. The runtime flag is opt-in and false when unset.

**Tech Stack:** Node.js 22, Cloudflare Worker and Durable Objects, Supabase Postgres migrations, Python 3.12 MT5 connector/bridge, C# cTrader Automate cBot, Node.js WebSocket gateways.

**Spec:** `docs/superpowers/specs/2026-10-08-pending-order-activation-lifecycle-design.md`

## Global Constraints

- A broker status observation is read-only; it never places, modifies, closes, or cancels an order.
- State updates require exact persisted workspace, trade-account row, group, logical leg, and broker-order identity.
- Repeated, delayed, out-of-order, or conflicting reports cannot duplicate a fill or regress a terminal state.
- Partial fills retain both filled-position quantity and any still-working pending quantity.
- Delete cancels only a pending remainder; Close closes filled positions and cancels any remainder; Close on a wholly unfilled order cancels it only.
- Existing behavior outside confirmed pending-order lifecycle children remains unchanged.
- The feature flag defaults off; DEMO is the only rollout target before acceptance; do not change LIVE controls or accounts.
- Reconciliation persistence failures never trigger a broker action retry.

## Review Focus

- **Duplicate cumulative fill snapshots:** applying the same snapshot after restart must not duplicate filled child legs or volume (Task 1 persistence tests).
- **Cross-account or stale order identity:** a valid broker response for a different account/order or an older observation must not mutate the target group (Task 1 and Task 3 tests).
- **Partial fill plus active remainder:** Delete cancels only the remainder; Close closes filled positions and cancels the remainder (Task 2 tests).
- **Broker offline or ambiguous history:** missing/ambiguous broker evidence leaves current state unchanged and schedules later reconciliation (Task 3 tests).
- **Feature disabled and unrelated executions:** unset/false flag does nothing, while market orders and ordinary open-leg management retain existing behavior (Task 4 regression tests).

---

### Task 1: Add idempotent pending-order snapshot state and persistence

**Files:**
- Create: `cloudflare-v2/db/migrations/0048_pending_order_lifecycle_state.sql`
- Modify: `cloudflare-v2/src/state/trade_state_store.js`
- Modify: `cloudflare-v2/src/state/trade_state_node.js`
- Modify: `cloudflare-v2/src/persistence/supabase_trade_state_persistence.js`
- Test: `cloudflare-v2/tests/trade_state_store.test.mjs`
- Test: `cloudflare-v2/tests/trade_state_node.test.mjs`
- Test: `cloudflare-v2/tests/supabase_trade_state_persistence.test.mjs`
- Test: new `cloudflare-v2/tests/pending_order_lifecycle_state.test.mjs`
- Test: new `cloudflare-v2/tests/pending_order_lifecycle_migration.test.mjs`

**Interfaces:**
- Add `TradeStateStore.reconcilePendingOrderSnapshot(groupId, logicalLegId, { tradeAccountId, brokerOrderId, snapshot, nowMs })`.
- `snapshot` is `{ status, remainingLots, fills, observedAt, sourceVersion }`, where `status` is `PENDING`, `PARTIALLY_FILLED`, `FILLED`, `CANCELLED`, or `UNRESOLVED`; each fill is `{ dealId, positionId, lots, fillPrice }`.
- Return `{ outcome, group }`, where `outcome` is one of `APPLIED`, `UNCHANGED`, `STALE`, `MISMATCH`, or `NOT_FOUND`.
- On the first actionable snapshot, convert the original leg into a non-actionable `PARENT` record with `status: 'SUPERSEDED'`; create deterministic `FILLED_POSITION` children keyed by parent leg + position ID and, while remaining volume is positive, exactly one `PENDING_REMAINDER` child keyed by parent leg. Later cumulative snapshots update those children rather than adding duplicates.
- Persist `parentLegId`, `lifecycleRole`, `originatingOrderId`, `lastBrokerObservedAt`, and `lastBrokerSourceVersion` with additive defaults for existing rows. Legacy rows without lifecycle metadata remain ordinary logical legs.

- [ ] **Step 1: Write failing tests** for exact account/order guard, full fill, partial fill with remainder, duplicate snapshot, older snapshot, terminal cancellation, and recovery after Supabase reload.
- [ ] **Step 2: Run only the new state tests** with `cd cloudflare-v2 && node --test tests/pending_order_lifecycle_state.test.mjs`; confirm failures identify the missing transition.
- [ ] **Step 3: Implement the transition, Durable Object route, migration, and persistence hydration** using the interface above. A snapshot must never mutate a group if its persisted account/order identity differs.
- [ ] **Step 4: Run state and persistence tests** with `cd cloudflare-v2 && node --test tests/pending_order_lifecycle_state.test.mjs tests/trade_state_store.test.mjs tests/trade_state_node.test.mjs tests/supabase_trade_state_persistence.test.mjs tests/pending_order_lifecycle_migration.test.mjs`.
- [ ] **Step 5: Commit** as `feat: persist pending order lifecycle snapshots`.

### Task 2: Make management actions operate on filled and remainder children

**Files:**
- Modify: `cloudflare-v2/src/execution/position_group.js`
- Modify if required by child binding: `cloudflare-v2/src/state/trade_state_store.js`
- Test: `cloudflare-v2/tests/pending_order_management_regressions.test.mjs`
- Test: `cloudflare-v2/tests/position_group.test.mjs`
- Test: `cloudflare-v2/tests/production_lifecycle_binding_hardening.test.mjs`

**Interfaces:**
- `buildManagementActions(group, management)` continues to return the existing action array, using child `legId`s for broker bindings.
- Filled children are `OPEN` legs with broker position identity; remainder children are `PENDING` legs with broker order identity.

- [ ] **Step 1: Add failing assertions** for Delete on a fully filled order (no close action), Delete on a partial fill (cancel remainder only), Close on a wholly pending order (cancel only), and Close on a partial fill (close every filled child and cancel remainder).
- [ ] **Step 2: Run the focused management test file** and confirm the new assertions fail for the current action builder.
- [ ] **Step 3: Update management selection** to target only confirmed child roles, preserving legacy behavior for pre-existing groups without lifecycle metadata.
- [ ] **Step 4: Run management tests** with `cd cloudflare-v2 && node --test tests/pending_order_management_regressions.test.mjs tests/position_group.test.mjs tests/production_lifecycle_binding_hardening.test.mjs`.
- [ ] **Step 5: Commit** as `fix: manage activated pending order quantities safely`.

### Task 3: Add account-scoped broker status readers

**Files:**
- Modify: `cloudflare-v2/src/adapters/ctrader_protocol.js`
- Modify: `cloudflare-v2/src/adapters/ctrader_executor_v2.js` or add focused `cloudflare-v2/src/adapters/ctrader_pending_order_status.js`
- Modify: `cloudflare-v2/src/adapters/ctrader_cbot_protocol.js`
- Modify: `cloudflare-v2/src/adapters/ctrader_cbot_executor_v2.js` or add focused cBot status adapter
- Modify: `cloudflare-v2/src/adapters/mt5_connector_protocol.js`
- Modify: `cloudflare-v2/bridges/mt5_bridge.py`
- Modify: `mt5-connector/mkety_mt5_connector.py`
- Modify: `ctrader-cbot-gateway/src/server.js` and `src/mt5_server.js`
- Modify: `ctrader-cbot/MketyCloudAutoTrader/MketyCloudAutoTrader.cs`
- Tests: existing cTrader/MT5 adapter, protocol, gateway, connector, and bridge suites; add focused lifecycle status tests beside each component.

**Interfaces:**
- Each status reader accepts authenticated `accountRowId` and one or more exact broker order IDs and returns a snapshot matching Task 1's schema plus broker account number, server/environment identity, and `isLive`.
- New gateway/connector status requests use a distinct read-only request type; they cannot be interpreted as `OPEN_POSITION`, `MODIFY_POSITION`, `CLOSE_POSITION`, `CLOSE_PARTIAL`, or `CANCEL_PENDING`.
- Persistent cBot and MT5 sessions may publish fill/cancel snapshots; the gateway derives `accountRowId` from its authenticated socket, never from message content.

- [ ] **Step 1: Write failing protocol/adapter tests** for exact order matching, all related fills, remaining quantity, account identity, offline responses, and unsupported/ambiguous history.
- [ ] **Step 2: Run the focused adapter and connector tests** and confirm they fail because the read-only lifecycle request does not exist.
- [ ] **Step 3: Implement read-only status lookup** for cTrader OAuth, cTrader cBot, and MT5 using broker-authenticated order/deal/position history. If fill-to-position mapping is ambiguous, return `UNRESOLVED`; do not guess.
- [ ] **Step 4: Run focused suites**: cTrader executor/runtime/cBot tests; MT5 bridge, connector and gateway tests; cBot compile/test contract.
- [ ] **Step 5: Commit** as `feat: observe broker pending order lifecycle`.

### Task 4: Wire gated events and recovery sweep into the Worker

**Files:**
- Create: `cloudflare-v2/src/execution/pending_order_lifecycle_runtime.js`
- Modify: `cloudflare-v2/src/v1_entry.js`
- Modify: `cloudflare-v2/src/state/production_trade_state_binder.js` or add `pending_order_lifecycle_binder.js`
- Modify: `cloudflare-v2/src/persistence/supabase_trade_state_persistence.js`
- Modify: `cloudflare-v2/wrangler.toml` only if an explicit false default is needed for clarity
- Tests: new `cloudflare-v2/tests/pending_order_lifecycle_runtime.test.mjs`, `cloudflare-v2/tests/v1_pending_order_lifecycle_internal.test.mjs`, and scheduled-entry regression tests.

**Interfaces:**
- `createPendingOrderLifecycleRuntime({ enabled, supabaseFactory, statusReaders, snapshotBinder, clock })` returns a scheduled function that queries only persisted pending-remainder children and submits read-only snapshots.
- `SupabaseTradeStatePersistence.listPendingOrderLifecycles()` returns `{ workspaceId, groupId, tradeAccountId, parentLegId, brokerOrderId }[]` for pending children only; the runtime selects DEMO accounts and requires broker-confirmed `isLive === false` before applying an observation.
- Internal event input carries broker snapshot only. The authenticated gateway supplies account-row identity; Worker verifies it against the persisted group and account before binding.
- `PENDING_ORDER_LIFECYCLE_SYNC_ENABLED` must be exactly true to run; unset, empty, or false skips without broker/gateway calls.

- [ ] **Step 1: Add failing tests** for flag-off no-op, flag-on pending-only scan, per-account grouping, exact identity forwarding, event and poll using the same state transition, partial failures isolated per account, and no execution dispatch.
- [ ] **Step 2: Run the focused Worker tests** and verify the expected missing-runtime failures.
- [ ] **Step 3: Implement the gated recovery sweep and authenticated event route**, keeping status observations separate from execution dispatch.
- [ ] **Step 4: Run focused Worker and internal-auth tests** with the new runtime file and `v1_entry` tests; verify LIVE, unknown, or identity-mismatched accounts never reach the state binder even when the feature flag is true.
- [ ] **Step 5: Commit** as `feat: reconcile pending order activation safely`.

### Task 5: Add simulation acceptance and run all regression gates

**Files:**
- Modify: `cloudflare-v2/src/testing/v1_simulation_command.js` and acceptance harness only as needed
- Modify: `AGENTS.md` with the final lifecycle invariant and verification status
- Tests: add one end-to-end simulation covering pending -> partial fill -> Delete, then pending -> partial fill -> Close; run all existing unaffected lifecycle suites.

**Interfaces:**
- The simulation models broker snapshots and produces only state changes plus the existing expected management actions; it never calls a broker.
- Real DEMO acceptance remains a separate gated activity and must re-query current account/runtime controls immediately before any broker test.

- [ ] **Step 1: Write a failing end-to-end simulation regression** for pending order full/partial activation, management, replay, and restart recovery.
- [ ] **Step 2: Run the focused simulation test** and confirm the lifecycle behavior is missing.
- [ ] **Step 3: Implement only the test/simulation support needed** without changing live execution routes.
- [ ] **Step 4: Run `cd cloudflare-v2 && npm run test:ci`, `PYTHONPATH=bridges python -m unittest bridges/test_mt5_bridge.py bridges/test_mt5_bridge_reconciliation.py -v`, `cd ../ctrader-cbot-gateway && npm test`, `cd ../mt5-connector && python -m unittest discover -v`, and the cBot build/contract checks. Record any unavailable environment-dependent check explicitly.
- [ ] **Step 5: Commit** as `test: cover pending order activation lifecycle`.

## Branch and release handling

- All work stays on `feat/pending-order-activation-lifecycle-sync`; do not merge to `main` or deploy production in this plan.
- Keep the feature flag absent/false in production configuration. Do not edit Cloudflare secrets, runtime controls, account rows, gateway production settings, or broker state.
- Open a draft PR only after static tests and code review are complete. DEMO acceptance and any later production release are separate gates.
