# TP, Fast-Completion, Reply and Route Stabilization Design

## Goal

Make signal parsing, fast-entry completion, Telegram reply targeting, multi-leg promotion, TP-hit protection, Telegram verbatim forwarding, and MT5 Linux/Wine operation safe enough for final DEMO acceptance before any LIVE enablement.

## Global safety constraints

- LIVE broker execution must remain disabled throughout implementation and acceptance.
- Existing working MT5/cTrader execution, Telegram AI formatting, deterministic fallback, destination fanout isolation, and idempotency must not regress.
- Strong identity must outrank recency. Explicit Telegram replies and durable trade identity are authoritative while the referenced trade remains active.
- Ambiguity must fail closed. Never guess between multiple compatible active trades.
- Fast-entry completion is allowed for up to 30 minutes, but only for a compatible unique incomplete logical trade from the same workspace/source/symbol/side. Explicit reply/thread identity remains stronger than the 30-minute heuristic.

## 1. TP parsing contract

The parser must preserve all explicit take-profit targets without confusing list separators with thousands separators.

Accepted examples include:

- multiline repeated labels:
  - `tp 4300.5`
  - `tp 4360.9`
  - `tp 4450.3`
- numbered labels: `tp1 0.1273`, `tp2 0.1300`, `tp3 0.1340`
- one-line repeated labels: `tp 8376, tp 6353, tp 7363`
- one-line list after one TP label: `tp 2453, 6635, 8634.6`
- existing colon/@/dash label variants already supported.

Thousands separators remain one numeric token, e.g. `77,536.637` is one price, not two targets. The number tokenizer remains the authority for validating comma grouping. A comma can be interpreted as a TP list separator only when the resulting fragments are independently valid signal numbers and the comma is not valid as part of a single grouped numeric token.

Repeated unnumbered TP lines preserve source order. Numbered TP labels are ordered by TP index. Conflicting duplicate numbered indices must fail deterministic parsing or escalate to interpretation rather than silently overwrite semantically different values.

## 2. Fast-entry completion contract

A fast signal such as `buy gold` creates one incomplete logical trade per routed broker account. A later full compatible signal can complete that logical trade for up to 30 minutes.

Correlation priority for completion:

1. explicit Telegram reply to any source event already bound to the logical trade;
2. explicit thread/group relationship;
3. compatible unique incomplete logical trade from the same workspace + source instance + symbol + side within 30 minutes;
4. otherwise create a new trade only when no compatible incomplete trade exists; ambiguous compatible incomplete trades must go to review rather than guessing.

The completion event must be appended to the same logical trade source-event history on every broker route.

## 3. Safe 1-to-N leg promotion

When a fast signal opened one broker position and the full signal later contains N TPs:

- existing fast leg remains leg 1 and keeps its original broker position identity;
- leg 1 is modified to the full signal SL and TP1 when those protections are broker-valid;
- legs 2..N are opened only once, each with the same SL and its corresponding TP;
- no replacement/duplicate leg 1 is opened;
- each leg receives deterministic idempotency keys and durable target indexes;
- all broker routes in the same logical trade remain correlated but retain their own broker position IDs.

### Stale-price protection during completion

Because the full signal may arrive up to 30 minutes later, its original SL/TP geometry may no longer be valid for the already-open leg.

For the already-open leg:

- never close/reverse/reopen merely to force stale SL/TP values;
- fetch authoritative broker/market context before applying completion protection where broker validity depends on current price;
- apply each protection only when valid for the side and broker stop rules;
- if TP1 is already passed or would be rejected as an invalid protective TP, do not attach it to leg 1; record a deterministic blocked/skipped protection reason while preserving the position;
- if the requested SL is already on the wrong side of current market or otherwise broker-invalid, do not attach it to leg 1; fail that protection closed without opening a replacement position;
- new legs must not be opened with invalid SL/TP geometry. If their intended protection is invalid at execution time, block that leg rather than creating uncontrolled risk unless the account's explicit policy permits an unprotected fast leg.

The completion event can still mark the logical trade as structurally complete only when the intended leg topology is safely established; blocked legs/protections remain visible in outcomes and durable state.

## 4. Reply integrity contract

Replies must work for both Telegram forwarding routes and trade-management/execution routes.

- Bot API and MTProto ingestion must preserve `reply_to_event_id` when Telegram provides a reply relationship.
- A reply to the original fast signal, full signal, or later management/update event bound to a trade must resolve to the same logical trade.
- Explicit reply targeting is not time-bound while the trade remains active.
- If an explicit reply references an event that cannot be resolved, fail closed as `NO_REPLY_TARGET`/review; never fall through to a newer unrelated trade.
- Telegram destination forwarding should preserve reply relationships when the destination has a known mapped destination message for the replied source message. If no mapping exists, send the content without inventing a destination reply target.
- Broker routing and Telegram routing remain independent: a Telegram reply-delivery failure cannot cancel MT5/cTrader execution and vice versa.

## 5. TP-hit protection policy

Automatic protection remains opt-in per account.

Supported policy modes:

- `OFF` (default): TP-hit messages are recognized/correlated but do not modify remaining positions.
- `PROGRESSIVE`: TP1 hit moves remaining legs to break-even; TP2 hit moves later remaining legs to TP1 price.
- `BREAKEVEN`: TP1/TP2 hit may move remaining legs to break-even only; no progressive TP1-price lock.

Legacy `autoTpProtection=true` maps to `PROGRESSIVE` for backward compatibility.

Every automatic protection action must use the same broker-specific BE/SL validity safeguards as explicit management. It must never invent a price or modify a closed leg.

## 6. Telegram destination `none` contract

`formatting_mode=none` is the verbatim copier mode.

For every routed Telegram source message that contains sendable content, whether or not it is a valid trade signal:

- send the exact stored source text;
- preserve Telegram entities when available;
- do not call presentation AI;
- do not clean, normalize, rebuild, brand, add disclaimer, or reorder content;
- preserve supported reply relationship through source->destination message mapping when available;
- forwarding remains independent from broker interpretation/execution.

This includes trade signals, analysis posts, greetings, results posts, management phrases, malformed signals, and other ordinary text messages.

## 7. Linux/Wine MT5 connector contract

The existing Windows connector EXE is the canonical connector binary. Linux VPS support uses Wine rather than a separate trading implementation.

- Install/run MetaTrader 5 in Wine.
- Run `MketyMT5Connector.exe` in the same Wine prefix as MT5.
- Persist connector config and SQLite replay ledger inside that prefix.
- Document pairing/reset, logs, reconnect, reboot startup via systemd, and verification of account/server/heartbeat.
- The connector must retain the same broker-account identity, command expiry, replay/idempotency, heartbeat, symbol catalog, context-request, and reconnect behavior under Wine.
- Do not claim Linux/Wine production support until a real Wine acceptance run succeeds.

## 8. Acceptance requirements

Before LIVE can be considered:

- parser tests cover all TP formats above and thousands-separator counterexamples;
- fast->full completion succeeds after >2 minutes and <=30 minutes without duplicating leg 1;
- same flow fails closed after 30 minutes unless explicit reply/thread identity targets the original trade;
- explicit replies work for management and full-signal completion, including replies to later events in the same trade chain;
- 1->3 promotion produces TP1/TP2/TP3 on the correct legs for cTrader DEMO and MT5 DEMO;
- stale/invalid completion SL/TP values are blocked safely without replacement opens;
- TP protection OFF/PROGRESSIVE/BREAKEVEN behavior is proven;
- Telegram `none` forwards non-signal text as well as signals, with entities and reply mapping where possible;
- connector restart/replay/reconnect remains idempotent;
- final production controls confirm `live_broker_execution_enabled=false` and zero LIVE deliveries during acceptance.
