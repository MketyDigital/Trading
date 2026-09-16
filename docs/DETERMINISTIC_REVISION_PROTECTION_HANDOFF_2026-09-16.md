# Deterministic Revision + Protection Handoff — 2026-09-16

Branch: `fix/ai-operations-observability-continuation`
Design commit: `c4ad7fe9588d01ff345d71e316cc5f83597de2e7`
Draft PR: `#101`

## Latest implementation checkpoint — 2026-09-16

Verified work now completed on the continuation branch:

- deterministic incomplete-signal regression was reproduced RED on Trading V1 CI `#2832`;
- explicit incomplete signals now remain deterministic instead of escalating to AI merely because SL or TP is missing;
- prose/ambiguous recovery remains guarded rather than accepting every incomplete machine plan;
- `V75 index Sell Now!!!` and equivalent supported Deriv short-index phrasing normalize deterministically;
- Trading V1 CI `#2835` passed all Worker/trading-core, MT5 bridge and MTProto suites after the deterministic-first fix;
- canonical field-level invalid-protection policy is implemented in `src/execution/protection_validation_policy.js`;
- backward-compatible default remains `reject_trade`;
- explicit `skip_invalid` can omit invalid SL/TP components only when corresponding per-field allow flags are enabled;
- risk-based sizing still blocks when an invalid SL would remove the stop required for risk calculation;
- Telegram Bot edits preserve stable `chat_id:message_id` identity and explicit edit lineage;
- revision hashing produces the same key for exact edit replay and a different key for changed edited content;
- deterministic management parsing now covers explicit SL/TP update/remove and partial-close variants while conditional/negated text remains fail-closed;
- source replies and guarded no-reply context correlation remain intact;
- Telegram destination `editMessageText` support is implemented, preserving destination message identity and native entities when available;
- source edit with unresolved destination mapping fails isolated and never falls back to a duplicate standalone send;
- Trading V1 CI `#2869` passed Worker/trading-core, MT5 bridge and MTProto suites for Telegram destination edit lineage;
- compatibility shim `src/pipeline/protection_validation_policy.js` intentionally delegates semantic authority to pre-planning execution protection policy and must not become a second geometry authority.

Active RED checkpoint:

- `cloudflare-v2/tests/production_missing_fill_price.test.mjs` was added at commit `7cf77e97dd91f0c127068c4c30d1885385334a05` to prove a broker success with `fillPrice: null` must not be materialized/audited as price `0` through JavaScript `Number(null)` coercion;
- Trading V1 CI `#2870` is the RED verification run for that regression at the time of this checkpoint;
- do not mark the fill-price durability defect fixed until the RED failure is observed, the minimal implementation is applied, and exact-head CI is green.

Still pending before completion:

1. finish null-fill/close-state durability hardening and regression verification;
2. finish semantic edit diff -> broker management lifecycle, including corrected skipped protection on the same group with no duplicate OPEN;
3. verify reply/edit/context management across both cTrader and MT5 paths;
4. integrate normalized Operations/Admin journal visibility for revisions, skipped fields and edit/reply delivery outcomes;
5. continue DB-authoritative AI provider/health/diagnostic Tasks 3–7 from the prior AI observability handoff;
6. run focused and full CI on exact final head;
7. run controlled real DEMO acceptance with fresh runtime/account/route checks and zero-LIVE audit;
8. update root `AGENTS.md`, `CURRENT_HANDOFF.md`, and this handoff with exact final commit/CI/DEMO evidence before considering merge/release.

Read in this order:

1. root `AGENTS.md`
2. `CURRENT_HANDOFF.md`
3. `docs/CMP_TELEGRAM_AI_OBSERVABILITY_HANDOFF_2026-09-16.md`
4. `docs/superpowers/specs/2026-09-16-deterministic-revisions-protection-and-telegram-lineage-design.md`

## Newly approved authority

The owner approved deterministic-first parsing and lifecycle expansion with backward compatibility as the priority.

### Deterministic signals

Clear signals must not require AI merely because optional fields are missing.

Production regression to fix:

```text
xauusd sell
entry 4273.25-4279.76
sl 4380
```

This persisted as `NEEDS_REVIEW` after AI failure even though the machine parser can identify SELL, XAUUSD, entry range and SL. Root cause was the interpreter path re-escalating incomplete deterministic intents unless they were fast-entry commands.

Corrected behavior is deterministic `READY` with `incomplete=true` when appropriate, while prose/ambiguous cases still use guarded recovery/AI/fallback rather than blindly accepting incomplete machine output.

A syntactically clear signal with invalid geometry such as SELL + SL below entry must still be understood deterministically; geometry belongs to validation/policy, not interpretation.

### Invalid SL/TP policy

Backward-compatible policy-controlled partial protective acceptance is approved and implemented at canonical pre-planning execution validation.

Default existing behavior remains strict rejection.

When `skip_invalid` is explicitly enabled, invalid optional SL/TP values may be skipped while valid trade components proceed. Every skipped field must be journaled with a specific reason. This policy must never relax symbol, side, entry, lot/risk, authorization, route/account, broker-capability or LIVE gates.

### Telegram edits

Telegram Bot API ingress receives `edited_message` and `edited_channel_post` using stable `chat_id:message_id` identity. Edits are revisions of one logical source message.

An edit must semantic-diff against the materialized logical trade and produce management actions only for changed trade fields. It must never create an accidental duplicate OPEN.

Formatting-only edits produce no broker action.

An invalid SL/TP skipped initially may be corrected by editing the source message; the corrected field should then be applied to the same position group when valid and authorized.

### Replies and context

Existing reply/thread behavior must remain intact.

Correlation priority:

1. exact reply target;
2. exact edit/original-message lineage;
3. explicit thread/relation target;
4. strong symbol + source + recent active-group context;
5. guarded unique/recent fallback only when unambiguous.

No-reply management within context remains supported when there is exactly one strong safe candidate. Ambiguous context must fail closed.

Broaden deterministic management forms for explicit SL/TP update/remove, BE, partial/full close, and pending cancellation variants as specified in the design document.

### Telegram destination lineage

Reply/edit lineage must survive all destination formatting modes:

- `none`
- `clean`
- `template`
- `ai_then_fallback`

Formatting changes presentation only.

Source reply -> destination reply to the corresponding mapped destination parent.

Source edit -> edit the already-sent corresponding destination message using Telegram edit semantics when allowed. Do not post a duplicate standalone message merely because the source was edited.

A Telegram edit/send/reply failure must remain isolated from broker destinations and must never cause broker resend.

## Existing code facts confirmed during investigation

- `cloudflare-v2/src/http/telegram_bot_webhook.js` accepts message, edited_message, channel_post and edited_channel_post.
- Telegram Bot ingress preserves stable native identity `chat_id:message_id`.
- `cloudflare-v2/src/events/trading_event.js` canonicalizes reply identity into `thread.reply_to_event_id`.
- `cloudflare-v2/src/events/source_revision.js` now provides deterministic edit revision hashing.
- `cloudflare-v2/src/destinations/v1_destination_delivery_acceptance.js` maps source parent event -> prior successful destination Telegram message ID for replies and edits.
- `cloudflare-v2/src/destinations/telegram_destination.js` implements `sendMessage` and `editMessageText` with sanitized failure diagnostics.
- Destination delivery journaling records successful Telegram message IDs and sanitized rejection details.

## Safety

Do not enable LIVE.

Before any controlled real DEMO tests, re-query runtime controls, workspace entitlements, source/feed routes, destination state and trade-account execution flags.

Final acceptance must include a fresh zero-LIVE audit.

## Implementation sequence

Use TDD.

1. regression tests for incomplete deterministic signals — implemented/green;
2. fix interpreter acceptance of safely incomplete deterministic intent — implemented/green;
3. regression/implementation for broader deterministic management syntax — implemented; retain non-regression coverage;
4. field-level SL/TP validation classification + persisted policy — core implementation present; UI/persistence exposure and operations visibility still require final audit;
5. revision-aware source event/idempotency model — source revision identity present; lifecycle application still requires final verification;
6. semantic revision diff -> management lifecycle — pending final integration/verification;
7. Telegram destination edit operation preserving message mapping and formatting mode — implemented/green in CI #2869;
8. reply/context non-regression — existing correlator behavior retained; full acceptance still pending;
9. operations journal integration — pending;
10. continue AI provider/observability Tasks 3–7 from the prior handoff — pending;
11. focused/full CI — ongoing after each TDD checkpoint;
12. controlled real DEMO acceptance — pending;
13. update root `AGENTS.md`, `CURRENT_HANDOFF.md`, and active handoffs with exact final commit/CI/evidence — pending final verified state.
