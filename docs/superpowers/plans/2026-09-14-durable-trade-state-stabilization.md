# Durable Trade State Stabilization Plan

**Goal:** Make position lifecycle/correlation durable across Durable Object restart by materializing position groups/legs in Supabase, restoring active state from Supabase, and preserving broker IDs and Telegram reply/follow-up correlation. Keep LIVE disabled throughout DEMO acceptance.

## Root cause evidence

- `TradeStateStore` currently persists only to Durable Object storage.
- `TradeStateNode` constructs that store without a database persistence adapter.
- Production `public.position_groups` and `public.position_legs` are both empty despite successful documented DEMO fills.
- Current in-memory group IDs are composite text (`event/account`) while the relational table primary key is UUID, so durable materialization needs a stable text state key rather than forcing the DO key into the UUID PK.

## Phase 1 — durable schema + adapter

1. Add a migration giving `position_groups` a unique `state_key` and `position_legs` a per-group `leg_key`.
2. Add tests that require group/leg serialization, upsert, broker ID preservation, and active-state hydration.
3. Implement `SupabaseTradeStatePersistence` using service-role-only PostgREST access.
4. Extend `TradeStateStore` with optional write-through persistence and one-time hydration/recovery.
5. Wire `TradeStateNode` to Supabase using the existing service credentials; fail closed for persistence errors in execution-affecting state mutations.

## Phase 2 — reply/lifecycle continuity

1. Add tests showing explicit Telegram reply IDs still resolve after a fresh DO instance hydrates from Supabase.
2. Verify source event IDs, thread ID, account ID, group status, leg status, broker position/order IDs, lots, SL and TP round-trip correctly.
3. Verify BE, SL edit, TP edit, partial/full close, cancel-pending lifecycle mutations remain correlated after recovery.

## Phase 3 — idempotency/reconnect

1. Verify duplicate source event IDs remain no-action after recovery.
2. Verify delivery idempotency remains authoritative and a reconnect/replay cannot execute the same broker action twice.
3. Keep broker result binding separate from broker retry so successful broker outcomes can repair state without re-executing.

## Phase 4 — DEMO acceptance

1. Deploy Worker and connector artifacts from reviewed code.
2. Verify `BROKER_EXECUTION_ENABLED=false` / persisted global live switch false.
3. Restart connector(s) and run fresh XAUUSD DEMO on MT5 and cTrader.
4. Validate DB group/leg rows and broker IDs after fills.
5. Exercise explicit Telegram reply management: BE, SL edit, TP edit, partial close, full close, pending cancel/modify as applicable.
6. Restart/reconnect and replay to prove no duplicate execution.
7. Run broker-capability compatibility checks (symbol aliases, volume constraints, filling mode, stops/freeze, pending order types) against configured DEMO accounts.

## LIVE boundary

No real-money order will be enabled or submitted by this stabilization work. After all DEMO gates pass, perform a separate LIVE-readiness review of account identity, environment, caps, kill switch, allowed symbols, and rollback; keep the global LIVE fuse off until separately authorized and reviewed.
