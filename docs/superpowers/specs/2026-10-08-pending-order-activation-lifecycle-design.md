# Pending Order Activation Lifecycle Sync

**Status:** Design for owner review
**Scope:** cTrader and MT5 pending-order activation, including partial fills
**Production posture:** No production, account, secret, or broker changes are part of this design review.

## 1. Goal and constraints

A pending order accepted by a broker is currently persisted as `PENDING`. The system does not continuously observe that order after the initial execution response. If it later fills, durable trade state may continue to treat it as pending, so later management can omit the filled position or attempt to cancel an order that no longer exists.

The feature must make broker-confirmed fills visible to the existing trade-management pipeline while preserving these invariants:

- A broker status observation is read-only. It must never place, modify, close, or cancel a broker order.
- A state update requires an exact persisted workspace, trade-account row, group, logical leg, and broker-order match. Symbol or side similarity is never enough.
- Repeated, delayed, out-of-order, or conflicting reports cannot duplicate a fill or regress a terminal state.
- Partial fills represent both the filled position quantity and any still-working pending quantity. Close must handle both; Delete must cancel only the still-working pending quantity.
- No unrelated market-order, open-position, risk, routing, destination, Close, or Delete behavior changes.
- The feature defaults off when its runtime flag is missing or false. It is exercised on DEMO first. LIVE execution controls and accounts are never enabled by this feature.

## 2. Existing behavior and gap

- `ctrader_executor_v2.js` and the MT5 connector executor persist the initial accepted pending order ID and `PENDING` status.
- The MT5 bridge has broker reconciliation helpers, but the current reconciliation path is used for uncertain `OPEN_POSITION` outcomes rather than continuous activation tracking.
- The cTrader cBot and MT5 connector have authenticated, account-bound gateway sessions. The gateway can route account-scoped requests, but currently exposes no pending-order lifecycle snapshot.
- `TradeStateStore` persists one state record per logical leg and has no activation-specific transition guarded by expected account and order identity.
- Management builders include only `OPEN` legs for position changes. `CANCEL_PENDING` currently selects legs with a broker order ID, and `CLOSE` already handles separate open and pending legs in a group. Partial fill of one logical leg needs explicit modeling so both sides remain manageable.
- The Worker already has a one-minute scheduled path, an internal authenticated routing boundary, and durable state in Durable Objects plus Supabase.

## 3. Approaches considered

1. **Periodic reconciliation only:** simple recovery after disconnects, but fill state can lag until the next sweep.
2. **Broker event push only:** quick updates, but a missed event during a disconnect can leave stale state indefinitely.
3. **Hybrid (selected):** publish broker lifecycle events when observed and run a read-only periodic recovery sweep against the exact still-pending broker order IDs. Both use the same validation and idempotent state transition.

## 4. Proposed architecture

### 4.1 Broker observation

Each authenticated connector reports a lifecycle snapshot scoped to its authenticated account row:

- cTrader cBot accounts: observe the pending-order fill/cancel lifecycle through the connected cBot and return exact order and position/deal identities. cTrader OAuth accounts: use a short-lived authenticated cTrader API session during the recovery sweep to query the exact order and related executions.
- MT5: observe broker order, position, and deal state through the connected MT5 terminal, using the exact order ticket and its related deal/position history.
- Persistent cTrader cBot and MT5 sessions may push a broker observation as soon as they see a fill or cancellation. The gateway forwards it over a narrowly scoped internal Worker route. These pushes improve freshness but are not the source of truth; the scheduled sweep queries broker state again and recovers missed pushes.
- The gateway derives account-row identity from its verified session; a connector-provided account ID cannot override it.
- A recovery query is read-only and requests one exact broker order ID at a time (or a bounded batch for the same account). Offline, timed-out, unsupported, and ambiguous results leave state unchanged.

A snapshot contains the authenticated account row ID and broker identity, exact order ID, broker order state, monotonic observation time/version, remaining order volume, and every unambiguously related fill position/deal with volume and fill price. A snapshot that cannot establish the relationship between the requested order and its fills is not actionable.

### 4.2 Worker reconciliation

The scheduled runtime, behind `PENDING_ORDER_LIFECYCLE_SYNC_ENABLED` (default false), loads only persisted pending-order legs and groups queries by their persisted `tradeAccountId`. It asks the authenticated broker adapter/gateway for read-only status, verifies returned account identity and environment, and submits only broker observations to Trade State. This covers cTrader OAuth, cTrader cBot, and MT5 connector accounts.

Broker events and scheduled recovery use the same internal state transition. The transition checks workspace, account row, group, logical parent leg, and the currently stored broker order ID before applying any snapshot. Durable Object serialization protects races with source-management events. The reconciler never dispatches a normal execution action.

### 4.3 Durable state model

Keep the signal's logical leg identity stable and represent broker-side outcomes as child execution legs linked to that logical leg. Each child records its role (`FILLED_POSITION` or `PENDING_REMAINDER`), source logical leg, originating order ID, and exact broker position/deal IDs. IDs must be deterministic for a broker execution identity so replay is idempotent.

- A fully filled order becomes one or more `OPEN` execution legs and has no active pending-remainder child.
- A partial fill produces `OPEN` execution leg(s) and one `PENDING` remainder child for the exact unfilled amount.
- A still-working unfilled order remains `PENDING`.
- A broker-confirmed cancellation removes or terminalizes only the pending-remainder child; any filled execution legs remain `OPEN`.
- Unknown, ambiguous, or older snapshots do not change state. Conflicts are logged for investigation without broker actions.

Persist child-leg relationships and observation/version data in a migration that is additive and has safe defaults for existing records. Existing records hydrate as they do today; there is no bulk rewrite or reinterpretation of production state.

### 4.4 Management semantics

- Position protection changes and partial closes target only confirmed filled execution legs.
- `CANCEL_PENDING` / Delete targets only confirmed active pending-remainder children. It does not close filled execution legs.
- `CLOSE` / `CLOSE_ALL` emits close actions for every confirmed filled execution leg and cancel actions for any active pending remainder. Each action is bound back to its child so partial success is persisted accurately and never causes a blind broker retry.
- If the order is still entirely unfilled, Close emits only a pending-order cancellation. Once fully filled, Delete has no pending remainder to cancel and does not close the resulting position.
- Existing behavior for groups without activation snapshots remains unchanged.
- If broker/account mode cannot map a fill to a distinct manageable position without affecting unrelated exposure, the snapshot is rejected and the leg remains flagged for review; no guessed management action is emitted.

### 4.5 Security and rollout

- Add no new secret unless code review proves an existing internal credential cannot authenticate the new internal route. Never reuse a customer-provided token.
- Internal event/reconciliation routes require service authentication, enforce request size limits, and derive account authority from authenticated gateway context plus persisted account rows.
- The feature flag is opt-in and defaults off. DEMO is the only permitted rollout target until static CI and applicable DEMO acceptance pass. No production flag flip, LIVE test, deployment, account edit, or live broker action is included in implementation review.
- Production deploy remains a separate, explicitly reviewed step after the feature is complete and DEMO acceptance is recorded.

## 5. Error and recovery behavior

- Gateway offline, connector offline, timeout, broker history unavailable, or incomplete identity: preserve existing state and retry on a later sweep.
- Exact order not found in active orders or broker history: do not infer fill or cancellation from absence alone.
- Duplicate report: return an idempotent unchanged result.
- Wrong workspace/account/group/leg/order: reject without mutation and record a sanitized mismatch reason.
- Stale report: ignore using broker observation/version ordering.
- State persistence failure after a broker observation: retry state persistence only; never resend or synthesize a broker action.

## 6. Tests and acceptance gates

### Static regression tests

- Exact account/order match promotes only the intended pending leg.
- Wrong account, wrong order, wrong group, missing identity, ambiguous position mapping, stale event, and terminal-state replay do not mutate state.
- Duplicate full-fill and partial-fill snapshots are idempotent across DO restart and Supabase hydration.
- Partial fill creates filled and remainder children with exact volumes; a later full fill or cancellation reconciles only the remainder.
- Delete cancels only pending-remainder children; it never closes filled children.
- Close closes every filled child and cancels every pending remainder; an error on one child does not repeat successful broker actions.
- Market orders, already-open trades, existing pending cancel behavior, unrelated siblings, source routing, and delivery isolation remain unchanged.
- Reconciliation sends no execution command and does nothing with the feature flag disabled.
- Gateway, connector, Worker, persistence migration, cBot build, MT5 bridge and full CI tests pass.

### DEMO acceptance before any production enablement

Using a currently re-verified DEMO account only: create a pending order, verify it remains pending before activation, observe full activation, then verify follow-up SL/TP and Close management targets the confirmed position. Separately verify a partial fill with a working remainder: Delete cancels the remainder and leaves the filled position open; Close closes the filled position and cancels the remainder. Verify reconnect/recovery and confirm no duplicate broker actions. Re-query runtime controls and account rows immediately before any real DEMO broker test; do not change any LIVE control or account setting.

## 7. Non-goals

- Change signal interpretation or the meaning of Delete, Close, or any other management phrase.
- Change order placement, sizing, risk policy, route selection, or source correlation.
- Automatically close a filled trade because its original pending order was deleted or canceled.
- Reconcile historical groups in bulk or repair existing production rows without broker evidence.
- Deploy, enable the feature in production, or run LIVE broker tests as part of this change.

## 8. Review questions

1. Confirm that Delete after a partial fill cancels only the still-pending remainder and leaves the filled position open.
2. Confirm that Close after a partial fill closes the filled position and cancels the still-pending remainder.
3. Confirm that ambiguous broker-to-position mapping should fail closed and surface for review rather than guess.
