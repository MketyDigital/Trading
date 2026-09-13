# Trade Lifecycle Correlation and Audit Design

## Goal
Make Mkety preserve deterministic trade identity from source signal through broker execution, durable Trade State, follow-up completion, management actions, and all configured destinations across cTrader, MT5, Telegram, and webhook paths.

## Approved sizing semantics
- FIXED_LOTS means configured lot size **per TP leg**, not total across all legs.
- Example: fixed lot 0.10 with TP1/TP2/TP3 produces three 0.10-lot legs.
- A fast-entry BUY/SELL with no TP opens exactly one fixed-lot leg immediately.
- If a later compatible full signal completes that fast entry with N TPs, the already-open fast leg becomes TP1 and only N-1 additional legs are opened. Total legs after completion must equal N, never N+1.
- Risk-percent and fixed-risk modes keep total risk as the trade-level budget and distribute volume/risk across target legs.

## Durable execution identity
Every planned leg has a stable legId. The same identity must survive:
source event -> canonical intent -> position group -> execution action -> delivery request -> broker response -> Trade State binding -> audit/recovery.

Broker success followed by state-binding failure must never resend the broker order. The successful delivery must be marked for state-only repair and repaired from its persisted response payload.

## Follow-up completion correlation
Correlation is a separate safety layer from parsing. Candidate selection order:
1. Explicit Telegram reply/message reference.
2. Explicit symbol + direction matching an incomplete compatible group from the same source/workspace/account scope.
3. Explicit symbol for management actions.
4. Unique contextual match within the same source/chat and bounded recency window.
5. If more than one compatible target remains, fail closed with NEEDS_REVIEW.

A follow-up full signal does not need to be a Telegram reply when deterministic correlation produces exactly one compatible target.

## Management semantics
Support deterministic forms including CLOSE, CLOSE ALL, CLOSE <symbol>, CLOSE HALF/50%, MOVE SL TO BE, BE, MOVE SL <price>, CHANGE TP <price>, CANCEL PENDING, DELETE ORDER, and equivalent concise trader language.

Bare management commands may auto-execute only when exactly one eligible open/pending group exists in the same trusted source context. Never choose the latest trade globally.

Negated, conditional, uncertain, or conversational phrases must not execute automatically.

## Destination behavior
Telegram and webhook destinations must be idempotent per source event + destination. Retries must not create duplicate messages. Presentation/rebranding AI may alter wording only; canonical side, symbol, entry, SL, TPs, risk, routing, account and execution semantics are immutable.

## Broker parity
The same lifecycle contract applies to cTrader Direct/Open API, cTrader cBot, MT5 connector/bridge and future broker adapters. Broker-specific symbol aliases, min/max/step lots, market state and execution semantics remain adapter-authoritative.

## Audit and acceptance
Acceptance must prove:
- deterministic source ingestion and correlation;
- correct per-leg sizing semantics;
- durable broker IDs and open/closed timestamps;
- no duplicate broker send on recovery;
- close/partial/BE/pending management lifecycle;
- destination idempotency and retry behavior;
- workspace/account/source isolation;
- demo/live safety and global live switch enforcement;
- Operations visibility for recent events, deliveries, state-binding repair and management outcomes.

Live-money execution remains disabled until separately authorized.