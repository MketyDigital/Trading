# Trading Stabilization Handoff — 2026-09-14

## Objective
Finish the trading system stabilization before any real-money enablement. The target is one source-agnostic, broker-adaptive pipeline that receives signals and follow-ups, correlates them correctly, routes them to every configured destination, executes or manages the broker position, and persists enough durable state to recover after reconnects/restarts.

## Safety rule
- Keep global live broker execution disabled during engineering and DEMO acceptance.
- Do not touch the cTrader LIVE account during stabilization.
- The same broker compatibility/execution code must work for DEMO and LIVE accounts; environment/safety gates decide whether LIVE execution is permitted. Do not create a second LIVE-only execution implementation.

## Current isolated MT5 fix — PR #80
Branch: `fix/mt5-comment-compat-20260914`

Problem proven in production DEMO:
- Telegram ingress, parsing and routing reached MT5.
- MT5 connector rejected order preflight with `last_error=-2 Invalid "comment" argument`.
- cTrader DEMO executed the same XAUUSD/V75 events successfully.

Current code change:
- Broker marker changed from a 31-char `mkety:` format to deterministic ASCII/alphanumeric <=20 chars: `mkety` + SHA prefix.
- This preserves deterministic command identity while avoiding restrictive MT5 comment validation.

Before merge:
- Required Trading V1 CI must be green.
- Make the comment compatibility regression part of the mandatory MT5 test gate.
- Preserve all existing bridge logic. Avoid unrelated changes.
- Restore any accidentally removed explanatory comments if touching that area again.

## Broker-adaptive execution requirements
The adapter must discover and obey broker capabilities instead of hardcoding broker names. This should cover Deriv, Octa, FBS, IUX, HFM, Exness, IC Markets, PU Prime and other MT5 brokers without separate implementations.

Checklist:
- [ ] Safe broker comment strategy, including fallback when a broker rejects comments.
- [ ] Symbol resolution/aliases/suffixes/prefixes (for example XAUUSD vs broker-specific variants).
- [ ] Broker min/max volume and `volume_step` normalization.
- [ ] Digits, tick-size and price normalization.
- [ ] Stops/freeze-level validation and normalization.
- [ ] Execution-mode compatibility (market/instant/exchange where exposed by MT5).
- [ ] Filling-mode capability handling with safe FOK/IOC/RETURN candidate fallback.
- [ ] Supported order type handling for market and pending orders.
- [ ] Broker preflight (`order_check`) handling that reports exact broker/API failure and retries only with a genuinely compatible request variant.
- [ ] Close, partial close, modify SL, modify TP, BE, pending cancel/replace where broker/account supports it.
- [ ] Idempotent retry/reconnect reconciliation using broker IDs and deterministic command identity.
- [ ] Tests for restrictive and permissive broker fixtures so capability adaptation is proven without vendor-specific hardcoding.

## Signal lifecycle / management requirements
Management messages must follow the same normalized pipeline regardless of source. Telegram is only one source; containers/webhooks/future sources must not require a different persistence/execution model.

Correlation priority already intended in code:
1. explicit reply/reply-to event
2. thread/relation
3. symbol/context match
4. most recent compatible active trade

Checklist:
- [ ] Receive and normalize entry signals.
- [ ] Receive replies/follow-ups/management messages.
- [ ] Correlate explicit Telegram replies to the original normalized trade/group.
- [ ] Support close/full close.
- [ ] Support partial close when requested/supported.
- [ ] Support SL update.
- [ ] Support move-to-BE.
- [ ] Support TP update/add/remove as supported by broker model.
- [ ] Support pending-order cancellation/management.
- [ ] Fan management operation to each configured destination independently.
- [ ] Preserve exactly-once/idempotent behavior across retries and reconnects.
- [ ] Record per-destination success/failure without one broker blocking another.

## Durable state defect already identified
Current production state binder posts execution updates into the Durable Object, but broker fills have been observed while Supabase `position_legs` remained empty. This is a real durability/recovery gap.

Required architecture:
- Durable Object = hot coordination/correlation state.
- Supabase = durable relational/audit/recovery state for position groups, legs, broker bindings/IDs/status/quantities and lifecycle changes.
- KV/cache may accelerate reads but must not become the only authoritative lifecycle store.
- Source type must not determine whether broker state is persisted.

Checklist:
- [ ] Materialize normalized position group durably.
- [ ] Materialize each destination leg durably.
- [ ] Persist broker order/deal/position IDs after execution binding.
- [ ] Persist requested/executed quantity and relevant fill/status data.
- [ ] Persist subsequent lifecycle/management transitions.
- [ ] Make writes idempotent/upsert-safe.
- [ ] Allow DO correlation state to be reconstructed/recovered from Supabase after restart/state loss.
- [ ] Add source-agnostic tests proving this path does not depend on Telegram-specific code.

## Known production DEMO evidence
### cTrader DEMO
Recent controlled source events executed successfully, including:
- XAUUSD BUY event `telegram:-1001822170589:25151` -> order `43933042`, position `136177927`, deal `40532264`, qty 0.01, fill 4315.13.
- V75(1s) BUY event `telegram:-1001822170589:25153` -> order `43933055`, position `136177957`, deal `40532276`; requested 0.01, broker normalized to minimum 0.05, fill 5893.69.

### MT5 DEMO
Same entry events reached MT5 but failed at broker preflight only because of the invalid comment format. This proves ingress/routing/connector delivery was functioning far enough to invoke MT5 `order_check`.

### Bare management messages
Bare `close` messages were parsed as MANAGEMENT but did not create destination deliveries. Do not use bare uncorrelated messages as acceptance proof. For acceptance, send a Telegram REPLY to a known controlled entry so the reply relation is explicit.

## Accounts / safety references
- MT5 DEMO trade account ID: `87eb40ab-5cce-48c5-b764-149fd6b31ca5`, account `213921698`.
- cTrader DEMO trade account ID: `40eacf2a-5a8a-4648-9b90-55038748d2ed`, broker account `48685071`.
- cTrader LIVE trade account ID: `4dbe17df-40b0-412a-88de-9bbc562969c7`, broker account `48681337`. Keep execution disabled; do not use for stabilization tests.
- Global `live_broker_execution_enabled` was last confirmed `false`; keep it false through DEMO acceptance.

## Final DEMO acceptance gate before considering LIVE
All of the following must be proven with fresh evidence:
- [ ] CI green for all required workflows.
- [ ] New MT5 connector build deployed/released and restarted with the broker-compatible bridge.
- [ ] Telegram controlled XAUUSD entry reaches both cTrader DEMO and MT5 DEMO exactly once.
- [ ] Telegram controlled synthetic/V75 entry reaches every configured compatible destination correctly; unsupported destinations fail explicitly, not silently.
- [ ] Both brokers return real broker IDs for successful executions.
- [ ] Supabase contains matching durable position group/legs and broker bindings for those fills.
- [ ] Explicit Telegram REPLY management command (for example move SL to BE or close) correlates to the correct original trade.
- [ ] That management action is dispatched to both DEMO destinations independently and the DB lifecycle state updates.
- [ ] Reconnect/retry does not duplicate entry or management execution.
- [ ] Reusable MT5 pairing/reconnect behavior remains functional.
- [ ] No LIVE destination receives an execution.

## Next-session execution order
1. Finish PR #80 cleanly: exact CI blocker -> mandatory regression coverage -> green checks -> merge.
2. Verify production deploy + fresh MT5 connector release from merged main.
3. Restart connector with the new release and rerun controlled DEMO entry acceptance.
4. On a fresh stabilization branch, implement source-agnostic DO -> Supabase group/leg/broker-binding materialization under tests.
5. Add durable correlation recovery from Supabase and management lifecycle persistence.
6. Run explicit Telegram REPLY management acceptance on XAUUSD (BE/SL update then close) across both DEMO brokers.
7. Run idempotency/reconnect acceptance.
8. Only after every DEMO gate above is green, perform a separate LIVE-readiness review. Do not enable LIVE automatically.

## Completion rule
Do not mark an item complete because code looks correct. Mark it complete only after relevant automated tests pass and, for execution/lifecycle items, production DEMO evidence confirms the expected broker and database state.
