# Complete DEMO Execution Stabilization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove the complete Telegram/source -> AI/fallback -> Telegram destinations + MT5 + cTrader -> durable state -> rich follow-up/management lifecycle on DEMO with permissive secondary validation and zero LIVE execution.

**Architecture:** Preserve one normalized source-agnostic lifecycle. Deterministic parsing remains primary, AI remains available for genuine ambiguity and user-selected Telegram transformations/templates, deterministic material fallback handles AI failure, and secondary numeric/evidence checks only warn unless a material contradiction is proven. Fanout destinations execute independently while sharing durable correlation/idempotency state in Durable Objects + Supabase.

**Tech Stack:** Cloudflare Worker/Node.js, Telegram ingestion/destinations, cTrader Open API adapter, Python MT5 connector/bridge, Supabase/PostgreSQL, Durable Objects, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-09-14-demo-execution-complete-stabilization-design.md`

## Global Constraints
- LIVE execution remains OFF throughout engineering and DEMO acceptance.
- Do not use the cTrader LIVE account for stabilization tests.
- Preserve all existing user-selectable Telegram destination/template options and AI-enabled destination behavior.
- Preserve fast-signal and rich reply/follow-up correlation semantics.
- Secondary/value validation is advisory unless a material contradiction or clearly unsafe/impossible intent is proven.
- AI failure alone must never reject a materially recoverable trade.
- Destination failures are independent; one destination cannot cancel another.
- Do not merge to `main` until automated tests and fresh DEMO acceptance both pass.

---

### Task 1: Lock regression coverage for interpretation and permissive validation

**Files:**
- Modify: `cloudflare-v2/test/trading_interpreter.test.js`
- Modify: `cloudflare-v2/test/signal_intent_validator.test.js`
- Modify: `cloudflare-v2/src/ai/trading_interpreter.js` only after RED tests
- Modify: `cloudflare-v2/src/pipeline/signal_intent_validator.js` only after RED tests
- Modify: `cloudflare-v2/src/ai/relaxed_signal_recovery.js` only after RED tests

**Interfaces:**
- Consumes: normalized source event `{ text, ...relation metadata }`.
- Produces: `READY`, `MANAGEMENT`, `NO_ACTION`, or `NEEDS_REVIEW` plus optional advisory `validationWarnings`.

- [ ] Add failing tests proving AI unavailable/error/bad JSON falls back to deterministic material recovery when original text contains coherent side, symbol, entry, SL and TP evidence.
- [ ] Add failing tests proving non-exact numeric/string evidence becomes a warning rather than `validation.ok=false`.
- [ ] Add failing tests proving true side/symbol/order-type/unsafe-geometry contradictions still fail closed.
- [ ] Run focused Node tests and confirm each new test fails for the intended missing behavior.
- [ ] Implement the minimal interpreter/recovery/validator changes.
- [ ] Re-run focused tests and the full Worker/Node suite.
- [ ] Commit the completed interpretation/validation unit.

### Task 2: Preserve every Telegram destination/template and AI transformation path

**Files:**
- Inspect/modify existing Telegram destination renderer/router files returned by repository search for template selection, AI destination rendering and delivery fanout.
- Add/modify the corresponding destination tests before production changes.

**Interfaces:**
- Consumes: normalized/correlated source event and user destination configuration/template choice.
- Produces: destination-specific Telegram delivery payload/result without controlling broker execution outcome.

- [ ] Enumerate every currently supported Telegram template/format option from code/config/tests and record the names in the regression test fixture.
- [ ] Add a regression test that iterates all existing choices and proves they remain selectable/renderable.
- [ ] Add AI-enabled destination test proving the configured AI transformation path still executes.
- [ ] Add deterministic/non-AI template test proving AI is not mandatory where user selected a deterministic template.
- [ ] Add failure-isolation test: Telegram destination failure does not cancel MT5/cTrader fanout.
- [ ] Add reciprocal isolation test: one broker failure does not cancel Telegram delivery.
- [ ] Make only the minimal production changes required by failing tests.
- [ ] Run destination + orchestration suites and commit.

### Task 3: Preserve fast-signal and rich follow-up lifecycle

**Files:**
- Modify tests around `v1_orchestrator`, correlation, `position_group`, source-event follow-ups and Telegram reply/thread mapping.
- Modify production files only after RED tests.

**Interfaces:**
- Consumes: fast/incomplete entry plus later source/reply/thread updates.
- Produces: one logical position group with stable legs and idempotent follow-up actions.

- [ ] Add/confirm tests for fast entry followed by SL/TP completion on the same group.
- [ ] Add/confirm duplicate fast-entry suppression across replay.
- [ ] Add tests for explicit reply > thread > symbol/context > guarded unique/recent fallback correlation priority.
- [ ] Add tests for `STOPPED AT BE AFTER TP2` and equivalent informational wording producing no destructive broker action.
- [ ] Add tests proving follow-up actions fan independently to configured MT5/cTrader/Telegram destinations.
- [ ] Implement only missing behavior, then run correlation/orchestrator/position lifecycle suites and commit.

### Task 4: Expand deterministic management wording safely

**Files:**
- Modify: `cloudflare-v2/src/ai/trading_interpreter.js` or the canonical deterministic management parser if repository inspection identifies a more appropriate existing module.
- Modify management parser tests first.

**Interfaces:**
- Consumes: common management wording plus correlation metadata.
- Produces: normalized management intent such as `MOVE_SL_TO_BE`, `MOVE_SL`, `CHANGE_TP`, `CLOSE_PARTIAL`, `CLOSE`, `CANCEL_PENDING`, or informational `NO_ACTION`.

- [ ] Add RED table-driven tests for `SL AT BE`, `SL AT BE NOW`, `SL TO BE`, `MOVE SL TO BE`, `BREAKEVEN`, `BREAK EVEN`.
- [ ] Add RED tests for SL-to-value, TP update, close/full close/close all, partial close/reduce, pending cancel wording already supported by product semantics.
- [ ] Add RED tests that ambiguous destructive management never guesses the wrong trade.
- [ ] Implement minimal deterministic aliases/normalization without removing AI as a fallback for genuinely ambiguous wording.
- [ ] Run management/correlation suites and commit.

### Task 5: Complete cTrader management compatibility

**Files:**
- Modify: `cloudflare-v2/src/execution/platform_translation.js`
- Modify: `cloudflare-v2/src/adapters/ctrader_executor_v2.js`
- Modify corresponding cTrader translation/executor tests before production changes.

**Interfaces:**
- Consumes: stable internal action/idempotency identity.
- Produces: broker-safe command with `clientMsgId.length <= 64` while retaining full internal idempotency key in durable delivery state.

- [ ] Add/confirm RED boundary tests for long open and every management action request id.
- [ ] Prove two different long internal ids do not collapse to the same bounded broker id in fixtures.
- [ ] Add/confirm rejection test preserving broker error code and description in destination diagnostics.
- [ ] Verify open, close, partial close, BE, SL, TP, pending management use the bounded broker-facing id consistently.
- [ ] Implement/fix only missing paths, run cTrader suites and commit.

### Task 6: Make MT5 broker-adaptive across execution and management

**Files:**
- Inspect current Python connector/bridge order construction, preflight, symbol capability and management modules.
- Add/modify Python tests/fixtures before production changes.

**Interfaces:**
- Consumes: normalized execution/management command plus broker/account/symbol capabilities.
- Produces: broker-compatible request variant or explicit terminal unsupported/failure diagnostic, never silent failure.

- [ ] Add restrictive broker fixture where comments are rejected; test deterministic safe comment then commentless compatible fallback without changing command identity.
- [ ] Add symbol alias/prefix/suffix resolution fixture.
- [ ] Add min/max/volume-step normalization fixture.
- [ ] Add digits/tick-size/stops/freeze normalization fixtures.
- [ ] Add filling-mode fixtures for allowed FOK/IOC/RETURN candidates and prove only compatible variants are retried.
- [ ] Add market and pending order capability fixtures.
- [ ] Add exact `order_check` error propagation tests.
- [ ] Add open/close/partial-close/SL/TP/BE/pending-cancel management fixtures.
- [ ] Add reconnect/idempotency fixture proving broker-success/state-repair does not resend the broker action.
- [ ] Implement minimal capability-driven changes, avoiding broker-name hardcoding.
- [ ] Run full Python/MT5 suite and commit.

### Task 7: Verify durable state/recovery and destination-independent lifecycle persistence

**Files:**
- Inspect/modify trade state store/node, Supabase materializer/recovery, production binder/state-repair and their tests.

**Interfaces:**
- Consumes: normalized group/legs, source relation metadata and destination execution/management results.
- Produces: idempotent Supabase materialization plus DO hot state recoverable from Supabase.

- [ ] Add/confirm tests for runtime group/leg text identity mapped to relational UUID rows.
- [ ] Add/confirm broker order/position/deal ids, requested/executed/remaining quantities and management transitions persist.
- [ ] Add/confirm state-binding failure after broker success enters state-only repair and cannot broker-resend.
- [ ] Add/confirm Supabase -> DO recovery restores enough correlation for a subsequent explicit reply management event.
- [ ] Add/confirm per-destination success/failure persistence remains independent.
- [ ] Implement only missing behavior, run state/binder/materialization suites and commit.

### Task 8: Full automated verification and CI repair

**Files:**
- No production changes unless a failing test identifies a root cause.

**Interfaces:**
- Consumes: current branch HEAD.
- Produces: green Worker/Node + MT5/Python CI with no LIVE execution.

- [ ] Run/fetch focused suite results for Tasks 1-7.
- [ ] Run/fetch the full Worker/Node suite.
- [ ] Run/fetch the full MT5/Python suite.
- [ ] Inspect exact CI failure logs for any red workflow; do not guess-fix.
- [ ] Fix each root cause with a RED regression test first.
- [ ] Re-run until all required branch checks are green.
- [ ] Record commit SHA and CI run ids in the stabilization handoff.

### Task 9: Fresh connector release and controlled DEMO acceptance

**Files:**
- Update: `docs/STABILIZATION_HANDOFF_2026-09-14.md` with evidence after each acceptance step.

**Interfaces:**
- Consumes: green branch artifact and existing DEMO accounts/configuration.
- Produces: fresh real broker/destination/database evidence.

- [ ] Build/release the MT5 connector from the exact accepted branch commit.
- [ ] Install/restart that fresh connector; record artifact id/digest/commit.
- [ ] Verify global and account LIVE execution controls remain OFF before sending any test.
- [ ] Send one controlled Telegram XAUUSD entry.
- [ ] Verify selected Telegram destination template/output.
- [ ] Verify exactly one cTrader DEMO open with real order/position/deal ids.
- [ ] Verify exactly one MT5 DEMO open with real broker ids.
- [ ] Verify matching durable Supabase group/legs/broker ids.
- [ ] Send a source message that genuinely requires AI and verify successful interpretation/delivery.
- [ ] Induce AI failure on a materially recoverable fixture/path and verify deterministic fallback.
- [ ] Verify advisory value mismatch cannot veto the coherent trade.
- [ ] Reply `SL AT BE NOW` to the controlled trade; verify both brokers and durable state.
- [ ] Verify SL-to-value, TP update, partial close where supported, and full close on both brokers.
- [ ] Verify configured Telegram follow-up/update destinations receive correlated output.
- [ ] Execute a fast-signal + completion/update acceptance without duplicate positions.
- [ ] Restart/replay connector/event and verify no duplicate open or management action.
- [ ] Verify recovery after hot-state loss/restart preserves correlation.
- [ ] Confirm zero LIVE executions.

### Task 10: Handoff, superseded PR cleanup and merge gate

**Files:**
- Update: `docs/STABILIZATION_HANDOFF_2026-09-14.md`
- Update this plan's checkboxes/evidence notes as work completes.

**Interfaces:**
- Consumes: all automated + fresh DEMO evidence.
- Produces: an unambiguous next-session state and, only when complete, a merge-ready stabilization PR.

- [ ] Record completed tasks, exact remaining blockers, branch/commit, CI run ids, connector artifact, DEMO broker ids and Supabase evidence.
- [ ] Re-audit older open stabilization PRs for unique tests/coverage before marking them superseded.
- [ ] Do not merge current stabilization PR until every required DEMO acceptance item is green.
- [ ] Once accepted, merge to `main`, verify post-merge deploy/release, and perform a separate LIVE-readiness review.
- [ ] Do not automatically enable LIVE.