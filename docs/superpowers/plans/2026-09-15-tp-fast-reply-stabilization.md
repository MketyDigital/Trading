# TP, Fast-Completion, Reply and Route Stabilization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Safely preserve all TP formats, complete fast trades for 30 minutes without duplicate leg 1, make replies authoritative across Telegram and broker routes, validate stale completion protection, expose TP-hit protection modes, guarantee Telegram `none` copies every routed message, and document Linux/Wine MT5 operation.

**Architecture:** Keep parsing, correlation, lifecycle promotion, broker safety, Telegram presentation, and connector operation as separate responsibilities. Strong source/durable identity outranks timing; timing is used only for bounded fast-completion inference. Broker-specific validity remains authoritative at execution time and no LIVE control is changed.

**Tech Stack:** Cloudflare Workers/Node.js, Supabase/Postgres, Telegram Bot API + MTProto, cTrader Open API, Python MT5 connector, Wine/systemd documentation.

**Spec:** `docs/superpowers/specs/2026-09-15-tp-fast-reply-stabilization-design.md`

## Global Constraints

- LIVE broker execution remains disabled throughout implementation and acceptance.
- Explicit reply/thread/durable identity outranks recency.
- Fast-completion inference window is 30 minutes.
- Ambiguous correlation fails closed.
- `formatting_mode=none` never invokes presentation AI and forwards any routed sendable Telegram message.
- Existing MT5/cTrader idempotency, destination fanout isolation, AI/template modes, and deterministic fallback must not regress.

---

### Task 1: TP parser preserves repeated and comma-separated targets safely

**Files:**
- Modify: `cloudflare-v2/src/pipeline/machine_plan.js`
- Test: `cloudflare-v2/tests/machine_plan.test.mjs`
- Test: create `cloudflare-v2/tests/tp_list_parsing_regressions.test.mjs`

**Interfaces:**
- Consumes: `parseSignalNumber(raw, { allowNegative })` and `SIGNAL_NUMBER_SOURCE`.
- Produces: deterministic READY intent with `takeProfits: number[]` in source/index order.

- [ ] Add failing tests for multiline repeated unnumbered `tp`, numbered `tp1/tp2/tp3`, one-line `tp 8376, tp 6353, tp 7363`, one-label list `tp 2453, 6635, 8634.6`, and the exact XAUUSD sample.
- [ ] Add counterexample tests proving `77,536.637` remains one numeric price and grouped thousands are not split into multiple targets.
- [ ] Add duplicate-index conflict test such as `TP1 4300, TP1 4400` that must not silently overwrite.
- [ ] Run the parser tests and confirm RED on current main behavior.
- [ ] Implement a TP token extractor that scans TP segments across lines, preserves repeated labels, validates commas using `parseSignalNumber`, and distinguishes valid grouped numeric commas from list separators.
- [ ] Run parser tests and all existing machine-plan/normalization tests; confirm GREEN.
- [ ] Commit parser changes independently.

### Task 2: Fast completion uses a dedicated 30-minute inference window

**Files:**
- Modify: `cloudflare-v2/src/correlation/trade_correlator.js`
- Modify: `cloudflare-v2/src/pipeline/v1_orchestrator.js` only if a distinct completion-window argument must be propagated.
- Test: `cloudflare-v2/tests/trade_correlation.test.mjs`
- Test: `cloudflare-v2/tests/management_continuity_state_regressions.test.mjs`

**Interfaces:**
- Produces: `FAST_ENTRY_COMPLETION` for one compatible incomplete logical trade within `fastCompletionWindowMs=1800000`.
- Explicit reply/thread remains unbounded while active and stronger than the window.

- [ ] Add RED tests for completion at 7 minutes and 29 minutes.
- [ ] Add RED test proving a 31-minute unreplied completion does not infer the old fast group.
- [ ] Add test proving a 31-minute explicit reply still targets the active fast trade.
- [ ] Add ambiguity test with two compatible incomplete XAUUSD BUY trades; expect review rather than guess.
- [ ] Implement dedicated fast-completion-window filtering without widening ordinary management recency logic.
- [ ] Run correlation/orchestrator tests and confirm GREEN.
- [ ] Commit correlation changes independently.

### Task 3: Safe 1-to-N fast leg promotion

**Files:**
- Modify: `cloudflare-v2/src/execution/position_group.js`
- Modify: `cloudflare-v2/src/pipeline/v1_orchestrator.js`
- Modify: `cloudflare-v2/src/state/trade_state_store.js` only if topology/state binding needs additional durable fields.
- Test: create `cloudflare-v2/tests/fast_completion_leg_promotion.test.mjs`

**Interfaces:**
- Existing leg 1 retains broker position identity.
- Full signal with N TPs modifies leg 1 and creates legs 2..N exactly once.

- [ ] Add RED test reproducing `buy gold` followed by exact three-TP XAUUSD signal.
- [ ] Assert original leg 1 emits MODIFY rather than replacement OPEN and keeps broker position ID.
- [ ] Assert leg 2 receives TP2 and leg 3 receives TP3 with same SL.
- [ ] Add replay test proving same completion event cannot create N+1 legs.
- [ ] Add dual-account logical-cohort test proving cTrader and MT5 groups promote independently but share the same source-event chain.
- [ ] Implement minimal promotion logic preserving target indexes and deterministic idempotency keys.
- [ ] Run topology/state/idempotency tests and confirm GREEN.
- [ ] Commit promotion changes independently.

### Task 4: Stale-price validation for fast completion protection

**Files:**
- Modify: `cloudflare-v2/src/execution/production_execution_coordinator.js`
- Modify: `cloudflare-v2/src/adapters/ctrader_runtime.js`
- Modify: `cloudflare-v2/src/execution/production_execution_deps_unified.js`
- Reuse/extend: `cloudflare-v2/src/execution/break_even_safety.js` or create a focused `protective_price_safety.js` if general SL/TP validity deserves a separate unit.
- Test: create `cloudflare-v2/tests/fast_completion_protection_safety.test.mjs`

**Interfaces:**
- Produces action-level BLOCKED/SKIPPED outcomes for stale invalid SL/TP without opening/replacing the protected existing position.

- [ ] Add RED BUY tests where TP1 is already behind/passed relative to authoritative trigger-side market price.
- [ ] Add RED SELL mirror cases.
- [ ] Add RED tests where completion SL is broker-invalid relative to current price.
- [ ] Add tests proving new legs with invalid intended protection are blocked rather than opened uncontrolled.
- [ ] Implement pure protective-price eligibility first, then broker-aware current-price/min-distance preflight using existing cTrader quote and MT5 context paths.
- [ ] Preserve broker minimum-distance authority; do not invent arbitrary distances.
- [ ] Run broker/runtime/coordinator tests and confirm GREEN.
- [ ] Commit safety changes independently.

### Task 5: Reply identity works across trade and Telegram routes

**Files:**
- Audit/modify if needed: `cloudflare-v2/src/http/v1_events.js`
- Audit/modify if needed: Bot API source normalization and `cloudflare-v2/containers/mtproto-listener/listener.py`
- Audit/modify if needed: `cloudflare-v2/external/mtproto-adapter/adapter.py`
- Modify: `cloudflare-v2/src/destinations/v1_destination_delivery_stage.js`
- Modify/create destination message-map persistence if absent.
- Test: create `cloudflare-v2/tests/reply_route_integrity.test.mjs`
- Test: Python MTProto reply tests.

**Interfaces:**
- Source `reply_to_event_id` targets durable trade correlation.
- Telegram destination may reply to mapped destination message ID only when mapping exists.

- [ ] Add tests for Bot API reply to fast signal, full signal, and management update.
- [ ] Add MTProto equivalent tests including wrapped/fallback reply metadata.
- [ ] Add trade-correlation test proving explicit reply is not time-bound.
- [ ] Add fail-closed test for unresolved explicit reply.
- [ ] Add Telegram destination test proving mapped reply is sent as `reply_parameters.message_id`/supported Bot API reply field.
- [ ] Add test proving absent mapping sends content normally without inventing reply ID.
- [ ] Implement minimal source->destination message mapping if not already present, with workspace/source/destination scope and idempotent updates.
- [ ] Run Node + Python reply suites and confirm GREEN.
- [ ] Commit reply changes independently.

### Task 6: TP-hit protection exposes OFF / PROGRESSIVE / BREAKEVEN

**Files:**
- Modify: `cloudflare-v2/src/pipeline/v1_orchestrator.js`
- Modify account safety-policy normalization/schema only where necessary.
- Test: `cloudflare-v2/tests/tp_protection_policy.test.mjs`

**Interfaces:**
- `tpProtectionMode: OFF | PROGRESSIVE | BREAKEVEN`.
- Legacy `autoTpProtection=true` resolves to `PROGRESSIVE`.

- [ ] Add RED tests for explicit mode normalization and legacy compatibility.
- [ ] Prove OFF emits no broker action.
- [ ] Prove PROGRESSIVE: TP1 -> BE for later legs; TP2 -> TP1 price for later legs.
- [ ] Prove BREAKEVEN: TP1/TP2 -> BE only.
- [ ] Ensure automatic BE uses existing BE eligibility/market checks in production dispatch rather than bypassing them.
- [ ] Run protection and broker safety suites; confirm GREEN.
- [ ] Commit policy changes independently.

### Task 7: Telegram `none` forwards all routed message text and preserves replies/entities

**Files:**
- Modify if necessary: `cloudflare-v2/src/destinations/v1_destination_delivery_stage.js`
- Modify if necessary: `cloudflare-v2/src/destinations/telegram_destination.js`
- Test: `cloudflare-v2/tests/telegram_verbatim_and_durable_close.test.mjs`
- Test: create `cloudflare-v2/tests/telegram_none_all_messages.test.mjs`

**Interfaces:**
- Any routed event with sendable `event.text` reaches Telegram destination even if trading interpretation is NO_ACTION/NEEDS_REVIEW/non-signal.

- [ ] Add RED/contract tests for greeting, market analysis, malformed signal, READY signal, MANAGEMENT signal, and NO_ACTION text.
- [ ] Assert AI formatter invocation count remains zero in `none` mode.
- [ ] Assert exact text + Telegram entities are preserved.
- [ ] Assert reply mapping behavior from Task 5 is preserved.
- [ ] Ensure destination failure remains isolated from broker routes.
- [ ] Run all destination tests and confirm GREEN.
- [ ] Commit Telegram copier changes independently.

### Task 8: Linux/Wine MT5 connector runbook and compatibility checks

**Files:**
- Modify: `docs/MT5_CONNECTOR_ACCEPTANCE_RUNBOOK.md`
- Modify: `AGENTS.md`
- Modify: `docs/STABILIZATION_PROGRESS_2026-09-14.md`
- Modify: `docs/STABILIZATION_HANDOFF_2026-09-14.md`
- Add tests only if connector path/config helpers need code changes.

**Interfaces:**
- Canonical Windows connector EXE runs inside same Wine prefix as MT5.

- [ ] Document supported Wine topology, exact same-prefix requirement, config/ledger locations, pairing/reset, logs, reconnect and health checks.
- [ ] Document a systemd unit pattern invoking Wine with the connector EXE and stable `WINEPREFIX`.
- [ ] Document that Linux/Wine is not production-accepted until a real Wine VPS test passes.
- [ ] Add all parser/correlation/reply/leg/TP-protection/Telegram-none contracts to `AGENTS.md` as release blockers.
- [ ] Record production evidence for events 297/298 showing current parser and 2-minute completion defects.
- [ ] Record that LIVE remained disabled.
- [ ] Commit documentation independently.

### Task 9: Full verification, DEMO acceptance, and release gate

**Files:**
- No functional changes unless a verified failing acceptance test exposes a new root cause.

**Interfaces:**
- Exact branch head must pass CI before merge/deploy.

- [ ] Run complete Node/trading-core suite.
- [ ] Run MT5 compatibility/release tests.
- [ ] Run MTProto Python tests.
- [ ] Review changed-file diff for accidental removal of AI/template/deterministic fallback behavior.
- [ ] Confirm production runtime controls still show LIVE disabled before deploy.
- [ ] Merge only after exact head is green.
- [ ] Deploy Worker/external listener components required by changed files.
- [ ] Reconfirm LIVE disabled after deploy.
- [ ] Real DEMO test: `buy gold`, wait >2 minutes, send full three-TP signal within 30 minutes; verify original leg 1 modified and legs 2/3 opened with TP2/TP3 on cTrader + MT5.
- [ ] Real DEMO reply tests for full completion and management on both brokers.
- [ ] Real DEMO stale-price completion test where an intended SL/TP is no longer valid; verify safe BLOCKED/SKIPPED behavior and no duplicate/replacement open.
- [ ] Real Telegram Bot/MTProto -> Telegram destination `none` test once a Telegram destination entitlement/config is available.
- [ ] Reconnect/replay/idempotency check.
- [ ] Final zero-LIVE-delivery query and handoff update.
