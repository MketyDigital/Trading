# Fast Follow-up, TP Parsing, Reply, and MT5 Linux/Wine Stabilization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Telegram parsing, replies, fast-signal completion, TP protection, verbatim forwarding, and MT5 Linux/Wine operation production-safe without changing LIVE controls.

**Architecture:** Keep the current parser -> correlation -> execution-plan -> broker-adapter -> durable-state pipeline. Add narrowly scoped parsing/correlation/policy behavior with fail-closed rules and preserve broker/Telegram fanout isolation. Linux support reuses the existing Windows connector under Wine rather than introducing a second execution engine.

**Tech Stack:** Node.js/Cloudflare Workers, Supabase/Postgres, Telegram Bot API/MTProto, cTrader Open API, Python MT5 connector, Wine/systemd.

**Spec:** `docs/superpowers/specs/2026-09-15-fast-followup-tp-reply-stabilization-design.md`

## Global Constraints
- LIVE broker execution remains disabled throughout implementation and acceptance.
- Existing cTrader DEMO and MT5 DEMO execution must not regress.
- Telegram destination delivery remains isolated from broker delivery failures.
- AI formatting/interpreter fallbacks remain intact except `none`, which must never invoke AI.
- Explicit reply/thread identity outranks time-based inference.
- Fast completion compatibility window is exactly 30 minutes for inference-only matching.

---

### Task 1: TP tokenizer and parser regression coverage

**Files:**
- Modify: `cloudflare-v2/tests/machine_plan.test.mjs`
- Modify: `cloudflare-v2/src/pipeline/machine_plan.js`
- If needed modify: `cloudflare-v2/src/normalization/signal_number.js`

**Interfaces:**
- Consumes: raw Telegram signal text.
- Produces: `intent.takeProfits: number[]` in source order with no invented prices.

- [ ] Add RED tests proving these parse exactly:
  - multiline repeated `TP` lines -> `[4300.5,4360.9,4450.3]`;
  - `TP 2453, 6635, 8634.6` -> three targets;
  - `TP 8376, TP 6353, TP 7363` -> three targets;
  - `TP1 0.1273, TP2 0.1300, TP3 0.1350` -> three ordered targets;
  - `TP 77,536.637` -> one target `77536.637`;
  - mixed thousands grouping such as `TP1 77,536.637, TP2 78,100.25` -> two targets;
  - malformed/ambiguous comma structure does not split into invented values.
- [ ] Run only the parser tests and confirm RED on current behavior.
- [ ] Refactor `extractExplicitTps` to tokenize TP segments first, then parse each numeric token using the canonical number parser. Never split commas blindly before determining whether they form valid thousands grouping.
- [ ] Keep numbered TP indexes ordered numerically; preserve unnumbered TP source order.
- [ ] Run parser tests GREEN, then run the complete machine-plan suite.

### Task 2: Fast completion correlation window and reply priority

**Files:**
- Modify: `cloudflare-v2/src/correlation/trade_correlator.js`
- Modify: `cloudflare-v2/tests/trade_correlation.test.mjs`
- Modify/add targeted fast-completion regression test file if clearer.

**Interfaces:**
- Consumes: event, canonical intent, active durable groups.
- Produces: `FAST_ENTRY_COMPLETION`, `REPLY_TARGET`, `THREAD_TARGET`, `NEW_GROUP`, or explicit ambiguity/review reason.

- [ ] Add RED test: fast signal at t=0 and compatible full signal at t=7 minutes must match same incomplete logical trade.
- [ ] Add RED test at t=29:59 minutes must match; at >30 minutes inference-only must not match.
- [ ] Add RED test: explicit reply to the original fast event remains valid after >30 minutes while group is active.
- [ ] Add RED test: two compatible incomplete logical trades within 30 minutes fail closed instead of choosing newest.
- [ ] Add a dedicated `fastCompletionWindowMs = 30 * 60 * 1000`; do not expand normal management recency rules.
- [ ] Preserve reply -> thread -> unique compatible incomplete group priority.
- [ ] Run correlation tests GREEN and full correlation suite.

### Task 3: 1-leg -> N-leg promotion with broker identity preservation

**Files:**
- Modify: `cloudflare-v2/src/execution/position_group.js`
- Modify: `cloudflare-v2/src/pipeline/v1_orchestrator.js`
- Modify: `cloudflare-v2/src/state/trade_state_store.js` only if state mutation requires it.
- Modify/add tests around fast completion promotion.

**Interfaces:**
- Consumes: incomplete group with existing broker leg + completed intent with N TPs.
- Produces: leg 1 MODIFY action and only N-1 OPEN actions; same logical group/source lineage.

- [ ] Add RED test for existing leg-1 plus three TP completion.
- [ ] Assert leg-1 keeps original `brokerPositionId`, receives common SL + TP1, and is not reopened.
- [ ] Assert leg-2/leg-3 receive same SL and TP2/TP3 respectively.
- [ ] Assert source event IDs contain both fast and full messages and idempotency keys differ by stable leg ID.
- [ ] Implement minimal promotion logic preserving original leg identity.
- [ ] Run promotion/state tests GREEN.

### Task 4: Follow-up SL/TP market-validity behavior

**Files:**
- Modify: `cloudflare-v2/src/execution/production_execution_coordinator.js`
- Modify broker-specific validation/preflight modules only where necessary.
- Add: `cloudflare-v2/tests/fast_followup_market_validity.test.mjs`

**Interfaces:**
- Consumes: promotion actions and authoritative current broker market context.
- Produces: executable actions or explicit per-action BLOCKED/SKIPPED reasons without duplicate opens.

- [ ] Add RED BUY/SELL cases where price has already crossed TP1 before the original fast leg can be assigned TP1.
- [ ] Add RED cases where broker stop-distance rules make SL/TP invalid on original leg.
- [ ] Prove invalid modification of existing leg is BLOCKED/SKIPPED with reason and never replaced by a new leg-1.
- [ ] Prove leg-2/leg-3 may still open with their own valid TP/SL when broker rules permit and signal geometry remains coherent.
- [ ] Ensure structurally impossible full signal geometry fails closed for the logical trade.
- [ ] Run cTrader and MT5 execution tests GREEN.

### Task 5: TP-hit protection modes

**Files:**
- Modify: `cloudflare-v2/src/pipeline/v1_orchestrator.js`
- Modify: `cloudflare-v2/tests/tp_protection_policy.test.mjs`
- Modify account policy normalization/admin schema only if necessary.

**Interfaces:**
- Consumes: `TARGET_HIT` management event + account safety policy.
- Produces: zero or more MODIFY actions on remaining legs.

- [ ] Add tests for `OFF`, `PROGRESSIVE`, and `BREAKEVEN`.
- [ ] Preserve backward compatibility: `autoTpProtection=true` => `PROGRESSIVE`; false/missing => `OFF`.
- [ ] `PROGRESSIVE`: TP1 -> BE on later legs; TP2 -> TP1 price on later legs.
- [ ] `BREAKEVEN`: TP1/TP2 -> BE only.
- [ ] Route generated BE changes through existing BE eligibility/broker-stop safeguards.
- [ ] Run policy + BE suites GREEN.

### Task 6: Reply integrity across Bot API, MTProto, correlation, broker route, and Telegram destination

**Files:**
- Inspect/modify normal Bot API source handler.
- Inspect/modify `cloudflare-v2/containers/mtproto-listener/listener.py`.
- Inspect/modify `cloudflare-v2/external/mtproto-adapter/adapter.py`.
- Modify reply/correlation tests.
- Modify Telegram destination stage/sender only if destination threading metadata is currently dropped.

**Interfaces:**
- Consumes: Telegram native reply/message references.
- Produces: canonical `thread.reply_to_event_id` and optional Telegram destination reply target.

- [ ] Add Bot API test proving reply to original signal maps to canonical source event ID.
- [ ] Add MTProto test proving direct reply and fallback reply lookup map identically.
- [ ] Add broker-route test: explicit unresolved reply returns `NO_REPLY_TARGET`/review and never falls through to another trade.
- [ ] Add test: reply to a known management/follow-up event resolves to the same logical trade lineage.
- [ ] Add Telegram destination test for reply threading where source/destination relationship supports it; failure must stay destination-local.
- [ ] Run Bot/MTProto/correlation/destination tests GREEN.

### Task 7: Telegram `none` as unconditional verbatim routed copy

**Files:**
- Modify: `cloudflare-v2/src/destinations/v1_destination_delivery_stage.js` only if interpretation status currently gates delivery.
- Modify: `cloudflare-v2/tests/telegram_verbatim_and_durable_close.test.mjs`
- Add broader non-trading forwarding test.

**Interfaces:**
- Consumes: any routed Telegram event with text/content.
- Produces: exact stored text + preserved Telegram entities, with zero AI calls.

- [ ] Add RED cases for READY signal, MANAGEMENT text, NEEDS_REVIEW/malformed signal, and ordinary non-trading text.
- [ ] Assert exact text, line breaks, entities, and zero AI formatter calls.
- [ ] Assert broker route may independently NO_ACTION/BLOCK without suppressing Telegram delivery.
- [ ] Implement only if the RED test reveals a gate.
- [ ] Run destination fanout tests GREEN.

### Task 8: Linux/Wine MT5 connector support and operator verification

**Files:**
- Modify: `docs/MT5_CONNECTOR_ACCEPTANCE_RUNBOOK.md`
- Create: `docs/MT5_CONNECTOR_LINUX_WINE.md`
- Modify connector tests only if platform path/config assumptions fail under POSIX/Wine paths.

**Interfaces:**
- Reuses: existing `MketyMT5Connector.exe`, websocket protocol, config, replay ledger.
- Produces: documented same-Wine-prefix deployment with systemd supervision.

- [ ] Document supported Ubuntu/Debian prerequisites, Wine prefix, MT5 installation, connector EXE placement, pairing token usage, config/ledger locations, and restart/reset commands.
- [ ] Provide a systemd service example that invokes the connector with Wine under the same prefix and restarts on failure.
- [ ] Document terminal account/server identity verification and heartbeat checks before enabling DEMO execution.
- [ ] Document that native Linux MT5 execution is not a separate supported engine in this release.

### Task 9: Master docs and acceptance matrix

**Files:**
- Modify: `AGENTS.md`
- Modify: `docs/STABILIZATION_PROGRESS_2026-09-14.md`
- Modify: `docs/STABILIZATION_HANDOFF_2026-09-14.md`
- Modify: `docs/MT5_CONNECTOR_ACCEPTANCE_RUNBOOK.md`

**Interfaces:**
- Produces: authoritative release-blocking contracts and exact acceptance sequence.

- [ ] Add TP parsing examples and thousands-separator warning.
- [ ] Add 30-minute fast completion rule and explicit-reply timeless rule.
- [ ] Add 1->N leg promotion contract.
- [ ] Add follow-up invalid-SL/TP behavior.
- [ ] Add TP protection modes and defaults.
- [ ] Add Bot API + MTProto reply integrity requirement for Telegram and broker routes.
- [ ] Add Telegram `none` all-message verbatim-copy rule.
- [ ] Add Linux/Wine connector support reference.
- [ ] Record production evidence event IDs 297/298 and the observed parser/correlation defect that motivated this change.

### Task 10: Verification, review, merge, deploy, DEMO acceptance

**Files:** none unless review uncovers a defect.

**Interfaces:**
- Consumes: all completed tasks.
- Produces: green PR, deployed Worker/listener/connector artifacts where applicable, DEMO acceptance evidence.

- [ ] Run the complete Node/trading-core test suite.
- [ ] Run Python MTProto/MT5 connector tests.
- [ ] Run cTrader compatibility tests.
- [ ] Verify exact PR head workflows are green.
- [ ] Review diff for accidental LIVE/control changes; verify `live_broker_execution_enabled=false` and both DEMO account `live_execution_enabled=false`.
- [ ] Merge only after green CI and review.
- [ ] Deploy required Worker/listener changes; publish connector artifact only if connector code changed.
- [ ] Re-query production controls and confirm LIVE remains disabled.
- [ ] DEMO test sequence: fast signal -> wait several minutes -> full three-TP signal -> verify original leg1 modified, legs2/3 opened with TP2/TP3 on both cTrader and MT5.
- [ ] Reply-to management acceptance on both brokers.
- [ ] TP1/TP2 protection acceptance with policy enabled on DEMO, then disable/reset as required.
- [ ] Telegram Bot source -> Telegram `none` destination acceptance for both trade and non-trade messages when entitlement/configuration allows.
- [ ] Replay/restart/idempotency acceptance and final zero-LIVE-delivery query.
