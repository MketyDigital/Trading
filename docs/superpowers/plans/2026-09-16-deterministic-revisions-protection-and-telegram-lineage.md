# Deterministic Revisions, Protection, and Telegram Lineage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make clear incomplete signals deterministic without AI, add policy-controlled invalid SL/TP skipping, make Telegram edits/replies/context follow-ups update the same durable trade, and preserve reply/edit lineage at Telegram destinations without duplicate broker actions.

**Architecture:** Extend the existing canonical parser/lifecycle/destination pipeline rather than creating a parallel path. Interpretation stays separate from validation; revision processing reuses stable Telegram native identity and durable position-group correlation; Telegram destination delivery selects send/reply/edit independently of formatting mode.

**Tech Stack:** Cloudflare Worker JavaScript, Node test runner, Supabase/Postgres persistence, Telegram Bot API, existing cTrader/MT5 execution abstractions.

**Spec:** `docs/superpowers/specs/2026-09-16-deterministic-revisions-protection-and-telegram-lineage-design.md`

## Global Constraints

- LIVE execution remains disabled throughout implementation and acceptance.
- AI is never trading authority.
- Missing optional SL/TP fields are not interpretation ambiguity.
- Existing fast-entry, reply/thread/context, routing, destination isolation, cTrader, MT5, replay/reconciliation, and exact-forwarding behavior must not regress.
- Existing customers retain strict invalid-protection behavior by default.
- Telegram formatting modes may change presentation only; reply/edit lineage must remain intact.
- Broker success followed by persistence failure is repair-only; never resend without reconciliation.
- Every skipped/applied/rejected/revised action must be observable without secrets.

---

### Task 1: Deterministic incomplete-signal acceptance

**Files:**
- Modify: `cloudflare-v2/src/ai/trading_interpreter.js`
- Modify as needed: `cloudflare-v2/src/pipeline/machine_plan.js`
- Test: existing interpreter/machine-plan tests plus a focused regression file if needed

**Interfaces:**
- Consumes: `buildMachinePlan(event)` returning `READY|MANAGEMENT|NO_ACTION|NEEDS_INTERPRETATION`.
- Produces: clear `READY` incomplete intents returned directly without requiring AI merely because SL or TP is absent.

- [ ] Add failing regressions for `xauusd sell\nentry 4273.25-4279.76\nsl 4380`, entry+TP/no-SL, market+SL, market+TP, field-order variants, and `V75 index Sell Now!!!`.
- [ ] Verify RED in CI/test runner: production SL-only reproduction must currently fall through toward AI/NEEDS_REVIEW.
- [ ] Change interpreter logic so deterministic `READY` remains authoritative when supplied fields are semantically assigned safely; keep fast-entry and relaxed recovery compatibility.
- [ ] Expand deterministic syntax only where regressions prove a safe unambiguous form is missing.
- [ ] Run focused parser/interpreter tests and existing reply/fast-signal regressions.
- [ ] Commit `fix: keep clear incomplete signals deterministic`.

### Task 2: Field-level protection validation policy

**Files:**
- Inspect/modify: `cloudflare-v2/src/pipeline/signal_intent_validator.js`
- Inspect/modify: broker planning/execution policy module owning `safety_policy`
- Add focused helper only if current validator becomes overloaded, e.g. `cloudflare-v2/src/pipeline/protection_validation_policy.js`
- Test: validator/planner/execution tests

**Interfaces:**
- Produces normalized classification for each protection field: valid, invalid-skippable, invalid-fatal.
- Reads persisted policy from existing safety-policy JSON; default remains strict reject.

- [ ] Add failing tests proving SELL SL 4180 is interpreted but rejected under strict policy; `skip_invalid` omits only invalid SL/TP while preserving valid components.
- [ ] Add tests for one invalid TP among multiple targets and for non-skippable failures (entry/risk/auth/symbol) remaining fatal.
- [ ] Implement policy normalization with backward-compatible defaults: `invalidProtectionPolicy='reject_trade'`, per-field skips false unless explicitly enabled.
- [ ] Implement field-level protection filtering before broker request construction; emit structured skip reasons such as `SL_SKIPPED_INVALID_GEOMETRY` and `TP2_SKIPPED_INVALID_GEOMETRY`.
- [ ] Verify no broker receives invalid protection fields and strict behavior is unchanged without explicit policy.
- [ ] Commit `feat: add policy-controlled invalid protection skipping`.

### Task 3: Revision-aware Telegram source events

**Files:**
- Modify: `cloudflare-v2/src/http/telegram_bot_webhook.js`
- Modify: `cloudflare-v2/src/events/trading_event.js`
- Inspect/modify: source event persistence/idempotency modules
- Add migration only if existing event metadata cannot safely preserve revision history
- Test: `cloudflare-v2/tests/telegram_bot_source_v1.test.mjs`, `trading_event.test.mjs`, lifecycle tests

**Interfaces:**
- Stable logical identity remains `telegram:<chat_id>:<message_id>`.
- Produces revision metadata/content hash that distinguishes exact replay from a new edit revision without creating a second logical OPEN.

- [ ] Add failing tests for original message, edited message same native identity, exact replay of same revision, and edit with changed content.
- [ ] Preserve update kind (`edited_message` / `edited_channel_post`) and source-native identity explicitly in canonical event metadata/thread relation.
- [ ] Implement revision-safe persistence/idempotency: same content revision -> no action; changed edit -> revision event/semantic processing linked to original logical message.
- [ ] Verify ordinary new replies/messages remain distinct events and source/feed authorization still gates edits.
- [ ] Commit `feat: model Telegram edits as source revisions`.

### Task 4: Semantic revision diff to management actions

**Files:**
- Create focused module: `cloudflare-v2/src/lifecycle/trade_revision_diff.js`
- Modify: lifecycle correlation/management planner modules handling durable position groups
- Test: new `trade_revision_diff` tests plus lifecycle integration tests

**Interfaces:**
- `diffTradeRevision(previousIntent, nextIntent)` returns deterministic management actions only for changed executable fields, never OPEN for an already-materialized logical trade.

- [ ] Add failing unit tests: SL-only edit, TP-only edit, SL+TP edit, formatting-only edit, invalid-skipped SL corrected by edit.
- [ ] Implement minimal semantic diff for protection changes first; do not infer unsafe entry/side/symbol rewrites on an already-open group.
- [ ] Integrate diff with durable position-group correlation using edit lineage before weaker context matching.
- [ ] Give revision management actions deterministic revision-aware idempotency keys.
- [ ] Verify replay of same revision cannot duplicate management.
- [ ] Commit `feat: apply safe trade revisions as management`.

### Task 5: Deterministic management language expansion and context non-regression

**Files:**
- Modify: `cloudflare-v2/src/pipeline/machine_plan.js`
- Modify only if required: management correlation/lifecycle modules
- Test: `reply_and_lifecycle_hardening.test.mjs` and focused parser tests

**Interfaces:**
- Expands existing `MANAGEMENT` output; correlation priority remains reply > edit lineage > explicit relation > strong same-context > guarded unique recent fallback.

- [ ] Add failing parser tests for `SL 4280`, `NEW/UPDATE/CHANGE/MOVE SL`, `TP/TP1`, `UPDATE/CHANGE TPn`, `REMOVE SL`, `REMOVE/CANCEL TPn`, `CLOSE 25%`, `CLOSE 0.01`, while preserving BE aliases and informational-BE no-action.
- [ ] Add lifecycle tests proving explicit replies remain strongest and no-reply management only resolves when one strong same-source/feed candidate exists.
- [ ] Implement only unambiguous deterministic variants; ambiguous context must fail closed.
- [ ] Run fast->full and existing reply/thread regressions to ensure no duplicate OPEN.
- [ ] Commit `feat: broaden deterministic management commands safely`.

### Task 6: Telegram destination edit lineage

**Files:**
- Modify: `cloudflare-v2/src/destinations/telegram_destination.js`
- Modify: `cloudflare-v2/src/destinations/v1_destination_delivery_acceptance.js`
- Modify presentation tests for all modes
- Test: Telegram destination/threading tests

**Interfaces:**
- Add a Telegram edit operation using persisted destination `messageId` mapping; reply mapping remains unchanged.
- Formatting mode determines rendered text/entities, never operation lineage.

- [ ] Add failing tests showing source edit maps to Telegram `editMessageText` on the original destination message ID for `none`, `clean`, `template`, and `ai_then_fallback` paths.
- [ ] Add tests proving source replies still use `reply_parameters` to the mapped parent after revision changes.
- [ ] Implement `editTelegramDestination(...)` with the same credential/error sanitization discipline as send.
- [ ] Extend delivery acceptance to resolve source revision lineage to the prior successful destination mapping and edit in place; do not silently send a replacement standalone message when edit resolution/API fails.
- [ ] Preserve exact revised text/native entities in `none` mode where Telegram permits; regenerate presentation for other modes without changing message identity.
- [ ] Persist sanitized send/reply/edit outcome with no broker retry coupling.
- [ ] Commit `feat: preserve Telegram destination edit lineage`.

### Task 7: Operations diagnostics for parse/protection/revision/lineage

**Files:**
- Reuse/extend existing `destination_deliveries` and operations journal modules from the AI observability plan
- Modify customer Operations serializer/API/UI only after normalized backend events exist
- Modify Mkety Admin diagnostics similarly
- Test backend serialization and tenant-scope/security behavior

**Interfaces:**
- Customer-safe operation records include parser source, protection skips, revision diff, broker management result, Telegram send/reply/edit result, and replay outcome.

- [ ] Add failing tests for sanitized operation records and workspace scoping.
- [ ] Persist/serialize field-level skip and revision events without raw secrets or stack traces.
- [ ] Surface actionable customer messages while retaining richer sanitized admin context.
- [ ] Verify one destination failure remains isolated and journaling failure never causes a broker/message resend.
- [ ] Commit `feat: expose revision and protection diagnostics`.

### Task 8: AI provider/observability continuation non-regression

**Files:**
- Continue approved Tasks 3-7 from `docs/superpowers/plans/2026-09-16-cmp-telegram-ai-observability-stabilization.md`
- `cloudflare-v2/src/ai/universal_ai.js`, `workspace_ai.js`, admin AI endpoints/tests as specified there

**Interfaces:**
- Deterministic parser runs before AI; provider failures are diagnosable but cannot turn a deterministically clear signal into review merely due missing optional fields.

- [ ] Implement first-class DB-authoritative provider adapters and sanitized health diagnostics per existing approved plan.
- [ ] Remove provider-specific environment fallback where the existing plan requires DB authority.
- [ ] Verify provider outages do not regress deterministic signals implemented in Task 1.
- [ ] Commit in provider-focused TDD slices.

### Task 9: Documentation, full CI, DEMO acceptance, and zero-LIVE audit

**Files:**
- Update: `AGENTS.md`
- Update: `CURRENT_HANDOFF.md`
- Update/create dated acceptance handoff/runbook evidence

**Interfaces:**
- Documentation becomes authority only for behavior verified by tests/DEMO evidence.

- [ ] Run focused tests for Tasks 1-8, then full Worker/trading CI, MT5 bridge/connector tests, MTProto tests, and relevant frontend tests.
- [ ] Re-query runtime controls/accounts immediately before controlled real DEMO tests; confirm global/workspace/account LIVE gates remain false.
- [ ] Execute DEMO matrix: SL-only signal, invalid protection strict/skip policy, edit correction, explicit reply management, no-reply unique-context management, ambiguous-context fail closed, Telegram reply fidelity, Telegram edit fidelity in each formatting mode, replay/no duplicate, fast->full, cTrader, MT5, reconnect/recovery.
- [ ] Verify historical durable close defect (`closed_at` and null `fill_price`) is fixed or add regression/fix before final signoff.
- [ ] Update `AGENTS.md` only with verified invariants and update `CURRENT_HANDOFF.md` with exact branch/head/CI/DEMO evidence and remaining gaps.
- [ ] Perform final fresh zero-LIVE audit and record exact results.
- [ ] Request code review before merge; merge/deploy only through reviewed `main` workflow.
