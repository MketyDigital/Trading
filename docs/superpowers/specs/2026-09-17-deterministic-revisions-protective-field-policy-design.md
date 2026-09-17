# Deterministic Telegram Revisions and Protective-Field Policy Design

Date: 2026-09-17
Branch: `fix/ai-operations-observability-continuation`
Status: Approved in chat for spec drafting; implementation requires written-spec review approval.

## 1. Purpose

Extend the existing trading pipeline without weakening its safety model so that:

1. Clear trading signals are handled deterministically even when some optional fields are missing.
2. Telegram edited messages update the already-correlated trade or pending order instead of creating a duplicate OPEN.
3. Telegram replies containing explicit SL/TP/close/cancel corrections can manage the correlated trade.
4. Standalone explicit management commands can manage a trade only when correlation is unique and safe.
5. Invalid protective fields can optionally be skipped instead of rejecting an otherwise valid trade.
6. Existing authorization, replay protection, destination isolation, broker-id persistence, reconnect recovery, DEMO-first release gates, and LIVE safeguards remain intact.

The design deliberately separates **understanding** a message from **validating** broker geometry and from **deciding** whether an invalid protective field is fatal.

## 2. Non-negotiable invariants

- A Telegram edit must never create a second market OPEN for a trade that already exists.
- Stable Telegram logical identity remains `chat_id:message_id`.
- Delivery/update identity may additionally use Telegram `update_id`, edit timestamp, and/or a content hash, but these never replace the logical message identity used for correlation.
- Persisted workspace/source/route/account authorization remains authoritative over caller hints.
- Authorization is reloaded immediately before broker dispatch.
- AI is never trading authority. Deterministic parsing, validation, policy, correlation, and broker state determine whether an action is executable.
- One destination failure must not cancel sibling destinations.
- A broker success followed by persistence failure is repaired by reconciliation/state repair; the system must not blindly resend the broker command.
- LIVE execution stays disabled until the existing DEMO acceptance matrix passes and runtime controls/accounts are explicitly rechecked.
- Existing source formatting, feed routing, MTProto/Bot API support, cTrader/MT5 execution, fast-entry completion behavior, and idempotency remain compatible.

## 3. Deterministic interpretation policy

### 3.1 Missing optional fields are not ambiguity

A message is not sent to AI merely because SL or TP is missing. If side, symbol, order/entry intent, and every supplied numeric field are syntactically understood, the pipeline returns a deterministic canonical intent marked incomplete where appropriate.

Examples that must remain deterministic include:

- `BUY XAUUSD`
- `XAUUSD BUY`
- `Gold buy now`
- `SELL GOLD CMP`
- `XAUUSD SELL @ MARKET`
- `BUY EURUSD 1.1820`
- `SELL XAUUSD ENTRY 4275`
- `XAUUSD SELL ENTRY 4273-4279`
- `BUY XAUUSD SL 4250`
- `SELL XAUUSD ENTRY 4273-4279 SL 4380`
- one or many TPs, including compact forms such as `TP 4300 4310 4320`
- LONG/SHORT aliases
- common field aliases: Entry, Entry Price, Entry Zone, SL, S/L, Stop Loss, TP, T/P, Take Profit
- current-market aliases: CMP, C.M.P, current market price, market price, at market, now
- safe symbol aliases including Gold/XAUUSD and supported Deriv shorthand such as V75 / Volatility 75 Index.

AI remains available only for genuinely ambiguous, narrative, contradictory, conditional, or safely uncorrelatable messages.

### 3.2 Syntax and geometry are separate

A value can be syntactically understood yet geometrically invalid for the broker action. Example: a SELL signal with a clearly labeled SL below the sell entry is still deterministically understood as an SL; geometry validation later determines whether it is acceptable.

This prevents clear signals from being pushed into AI merely because one protective field is bad.

## 4. Telegram revision model

### 4.1 Logical message versus revision

For Bot API `message`, `edited_message`, `channel_post`, and `edited_channel_post`:

- logical message key: source/chat + `chat_id:message_id`
- revision identity: Telegram `update_id` plus edit metadata/content fingerprint where available
- persisted revisions must retain raw text and the materialized canonical interpretation used for comparison

The existing logical identity remains the primary idempotency/correlation anchor. A revision is not a new independent signal.

### 4.2 Materialized intent diff

When an edit arrives for a logical message that already has a correlated group/order:

1. Parse the edited text deterministically.
2. Load the previously materialized canonical intent and correlated group state.
3. Compute a semantic diff.
4. Emit only the safe management delta.

Example:

Original:
`BUY GOLD ENTRY 4300 SL 4270 TP 4350`

Edited:
`BUY GOLD ENTRY 4300 SL 4280 TP 4370`

Result:
- `UPDATE_SL 4280`
- `UPDATE_TP1 4370`
- no `OPEN`

Formatting-only edits produce no broker action.

### 4.3 Immutable versus mutable fields after execution

After a position has executed:

- symbol and side are immutable for automatic revision handling;
- changing symbol or side yields review/no broker action;
- the historical fill/market entry is not rewritten;
- SL and TP changes may be applied to remaining open legs;
- already-closed legs are never reopened;
- a fully closed/cancelled group is never reopened because an old Telegram message was edited.

For an unfilled pending order, safe broker-supported modifications to entry/SL/TP may be allowed, but symbol/side changes remain non-amendable automatically.

### 4.4 Omission is not automatic protection removal

If an edited message simply omits a previously present SL or TP, the system must not assume the user intended to remove that protection. Automatic removal requires explicit language such as `REMOVE SL`, `CANCEL SL`, `REMOVE TP2`, or equivalent deterministic wording.

This avoids accidentally stripping risk controls when a provider shortens or cleans up an edited post.

### 4.5 Corrected edit after no execution

If the original message did not cause a broker action because it was invalid/review-only and an edit corrects it, the corrected revision may OPEN exactly once if all ordinary authorization, idempotency, validation, route, and runtime gates pass and no broker action already exists for the logical message.

## 5. Reply and standalone management

### 5.1 Reply correlation

A reply containing explicit management instructions uses the strongest correlation available:

1. same source/chat + `reply_to_message_id`
2. persisted original logical event -> group/order mapping
3. current broker/group state

Examples:

- `SL 4280`
- `UPDATE SL 4280`
- `MOVE SL TO 4280`
- `SL AT BE`
- `MOVE SL BE`
- `TP1 4350`
- `UPDATE TP1 4350`
- `REMOVE TP2`
- `CLOSE HALF`
- `CLOSE 25%`
- `CLOSE 0.01`
- `CLOSE ALL`
- `CANCEL PENDING`

A reply with strong message correlation does not need loose symbol guessing.

### 5.2 Standalone management

Standalone management may execute only when the existing correlation hierarchy resolves exactly one safe target. Ambiguous candidates remain `NEEDS_REVIEW`/no broker action.

Narrative status text such as `STOPPED AT BE AFTER TP2` is not automatically treated as a command unless the deterministic grammar proves an actionable instruction.

## 6. Protective-field validation and policy

### 6.1 Field-level validation

Validate independently:

- entry/order geometry
- stop loss
- each take-profit field/leg

The parser produces canonical intent first. Validation produces field-level validity and reason codes second. Execution policy decides whether an invalid protective field rejects the trade or is omitted.

### 6.2 Workspace/account policy

Add an explicit persisted policy with the effective behavior equivalent to:

- `reject_trade` — current strict behavior; any invalid required protective field prevents execution.
- `skip_invalid` — an invalid SL or TP is stripped from the broker request while valid executable parts continue.

For compatibility, **new workspaces/customers default to `reject_trade`**. The Starpips DEMO workspace may explicitly enable `skip_invalid` during acceptance testing.

Implementation may expose this as one enum or equivalent separate persisted SL/TP toggles if the existing settings model makes that safer, but the effective defaults and semantics above are mandatory.

### 6.3 What may be skipped

Only syntactically understood protective levels may be skipped under `skip_invalid`:

- invalid SL geometry
- invalid TP geometry for an individual TP/leg

The system must record exactly which field was skipped and why.

### 6.4 What is never skippable

The following remain fail-closed regardless of protective-field policy:

- ambiguous or missing symbol when no safe alias/correlation exists
- contradictory BUY and SELL instructions
- unsupported instrument
- invalid lot/risk sizing
- unauthorized source/workspace/route/account
- LIVE disabled by runtime control/account policy
- ambiguous entry intent
- invalid/unsupported pending-order geometry
- contradictory management instructions
- uncertain management correlation
- broker capability mismatch that makes the core action unsafe

### 6.5 Multiple TP legs and requested size preservation

Skipping an invalid TP must not silently reduce the user-requested total position size. If the architecture represents TPs as separate legs, an invalid TP removes only the TP protection from that leg while preserving its allocated volume, unless the broker/executor model cannot safely represent that state. In that exceptional case, execution must fail closed rather than silently changing requested exposure.

An invalid shared SL under `skip_invalid` is omitted consistently from the affected open legs; it is never converted to `0`, `null` in a form interpreted as a real price, or another fabricated level.

## 7. Management after partial/full lifecycle events

- Edits/management apply only to remaining open volume.
- Closed legs remain immutable historical records.
- Partial close preserves durable remaining-volume state.
- Full close sets durable closed state and prevents old-message edits from reopening the group.
- Pending-order cancel/edit uses the persisted broker order identifier.
- Reconnect/restart recovery reconciles broker truth before any management resend.

The existing regression requirement around `closed_at` and missing management `fillPrice` remains release-blocking: missing values must not become `0` through coercion.

## 8. Persistence and operation journal

Every material step should produce normalized durable observability without leaking secrets:

- source update received / edit received
- deterministic interpretation result
- revision correlation result
- semantic diff/no-op
- field validation result
- `SKIPPED_INVALID_SL`
- `SKIPPED_INVALID_TP<n>`
- OPEN / MODIFY / CLOSE / CANCEL intent
- destination dispatch attempt/result
- broker success/failure with normalized reason
- persistence repair/reconciliation result

Migration history must be forward-only. If two branch files share the same migration number, do not rewrite any migration that may already have been applied. Resolve numbering with a new forward migration or rename only a branch-local unapplied migration after verifying deployment history.

## 9. Error handling

- Duplicate Telegram revisions: no duplicate broker action.
- Semantically unchanged revision: durable no-op.
- Revision arrives after full close: no reopen; record no-action/review reason.
- Broker rejects one management command: record the exact leg/field/provider failure and leave sibling destination operations isolated.
- Broker reports success but database persistence fails: enter repair/reconciliation path; never resend the original broker command solely because persistence failed.
- AI provider failure cannot turn a syntactically clear deterministic signal into `NEEDS_REVIEW` merely because optional fields are missing.

## 10. Test strategy

Implementation follows RED -> GREEN -> regression verification.

Minimum automated coverage:

1. deterministic incomplete signals do not fall through to AI;
2. production-style `SELL XAUUSD ENTRY 4273-4279 SL 4380` is deterministic;
3. the same shape with geometrically invalid SL is still deterministically understood, then strict policy rejects while skip policy omits the SL;
4. `V75 index Sell Now` resolves deterministically to the configured supported symbol;
5. original Telegram signal opens once;
6. replay of original does not reopen;
7. edited same message updates SL/TP without OPEN;
8. formatting-only edit is a no-op;
9. omission of existing SL/TP does not remove it;
10. explicit `REMOVE SL`/`REMOVE TP<n>` does remove when valid and authorized;
11. reply-to-original updates the correct group;
12. ambiguous standalone management does not execute;
13. corrected edit after a non-executed original may open once;
14. edit after full close does not reopen;
15. invalid one TP under skip policy preserves requested volume while omitting only that TP;
16. strict policy preserves legacy fail-closed behavior;
17. destination fanout failure isolation remains intact;
18. broker success + persistence failure does not resend;
19. `closed_at` persists correctly on full close and missing management `fillPrice` is never coerced to zero;
20. migration sequence is unambiguous and applies cleanly to a fresh database/test schema.

## 11. DEMO acceptance before LIVE

After automated CI passes, run the existing real DEMO acceptance matrix with LIVE still disabled:

- re-query runtime controls and all trade-account execution/live flags;
- confirm global live broker execution remains false;
- confirm every LIVE account has execution/live disabled;
- Telegram Bot API fresh signal;
- MTProto path where configured;
- exact Telegram destination formatting modes and fallback behavior;
- destination failure isolation;
- fresh broker market OPEN;
- replay/idempotency;
- fast-entry -> full completion without duplicate OPEN;
- edited message SL/TP revision;
- reply-based management;
- standalone unambiguous management;
- partial close and full close durable state;
- pending order and cancel/modify;
- invalid SL/TP strict mode;
- invalid SL/TP skip mode on explicitly enabled Starpips DEMO workspace;
- connector restart/reconnect and broker reconciliation;
- DigitalOcean/Supabase recovery paths where applicable;
- operation-journal diagnostics.

Any failed release-blocking case returns the system to fix/test; it does not advance to LIVE.

## 12. LIVE transition

LIVE is a separate explicit release step after a clean DEMO matrix. Before enabling it:

1. merge only verified code through the repository's production path;
2. verify production workflow success for the exact commit;
3. re-query runtime controls and account flags after deploy;
4. confirm intended LIVE account, route, source, sizing, and broker identifiers;
5. enable the minimum required LIVE controls only for the intended account/workspace;
6. perform a controlled small live acceptance action only after explicit human authorization at that point;
7. immediately verify broker truth, persisted group/legs, journal, and reconciliation state.

No code path, migration, test, or deploy step in this design automatically turns LIVE on.

## 13. Scope boundaries

This design does not authorize unrelated refactors, new trading strategies, exposure redistribution, automatic trade reversal, or inference of unclear provider intent. It changes deterministic interpretation, revision/management lifecycle handling, protective-field policy, and the observability needed to make those changes safe.
