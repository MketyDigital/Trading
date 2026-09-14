# Complete DEMO Execution Stabilization Design — 2026-09-14

## Status and priority
This document is the authoritative continuation contract for the current trading stabilization work. It supersedes any narrower interpretation of the open stabilization PRs while preserving already-correct behavior. The immediate priority is to prove the complete DEMO lifecycle before any LIVE-readiness work.

LIVE execution MUST remain OFF throughout this work. Do not use the cTrader LIVE account for stabilization tests.

## Current proven state
- Telegram signal ingestion works.
- Signal-to-broker routing works.
- cTrader DEMO opens trades.
- Durable Supabase position state works.
- Management correlation works.
- MT5 is not yet accepted because the running connector is stale relative to current bridge/release code.
- cTrader close exposed a broker-safe client request-id constraint: clientMsgId must be bounded to 64 characters.
- Real wording `SL AT BE NOW` previously fell through to AI/review and is now covered by deterministic management aliases.

## End-to-end acceptance objective
A user-configured source/destination flow must work as one lifecycle:

Telegram/source event -> deterministic normalization -> AI only when required -> deterministic fallback if AI fails -> permissive advisory secondary/value checks -> durable correlated trade/group -> independent destination fanout -> Telegram destination(s) + MT5 + cTrader -> durable broker binding/state -> Telegram replies/follow-ups/management -> independent broker and Telegram updates -> reconnect/replay without duplicates.

The system is not complete until fresh DEMO evidence proves this lifecycle on both MT5 and cTrader while Telegram destination rendering and follow-up behavior remain intact.

## Non-negotiable behavioral contract

### 1. AI remains available and user-selectable
Do not remove AI behavior from Telegram destinations, interpretation, rendering, templates, or user-configurable destination choices that already exist.

AI may be used for:
- genuinely ambiguous source interpretation;
- user-selected Telegram destination/template transformations;
- existing supported rich destination formatting/workflows.

Do not collapse existing template choices into one format. Preserve every existing user-selectable template/format option unless a specific option is proven broken, in which case fix it without removing the option.

### 2. AI failure must never be the only reason a material trade dies
For a message requiring AI interpretation:
1. run the normal deterministic parser first;
2. use AI when deterministic parsing cannot confidently complete the intent;
3. if AI is unavailable, times out, returns bad JSON, returns unsupported output, or otherwise fails, run a deterministic material-evidence fallback against the original message;
4. only return review/non-actionable when the source still lacks enough material information to form a coherent executable/management intent.

AI failure alone is not a hard rejection.

### 3. No aggressive secondary/value veto
The second/secondary value check is advisory, not a second parser with veto power.

It MUST NOT invalidate an otherwise coherent trade merely because:
- a numeric token is formatted differently;
- rounding differs;
- punctuation/grouping differs but the parsed value remains unambiguous;
- an AI-rendered numeric value does not exactly string-match the raw source;
- a heuristic cannot independently re-prove every price.

Hard rejection is reserved for explicit material contradictions or clearly unsafe/impossible intent, such as:
- conflicting BUY vs SELL direction;
- a known symbol conflict;
- explicit instruction not to trade/cancel the signal;
- explicit order-type conflict that changes execution semantics;
- impossible/unsafe SL/TP geometry after normalization where execution would clearly invert protection/target intent;
- genuinely malformed/ambiguous values for which no coherent value can be recovered.

Warnings from secondary checks should be recorded for observability but must not silently veto coherent execution.

### 4. Telegram destination behavior must stay intact
Telegram output is a first-class destination, not a side effect of broker execution.

Preserve:
- all existing user-selectable Telegram destination/template options;
- AI-enabled Telegram destination transformations/options;
- deterministic/non-AI template paths;
- rich message/follow-up rendering logic already implemented;
- fast-signal handling and later completion/update behavior;
- destination-specific success/failure state;
- independent delivery: Telegram failure must not cancel MT5/cTrader, and broker failure must not cancel Telegram destinations.

### 5. Fast signals and rich follow-ups must remain correlated
Preserve the existing lifecycle for fast/incomplete signals and subsequent updates.

Required behavior includes:
- fast entry can be opened when policy permits;
- later SL/TP/entry completion updates correlate to the same logical position group;
- duplicate fast-entry replays do not create duplicate broker positions;
- reply/thread/source-event correlation remains richer than symbol-only matching;
- follow-up updates fan out independently to MT5, cTrader, and configured Telegram destinations where applicable;
- informational follow-ups such as `STOPPED AT BE AFTER TP2` must not accidentally create a new trade or destructive management action.

### 6. Management wording must be broad but deterministic for common commands
Common management wording should not require AI when it can be safely normalized.

At minimum preserve/support equivalent wording for:
- move SL to BE: `SL AT BE`, `SL AT BE NOW`, `SL TO BE`, `MOVE SL TO BE`, `BREAKEVEN`, `BREAK EVEN`;
- move/modify SL to a stated value;
- modify/change TP and target updates;
- close/full close/close all;
- partial close/reduce position when quantity/percentage semantics are supplied;
- cancel pending order;
- informational stopped-at-BE/target-hit updates without executing the wrong action.

Correlation priority remains:
1. explicit reply/reply-to relation;
2. thread/relation metadata;
3. explicit compatible symbol/context;
4. unique/recent compatible active trade as a guarded fallback.

Ambiguous destructive management must still fail closed rather than manage the wrong trade.

### 7. cTrader compatibility requirements
- cTrader `clientMsgId` must never exceed the broker/protocol-safe 64-character limit.
- The full internal idempotency identity must remain durable even when the broker-facing request id is bounded/hashed.
- Preserve actual broker rejection code/description in destination diagnostics; do not reduce useful errors to generic `INVALID_REQUEST`.
- Open, close, partial close, SL, TP, BE and pending-management commands must remain independently idempotent.

### 8. MT5 must be broker-adaptive, not broker-name-specific
The MT5 connector/bridge must work from broker-exposed symbol/account capabilities rather than vendor hardcoding.

Required compatibility surface:
- restrictive broker comments and commentless fallback;
- symbol aliases/prefixes/suffixes;
- min/max/step volume normalization;
- digits/tick-size price normalization;
- stops/freeze-level handling;
- market/instant/exchange execution modes where exposed;
- safe supported filling-mode selection/fallback (FOK/IOC/RETURN as allowed);
- market and supported pending-order types;
- exact `order_check`/broker diagnostics;
- retry only when the next request variant is genuinely compatible;
- open, close, partial close, SL, TP, BE and pending cancel/management;
- reconnect/reconciliation based on durable broker identifiers and deterministic command identity;
- no duplicate broker action after retry/restart.

A stale connector is an operational failure, not proof that current source code is broken. Acceptance requires a fresh connector artifact built from the accepted branch and an actual restart before real DEMO evidence is collected.

### 9. Durable state and recovery
Durable Object remains hot coordination/correlation state. Supabase remains durable relational/audit/recovery state.

For every accepted trade lifecycle persist/recover:
- runtime group identity and DB UUID mapping;
- runtime leg identity;
- source/reply/thread correlation metadata;
- destination/account identity;
- broker order/position/deal ids;
- requested, executed and remaining lots/quantity;
- fill/status/failure data;
- management/lifecycle transitions;
- idempotency/retry state sufficient to avoid broker re-send after successful broker execution.

Broker success followed by state-binding persistence failure must enter state-repair, not resend the broker command.

### 10. Independent destination isolation
A source event can fan out to multiple configured destinations. Every destination records its own result. Failure/timeout/retry at one destination cannot invalidate or roll back already-successful independent destinations.

This specifically applies to:
- Telegram destination(s);
- MT5 account(s);
- cTrader account(s).

## Automated regression matrix
Tests must cover at least:
- deterministic normal signal;
- AI-required ambiguous signal;
- AI unavailable/error/bad JSON -> deterministic material fallback;
- advisory value mismatch warning without trade rejection;
- real material contradiction still rejected;
- all existing Telegram template/destination options still selectable/renderable;
- Telegram destination failure isolated from broker execution;
- broker failure isolated from Telegram destination delivery;
- fast entry then completion/follow-up;
- duplicate fast entry suppression;
- explicit Telegram reply management correlation;
- BE wording variants;
- informational stopped-at-BE update;
- cTrader request id <=64 with stable uniqueness;
- cTrader broker error description preservation;
- MT5 comment rejection -> compatible comment/commentless behavior;
- MT5 volume/filling/symbol/stops capability adaptation;
- open and management idempotency/reconnect;
- Supabase durable bindings and recovery.

## Fresh DEMO acceptance matrix
Do not mark these complete from unit tests alone.

- [ ] Current branch CI is green for Worker/Node and MT5/Python suites.
- [ ] Current branch deploy/release artifact is produced successfully.
- [ ] Fresh MT5 connector artifact from current accepted commit is installed/restarted.
- [ ] One controlled Telegram XAUUSD entry is ingested exactly once.
- [ ] Configured Telegram destination(s) receive the expected selected template/output.
- [ ] cTrader DEMO opens exactly one position and returns real broker ids.
- [ ] MT5 DEMO opens exactly one position and returns real broker ids.
- [ ] Supabase contains the matching durable position group/legs and broker ids.
- [ ] A signal that requires AI is handled successfully.
- [ ] An induced AI failure proves deterministic fallback where material evidence is sufficient.
- [ ] Advisory value-check mismatch does not reject a coherent trade.
- [ ] Explicit Telegram reply `SL AT BE NOW` modifies the correct MT5 and cTrader positions.
- [ ] SL-to-value update works on both brokers.
- [ ] TP update works on both brokers.
- [ ] Partial close works where broker/account capability permits and reports explicit unsupported behavior otherwise.
- [ ] Full close works on both brokers.
- [ ] Telegram follow-up/update destinations receive the correct correlated lifecycle output where configured.
- [ ] Fast-signal entry plus later completion/update works without duplicate positions.
- [ ] Connector/retry/replay test produces no duplicate open or management action.
- [ ] Durable state can recover enough correlation after hot-state loss/restart.
- [ ] Zero LIVE executions occurred.

## Completion and merge rule
This stabilization branch is not ready for `main` merely because code compiles or tests are green. Merge only after the automated matrix is green AND the fresh DEMO acceptance matrix proves Telegram destination behavior, MT5, cTrader, follow-ups/management, durability and reconnect/idempotency together.

After merge, perform a separate LIVE-readiness review. Do not automatically enable LIVE.