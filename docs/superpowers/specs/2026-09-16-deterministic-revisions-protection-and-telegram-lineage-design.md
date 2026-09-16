# Deterministic Signal, Revision, Protection, and Telegram Lineage Design

Date: 2026-09-16
Branch: `fix/ai-operations-observability-continuation`
Status: Approved design; implementation pending

## 1. Goal

Make normal trading messages executable without AI whenever deterministic intent is safely clear, while preserving all existing safety, routing, idempotency, broker, reply/thread, destination, and LIVE-off guarantees.

This change also makes Telegram edits, replies, and strong same-context follow-ups first-class trade lifecycle inputs instead of treating them as unrelated new messages.

The design must improve compatibility without weakening execution authority.

## 2. Non-negotiable invariants

1. LIVE execution remains disabled. Nothing in this work may enable global, workspace, account, or route LIVE authority.
2. AI is never trading authority. Deterministic parsing and deterministic validation remain final authority for money-moving actions.
3. Missing optional trade fields are not ambiguity by themselves.
4. Syntactically clear but geometrically invalid SL/TP values must not be mislabeled as interpretation failures.
5. No edit, reply, follow-up, replay, or Telegram formatting action may create an accidental duplicate broker OPEN.
6. Broker success followed by persistence failure remains repair-only; never resend without reconciliation proving the broker action did not occur.
7. Destination failures remain isolated from sibling destinations.
8. Existing fast-entry -> later-full-signal completion behavior stays intact.
9. Existing reply/thread/context correlation stays intact and is extended, not replaced.
10. Telegram formatting modes may alter presentation only. They may never alter canonical trading semantics or source/destination lineage.
11. Exact/raw Telegram mode keeps exact stored source text and native entities where available.
12. Every skipped, rejected, applied, ignored, replayed, or revised field/action must be observable without exposing secrets.

## 3. Deterministic-first interpretation

### 3.1 Principle

A signal should avoid AI whenever side + symbol are deterministically clear and every supplied field can be assigned a safe semantic role.

A signal may be incomplete and still be `READY`.

Missing TP or missing SL must not force AI merely because the canonical intent is incomplete.

Examples that should be deterministic when otherwise unambiguous:

- `BUY XAUUSD`
- `XAUUSD BUY`
- `Gold buy now`
- `SELL XAUUSD CMP`
- `BUY EURUSD 1.1820`
- `SELL XAUUSD ENTRY 4275`
- `XAUUSD SELL ENTRY 4273.25-4279.76`
- `SELL GOLD 4273-4279`
- `BUY XAUUSD SL 4250`
- `BUY XAUUSD ENTRY 4275 SL 4250`
- `SELL XAUUSD ENTRY 4275 SL 4300`
- entry + SL without TP
- entry + TP without SL
- market/CMP + SL/TP
- one TP or many TPs
- `TP 4300`, `TP1 4300`, `TP2: 4310`, `TP 4300 4310 4320`
- fields in different order
- `LONG` / `SHORT`
- common field separators and line breaks
- `Entry`, `Entry Price`, `Entry Zone`
- `SL`, `S/L`, `Stop Loss`
- `TP`, `T/P`, `Take Profit`
- `CMP`, `C.M.P`, `current market price`, `market price`, `at market`, `now`
- supported symbol aliases
- supported Deriv shorthand including `V75 SELL NOW`
- harmless emojis/punctuation around otherwise clear commands
- branded/footer text that does not create semantic ambiguity

### 3.2 Interpretation versus validation

Interpretation answers: what did the sender mean?

Validation answers: is every requested executable field valid now for this route/account/broker state?

These must remain separate.

Example:

`xauusd sell\nentry 4273.25-4279.76\nsl 4180`

This is deterministically understood as a SELL XAUUSD range-entry signal with SL 4180. It should not become `NEEDS_REVIEW` merely because the SL is invalid for the SELL geometry.

The invalid SL belongs to validation/policy, not interpretation.

### 3.3 AI boundary

AI remains fallback only for genuine ambiguity or rough natural language, such as:

- unclear or missing instrument where it cannot be safely inferred;
- contradictory BUY and SELL commands;
- conditional or speculative wording (`buy if`, `maybe sell`, `wait`, `watch`, etc.);
- numbers whose roles cannot be safely assigned;
- narrative analysis with no clear execution command;
- ambiguous management correlation;
- rough natural-language updates that deterministic recovery cannot safely canonicalize.

If AI succeeds, its output still passes deterministic validation.

## 4. Field-level validation and partial protective acceptance

### 4.1 Policy

Introduce an explicit persisted protection-validation policy. Suggested canonical shape:

```json
{
  "invalidProtectionPolicy": "reject_trade|skip_invalid",
  "allowInvalidStopLossSkip": false,
  "allowInvalidTakeProfitSkip": false,
  "applySourceEditsToActiveTrades": true
}
```

Exact storage location should follow the existing account/workspace safety-policy pattern and avoid unnecessary schema expansion if a persisted JSON policy already owns this domain.

Defaults for backward compatibility:

- `invalidProtectionPolicy = reject_trade`
- invalid SL skip = false
- invalid TP skip = false
- apply source edits to active trades = true for newly configured behavior only if compatible with existing lifecycle semantics; existing stored customers must not be silently changed without an explicit migration/default decision.

For the Starpips DEMO workspace, `skip_invalid` may be explicitly enabled only during controlled DEMO acceptance after the code path is verified and LIVE remains off.

### 4.2 Allowed partial acceptance

When policy allows `skip_invalid`, invalid optional protective components may be omitted while the valid trade components continue.

Examples:

- valid SELL + valid entry + invalid SL -> open without SL, journal skipped SL;
- valid SELL + valid SL + TP1 valid + TP2 invalid -> open/apply valid items, skip only TP2;
- valid market signal + invalid TP only -> open without invalid TP when policy permits.

Skipped fields must never be silently discarded. Persist a reason such as:

- `SL_SKIPPED_INVALID_GEOMETRY`
- `TP_SKIPPED_INVALID_GEOMETRY`
- `TP2_SKIPPED_INVALID_GEOMETRY`

### 4.3 What remains whole-trade fail-closed

Partial protective acceptance must never weaken these failures:

- unknown or ambiguous symbol;
- contradictory side;
- unsupported instrument for the actual destination account catalog;
- invalid/unauthorized lot or risk;
- unauthorized source/route/destination/account;
- global/workspace/account execution disabled;
- any LIVE gate failure;
- ambiguous/impossible entry semantics;
- unsafe pending-order semantics;
- uncertain management correlation;
- broker/account authority mismatch.

## 5. Revisions: edited Telegram messages

### 5.1 Identity

Telegram Bot API already supplies `edited_message` / `edited_channel_post` while preserving `chat_id:message_id`.

That native identity must represent one logical source message lineage, not multiple unrelated trades.

### 5.2 Revision model

Add explicit revision semantics around the existing stable native identity.

Conceptually:

- revision 0 = first accepted source version;
- revision 1+ = later Telegram edits of the same native message.

The persisted event/audit model may use a revision counter, content hash, prior snapshot, relation metadata, or a dedicated event-revision table. Implementation should prefer the smallest schema that preserves:

- every received version for audit;
- one logical source identity;
- no duplicate OPEN;
- deterministic semantic diff;
- safe retry/replay behavior.

### 5.3 Semantic diff

An edited source message is reinterpreted canonically and compared against the materialized logical trade.

Only meaningful changes produce management actions.

Example:

Original:

```text
BUY GOLD
ENTRY 4300
SL 4270
TP 4350
```

Edited:

```text
BUY GOLD
ENTRY 4300
SL 4280
TP 4370
```

Semantic diff:

- update SL -> 4280
- update TP1 -> 4370
- no new OPEN

Formatting-only edits, spelling cleanup, footer changes, or semantically equivalent edits produce no broker action.

### 5.4 Edited invalid -> corrected protection

A trade may initially execute with an invalid protection field skipped when policy permits.

If the original Telegram message is later edited with a valid corrected field, the edit should apply the protection to the existing position group.

Example:

1. `SELL XAUUSD ENTRY 4273-4279 SL 4180`
2. policy skips invalid SL and opens valid trade components;
3. sender edits same message to `SL 4380`;
4. system applies `UPDATE_SL 4380` to the existing group;
5. no duplicate OPEN.

## 6. Replies and same-context management

### 6.1 Correlation priority remains conservative

Preserve and extend the existing hierarchy:

1. exact reply target;
2. edit lineage / exact original native message identity;
3. explicit thread/relation target;
4. strong symbol + source + recent active-group context;
5. guarded unique/recent fallback only when unambiguous.

A weaker context heuristic must never override a stronger explicit reply/edit relation.

### 6.2 Supported deterministic management forms

Expand deterministic management coverage for clear commands including:

- `SL 4280`
- `NEW SL 4280`
- `UPDATE SL 4280`
- `CHANGE SL TO 4280`
- `MOVE SL 4280`
- `SL TO 4280`
- `STOP LOSS 4280`
- `TP 4350`
- `TP1 4350`
- `UPDATE TP1 4350`
- `NEW TP 4350`
- `CHANGE TP2 TO 4400`
- `REMOVE TP2`
- `CANCEL TP2`
- `REMOVE SL`
- `SL AT BE`
- `MOVE SL BE`
- `BREAKEVEN`
- `CLOSE HALF`
- `CLOSE 25%`
- `CLOSE 0.01`
- `CLOSE GOLD`
- `CLOSE ALL`
- `CANCEL PENDING`
- `DELETE PENDING`

Exact supported variants should be regression-driven and must distinguish informational text from commands.

### 6.3 No explicit reply but within context

The existing guarded context behavior remains supported.

A management message that is not an explicit Telegram reply may still correlate when there is exactly one strong safe candidate within the same authorized source/feed/thread/context window.

Examples:

- original signal, followed shortly by `SL 4380` in the same source feed;
- original signal, followed by `TP1 4300` while exactly one compatible active group is in scope;
- fast signal, followed by full signal completion.

If more than one candidate is plausible, fail closed to review/no-action rather than guess.

## 7. Telegram destination lineage preservation

### 7.1 General rule

Destination formatting and source lineage are separate concerns.

`none`, `clean`, `template`, and `ai_then_fallback` may alter destination presentation according to their existing contracts, but must preserve reply/edit lineage.

### 7.2 Replies at Telegram destinations

Existing source reply -> destination reply mapping remains authoritative.

When a source message replies to a prior source message:

1. resolve the parent source event;
2. resolve the successful destination delivery mapping for the same Telegram destination;
3. send the new destination message as a Telegram reply to the mapped destination message;
4. formatting mode may change text, but not thread identity;
5. failure to resolve the parent must not silently send an unrelated standalone message when the contract requires a reply.

### 7.3 Edits at Telegram destinations

Add edit support to Telegram destination delivery.

When a source message is edited and the corresponding destination message was previously delivered successfully:

- update that destination message using Telegram edit semantics when Telegram allows it;
- do not send a second standalone destination message merely because the source was edited;
- preserve the original destination message ID mapping;
- preserve formatting mode semantics on the revised content;
- exact/raw mode edits must use the revised exact source text/entities where Telegram permits entities on edit;
- clean/template/AI modes should regenerate presentation from the revised canonical/source content while preserving the same destination message identity.

If Telegram refuses an edit because of platform constraints:

- record a distinct terminal/retryable delivery diagnostic;
- do not convert that destination failure into a broker resend;
- do not silently post a duplicate replacement unless an explicit future fallback policy is designed and enabled.

### 7.4 Formatting-mode independence

A reply or edit remains structurally a reply/edit in every formatting mode.

Presentation AI is never allowed to decide lineage.

## 8. Event, idempotency, and state requirements

### 8.1 Stable source identity

Stable source-native identity remains the replay key foundation.

For Telegram, `chat_id:message_id` remains the logical source-message identity.

Revision-aware processing must distinguish:

- exact replay of an already-seen revision -> no action;
- a new content revision of the same logical message -> semantic diff processing;
- a reply/new message -> new event linked to its parent.

### 8.2 Broker idempotency

A revision may create management actions, but never a second OPEN for an already-open logical group unless the source semantics explicitly and unambiguously represent a genuinely new trade.

Broker-facing idempotency keys must include enough action/revision identity to retry the same management action safely without colliding with the original OPEN or duplicating a different management action.

## 9. Operations and diagnostics

The normalized operations journal must expose this lifecycle clearly.

Examples:

```text
Signal received
Deterministic parser: READY
Trade opened
SL 4180 rejected: invalid SELL geometry
SL skipped by workspace policy
Telegram source message edited
Revision diff: SL 4180 -> 4380
SL 4380 validated
cTrader position modified successfully
MT5 position modified successfully
Telegram destination message edited successfully
```

Journal requirements:

- workspace scoped;
- source event + logical message identity + revision;
- canonical parser/AI source;
- field-level validation outcomes;
- route selection/skips;
- broker action/result/reconciliation;
- Telegram send/reply/edit result;
- replay/idempotency outcome;
- connector/recovery outcome;
- sanitized provider diagnostics only;
- no plaintext credentials, internal secrets, stack traces, or cross-tenant data in customer Operations.

Admin may expose richer internal context without plaintext credentials.

## 10. Compatibility and rollout

### 10.1 Backward compatibility

Existing customers must keep current strict invalid-protection behavior unless the chosen persisted default/migration explicitly preserves equivalent semantics.

The safest rollout is:

- existing workspaces/accounts: strict reject behavior;
- new policy control exposed in settings;
- Starpips DEMO: explicitly enable skip-invalid for controlled testing only;
- no LIVE behavior change.

### 10.2 No scattering

Implementation should extend existing modules and contracts rather than introduce parallel trading pipelines.

Prefer shared canonical helpers for:

- deterministic signal parsing;
- protection validation classification;
- revision diff;
- management correlation;
- Telegram delivery operation selection (`send`, `reply`, `edit`).

Do not duplicate Telegram-specific trading semantics across source and destination adapters.

## 11. Test plan

Use test-driven development.

### 11.1 Deterministic parser regressions

Add tests proving AI is not required for:

- entry + SL, no TP;
- entry + TP, no SL;
- market + SL;
- market + TP;
- range entry;
- field-order variations;
- aliases and common punctuation;
- `V75 index Sell Now!!!` and supported synthetic variants;
- missing optional fields remain `READY` + `incomplete` rather than `NEEDS_REVIEW`.

Production reproduction:

`xauusd sell\nentry 4273.25-4279.76\nsl 4380`

must become deterministic `READY` without AI.

### 11.2 Invalid protection regressions

- same clear signal with SELL SL 4180 is parsed deterministically;
- strict policy rejects execution safely;
- skip policy opens only valid components and journals skipped SL;
- invalid one-of-many TP skips only that TP when policy allows;
- invalid entry/risk/auth remains whole-trade fail closed.

### 11.3 Revision regressions

- Telegram edit changes SL only -> one management action, no OPEN;
- edit changes TP only -> one management action, no OPEN;
- edit changes SL + TP -> expected management diff;
- formatting-only edit -> no broker action;
- replay same edit revision -> no duplicate management;
- skipped invalid SL corrected by edit -> apply corrected SL to same group;
- edit cannot escape source/feed/route/account authorization.

### 11.4 Reply/context regressions

- explicit reply remains strongest correlation;
- reply management still works after parser/revision changes;
- no-reply same-context management works only with one strong candidate;
- ambiguous context fails closed;
- fast -> full follow-up remains same group, no duplicate OPEN;
- existing BE and informational-BE distinction remains intact.

### 11.5 Telegram destination regressions

For all four formatting modes:

- ordinary source message -> ordinary destination message;
- source reply -> destination reply to mapped destination parent;
- source edit -> edit corresponding destination message, not a new post;
- reply to edited source lineage stays mapped correctly;
- raw mode exact text/entities remain exact where supported;
- template/AI mode formatting does not alter thread/edit lineage;
- Telegram edit rejection is isolated and journaled;
- journal persistence failure after successful Telegram operation must not trigger duplicate send/edit.

### 11.6 Full non-regression

Run focused and full Worker/trading CI plus existing MT5/MTProto/frontend suites required by repository authority.

Re-run controlled real DEMO acceptance for parser, broker, reply, edit, context, Telegram destination lineage, replay, management, connector recovery, and final zero-LIVE verification.

## 12. Documentation authority

During implementation and before handoff/merge:

- update root `AGENTS.md` with final invariants and operator semantics;
- update `CURRENT_HANDOFF.md` with exact branch/commit/CI/DEMO state;
- update the active AI/observability handoff to reference this lifecycle work;
- preserve historical evidence rather than rewriting old acceptance claims;
- record unresolved items explicitly.

## 13. Definition of done

This work is not done until all of the following are true:

1. clear incomplete signals do not require AI;
2. AI remains available for genuinely rough/ambiguous signals;
3. invalid optional SL/TP handling is policy-controlled and backward-compatible;
4. edits modify the same logical trade and never duplicate OPEN;
5. replies and safe no-reply context correlation remain intact;
6. Telegram destination replies and edits preserve source lineage in every formatting mode;
7. all actions/skips/failures are observable and sanitized;
8. broker/destination isolation and persistence/reconciliation invariants remain intact;
9. focused and full CI pass on the exact reviewed head;
10. controlled real DEMO evidence is collected;
11. global/workspace/account LIVE execution remains off;
12. `AGENTS.md` and handoff documents reflect the exact final state.
