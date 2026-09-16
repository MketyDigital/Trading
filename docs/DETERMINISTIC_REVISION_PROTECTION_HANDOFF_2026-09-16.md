# Deterministic Revision + Protection Handoff — 2026-09-16

Branch: `fix/ai-operations-observability-continuation`
Design commit: `c4ad7fe9588d01ff345d71e316cc5f83597de2e7`
Implementation status: not started yet; design approved by owner

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

This currently persisted as `NEEDS_REVIEW` after AI failure even though the machine parser can identify SELL, XAUUSD, entry range and SL. Root cause is the interpreter path re-escalating incomplete deterministic intents unless they are fast-entry commands.

The corrected behavior is deterministic `READY` with `incomplete=true` when appropriate.

A syntactically clear signal with invalid geometry such as SELL + SL below entry must still be understood deterministically; geometry belongs to validation/policy, not interpretation.

### Invalid SL/TP policy

Add backward-compatible policy-controlled partial protective acceptance.

Default existing behavior remains strict rejection.

When `skip_invalid` is explicitly enabled, invalid optional SL/TP values may be skipped while valid trade components proceed. Every skipped field must be journaled with a specific reason. This policy must never relax symbol, side, entry, lot/risk, authorization, route/account, broker-capability or LIVE gates.

### Telegram edits

Telegram Bot API ingress already receives `edited_message` and `edited_channel_post` using stable `chat_id:message_id` identity. Treat edits as revisions of one logical source message.

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

Current destination adapter only sends new messages. Edit support is an additive implementation requirement.

A Telegram edit/send/reply failure must remain isolated from broker destinations and must never cause broker resend.

## Existing code facts confirmed during investigation

- `cloudflare-v2/src/http/telegram_bot_webhook.js` accepts message, edited_message, channel_post and edited_channel_post.
- Telegram Bot ingress preserves stable native identity `chat_id:message_id`.
- `cloudflare-v2/src/events/trading_event.js` canonicalizes reply identity into `thread.reply_to_event_id`.
- `cloudflare-v2/src/destinations/v1_destination_delivery_acceptance.js` already maps source parent event -> prior successful destination Telegram message ID for replies.
- `cloudflare-v2/src/destinations/telegram_destination.js` currently implements `sendMessage` with optional reply parameters but not `editMessageText`.
- Destination delivery journaling already records successful Telegram message IDs and sanitized rejection details.

## Safety

Do not enable LIVE.

Before any controlled real DEMO tests, re-query runtime controls, workspace entitlements, source/feed routes, destination state and trade-account execution flags.

Final acceptance must include a fresh zero-LIVE audit.

## Next implementation sequence

Use TDD.

1. regression tests for incomplete deterministic signals;
2. fix interpreter acceptance of safely incomplete deterministic intent;
3. regression/implementation for broader deterministic management syntax;
4. field-level SL/TP validation classification + persisted policy;
5. revision-aware source event/idempotency model;
6. semantic revision diff -> management lifecycle;
7. Telegram destination edit operation preserving message mapping and formatting mode;
8. reply/context non-regression;
9. operations journal integration;
10. continue AI provider/observability Tasks 3–7 from the prior handoff;
11. focused/full CI;
12. controlled real DEMO acceptance;
13. update root `AGENTS.md`, `CURRENT_HANDOFF.md`, and active handoffs with exact final commit/CI/evidence.
