# Deterministic Revisions, Protection, and Telegram Lineage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make clear signals deterministic without AI, add revision-aware management for source edits, add configurable field-level invalid SL/TP skipping, and preserve reply/edit lineage at Telegram destinations without weakening execution safety.

**Architecture:** Extend the existing canonical pipeline rather than creating parallel flows. Keep interpretation, validation/policy, lifecycle correlation, broker execution, and Telegram presentation separate; represent edits as revisions of one logical source identity and convert semantic differences into management actions against the existing durable position group.

**Tech Stack:** Cloudflare Workers JavaScript/ESM, Node test runner, Supabase/Postgres persistence, Telegram Bot API, existing cTrader/MT5 execution adapters.

**Spec:** `docs/superpowers/specs/2026-09-16-deterministic-revisions-protection-and-telegram-lineage-design.md`

## Global Constraints

- LIVE remains disabled; no global/workspace/account LIVE flag may be enabled by this work.
- AI is fallback only; deterministic validation remains final authority.
- Existing reply/thread/context correlation is extended, not replaced.
- Existing fast-entry -> later-full-signal completion must not regress.
- Broker success + persistence failure is repair-only; never resend without reconciliation proof.
- Telegram destination failures remain isolated from broker and sibling destinations.
- Existing customers retain strict invalid-protection behavior unless an explicit persisted policy enables skipping.
- Source formatting mode never controls lineage; replies remain replies and edits remain edits in all modes.

---

### Task 1: Deterministic incomplete-signal interpretation

**Files:**
- Modify: `cloudflare-v2/src/ai/trading_interpreter.js`
- Modify if necessary: `cloudflare-v2/src/pipeline/machine_plan.js`
- Test: existing deterministic/interpreter tests under `cloudflare-v2/tests/`

**Interfaces:**
- Consumes: `buildMachinePlan(event)` returning `READY|MANAGEMENT|NO_ACTION|NEEDS_INTERPRETATION`.
- Produces: `interpretTradingEvent()` returns deterministic `READY` for clear incomplete signals without invoking AI.

- [ ] Add a failing regression for `xauusd sell\nentry 4273.25-4279.76\nsl 4380` proving status `READY`, source `deterministic`, XAUUSD SELL range entry, SL 4380, empty TP list, `incomplete=true`, and zero AI calls.
- [ ] Add matrix failures for entry+TP/no-SL, market+SL, market+TP, field-order variants, aliases/punctuation, and `V75 index Sell Now!!!` where intent is otherwise unambiguous.
- [ ] Run focused tests and confirm RED is caused by incomplete deterministic intent falling through to AI/review.
- [ ] Change `interpretTradingEvent()` so deterministic `READY` with safe incomplete intent is returned directly; retain relaxed recovery only when it adds missing safely inferable structure and never let optional-field absence force AI.
- [ ] Run focused tests and confirm GREEN.
- [ ] Commit parser/interpreter fix separately.

### Task 2: Expand deterministic management grammar without breaking BE/informational handling

**Files:**
- Modify: `cloudflare-v2/src/pipeline/machine_plan.js`
- Test: `cloudflare-v2/tests/reply_and_lifecycle_hardening.test.mjs` and/or focused parser tests.

**Interfaces:**
- Produces management intents for explicit SL/TP update/remove, percentage/lot partial close, close/cancel commands.

- [ ] Add RED tests for `SL 4280`, `NEW SL 4280`, `UPDATE SL 4280`, `CHANGE SL TO 4280`, `SL TO 4280`, `STOP LOSS 4280`, `TP 4350`, `TP1 4350`, `UPDATE TP1 4350`, `NEW TP 4350`, `CHANGE TP2 TO 4400`, `REMOVE TP2`, `REMOVE SL`, `CLOSE 25%`, `CLOSE 0.01`, and symbol-qualified variants.
- [ ] Add non-regression tests proving `SL AT BE NOW` remains BE management and `STOPPED AT BE AFTER TP2` remains informational/no destructive action.
- [ ] Implement the smallest grammar expansion in the existing management parser.
- [ ] Run focused tests and commit.

### Task 3: Protection validation policy and field-level outcomes

**Files:**
- Inspect/modify existing execution validation/planning modules and `trade_accounts.safety_policy` consumers.
- Prefer a focused helper under `cloudflare-v2/src/execution/` if current validators are too coupled.
- Test: focused execution/planning tests.

**Interfaces:**
- Persisted policy keys: `invalidProtectionPolicy`, `allowInvalidStopLossSkip`, `allowInvalidTakeProfitSkip`, `applySourceEditsToActiveTrades` within existing JSON safety-policy authority unless code inspection proves a better existing owner.
- Produces validation result containing valid executable protection plus explicit skipped-field diagnostics.

- [ ] Add RED tests proving clear SELL + SL 4180 is parsed but strict policy rejects execution safely.
- [ ] Add RED tests proving `skip_invalid` may omit only invalid SL or individual invalid TP while valid trade components continue.
- [ ] Add RED tests proving unsupported symbol, invalid risk/lot, invalid entry/pending semantics, auth/runtime/LIVE failures remain whole-trade fail closed.
- [ ] Implement policy lookup with strict backward-compatible defaults.
- [ ] Implement field-level protection classification and sanitized skip reason codes.
- [ ] Run focused tests and commit.

### Task 4: Revision-aware source identity and persistence

**Files:**
- Modify: `cloudflare-v2/src/http/telegram_bot_webhook.js`
- Modify: `cloudflare-v2/src/events/trading_event.js`
- Modify: source-event persistence/idempotency modules discovered during implementation.
- Add migration only if existing event metadata/version columns cannot safely represent revisions.
- Test: Telegram source/idempotency/event tests.

**Interfaces:**
- Stable logical identity remains Telegram `chat_id:message_id`.
- New revision identity distinguishes exact replay from changed content for that logical message.

- [ ] Add RED tests proving `edited_message`/`edited_channel_post` preserve logical native identity and carry explicit edit/revision metadata.
- [ ] Add RED tests proving exact replay of same revision is no-op while changed content is accepted as a new revision of the same logical message.
- [ ] Implement smallest durable revision representation compatible with existing event storage and replay semantics.
- [ ] Ensure every revision remains auditable and cannot become a duplicate OPEN.
- [ ] Run focused tests and commit.

### Task 5: Semantic diff from edit to management

**Files:**
- Create focused revision-diff helper if needed under lifecycle/execution domain.
- Modify existing lifecycle correlation/management orchestration modules.
- Test: lifecycle hardening tests.

**Interfaces:**
- Consumes previous canonical intent + revised canonical intent + durable position group.
- Produces zero or more explicit management actions; never a second OPEN for the same logical trade.

- [ ] Add RED tests: SL-only edit, TP-only edit, SL+TP edit, formatting-only edit, repeated same edit, invalid skipped SL corrected by edit.
- [ ] Add authorization tests proving edits cannot escape source/feed/route/account scope.
- [ ] Implement semantic diff and management conversion using existing group identifiers/idempotency patterns.
- [ ] Run focused tests and commit.

### Task 6: Reply and safe no-reply context non-regression

**Files:**
- Modify only if tests reveal gaps in existing correlation modules.
- Test: `cloudflare-v2/tests/reply_and_lifecycle_hardening.test.mjs` and related fast/follow-up tests.

**Interfaces:**
- Correlation priority: explicit reply > exact edit lineage > explicit thread > strong symbol/source/context > guarded unique recent fallback.

- [ ] Add tests proving explicit reply stays strongest.
- [ ] Add tests proving no-reply management can correlate only when exactly one strong active candidate exists in source/feed/context.
- [ ] Add ambiguity tests proving multiple plausible groups fail closed.
- [ ] Re-run fast -> full completion and BE lifecycle regressions.
- [ ] Make only evidence-driven fixes; commit separately if code changes are needed.

### Task 7: Telegram destination edit fidelity

**Files:**
- Modify: `cloudflare-v2/src/destinations/telegram_destination.js`
- Modify: `cloudflare-v2/src/destinations/v1_destination_delivery_acceptance.js`
- Modify presentation helpers only where necessary.
- Test: Telegram destination acceptance/presentation tests.

**Interfaces:**
- Extend Telegram transport with an edit operation using the existing mapped destination `messageId`.
- Replies continue using mapped parent destination `messageId`.
- Edit lineage is selected independently of formatting mode.

- [ ] Add RED tests proving source edit resolves the existing destination message mapping and calls Telegram edit semantics instead of `sendMessage`.
- [ ] Test all four formatting modes: `none`, `clean`, `template`, `ai_then_fallback`.
- [ ] Test raw/native entities on edits where supported and parse-mode/entity exclusivity.
- [ ] Test edit rejection journaling and prove it cannot trigger broker resend or fallback duplicate send.
- [ ] Implement Telegram edit transport + operation selection while preserving existing reply mapping.
- [ ] Run focused tests and commit.

### Task 8: Operations journal and customer/admin diagnostics integration

**Files:**
- Extend existing delivery/event journal and Operations/Admin serializers per the already-approved AI/observability plan.
- Add migration only if normalized operation records require a new table/index not already planned.
- Test workspace isolation and sanitization.

**Interfaces:**
- Records parser source, revision, field validation/skips, correlation, broker management, Telegram send/reply/edit, replay, reconciliation.

- [ ] Add RED serializer/API tests for skipped SL/TP, source revision, semantic diff, Telegram edit success/failure.
- [ ] Persist sanitized codes/messages only; never plaintext provider/broker/Telegram credentials.
- [ ] Keep customer Operations infrastructure-neutral and workspace-scoped; Admin may include richer internal context without secrets.
- [ ] Run focused tests and commit.

### Task 9: Documentation, authority, and handoff update

**Files:**
- Modify: `AGENTS.md`
- Modify: `CURRENT_HANDOFF.md`
- Modify: `docs/DETERMINISTIC_REVISION_PROTECTION_HANDOFF_2026-09-16.md`
- Update related acceptance/runbook docs as needed.

- [ ] Update `AGENTS.md` only for behaviors actually implemented and verified.
- [ ] Update `CURRENT_HANDOFF.md` to current branch/head and current production authority without erasing historical evidence.
- [ ] Record exact tests, CI run IDs, DEMO evidence, remaining gaps, and zero-LIVE state.
- [ ] Commit documentation separately.

### Task 10: Full verification and controlled DEMO acceptance

**Files:** no feature changes unless verification exposes a regression; any fix restarts TDD for that defect.

- [ ] Run focused Worker parser/lifecycle/destination suites.
- [ ] Run full Worker/trading CI.
- [ ] Run MT5 connector/bridge and MTProto suites required by AGENTS.md.
- [ ] Verify exact branch head CI status.
- [ ] Re-query runtime controls and account environments before any real DEMO action.
- [ ] Verify `live_broker_execution_enabled=false`, workspace live entitlement false, and every LIVE account execution/live disabled.
- [ ] On Starpips DEMO only, explicitly enable skip-invalid policy if required for the acceptance case; do not change LIVE authority.
- [ ] Execute controlled DEMO cases: SL-only deterministic signal, invalid-SL skip then corrected edit, reply management, no-reply unambiguous management, destination reply mapping, destination edit mapping, replay/no duplicate OPEN, cTrader+MT5 where intended.
- [ ] Re-run final zero-LIVE audit and update handoff evidence.
