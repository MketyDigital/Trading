# Deterministic Revisions, Protection, and Telegram Lineage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make clear incomplete signals deterministic without AI; add safe configurable invalid-SL/TP skipping; treat Telegram edits, replies, and strong same-context follow-ups as lifecycle management of the same logical trade; and preserve reply/edit lineage at Telegram destinations across all formatting modes.

**Architecture:** Extend the existing canonical parser/interpreter/lifecycle/destination pipeline instead of creating parallel flows. Interpretation decides semantic intent, validation classifies field validity, persisted policy decides whether invalid optional protection rejects or skips, revision-aware lifecycle code converts source edits into management diffs, and Telegram destination delivery chooses send/reply/edit using durable source-to-destination message mappings.

**Tech Stack:** Cloudflare Workers JavaScript, Node test runner, Supabase/Postgres persistence, Telegram Bot API, existing cTrader/MT5 adapters and lifecycle state.

**Spec:** `docs/superpowers/specs/2026-09-16-deterministic-revisions-protection-and-telegram-lineage-design.md`

## Global Constraints

- LIVE execution remains disabled; no task may enable global, workspace, account, or route LIVE authority.
- AI is never trading authority; all AI output still passes deterministic validation.
- Missing optional SL/TP fields are not ambiguity.
- Invalid optional SL/TP is a validation/policy outcome, not an interpretation failure.
- No edit/reply/follow-up/replay may create an accidental duplicate broker OPEN.
- Broker success followed by persistence failure remains repair-only; never resend without reconciliation.
- Existing fast-entry -> later-full-signal, reply correlation, BE management, destination isolation, cTrader, MT5, routing and exact Telegram forwarding must remain intact.
- Existing customers keep strict invalid-protection behavior by default.
- Starpips testing remains DEMO-only until full acceptance and fresh zero-LIVE verification.

---

### Task 1: Deterministic incomplete signals bypass AI

**Files:**
- Modify: `cloudflare-v2/src/ai/trading_interpreter.js`
- Test: `cloudflare-v2/tests/trading_interpreter.test.mjs`
- Test: `cloudflare-v2/tests/machine_plan.test.mjs`

**Interfaces:**
- Consumes: `buildMachinePlan(event)` returning `READY`, `MANAGEMENT`, `NO_ACTION`, or `NEEDS_INTERPRETATION`.
- Produces: `interpretTradingEvent()` returns deterministic `READY` for any safely parsed incomplete signal, preserving `intent.incomplete`, without invoking AI merely because SL or TP is absent.

- [ ] **Step 1: Write failing regressions**

Add interpreter tests using an AI router that throws if called:

```js
for (const text of [
  'xauusd sell\n\nentry 4273.25-4279.76\nsl 4380',
  'BUY XAUUSD ENTRY 4275 TP 4300',
  'SELL XAUUSD SL 4300',
  'BUY XAUUSD TP 4350',
  'V75 index Sell Now!!! 😡😡😡',
]) {
  const result = await interpretTradingEvent({ text }, { aiRouter: { processSignal: async () => { throw new Error('AI must not run'); } } });
  assert.equal(result.status, 'READY', text);
  assert.equal(result.source, 'deterministic', text);
}
```

Also freeze machine-plan expectations for `incomplete === true` when an optional protective field is missing.

- [ ] **Step 2: Run focused CI/test command and confirm RED**

Run the repository's existing Worker/node focused test command for `machine_plan.test.mjs` and `trading_interpreter.test.mjs`. Expected failure: interpreter currently routes non-fast incomplete deterministic intents through recovery/AI.

- [ ] **Step 3: Make the minimal interpreter change**

Change the deterministic branch so any `READY` machine plan returns directly as deterministic. Do not special-case `fastEntry` as the only incomplete form allowed to bypass AI.

Canonical shape:

```js
if (deterministic.status !== 'NEEDS_INTERPRETATION') {
  return { ...deterministic, source: 'deterministic' };
}
```

Retain relaxed recovery only for genuine `NEEDS_INTERPRETATION` cases.

- [ ] **Step 4: Run focused tests and full Worker CI**

Expected: new regressions pass; existing AI ambiguity/fallback tests remain green.

- [ ] **Step 5: Commit**

Commit only Task 1 changes.

---

### Task 2: Expand deterministic management syntax without weakening correlation

**Files:**
- Modify: `cloudflare-v2/src/pipeline/machine_plan.js`
- Test: `cloudflare-v2/tests/machine_plan.test.mjs`
- Test: `cloudflare-v2/tests/reply_and_lifecycle_hardening.test.mjs`

**Interfaces:**
- Produces management actions including existing `MOVE_SL`, `MOVE_SL_TO_BE`, `CHANGE_TP`, `CLOSE_PARTIAL`, `CLOSE`, `CLOSE_ALL`, `CANCEL_PENDING` plus explicit `REMOVE_SL` and `REMOVE_TP`/target-index semantics if the downstream lifecycle already supports them; otherwise add only commands supported by existing management execution and leave unsupported destructive semantics fail-closed.

- [ ] **Step 1: Add RED tests for approved phrases**

Cover `SL 4280`, `NEW SL 4280`, `UPDATE SL 4280`, `CHANGE SL TO 4280`, `STOP LOSS 4280`, `TP 4350`, `TP1 4350`, `UPDATE TP1 4350`, `CHANGE TP2 TO 4400`, `CLOSE 25%`, `CLOSE GOLD`, plus negated/conditional/informational controls.

- [ ] **Step 2: Verify RED**

Expected: currently unsupported concise SL/TP management forms fail or fall to interpretation.

- [ ] **Step 3: Extend deterministic management parsing minimally**

Reuse `SIGNAL_NUMBER_SOURCE`, `withManagementSymbol`, `isConfidentExecutionInstruction`, and existing aliases. Do not create a second parser.

- [ ] **Step 4: Run parser + lifecycle regression tests**

Confirm existing `SL AT BE`, `STOPPED AT BE AFTER TP2`, reply behavior, target-hit handling and pending cancellation remain unchanged.

- [ ] **Step 5: Commit**

Commit Task 2 independently.

---

### Task 3: Field-level protection validation policy

**Files:**
- Inspect/modify existing validation and execution-policy modules under `cloudflare-v2/src/pipeline/` and `cloudflare-v2/src/execution/`.
- Prefer persisted JSON policy on the existing account/workspace safety-policy structure; add a migration only if no existing JSON policy can safely own the setting.
- Tests: focused validation/execution planning tests plus cTrader/MT5 planning non-regression tests.

**Interfaces:**
- Consumes canonical intent with entry, stopLoss, takeProfits.
- Produces `{ acceptedIntent, skippedProtection[] }` or equivalent internal result where skipped items include field/index and sanitized reason.
- Default remains strict reject.

- [ ] **Step 1: Locate the exact current geometry validation boundary and existing safety-policy reader.**
- [ ] **Step 2: Write RED tests for strict reject and opt-in skip behavior.**
- [ ] **Step 3: Implement per-field classification so optional invalid SL/TP can be removed only when policy explicitly permits.**
- [ ] **Step 4: Prove invalid entry/risk/auth/symbol/LIVE gates still reject the whole action.**
- [ ] **Step 5: Persist/journal skipped protection reasons without secrets.**
- [ ] **Step 6: Run focused and full Worker/broker-planning tests, then commit.**

---

### Task 4: Revision-aware Telegram source identity and durable audit

**Files:**
- Modify: `cloudflare-v2/src/http/telegram_bot_webhook.js`
- Modify: `cloudflare-v2/src/events/trading_event.js`
- Modify source-event persistence/idempotency code identified during implementation.
- Add migration only if revision history cannot be preserved in the existing event metadata/persistence safely.
- Tests: `cloudflare-v2/tests/telegram_bot_source_v1.test.mjs`, `trading_event.test.mjs`, revision-specific tests.

**Interfaces:**
- Stable logical identity: Telegram `chat_id:message_id`.
- Distinguish exact replay of the same content revision from a new edited content revision.
- Preserve `telegram_update_kind`, edit timestamp, content hash/revision metadata and prior lineage needed for audit.

- [ ] **Step 1: Add RED tests for original -> edited_message with same native identity but changed content.**
- [ ] **Step 2: Add RED replay test for duplicate delivery of the exact same edit.**
- [ ] **Step 3: Implement revision-aware persistence/idempotency without changing source authorization.**
- [ ] **Step 4: Verify original and revisions are auditable and cannot produce two OPENs.**
- [ ] **Step 5: Commit.**

---

### Task 5: Semantic revision diff -> management of the same durable group

**Files:**
- Modify existing lifecycle/correlation modules discovered from `reply_and_lifecycle_hardening` coverage.
- Add focused helper only if needed, e.g. `cloudflare-v2/src/lifecycle/revision_diff.js`.
- Tests: lifecycle/reply/follow-up/revision tests.

**Interfaces:**
- Consumes prior materialized canonical intent + revised canonical intent.
- Produces zero or more deterministic management actions; never OPEN for an already-materialized logical message.

- [ ] **Step 1: RED tests: SL-only edit, TP-only edit, SL+TP edit, formatting-only edit, skipped-invalid SL corrected by edit.**
- [ ] **Step 2: Implement canonical semantic diff.**
- [ ] **Step 3: Route edits through existing management executor/correlation path.**
- [ ] **Step 4: Prove replay and persistence-repair do not duplicate management.**
- [ ] **Step 5: Commit.**

---

### Task 6: Preserve replies and guarded no-reply context

**Files:**
- Modify only existing correlation modules if regressions reveal needed changes.
- Tests: `cloudflare-v2/tests/reply_and_lifecycle_hardening.test.mjs` and context/follow-up tests.

**Interfaces:**
- Correlation priority: explicit reply -> edit lineage -> explicit thread -> strong same-source/feed/symbol context -> guarded unique/recent fallback.

- [ ] **Step 1: Add regression tests proving explicit replies remain strongest.**
- [ ] **Step 2: Add no-reply same-context unique-candidate success and ambiguous-candidate fail-closed tests.**
- [ ] **Step 3: Make only minimal correlation changes needed.**
- [ ] **Step 4: Re-run fast->full, BE, close, pending and reply tests.**
- [ ] **Step 5: Commit.**

---

### Task 7: Telegram destination edit/reply lineage across all formatting modes

**Files:**
- Modify: `cloudflare-v2/src/destinations/telegram_destination.js`
- Modify: `cloudflare-v2/src/destinations/v1_destination_delivery_acceptance.js`
- Modify presentation/delivery tests.

**Interfaces:**
- `sendTelegramDestination` gains an explicit operation or companion edit function while keeping current send/reply contract compatible.
- Destination mapping continues to persist source event/logical identity -> Telegram destination `messageId`.
- Revisions edit the mapped destination message; they do not post a replacement by default.

- [ ] **Step 1: RED tests for source reply -> destination reply under `none`, `clean`, `template`, `ai_then_fallback`.**
- [ ] **Step 2: RED tests for source edit -> Telegram edit of same destination message ID under all modes.**
- [ ] **Step 3: Implement Telegram `editMessageText` support with entity/parse-mode rules matching send behavior.**
- [ ] **Step 4: Add delivery operation selection using revision lineage and durable mapping.**
- [ ] **Step 5: Verify edit rejection is journaled and never causes broker resend or duplicate standalone post.**
- [ ] **Step 6: Commit.**

---

### Task 8: Operations/Admin observability integration

**Files:**
- Continue existing observability plan files/APIs/UI identified in the CMP/AI handoff.
- Reuse destination delivery journal and add normalized operation entries for interpretation, field validation, revision, correlation, Telegram send/reply/edit and broker management.

**Interfaces:**
- Customer Operations stays workspace-scoped and infrastructure-neutral.
- Admin may include richer internal context, never plaintext credentials.

- [ ] **Step 1: RED serializer/API tests for skipped protection and revision lifecycle.**
- [ ] **Step 2: Implement normalized records and customer-safe labels.**
- [ ] **Step 3: Add Admin diagnostics without exposing secrets.**
- [ ] **Step 4: Run access-control/serialization tests and commit.**

---

### Task 9: AI provider stabilization from existing handoff

**Files:**
- `cloudflare-v2/src/ai/universal_ai.js`
- `cloudflare-v2/src/ai/workspace_ai.js`
- `cloudflare-v2/src/http/v1_admin_ai.js`
- focused provider tests; migration only if necessary.

**Interfaces:**
- First-class DB-authoritative OpenAI, Azure OpenAI, Gemini, Vertex AI, Cloudflare AI, AWS Bedrock adapters.
- Sanitized normalized provider diagnostics and test/health action.
- No new plaintext credential writes and no provider-specific environment fallback.

- [ ] **Step 1: Verify current official provider API contracts before implementation.**
- [ ] **Step 2: RED provider contract tests, including Cloudflare no-env-account fallback.**
- [ ] **Step 3: Implement provider adapters and sanitized diagnostics.**
- [ ] **Step 4: Verify health/test actions and credential handling.**
- [ ] **Step 5: Commit.**

---

### Task 10: Documentation, full CI, controlled DEMO acceptance and handoff

**Files:**
- Update: `AGENTS.md`
- Update: `CURRENT_HANDOFF.md`
- Update/add dated acceptance handoff under `docs/`.

- [ ] **Step 1: Run full Worker/trading CI plus MT5/MTProto/frontend non-regression suites.**
- [ ] **Step 2: Re-query runtime controls/accounts and prove LIVE remains off before any real broker test.**
- [ ] **Step 3: Controlled DEMO cases: production SL-only regression, invalid-protection strict/skip policy, corrected edit, explicit reply, no-reply unique context, ambiguous context fail-closed, destination reply/edit under formatting modes, cTrader and MT5 management, replay/no duplicate.**
- [ ] **Step 4: Verify durable close state and `fill_price` null handling defect is fixed or explicitly retain as unresolved blocker.**
- [ ] **Step 5: Update `AGENTS.md` only with invariants now backed by code/tests/evidence.**
- [ ] **Step 6: Rewrite `CURRENT_HANDOFF.md` current-authority header to exact latest branch/main/deploy state and preserve historical evidence below.**
- [ ] **Step 7: Fresh final zero-LIVE audit.**
- [ ] **Step 8: Exact-head CI/deploy/readiness evidence and completion review.**
