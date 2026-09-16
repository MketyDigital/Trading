# Deterministic Revision + Protection Handoff — 2026-09-16

Branch: `fix/ai-operations-observability-continuation`
Design commit: `c4ad7fe9588d01ff345d71e316cc5f83597de2e7`
Draft PR: `#101`

## Latest implementation checkpoint — 2026-09-16

Exact verified branch head for this checkpoint: `1c268972bc47595b08669a6e65b7d7e1606fe950`.
Trading V1 CI `#2901` passed Worker/trading-core, MT5 bridge and MTProto suites on that exact head.

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
- Telegram Bot source policy now accepts the canonical `allowed_chat_ids` allowlist as well as legacy `chat_ids`, without weakening authorization;
- Telegram Bot edits preserve stable source message identity and exact edit lineage;
- source edit revisions are persisted append-only in `trading_event_revisions` via migration `0039_trading_event_revisions.sql`;
- revision hashing produces the same key for exact edit replay and a different key for changed edited content;
- changed edits are interpreted from the incoming edited event, while exact revision replay returns the persisted revision and remains duplicate/no-resend;
- exact edit/original-message correlation resolves to the existing logical trade before ordinary duplicate replay suppression;
- semantic source edit diff supports changed SL/TP as `MODIFY_POSITION` only, never `OPEN_POSITION`;
- formatting-only/no-semantic-change edits produce no broker action;
- omission of SL/TP in edited signal text is not treated as destructive removal;
- edits that change trade identity/structure fail closed for review rather than mutating/opening another trade;
- edit management fans across broker-bound groups for the same logical cohort while preserving each broker position identity;
- broker idempotency for revisions uses `metadata.source_revision_key`, so different edits of one Telegram message produce distinct broker action keys while retrying the same revision remains stable;
- deterministic management parsing covers explicit SL/TP update/remove and partial-close variants while conditional/negated text remains fail-closed;
- source replies and guarded no-reply context correlation remain intact;
- Telegram destination `editMessageText` support is implemented, preserving destination message identity and native entities when available;
- source edit with unresolved destination mapping fails isolated and never falls back to a duplicate standalone send;
- Trading V1 CI `#2869` passed Worker/trading-core, MT5 bridge and MTProto suites for Telegram destination edit lineage;
- missing broker `fillPrice` no longer becomes `0` through `Number(null)` coercion in the production coordinator; the RED regression was CI `#2870` and the fixed path was green on CI `#2872`;
- full-close state regression coverage confirms status `CLOSED`, remaining lots `0`, `closedAt` populated, and original opening broker identity/fill retained;
- compatibility shim `src/pipeline/protection_validation_policy.js` intentionally leaves semantic authority to pre-planning execution protection policy and must not become a second geometry authority.

### AI provider authority + diagnostics checkpoint

Task 3 from `docs/superpowers/plans/2026-09-16-cmp-telegram-ai-observability-stabilization.md` is now implemented and green on the continuation branch.

Verified provider/runtime behavior:

- first-class provider transports exist for `openai`, `azure_openai`, `gemini`, `vertex_ai`, `cloudflare_ai`/`workers_ai`, and `aws_bedrock`;
- OpenAI uses the Responses API path;
- Azure OpenAI uses the configured Azure v1 Responses endpoint with `api-key` authentication;
- Gemini sends the API key in `x-goog-api-key`, not in the request URL;
- Vertex AI uses DB-backed project/location config and OAuth bearer credential material;
- Cloudflare AI requires persisted provider account ID and no longer falls back to `CLOUDFLARE_ACCOUNT_ID` from runtime environment;
- AWS Bedrock uses regional Converse requests with deterministic SigV4 signing and encrypted credential material resolved at runtime;
- migration `0040_ai_provider_authority.sql` adds `provider_config`, removes the legacy plaintext `api_key NOT NULL` requirement, and reconciles provider-name constraints;
- new admin provider writes encrypt credentials into `api_key_ciphertext`; plaintext columns remain compatibility-read only;
- provider-specific non-secret config is whitelisted before persistence/public output (`vertex_ai`: project/location; `aws_bedrock`: region);
- per-attempt AI diagnostics now preserve provider ID/type/model, outcome, latency, HTTP status when actually present, provider code, retryability, error class, and sanitized message;
- raw provider response bodies, authorization values and configured credentials are not returned as diagnostics;
- missing HTTP status stays absent rather than being coerced to `0` through `Number(null)`;
- `POST /api/v1/admin/ai-providers/:id/test` is workspace-scoped, reuses provider authority, persists only a sanitized health diagnostic, and never returns stored credential material;
- migration `0041_ai_provider_health.sql` adds the durable latest-health fields;
- CI `#2889` proved the provider contract regressions RED;
- CI `#2891` proved the first-class provider transports green;
- CI `#2892` proved admin/schema provider authority RED;
- CI `#2894` proved admin/schema authority green;
- CI `#2895` proved normalized provider diagnostics RED;
- CI `#2896` proved normalized provider diagnostics green;
- CI `#2897` proved the nullable HTTP-status regression RED;
- CI `#2901` passed Worker/trading-core, MT5 bridge and MTProto suites on the combined provider authority/diagnostic/health head.

These are branch-verified capabilities only. They are not production authority until reviewed/merged/deployed from `main` and accepted under the normal safety process.

Still pending before completion:

1. integrate the normalized append-only Operations journal as evidence only; it must not replace `destination_deliveries`, broker state, source idempotency, or any resend/retry authority;
2. expose customer Operations through workspace-safe serializers and Mkety Admin through site-wide sanitized diagnostics without plaintext secrets;
3. verify reply/edit/context management through controlled real DEMO cTrader and MT5 acceptance after fresh authority checks;
4. run focused and full CI on each exact final head;
5. run controlled real DEMO acceptance with fresh runtime/account/route checks and zero-LIVE audit;
6. update root `AGENTS.md`, `CURRENT_HANDOFF.md`, and this handoff with exact final commit/CI/DEMO evidence before considering merge/release.

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

Telegram Bot API ingress receives `edited_message` and `edited_channel_post` using stable source-message identity. Edits are revisions of one logical source message.

A changed edit is append-only persisted as a revision, semantic-diffed against the materialized logical trade, and may produce management actions only for changed supported trade fields. It must never create an accidental duplicate OPEN.

Formatting-only edits produce no broker action. Exact replay of one revision remains idempotent. A later changed revision gets a distinct broker action identity.

An invalid SL/TP skipped initially may be corrected by editing the source message; the corrected field can then be applied to the same position group when valid and authorized.

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

- `cloudflare-v2/src/http/telegram_bot_webhook.js` accepts message, edited_message, channel_post and edited_channel_post and preserves exact original-message edit lineage.
- `cloudflare-v2/src/events/trading_event.js` canonicalizes Telegram reply/edit identities.
- `cloudflare-v2/src/events/source_revision.js` provides deterministic edit revision hashing.
- `cloudflare-v2/src/storage/supabase_ingest_store.js` reserves and persists append-only revisions and revision interpretations.
- `cloudflare-v2/src/pipeline/ingest.js` distinguishes changed edit revision from exact revision replay without weakening normal source idempotency.
- `cloudflare-v2/src/correlation/trade_correlator.js` resolves edit lineage before ordinary duplicate suppression.
- `cloudflare-v2/src/execution/source_edit_management.js` produces supported semantic edit management and cannot create broker OPEN actions.
- `cloudflare-v2/src/pipeline/v1_orchestrator.js` applies edit management to the matched durable group/cohort.
- `cloudflare-v2/src/pipeline/v1_execution_stage.js` uses source revision identity for broker action idempotency on revisions while retaining existing identity for normal events.
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
3. regression/implementation for broader deterministic management syntax — implemented/green;
4. field-level SL/TP validation classification + persisted policy — core execution implementation green; operations/UI exposure still pending;
5. revision-aware source event/idempotency model — implemented/green through CI `#2887`;
6. semantic revision diff -> management lifecycle — implemented/green through CI `#2887`;
7. Telegram destination edit operation preserving message mapping and formatting mode — implemented/green in CI `#2869` and retained through CI `#2901`;
8. reply/context non-regression — covered in automated suites; controlled DEMO acceptance still pending;
9. AI provider authority/transports/diagnostics/health — implemented/green through CI `#2901`;
10. normalized Operations journal integration — next active scope;
11. customer Operations + Mkety Admin serializers/views — pending;
12. focused/full CI — continue after each TDD checkpoint;
13. controlled real DEMO acceptance — pending;
14. final root `AGENTS.md`, `CURRENT_HANDOFF.md`, and active handoff update with exact final CI/DEMO evidence — pending final verified state.
