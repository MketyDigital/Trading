# Trading System Stabilization & Acceptance Checklist

**Status vocabulary:** `TODO` → `IN PROGRESS` → `CODED` → `TESTED` → `DEMO VERIFIED` → `LIVE-READY`.

A feature is never marked `DEMO VERIFIED` without real broker evidence and durable database evidence where applicable. `LIVE-READY` means the same production code path has passed DEMO acceptance and safety review; it does **not** enable live execution automatically.

## 1. Safety invariants

- [ ] `IN PROGRESS` Global live-money execution remains disabled throughout stabilization and DEMO acceptance.
- [ ] `TODO` LIVE trade accounts cannot execute unless both global and account-level live gates explicitly permit it.
- [ ] `TODO` DEMO and LIVE use the same broker/runtime logic; environment gates and credentials differ, not feature implementations.
- [ ] `TODO` No test, reconnect, replay, management command, or recovery path bypasses live safety gates.

## 2. Source ingress & normalization

- [ ] `TODO` Telegram MTProto signals normalize into the common event contract.
- [ ] `TODO` Telegram replies/follow-ups retain stable source event/reply/thread identity.
- [ ] `TODO` Webhook/container/future sources can enter the same normalized pipeline without source-specific broker persistence logic.
- [ ] `TODO` Duplicate source deliveries are idempotent.
- [ ] `TODO` Malformed/unsupported source events fail safely without blocking later valid events.

## 3. Routing & destination fanout

- [ ] `TODO` Active source→destination routes are resolved from authoritative configuration.
- [ ] `TODO` MT5 and cTrader destinations receive the same normalized intent independently.
- [ ] `TODO` Failure at one destination never suppresses another destination.
- [ ] `TODO` Per-destination delivery attempt/result/error remains auditable.
- [ ] `TODO` Disabled/deleted destinations stop receiving new commands.

## 4. Broker capability engine

The implementation must adapt to terminal/broker capabilities instead of maintaining broker-name forks for FBS, IUX, Exness, HFM, IC Markets, Octa, PU Prime, Deriv MT5, or other brokers.

- [ ] `IN PROGRESS` Broker-safe deterministic MT5 reconciliation/comment marker.
- [ ] `TODO` Symbol discovery and aliases/prefixes/suffixes.
- [ ] `TODO` Minimum/maximum volume and volume-step normalization.
- [ ] `TODO` Filling-mode negotiation/fallback.
- [ ] `TODO` Execution-mode handling.
- [ ] `TODO` Digits, point, tick-size and price normalization.
- [ ] `TODO` Stop-level and freeze-level validation.
- [ ] `TODO` Supported order-type detection.
- [ ] `TODO` Pending-order constraints and expiration/time-in-force handling.
- [ ] `TODO` Market/session/trade-mode checks with useful diagnostics.
- [ ] `TODO` Restrictive broker comment handling.
- [ ] `TODO` Broker/API rejection diagnostics expose actionable terminal errors without leaking credentials.
- [ ] `TODO` Capability fallbacks are conservative and cannot silently turn an invalid request into a different trade intent.

## 5. MT5 pairing, reconnect & revocation

- [x] `TESTED` Reusable connection token supports reconnect until expiry.
- [x] `TESTED` Reconnect token is instance-bound and inherits pairing expiry.
- [x] `TESTED` Token regeneration is available for an existing destination.
- [ ] `TODO` Destination removal durably revokes unexpired connector authorization, not only Worker dispatch.
- [ ] `TODO` Active connector session is closed/rejected after destination revocation where practical.
- [ ] `TODO` Reconnect after network/process interruption does not duplicate execution.

## 6. Durable trade-state materialization

Durable Object remains the hot coordination layer. Supabase is the durable relational/audit/recovery record.

- [ ] `IN PROGRESS` Common execution path idempotently materializes `position_groups`.
- [ ] `IN PROGRESS` Common execution path idempotently materializes `position_legs`.
- [ ] `TODO` Persist destination/account/broker binding for every leg.
- [ ] `TODO` Persist broker order, position and deal identifiers returned by the destination.
- [ ] `TODO` Persist requested and actually executed quantity.
- [ ] `TODO` Persist lifecycle/status changes after execution and management actions.
- [ ] `TODO` Durable materialization is source-agnostic and works for Telegram/webhook/container/future sources.
- [ ] `TODO` Retry/replay cannot create duplicate groups/legs.
- [ ] `TODO` DO restart/loss can recover active trade state from Supabase.

## 7. Management correlation

- [ ] `TODO` Explicit reply/source relation has highest priority.
- [ ] `TODO` Thread relation is second priority.
- [ ] `TODO` Symbol-scoped correlation is used only when unambiguous.
- [ ] `TODO` Recent-active-trade fallback is bounded and safe.
- [ ] `TODO` Supabase recovery/fallback is used when DO hot state is unavailable.
- [ ] `TODO` Ambiguous management events fail closed or enter review instead of modifying the wrong position.
- [ ] `TODO` Correlation remains destination-independent for multi-broker fanout.

## 8. Management operations

For each supported operation, verify command construction, broker response, DO update and durable DB lifecycle update.

- [ ] `TODO` Full close.
- [ ] `TODO` Partial close with broker volume constraints.
- [ ] `TODO` Add stop loss.
- [ ] `TODO` Move/edit stop loss.
- [ ] `TODO` Break-even / SL-at-entry.
- [ ] `TODO` Remove stop loss where supported.
- [ ] `TODO` Add take profit.
- [ ] `TODO` Move/edit take profit.
- [ ] `TODO` Remove take profit where supported.
- [ ] `TODO` Pending-order modification where supported.
- [ ] `TODO` Pending-order cancellation.
- [ ] `TODO` Already-closed/missing position returns terminal idempotent outcome where appropriate.
- [ ] `TODO` Unsupported broker operation fails clearly without corrupting state.

## 9. Idempotency, replay & reconnect

- [ ] `TODO` Duplicate normalized entry event executes at most once per destination.
- [ ] `TODO` Duplicate management event executes at most once per destination.
- [ ] `TODO` Worker retry after timeout reconciles existing broker order/position before resending.
- [ ] `TODO` MT5 connector restart preserves/reconciles command outcome.
- [ ] `TODO` cTrader reconnect preserves/reconciles command outcome.
- [ ] `TODO` Broker success followed by persistence/network failure does not create a duplicate trade on retry.

## 10. Observability & audit

- [ ] `TODO` Every source event can be traced to normalized intent and destination deliveries.
- [ ] `TODO` Every successful destination execution exposes broker identifiers in audit data.
- [ ] `TODO` Every terminal/retryable failure has stable error classification and sanitized diagnostics.
- [ ] `TODO` Health snapshots distinguish connector connectivity from stale persisted snapshots.
- [ ] `TODO` No credentials/tokens/secrets appear in logs, audit payloads or user-visible errors.

## 11. Real DEMO acceptance matrix

Required on controlled DEMO accounts before LIVE readiness:

- [ ] `TODO` XAUUSD market entry → cTrader exactly once.
- [ ] `TODO` XAUUSD market entry → MT5 exactly once.
- [ ] `TODO` Symbol with broker suffix/alias resolves correctly on MT5.
- [ ] `TODO` Minimum-lot normalization verified on a broker/instrument that requires it.
- [ ] `TODO` Telegram reply: add/move SL.
- [ ] `TODO` Telegram reply: break-even.
- [ ] `TODO` Telegram reply: add/move TP.
- [ ] `TODO` Telegram reply: partial close.
- [ ] `TODO` Telegram reply: full close.
- [ ] `TODO` Pending modify/cancel on a supported DEMO instrument.
- [ ] `TODO` Connector reconnect and repeat/replay produces no duplicate trade.
- [ ] `TODO` Every successful broker fill has matching durable group/leg/broker IDs in Supabase.
- [ ] `TODO` Broker terminal state and DB lifecycle agree after management actions.
- [ ] `TODO` One destination failure does not prevent another destination from succeeding.

## 12. LIVE readiness gate

- [ ] `TODO` Mandatory CI suites green on final main SHA.
- [ ] `TODO` Security/static checks green.
- [ ] `TODO` Production deployment health checks green.
- [ ] `TODO` Current connector/cBot releases correspond to final main SHA.
- [ ] `TODO` All critical DEMO acceptance rows above are `DEMO VERIFIED` with recorded evidence.
- [ ] `TODO` No unresolved P0/P1 execution, persistence, correlation or safety defects.
- [ ] `TODO` LIVE enabling remains a separate explicit operational decision; stabilization code must not enable it.

## 13. Evidence log

For each verified item record: date/time, commit/PR, workflow run, source event ID, destination delivery ID, broker order/position/deal IDs, durable group/leg IDs, management command/result, and any broker-specific capability observed.

| Area | Status | PR / Commit | CI / Deploy | DEMO evidence | Notes |
|---|---|---|---|---|---|
| MT5 reusable pairing/reconnect | TESTED | PR #78 | Green | Connector reconnected | Durable deletion/revocation remains open |
| MT5 restrictive comment compatibility | IN PROGRESS | PR #80 | CI blocker under diagnosis | DEMO rejection reproduced: invalid `comment` | Must re-test after release/restart |
| cTrader DEMO execution | DEMO VERIFIED (entry only) | Existing main | Existing green deployment | Real XAUUSD/V75 broker IDs recorded | Management + durable DB materialization still open |
| Durable position materialization | IN PROGRESS | — | — | Production gap reproduced: fill exists while DB legs absent | Must fix common path |
| Reply/follow-up management | IN PROGRESS | — | — | Bare management messages classified but not delivered | Acceptance must use explicit replies |
