# Trading Stabilization & DEMO Acceptance Checklist

Last updated: 2026-09-14

This document is the release gate for broker execution. A checkbox may be marked complete only when the implementation is present, automated regression coverage passes, and the required production/DEMO evidence is recorded. Existing source normalization, routing, execution, risk, replay/idempotency, broker-management, and safety behavior must remain intact unless a documented defect requires a tested change.

## Safety invariants

- [x] Global LIVE broker execution remains disabled. Evidence before this stabilization branch: `live_broker_execution_enabled=false`.
- [x] cTrader LIVE destination remains execution-disabled and is excluded from DEMO acceptance.
- [ ] Re-verify safety controls immediately before every broker acceptance run.
- [ ] LIVE readiness requires a separate explicit gate after all DEMO items below are verified; this checklist never auto-enables LIVE execution.

## Broker execution compatibility

- [x] MT5 reusable pairing/reconnect token support merged in PR #78 (`8a582597b709366ca7ee8f71775149d0af1a5a97`).
- [x] MT5 broker rejection root cause isolated in real DEMO routing: `last_error=-2 Invalid "comment" argument`.
- [x] MT5 broker-safe deterministic reconciliation marker merged in PR #80 (`5dd2a36368b3a1698ead62e0a218ff75895c7a33`).
- [x] Trading V1 CI passed on PR #80 merge SHA: run `34842877583`.
- [x] Production Cloudflare deploy passed on PR #80 merge SHA: run `34842877575`.
- [x] MT5 Connector Release passed on PR #80 merge SHA: run `34842877579`.
- [x] Production Connection Readiness passed on PR #80 merge SHA: run `34842988853`.
- [x] Production Platform Configuration Verification passed on PR #80 merge SHA: run `34842989008`.
- [x] Production Frontend E2E passed on PR #80 merge SHA: run `34842988975`.
- [ ] Verify the newly packaged MT5 connector release artifact corresponds to PR #80 merge SHA and record its asset/hash.
- [ ] Restart/update the DEMO MT5 connector with that verified build and prove reconnect.
- [ ] Controlled XAUUSD DEMO entry succeeds exactly once on both MT5 DEMO and cTrader DEMO.
- [ ] Controlled synthetic/V75 DEMO entry succeeds exactly once on both supported DEMO destinations, respecting broker min-volume normalization.
- [ ] Record MT5 and cTrader broker order/deal/position IDs and executed quantities for acceptance entries.

## Durable position state

- [ ] Every successfully accepted broker entry materializes a durable `position_group` in Supabase through the common normalized execution path.
- [ ] Every successfully accepted broker leg materializes a durable `position_leg` in Supabase through the common normalized execution path.
- [ ] Broker position/order/deal IDs, requested/executed quantity, status, symbol, side, and destination/account binding are durably persisted.
- [ ] Materialization is source-agnostic; Telegram, webhooks, containers, free-DO workaround, and future normalized sources use the same persistence contract.
- [ ] Durable Object state remains the hot coordination/correlation layer and is not treated as a signal source or sole durable audit store.
- [ ] Replays/retries are idempotent and cannot create duplicate groups, legs, or broker executions.
- [ ] Reconciliation/recovery can rebuild/use durable broker bindings after worker/DO reconnects without duplicate orders.

## Management & lifecycle

- [ ] Telegram reply-to-entry correlation resolves the intended position group/legs deterministically.
- [ ] Reply `SL at BE now` modifies all intended open DEMO legs correctly on both brokers where supported.
- [ ] Reply `close` closes the intended open DEMO legs on both brokers exactly once.
- [ ] TP/SL/partial-close/breakeven/close lifecycle changes update both hot state and durable Supabase state.
- [ ] Management retry/replay is idempotent and cannot double-close or duplicate modifications.
- [ ] Bare/unrelated management messages fail safely rather than modifying an uncorrelated position.

## Authentication & connection lifecycle

- [ ] MT5 pairing token remains reusable only until its signed expiry and reconnect token remains instance-bound.
- [ ] Destination deletion/revocation invalidates unexpired MT5 connector authentication at the authoritative gateway, not merely future Worker routing.
- [ ] Active connector session is closed or otherwise rendered unusable when its destination is revoked/deleted.
- [ ] Reconnect after transient websocket loss recovers without duplicate broker execution.

## Regression & release gates

- [ ] Worker/trading-core regression suite green after persistence/management changes.
- [ ] Pure MT5 bridge regression suite green after all changes.
- [ ] cTrader cBot CI green after all changes.
- [ ] Production deploy/health/readiness/config verification green on final merge SHA.
- [ ] No existing routing, source normalization, risk sizing, destination filtering, kill-switch, replay/idempotency, or broker safety tests regress.
- [ ] Production DB evidence confirms `position_groups` and `position_legs` are populated for the controlled successful DEMO fills.
- [ ] Final end-to-end DEMO: source event -> parse -> route -> dual broker execution -> durable group/legs -> reply management -> durable lifecycle update.

## LIVE readiness gate

- [ ] All checklist items above required for execution are VERIFIED with evidence.
- [ ] No unresolved terminal/retriable delivery failures remain in the controlled acceptance window.
- [ ] No duplicate broker orders/positions from replay/reconnect tests.
- [ ] LIVE account remains disabled during the complete DEMO test suite.
- [ ] Explicit human decision to enable LIVE happens only after review of the final evidence; it is not part of automated stabilization.

## Known acceptance evidence before this branch

- cTrader DEMO XAUUSD entry `telegram:-1001822170589:25151`: SUCCEEDED, order `43933042`, position `136177927`, deal `40532264`, qty `0.01`, fill `4315.13`.
- cTrader DEMO V75 entry `telegram:-1001822170589:25153`: SUCCEEDED, order `43933055`, position `136177957`, deal `40532276`, requested `0.01`, executed `0.05`, fill `5893.69`.
- The matching MT5 deliveries reached the connector but failed before order placement solely at `order_check` with invalid broker `comment`; PR #80 addresses that isolated broker-compatibility defect.
- Prior production evidence showed successful cTrader fills while `position_legs` remained empty, proving that durable position materialization must be fixed before LIVE readiness.
