# Universal Signal Normalization and Broker Reconciliation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Mkety parse and validate human trading signals safely across supported markets, preserve identical lifecycle semantics on cTrader and MT5, reconcile broker truth without duplicate orders, and make MT5 pairing observable and automatic.

**Architecture:** Introduce one shared structured-number and canonical-signal normalization layer before broker-specific translation. Keep deterministic interpretation as the low-latency authority, invoke AI only for bounded ambiguity, validate AI output deterministically, and make broker responses plus stable group/leg identity the durable source for later correlation and management. MT5 and cTrader continue to use their own adapters only after the shared canonical lifecycle has produced validated actions.

**Tech Stack:** JavaScript/Node test runner for Cloudflare Worker V1, Cloudflare Durable Objects, Supabase/Postgres, cTrader Open API/cBot adapters, Python MT5 connector, MetaTrader5 Python API, GitHub Actions/CodeQL.

**Spec:** `docs/superpowers/specs/2026-09-13-universal-normalization-reconciliation-design.md`

## Global Constraints

- Live-money execution remains OFF unless separately and explicitly authorized.
- Demo and live environments remain distinct.
- Kill switch/account execution gates are checked immediately before broker dispatch.
- AI never directly authorizes broker execution and never bypasses deterministic validation or safety gates.
- Ambiguous numeric, symbol, correlation, or management targets fail closed.
- Broker/account symbol metadata is authoritative for executable symbol translation.
- Workspace/account/source isolation is mandatory for correlation, reconciliation, and management.
- FIXED_LOTS means configured fixed lot per TP leg; risk-sized modes remain trade-level risk distributed across TP legs.
- Fast-entry completion with N TPs must produce exactly N total legs; the first broker-filled fast leg is reused as TP1.
- Broker-success/state-binding failure must never resend the successful broker OPEN merely to repair state.
- No credentials, tokens, passwords, bearer headers, pairing secrets, or raw secret-bearing payloads may appear in Operations output.

---

### Task 1: Universal structured price-token normalization

**Files:**
- Create: `cloudflare-v2/src/normalization/signal_number.js`
- Modify: `cloudflare-v2/src/pipeline/machine_plan.js`
- Modify: `cloudflare-v2/src/ai/relaxed_signal_recovery.js`
- Test: `cloudflare-v2/tests/signal_number.test.mjs`
- Test: `cloudflare-v2/tests/machine_plan.test.mjs`

**Interfaces:**
- Produces `parseSignalNumber(raw, options?) -> { ok, value?, raw, normalized?, confidence, repairReason?, reason? }`.
- Produces `extractSignalNumbers(text, options?) -> structured token results` for generic TP lists.
- Produces a reusable numeric token pattern/helper so machine parsing and relaxed recovery do not maintain separate decimal-only regexes.
- Consumers must distinguish `HIGH` confidence deterministic normalization from `REVIEW`/ambiguous tokens.

- [ ] **Step 1: Add failing unit tests for accepted numeric formats and ambiguity**

Create tests that assert:

```js
assert.deepEqual(parseSignalNumber('77,400.54'), {
  ok: true, value: 77400.54, raw: '77,400.54', normalized: '77400.54', confidence: 'HIGH', repairReason: null,
});
assert.equal(parseSignalNumber('77 400.54').value, 77400.54);
assert.equal(parseSignalNumber('77400.54').value, 77400.54);
assert.equal(parseSignalNumber('77,400').value, 77400);
assert.equal(parseSignalNumber('77,610,00').value, 77610);
assert.equal(parseSignalNumber('77,610,00').repairReason, 'DUPLICATE_DECIMAL_SEPARATOR');
assert.equal(parseSignalNumber('1,234,56,78').ok, false);
```

Also cover negative values only where explicitly permitted by the caller, Unicode dash separation outside a number, and ensure no token silently becomes a truncated prefix such as `77`.

- [ ] **Step 2: Run the new number tests and verify they fail**

Run:
`cd cloudflare-v2 && node --test tests/signal_number.test.mjs`

Expected: FAIL because `signal_number.js` does not exist yet.

- [ ] **Step 3: Implement the structured-number normalizer**

Implement strict grouping rules:

```js
export function parseSignalNumber(raw, { allowNegative = false } = {}) {
  // Trim wrappers/punctuation but preserve separators for validation.
  // Accept plain decimal, grouped thousands comma/space, and one decimal separator.
  // Repair `77,610,00` only when the final comma group is exactly 1-2 decimal digits
  // and all preceding comma groups form a valid thousands-grouped integer.
  // Return {ok:false, reason:'AMBIGUOUS_NUMBER'} for multiple plausible parses.
}
```

Do not infer instrument scale in this low-level function. It may make only syntax-unique repairs; instrument/catalog magnitude validation happens later.

- [ ] **Step 4: Replace decimal-only extraction in `machine_plan.js` and relaxed recovery**

Use the structured parser for:
- explicit ENTRY and entry ranges,
- SL,
- labeled TP1/TP2/...,
- generic TP lists,
- relaxed `around/near/at`, protection, and targets.

If any required token is ambiguous, return `NEEDS_INTERPRETATION` rather than building a READY intent.

- [ ] **Step 5: Add the user's exact BTCUSD regression and market-order semantics tests**

Add:

```js
const plan = buildMachinePlan({ text: `BTCUSD Buy (77,010.81-77,140.80)
SL: 76,994.00
TP1: 77,400.54
TP2: 77,610,00
TP3: 78,201.24` });
assert.equal(plan.status, 'READY');
assert.equal(plan.intent.orderType, 'MARKET');
assert.deepEqual(plan.intent.entry, { kind: 'RANGE', min: 77010.81, max: 77140.80 });
assert.equal(plan.intent.stopLoss, 76994);
assert.deepEqual(plan.intent.takeProfits, [77400.54, 77610, 78201.24]);
```

Also prove a market range remains MARKET unless explicit LIMIT/STOP language is present.

- [ ] **Step 6: Run focused parser tests**

Run:
`cd cloudflare-v2 && node --test tests/signal_number.test.mjs tests/machine_plan.test.mjs tests/trading_interpreter.test.mjs`

Expected: PASS.

- [ ] **Step 7: Commit**

Commit message:
`fix: normalize human-formatted trading prices safely`

---

### Task 2: Market-wide instrument and broker-catalog normalization

**Files:**
- Modify: `cloudflare-v2/src/normalization/trading_normalizer.js`
- Modify: `cloudflare-v2/src/normalization/symbol_catalog.js`
- Modify: `cloudflare-v2/src/pipeline/machine_plan.js`
- Test: `cloudflare-v2/tests/trading_normalizer.test.mjs`
- Test: `cloudflare-v2/tests/machine_plan.test.mjs`

**Interfaces:**
- `normalizeSymbol(value)` remains the canonical alias entry point.
- `resolveSymbolAgainstCatalog(value, catalog)` remains exact/conservative and broker-catalog authoritative.
- Parser symbol extraction must accept compact FX/crypto/index tokens and named Deriv synthetics without inventing fuzzy matches.

- [ ] **Step 1: Add failing coverage for market families**

Test canonicalization and parsing for:
- EURUSD, GBP/JPY and another minor/cross,
- GOLD/XAUUSD and SILVER/XAGUSD,
- BTCUSD/ETHUSD,
- US30/NAS100/US500/GER40/UK100/JP225/HK50,
- USOIL/UKOIL,
- `Volatility 75 Index`, `Volatility 75 (1s) Index`, `Boom 1000 Index`, `Crash 500 Index`, `Step Index`, `Jump 25 Index`,
- broker symbols such as `XAUUSD.m`, `BTCUSD.pro`, and prefixed/suffixed catalog aliases.

- [ ] **Step 2: Run focused normalizer/parser tests and verify failures**

Run:
`cd cloudflare-v2 && node --test tests/trading_normalizer.test.mjs tests/machine_plan.test.mjs`

Expected: synthetic families not currently recognized fail.

- [ ] **Step 3: Extend canonical symbol normalization conservatively**

Add deterministic canonical forms for named Deriv synthetics, for example:

```js
DERIV:VOLATILITY_75
DERIV:VOLATILITY_75_1S
DERIV:BOOM_1000
DERIV:CRASH_500
DERIV:STEP
DERIV:JUMP_25
```

Keep future symbol execution broker-catalog-driven: unknown but syntactically plausible symbols may be canonical comparison keys, but execution still requires one unique catalog resolution.

- [ ] **Step 4: Extend parser symbol extraction for multiword synthetics**

Use one shared synthetic-symbol recognizer for normal signals and management commands so `BUY Volatility 75 Index` and `close Volatility 75 Index` resolve identically.

- [ ] **Step 5: Prove ambiguous broker catalog matches fail closed**

Add tests where two platform symbols both map to the requested canonical instrument and assert `AMBIGUOUS_SYMBOL`, plus a unique suffix/prefix resolution test.

- [ ] **Step 6: Run normalizer, catalog, machine-plan tests**

Run:
`cd cloudflare-v2 && node --test tests/trading_normalizer.test.mjs tests/symbol_catalog.test.mjs tests/machine_plan.test.mjs`

Expected: PASS.

- [ ] **Step 7: Commit**

Commit message:
`feat: normalize broker instruments across market families`

---

### Task 3: Deterministic signal validation plus bounded AI assistance

**Files:**
- Create: `cloudflare-v2/src/normalization/signal_intent_validator.js`
- Modify: `cloudflare-v2/src/ai/trading_interpreter.js`
- Modify: `cloudflare-v2/src/ai/universal_ai.js` only if structured-response handling needs a compatibility adjustment
- Test: `cloudflare-v2/tests/trading_interpreter.test.mjs`
- Test: `cloudflare-v2/tests/signal_intent_validator.test.mjs`
- Test: `cloudflare-v2/tests/ai_router.test.mjs`

**Interfaces:**
- `validateCanonicalSignalIntent(intent, context?) -> { ok, intent?, reason?, warnings? }` validates structure/geometry without broker dispatch.
- Interpreter deterministic HIGH-confidence results bypass AI.
- REVIEW/ambiguous formatting may call AI with the raw message and deterministic evidence, but the returned candidate must pass `validateCanonicalSignalIntent`.

- [ ] **Step 1: Add failing intent-validator tests**

Cover:
- BUY/SELL geometry,
- MARKET range remaining MARKET,
- finite price requirements,
- target ordering/index preservation without over-restricting unconventional strategies,
- malformed or scale-inconsistent candidate rejection when instrument context is supplied,
- broker tick-size/digits consistency where supplied.

- [ ] **Step 2: Add failing AI-interpreter tests for bounded repair**

Cases:
1. Clear `BUY XAUUSD` never calls AI.
2. `TP2: 77,610,00` may use AI only when deterministic token confidence is REVIEW; AI candidate still must match/validate deterministic symbol+side/order evidence.
3. AI changes BUY to SELL -> `NEEDS_REVIEW`.
4. AI invents a missing SL/TP -> `NEEDS_REVIEW` when raw text contains no support for that numeric value.
5. AI outage leaves clear deterministic signals executable but ambiguous signals in `NEEDS_REVIEW`.

- [ ] **Step 3: Run validator/interpreter tests and verify failures**

Run:
`cd cloudflare-v2 && node --test tests/signal_intent_validator.test.mjs tests/trading_interpreter.test.mjs tests/ai_router.test.mjs`

- [ ] **Step 4: Implement shared deterministic validation**

Move geometry validation out of AI-only code into the shared validator. Include optional `instrument`/reference price context, but never require broker metadata at ingestion time when it is unavailable.

- [ ] **Step 5: Integrate AI as candidate assistance, not authority**

Pass the raw signal plus deterministic candidate/evidence in the prompt. On return:
- parse JSON,
- normalize with the same structured-number/symbol rules,
- verify explicit raw evidence for every numeric field,
- reject material disagreement,
- run shared validation,
- return READY only after validation.

- [ ] **Step 6: Run focused AI/validator tests**

Expected: PASS.

- [ ] **Step 7: Commit**

Commit message:
`feat: validate ai-assisted trading interpretations deterministically`

---

### Task 4: Durable broker-state binding and fast-entry production reconciliation

**Files:**
- Modify: `cloudflare-v2/src/execution/production_execution_coordinator.js`
- Modify: `cloudflare-v2/src/execution/production_binding_repair_recorder.js`
- Modify: `cloudflare-v2/src/execution/execution_binding_repair.js`
- Modify: `cloudflare-v2/src/execution/production_binding_repair.js`
- Modify as required after state-store inspection: Trade State Durable Object/store implementation used by the V1 state coordinator
- Modify: `cloudflare-v2/src/pipeline/v1_orchestrator.js` only if persisted OPEN state is not consumed correctly
- Test: `cloudflare-v2/tests/production_state_binding.test.mjs`
- Test: `cloudflare-v2/tests/execution_binding_repair.test.mjs`
- Test: `cloudflare-v2/tests/production_binding_repair_runtime.test.mjs`
- Test: `cloudflare-v2/tests/v1_orchestration.test.mjs`
- Test: production coordinator/state-store tests located during implementation

**Interfaces:**
- A broker-successful OPEN must result in an OPEN/broker-bound leg visible to the same state coordinator used by later correlation.
- Binding repair uses durable successful delivery response and never calls broker dispatch.
- A successful broker result with failed state binding is lifecycle `STATE_BINDING_PENDING`, not eligible for duplicate OPEN retry.

- [ ] **Step 1: Write a failing integration test for broker fill -> correlated fast completion**

Simulate:
1. Fast `BTCUSD BUY` creates group/leg.
2. Broker returns position/order/fill.
3. State binder updates that exact leg to OPEN with broker position ID.
4. Later complete 3-TP signal without reply sees the group as incomplete/recent and correlates `FAST_ENTRY_COMPLETION`.
5. Actions are MODIFY TP1 + OPEN TP2 + OPEN TP3 only.

- [ ] **Step 2: Write a failing state-binding failure/repair test**

Assert:
- broker dispatch invoked once,
- successful delivery response persists broker identifiers,
- failed state bind marks `STATE_BINDING_PENDING`,
- repair binds from stored response,
- repair invokes broker dispatch zero times,
- subsequent complete signal reuses the repaired fast leg.

- [ ] **Step 3: Inspect and align the authoritative Trade State representation**

Trace the exact store used by `stateCoordinator.correlate()` and make `stateBinder()` mutate the same group/leg representation. Do not create a parallel SQL-only state path that correlation does not read.

- [ ] **Step 4: Correct lifecycle outcome reporting**

Keep broker delivery `SUCCEEDED`; expose state binding separately as pending/repaired. The account-level execution summary may report lifecycle partial/pending, but must not imply the broker OPEN itself failed and must never trigger broker resend.

- [ ] **Step 5: Make repair runtime use the same unified dependency/state binder path for cTrader and MT5**

Change production repair composition to the unified dependency factory when necessary so MT5 connector and cTrader repair use identical state-binding behavior.

- [ ] **Step 6: Run state, coordinator, orchestration, binding-repair tests**

Run the focused Node suites for the modified components, then the full `cloudflare-v2` test suite.

- [ ] **Step 7: Commit**

Commit message:
`fix: reconcile broker fills into durable trade state`

---

### Task 5: Complete management-command semantics across markets

**Files:**
- Modify: `cloudflare-v2/src/pipeline/machine_plan.js`
- Modify: `cloudflare-v2/src/execution/position_group.js`
- Modify: `cloudflare-v2/src/pipeline/v1_orchestrator.js`
- Modify: `cloudflare-v2/src/correlation/trade_correlator.js` only where target semantics require it
- Test: `cloudflare-v2/tests/machine_plan.test.mjs`
- Test: `cloudflare-v2/tests/trade_correlation.test.mjs`
- Test: `cloudflare-v2/tests/v1_orchestration.test.mjs`

**Interfaces:**
- Management parser emits canonical types such as `MOVE_SL_TO_BE`, `MOVE_SL`, `CHANGE_TP`, `CLOSE_PARTIAL`, `CLOSE`, `CANCEL_PENDING` plus explicit values/target indices when present.
- Informational state phrases (`TP1 hit`, `hold`, `keep running`) must have explicit audited semantics; they must not create a new trade.
- Correlation remains reply/thread -> explicit symbol -> unique contextual match -> review.

- [ ] **Step 1: Add failing parser tests for approved phrases**

Cover:
- `secure profits`, `risk free`, `set BE`,
- `trail SL to 3650`, `move SL 3650`,
- `change TP to 3700`, `new TP 3700`,
- `delete BTCUSD pending`,
- `TP1 hit`, `hold`, `keep running`,
- symbols including GOLD, FX, BTCUSD, NAS100, Volatility/Boom/Crash products,
- conditional variants remain `NEEDS_INTERPRETATION`.

- [ ] **Step 2: Add failing action-building tests**

Assert explicit SL/TP modifications bind only to uniquely correlated broker-bound legs and preserve unrelated targets/legs. `TP1 hit` updates/audits state without inventing a broker close unless the approved product semantics explicitly require one.

- [ ] **Step 3: Implement minimal management parsing/action support**

Reuse `parseSignalNumber` for explicit management prices. Do not create another number parser.

- [ ] **Step 4: Verify same-symbol/opposite-side ambiguity and stale followups**

Extend correlation tests so no management command silently targets a different trade.

- [ ] **Step 5: Run management/correlation/orchestration suites**

Expected: PASS.

- [ ] **Step 6: Commit**

Commit message:
`feat: complete safe trade management commands`

---

### Task 6: MT5 connector automatic identity sync and visible connection state

**Files:**
- Modify: `cloudflare-v2/src/http/v1_admin_mt5_connector.js`
- Modify: `cloudflare-v2/src/dashboard_mt5_connector_connections.js`
- Modify: `cloudflare-v2/src/dashboard_unified_connections.js` if account cards need stable data attributes/status fields
- Modify: `mt5-connector/mkety_mt5_connector.py` only if gateway identity publication is insufficient for automatic sync
- Modify: `mt5-connector/README.md`
- Test: `cloudflare-v2/tests/mt5_connector_onboarding.test.mjs`
- Test: `cloudflare-v2/tests/mt5_connector_frontend.test.mjs`
- Test: `mt5-connector/test_connector.py`
- Test: `.github/workflows/production-frontend-e2e.yml` assertions as needed

**Interfaces:**
- Pairing row status transitions are explicit: `awaiting_connector` -> `connected`, or an observable error/offline state.
- Identity sync is automatically attempted once the gateway reports a matching online connector; a manual `Retry identity sync` is recovery-only.
- Connected identity persists actual MT5 account number, server, broker/environment, symbol catalog, and removes the one-time token from retained credentials.
- Account remains inactive/execution-disabled/live-disabled until user explicitly enables demo trading after identity verification.

- [ ] **Step 1: Add failing backend onboarding tests for auto-sync/status**

Cover:
- newly created row is pending and disabled,
- status/read endpoint observes online gateway and performs the same safe identity patch as manual sync,
- environment mismatch fails closed,
- offline connector remains pending with a visible reason,
- one-time token is not retained after successful sync,
- no sync operation enables execution/live execution.

- [ ] **Step 2: Add failing frontend tests removing fragile text matching**

Assert account rows use stable platform/provider-mode/status data, not `card.textContent.indexOf('mt5_connector')`. Assert visible states `Awaiting connector`, `Connected`, and a recovery `Retry identity sync` control where appropriate.

- [ ] **Step 3: Implement one reusable backend `syncConnectionIdentity` operation**

Both automatic status refresh and manual retry call the same function. Do not duplicate gateway validation/credential rewriting logic.

- [ ] **Step 4: Implement safe frontend polling/refresh for pending MT5 rows**

Poll only bounded pending connector rows while the Connections view is active; stop polling after connected/error terminal state or page navigation. Refresh account rendering on successful identity sync.

- [ ] **Step 5: Add duplicate pending-row cleanup UX using existing authorized account-delete flow**

The connected row must be unambiguous. Deleting a duplicate pending row must not affect the connected connector row or its credentials.

- [ ] **Step 6: Run Node frontend/onboarding and Python connector tests**

Commands:
`cd cloudflare-v2 && node --test tests/mt5_connector_onboarding.test.mjs tests/mt5_connector_frontend.test.mjs`
`python -m unittest mt5-connector/test_connector.py`

Expected: PASS.

- [ ] **Step 7: Commit**

Commit message:
`fix: make mt5 connector identity sync observable and automatic`

---

### Task 7: Operations recent-event and reconciliation visibility

**Files:**
- Modify: `cloudflare-v2/src/http/v1_admin_operations.js`
- Modify dashboard Operations rendering file located by current admin dashboard composition
- Test: `cloudflare-v2/tests/v1_admin_operations.test.mjs`
- Test: `cloudflare-v2/tests/v1_admin_event_audit.test.mjs`
- Test dashboard actions/rendering suite as located

**Interfaces:**
- `snapshot(workspaceId)` gains `recentEvents`, bounded by existing `recentLimit`.
- Each recent event exposes only sanitized source/status/canonical summary, delivery outcome, correlation/state-binding summary, and event ID for audit drilldown.
- Exact workspace scoping is enforced on every query/result.

- [ ] **Step 1: Extend the Operations test Supabase mock to include `trading_events`**

Add events from two workspaces and secret-bearing metadata. Assert only the requested workspace is returned and secrets are absent.

- [ ] **Step 2: Add failing recent-event snapshot assertions**

Assert newest-first bounded output includes processing status, canonical symbol/side/order type, high-level error, and event ID. Add state-binding pending/repaired indication derived from delivery markers without exposing response payloads.

- [ ] **Step 3: Implement bounded recent-event query and sanitizer composition**

Reuse `safeAuditEvent`/existing secret sanitizer. Do not return raw text, request payload, response payload, credentials, or broker account identifiers unnecessarily.

- [ ] **Step 4: Add dashboard rendering/audit drilldown**

Display source, time, symbol/side, parser status, broker status, and state/reconciliation state. Link/drill into the existing event audit endpoint.

- [ ] **Step 5: Run Operations/audit/dashboard tests**

Expected: PASS.

- [ ] **Step 6: Commit**

Commit message:
`feat: expose recent trading lifecycle in operations`

---

### Task 8: Cross-broker idempotency, reconnect, and parity regression

**Files:**
- Modify only where regressions expose gaps: cTrader executor/runtime tests and MT5 connector/executor tests
- Test: `cloudflare-v2/tests/v1_multi_account_fast_completion.test.mjs`
- Test: `cloudflare-v2/tests/production_execution_coordinator.test.mjs`
- Test: `cloudflare-v2/tests/execution_binding_repair.test.mjs`
- Test: MT5 connector executor/replay tests
- Test: cTrader Open API/cBot executor tests

**Interfaces:**
- Same canonical action/idempotency identity on both broker families.
- Duplicate Telegram/edit/retry, connector reconnect, and uncertain broker response must reconcile before any resend.

- [ ] **Step 1: Add/extend cTrader parity tests**

Prove MARKET/pending, 3-TP fast completion, modify SL/TP, BE, partial/full close, pending cancel, duplicate delivery, and uncertain response all obey the shared lifecycle.

- [ ] **Step 2: Add/extend MT5 parity tests**

Run the same semantic matrix through outbound MT5 connector, including volume min/max/step and symbol suffix resolution. Legacy bridge compatibility should keep existing supported behavior.

- [ ] **Step 3: Add reconnect/replay duplicate tests**

Assert a previously acknowledged action is returned/reconciled as duplicate and does not create a second broker order.

- [ ] **Step 4: Run complete Worker/MT5/MTProto test suites**

Use the repository's CI-equivalent commands, including Node tests and Python MT5/MTProto tests.

- [ ] **Step 5: Commit**

Commit message:
`test: enforce ctrader and mt5 lifecycle parity`

---

### Task 9: Security review, PR, production deployment, and controlled demo acceptance

**Files:**
- No feature files unless review/acceptance exposes a defect.
- Update operational docs only for final customer-visible MT5 flow if tests confirm behavior.

**Interfaces:**
- Production acceptance is demo-only.
- Live global/account execution gates remain OFF.

- [ ] **Step 1: Run full local/CI-equivalent verification**

Verify:
- all Worker/trading-core tests,
- MT5 connector/bridge tests,
- external MTProto tests,
- lint/build checks used by repository CI.

- [ ] **Step 2: Run code/security review**

Use review workflow on the complete diff. Resolve correctness/security findings, especially ReDoS risk in parser regexes, secret leakage, workspace isolation, broker duplicate execution, and live-gate regressions.

- [ ] **Step 3: Open PR and wait for full GitHub CI/CodeQL evidence**

Require all relevant checks green and CodeQL no new alerts before merge.

- [ ] **Step 4: Merge and deploy production Worker/gateway/connector artifacts required by changed components**

A Worker deploy alone is not proof of MT5 gateway/connector health. Verify each changed deployable component separately.

- [ ] **Step 5: Confirm production safety posture before acceptance**

Query current account/runtime controls and verify live-money execution remains disabled. Demo execution may be enabled only for the controlled acceptance accounts.

- [ ] **Step 6: Run cTrader demo acceptance**

Sequence:
1. fast `BTCUSD buy` -> exactly one broker position and durable bound leg;
2. complete comma-formatted 3-TP signal without reply -> existing leg becomes TP1 and only two new positions open;
3. total exactly three positions;
4. verify correct SL/TP values including safe `77,610,00` repair;
5. test BE, partial close, explicit SL/TP modification, pending cancel, full close;
6. inspect Operations/audit after each stage.

- [ ] **Step 7: Run MT5 demo pairing and lifecycle acceptance**

Sequence:
1. run connector against logged-in demo MT5;
2. verify pending row auto-transitions to connected with actual account/server/catalog;
3. keep trading OFF until identity verified;
4. enable demo execution only;
5. repeat fast + complete 3-TP + management lifecycle;
6. verify reconnect/replay does not duplicate orders;
7. clean accidental duplicate pending pairing row safely.

- [ ] **Step 8: Exercise AI ambiguity production acceptance**

Use a demo-only malformed-but-bounded signal. Verify AI provider actually responds, candidate is deterministic-validated, and disagreement/outage fails closed. Do not infer AI provider health merely from deterministic signals.

- [ ] **Step 9: Final verification and completion report**

Report concrete evidence: merged commit, CI runs, CodeQL result, deploy run(s), production account safety state, cTrader demo results, MT5 demo results, parser outputs, and any remaining non-blocking limitations. Do not claim complete if either broker acceptance has not passed.