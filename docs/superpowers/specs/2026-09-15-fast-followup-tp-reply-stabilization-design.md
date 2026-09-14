# Fast Follow-up, TP Parsing, Reply, and MT5 Linux/Wine Stabilization Design

## Scope
This stabilization covers the existing Telegram ingress/destination and broker execution system. It must not redesign unrelated flows or enable LIVE trading.

## Global safety
- LIVE broker execution remains disabled throughout implementation and acceptance.
- Existing working cTrader DEMO and MT5 DEMO execution paths must remain intact.
- Telegram destination failures must remain isolated from broker execution failures and vice versa.
- AI formatting/interpreter fallbacks remain available where already supported.

## 1. TP parsing contract
The deterministic parser must preserve all intended take-profit values without confusing punctuation used inside one price.

Accepted examples include:
- `TP 4300.5` on multiple lines.
- `TP1 4300.5`, `TP2 4360.9`, `TP3 4450.3`.
- `TP 4300.5, 4360.9, 4450.3`.
- `TP 4300.5, TP 4360.9, TP 4450.3`.
- mixed-case and ordinary Telegram spacing variants.

A comma inside a numeric literal must not be treated as a TP separator when it is valid thousands grouping, e.g. `77,536.637` is one price, not `77` and `536.637`.

Parsing must fail closed or defer to interpretation when comma structure is genuinely ambiguous. It must never invent TP values.

## 2. Fast signal -> full follow-up contract
A fast/incomplete signal such as `buy gold` may be completed by a later full signal for up to 30 minutes.

Correlation priority for follow-up completion:
1. explicit Telegram reply/message reference;
2. known thread/source relationship;
3. unique compatible incomplete logical trade in the same workspace/source/account scope with the same canonical symbol and side and age <= 30 minutes;
4. otherwise fail closed for ambiguity.

The ordinary management recency policy remains separate; strong reply/thread/broker identity is not time-bound while the trade remains active.

A one-leg fast trade completed by a three-TP signal must become one logical three-leg trade:
- original broker position remains leg 1;
- leg 1 receives the common SL and TP1;
- leg 2 is opened with the common SL and TP2;
- leg 3 is opened with the common SL and TP3;
- no duplicate replacement leg 1;
- all source event IDs bind to the same logical trade;
- broker IDs and idempotency remain stable.

## 3. Follow-up protection validation
Before modifying the original fast leg or opening new follow-up legs, validate the follow-up SL/TP values against current broker-market constraints.

The system must distinguish:
- valid for all legs: apply normally;
- invalid only for the already-open original leg because price has moved beyond a TP/SL or broker stop rules reject it: do not force an invalid broker modification;
- values still valid for newly created legs: new legs may use them if broker/opening rules permit;
- structurally impossible signal geometry: fail closed rather than partially reinterpret.

A skipped invalid modification on the original leg must be observable with an explicit blocked/skipped reason and must not cause duplicate opens.

## 4. TP-hit protection policy
Automatic TP protection is user-configurable and off by default.

Supported policy modes:
- `OFF`: TP-hit messages make no automatic stop changes.
- `PROGRESSIVE`: TP1 hit moves remaining legs to break-even; TP2 hit moves remaining later legs to TP1 price.
- `BREAKEVEN`: TP1 or TP2 hit moves remaining legs only to break-even.

Backward compatibility: existing `autoTpProtection=true` maps to `PROGRESSIVE`; false/missing maps to `OFF`.

TP-hit actions must correlate to the correct logical trade and remaining legs, preserve broker identities, and obey BE market eligibility/broker stop-distance checks.

## 5. Reply integrity
Replies are a release-blocking contract for both Telegram and broker routes.

Telegram Bot API and MTProto sources must preserve `reply_to_event_id` whenever Telegram supplies or can resolve it. A reply to the original signal or any known follow-up/management message associated with that trade must resolve back to the same logical trade.

For broker management, an explicit reply outranks recency and symbol guessing. If a supplied reply cannot be resolved, the broker route must fail closed and must not silently manage another trade.

For Telegram destinations, routed reply metadata should be preserved when the destination mode supports reply threading. Destination reply failure must not affect broker execution.

## 6. Telegram `none` mode
`none` is the verbatim source-copy mode.

For any routed Telegram message with content, regardless of whether trading interpretation is READY, MANAGEMENT, NO_ACTION, NEEDS_REVIEW, or non-signal text:
- no AI;
- no cleanup;
- no canonical reconstruction;
- source text is sent exactly as stored;
- Telegram entities are preserved when available;
- ordinary non-trading messages are forwarded too.

Broker execution independently decides whether the same source message is executable. Telegram forwarding must not depend on the message being a valid signal.

## 7. MT5 on Linux VPS via Wine
Mkety supports the existing Windows MT5 connector EXE running under Wine on Linux VPS hosts.

The supported operating model is:
- MetaTrader 5 and `MketyMT5Connector.exe` run under the same Wine prefix;
- connector configuration and replay ledger remain persistent in the Wine user profile;
- connector reconnects after transient websocket/terminal failures;
- an operator runbook documents installation, pairing, startup, systemd supervision, logs, restart, reset, and identity verification;
- no separate native-Linux execution engine is introduced in this stabilization.

## 8. Required acceptance
Automated tests must cover:
- repeated-line TP parsing;
- single-line comma-separated TP parsing;
- repeated `TP` labels in one line;
- numbered TP syntax;
- thousands-separated prices;
- ambiguous comma fail-closed behavior;
- fast completion at >2 min and <=30 min;
- rejection beyond 30 min unless reply/thread identity is explicit;
- 1-leg -> 3-leg promotion without duplicate leg 1;
- invalid follow-up SL/TP on original leg without unsafe duplicate/replacement;
- Bot API and MTProto reply mapping;
- unresolved explicit reply fail-closed;
- TP protection OFF/PROGRESSIVE/BREAKEVEN;
- Telegram `none` forwarding of trade and non-trade messages with no AI;
- cTrader and MT5 broker actions preserving leg IDs and broker position IDs;
- replay/idempotency and persistence/recovery.

Real acceptance remains DEMO-only until every relevant test and deployment check is green and LIVE controls are explicitly reviewed separately.