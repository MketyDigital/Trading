# Hot-Path Isolation and Resilience Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Minimize Mkety-caused signal/execution failure and latency by isolating optional dependencies from the trading hot path, making Telegram destination AI presentation-only with deterministic fallback, adding safe runtime snapshots/circuit breakers, and producing secret-free latency evidence for launch.

**Architecture:** Preserve the current canonical event, deterministic parser, risk, persistent idempotency, broker coordinator, Trade State, and retry architecture. Add small focused modules around those existing boundaries: destination presentation is a sibling branch, execution AI remains ambiguity-only, configuration snapshots reduce repeated reads but never replace the final authoritative dispatch gate, and latency/failure instrumentation is side-effect-free and secret-free.

**Tech Stack:** Cloudflare Workers JavaScript/ES modules, Durable Objects, Supabase, MT5 Python bridge, cTrader Open API runtime, Telegram MTProto runtimes, Node test runner, Python unittest.

**Spec:** `docs/superpowers/specs/2026-09-03-hot-path-isolation-and-resilience-design.md`

## Global Constraints

- `TRADINGVIEW_DIRECT_INGRESS_ENABLED=false`, `TRADINGVIEW_CERT_PROBE_ENABLED=false`, `TRADING_ACCESS_ENABLED=false`, and `BROKER_EXECUTION_ENABLED=false` remain the default development/deployment state.
- No implementation task may enable real-money execution, merge `main`, invoke Cloudflare deploy/probe actions, or require real external credentials.
- Clear deterministic trade instructions must never call AI.
- AI may resolve ambiguous execution instructions only; post-validation remains deterministic and authoritative.
- Telegram destination AI is presentation-only and must fall back to deterministic formatting on failure, timeout, invalid output, or provider unavailability.
- Canonical symbol, direction, entry, SL, TP, Position Group, broker account, risk/lot and execution command are immutable across destination presentation.
- Zitadel, admin UI, audit, analytics, reporting, notifications, historical queries and destination AI must not become synchronous dependencies of broker dispatch.
- Persistent canonical-event and destination/order idempotency, broker reconciliation, exact workspace/account authority, final safety/kill-switch checks and master broker fuse remain mandatory.
- Safety revocation must override cached configuration immediately or force authoritative revalidation before dispatch.
- Tests are TDD RED first, exact-head GREEN second; ordinary branch work uses PR CI only and must leave Cloudflare jobs skipped.

---

### Task 1: Lock the execution-AI hot-path contract

**Files:**
- Modify: `cloudflare-v2/tests/trading_interpreter.test.mjs`
- Modify only if needed: `cloudflare-v2/src/ai/trading_interpreter.js`

**Interfaces:**
- Consumes: `interpretTradingEvent(event, { aiRouter, timeoutMs })`
- Produces: deterministic READY/management/non-actionable results without touching `aiRouter`; AI is invoked only for `NEEDS_INTERPRETATION`.

- [ ] **Step 1: Write failing/strengthening tests**

Add tests with an `aiRouter.processSignal()` spy that throws if called. Cover a complete NEW_SIGNAL and deterministic management command. Add a separate ambiguous event where the AI provider returns `{ success:false }` and assert `NEEDS_REVIEW`, not guessed execution.

- [ ] **Step 2: Run the focused tests**

Run the repository Node suite through CI on the test-only commit. Expected: any missing contract fails only in interpreter tests; external jobs skipped.

- [ ] **Step 3: Implement the minimum behavior if RED**

Keep the existing shape:

```js
const deterministic = buildMachinePlan(event);
if (deterministic.status !== 'NEEDS_INTERPRETATION') {
  return { ...deterministic, source: 'deterministic' };
}
```

Do not add AI to deterministic results.

- [ ] **Step 4: Verify exact-head GREEN and commit evidence**

Expected: full Node + MT5 + MTProto suites GREEN; Cloudflare/deploy/probe jobs skipped.

---

### Task 2: Add deterministic Telegram destination presentation with optional AI fallback

**Files:**
- Create: `cloudflare-v2/src/destinations/telegram_presentation.js`
- Create: `cloudflare-v2/tests/telegram_presentation.test.mjs`

**Interfaces:**
- Produces:

```js
renderTelegramDestination({
  canonicalEvent,
  destination,
  aiFormatter,
  timeoutMs,
}) -> Promise<{
  text: string,
  mode: 'DETERMINISTIC'|'AI',
  fallbackReason: string|null,
}>
```

- Canonical structured values are supplied separately from presentation text and are never mutated.

- [ ] **Step 1: Write RED tests**

Cover deterministic output for BUY/SELL signals and management events; configured label/prefix/suffix/emoji/field-order transformations; AI success; AI timeout/error/invalid result fallback; and immutability of canonical symbol/side/entry/SL/TP values.

- [ ] **Step 2: Run RED**

Expected: module missing / behavior missing only in the new destination presentation tests.

- [ ] **Step 3: Implement deterministic formatter**

Create a pure formatter that reads canonical values and destination presentation config. It may change labels/order/copy but never canonical data.

- [ ] **Step 4: Add bounded optional AI presentation**

Call `aiFormatter` only after deterministic text already exists. On any failure/timeout/invalid output, immediately return the deterministic text with a bounded `fallbackReason` code.

- [ ] **Step 5: Validate structured fields in AI-rendered output when structured trade fields are requested**

Use canonical values as authority. If the returned structured projection conflicts, discard AI output and fall back.

- [ ] **Step 6: Verify exact-head GREEN**

Full suites GREEN; no external jobs.

---

### Task 3: Compose Telegram destination fanout independently from broker execution

**Files:**
- Modify: `cloudflare-v2/src/destinations/destination_fanout.js`
- Create or modify focused tests under `cloudflare-v2/tests/` for destination fanout/presentation integration.

**Interfaces:**
- Existing `dispatchDestinationFanout()` remains sibling-isolated.
- Destination presentation failure must never throw into broker execution orchestration.

- [ ] **Step 1: Write RED integration tests**

Prove one Telegram destination AI failure falls back and succeeds; one Telegram network destination failure does not fail sibling destinations; and destination failure has no callback/path capable of cancelling broker execution.

- [ ] **Step 2: Implement the minimum composition**

Presentation occurs inside each destination task. Keep `Promise.all()` sibling isolation. Return sanitized destination outcomes only.

- [ ] **Step 3: Verify full GREEN**

No broker/deploy calls.

---

### Task 4: Add secret-free hot-path latency marks

**Files:**
- Create: `cloudflare-v2/src/observability/trading_latency.js`
- Modify: `cloudflare-v2/src/http/v1_events.js`
- Modify: `cloudflare-v2/src/execution/execution_coordinator.js`
- Modify destination presentation/fanout integration as needed.
- Create: `cloudflare-v2/tests/trading_latency.test.mjs`

**Interfaces:**
- Produces `createTradingLatencyTrace({ eventId, workspaceId, clock })` with bounded named marks and derived durations.
- No raw signal text, credentials, broker account/login, token, payload, or provider secret is accepted into the trace.

- [ ] **Step 1: Write RED tests**

Cover allowed marks: `SOURCE_RECEIVED`, `EVENT_PERSISTED`, `INTERPRETATION_DONE`, `AI_START`, `AI_DONE`, `PLAN_READY`, `IDEMPOTENCY_DONE`, `BROKER_SEND`, `BROKER_ACK`, `DESTINATION_FORMAT_START`, `DESTINATION_FORMAT_DONE`, `DESTINATION_ACK`.

- [ ] **Step 2: Implement pure trace helper**

Use injected monotonic/UTC clock. Reject arbitrary secret-bearing metadata; retain only IDs already safe for operations correlation and numeric timestamps/durations.

- [ ] **Step 3: Instrument existing boundaries without making telemetry authoritative**

Tracing failures are swallowed/sanitized and cannot stop execution. The broker path never awaits an external analytics provider.

- [ ] **Step 4: Verify GREEN and secret-redaction tests**

---

### Task 5: Add versioned runtime execution snapshots without weakening final authority

**Files:**
- Create: `cloudflare-v2/src/execution/runtime_execution_snapshot.js`
- Modify: `cloudflare-v2/src/execution/execution_coordinator.js`
- Create: `cloudflare-v2/tests/runtime_execution_snapshot.test.mjs`

**Interfaces:**
- Produces a workspace/account/source keyed in-memory snapshot cache containing only non-secret execution configuration.
- `getSnapshot(key)`, `putSnapshot(record)`, `invalidate(key)`, `invalidateWorkspace(workspaceId)`.
- The coordinator still reloads/revalidates authoritative safety state immediately before broker dispatch.

- [ ] **Step 1: Write RED tests**

Cover cache hit avoiding repeated non-critical configuration hydration; no credential fields retained; version mismatch causes refresh; account/source disable and kill switch invalidate/recheck before dispatch; stale snapshot can never override authoritative broker fuse/account state.

- [ ] **Step 2: Implement bounded cache**

Use max-entry and TTL limits. No unbounded global map.

- [ ] **Step 3: Integrate only non-critical configuration reuse**

Do not cache away the final authoritative account/safety lookup already required by `execution_coordinator.js`.

- [ ] **Step 4: Verify GREEN**

---

### Task 6: Add provider-isolated circuit breakers and bounded timeouts

**Files:**
- Create: `cloudflare-v2/src/resilience/provider_circuit_breaker.js`
- Modify: destination AI composition and ambiguity AI call sites.
- Create: `cloudflare-v2/tests/provider_circuit_breaker.test.mjs`

**Interfaces:**
- Circuit key includes purpose plus provider/workspace where applicable.
- State: `CLOSED`, `OPEN`, `HALF_OPEN` with bounded counters and reset deadline.

- [ ] **Step 1: Write RED tests**

Prove one destination AI provider/workspace circuit cannot block another workspace, broker execution, deterministic destination fallback, or a different AI provider.

- [ ] **Step 2: Implement pure breaker**

No persistent database dependency on hot path. In-memory/runtime state only; failure of the breaker itself defaults to allowing deterministic fallback logic, never blocking clear execution.

- [ ] **Step 3: Integrate with bounded AI timeouts**

Ambiguity AI timeout => `NEEDS_REVIEW`; destination AI timeout/open circuit => deterministic fallback.

- [ ] **Step 4: Verify GREEN**

---

### Task 7: Add failure-injection launch contracts

**Files:**
- Create: `cloudflare-v2/tests/hot_path_failure_isolation.test.mjs`
- Modify CI only if required to ensure the new file is included by the existing Node suite.

**Interfaces:**
- No production API changes.

- [ ] **Step 1: Write integrated failure-injection tests**

Inject failures for AI, audit callback, analytics callback, destination formatting, optional database query, Telegram destination send, and stale snapshot. Assert clear broker execution still reaches the mocked broker exactly once whenever mandatory safety/idempotency dependencies remain healthy.

- [ ] **Step 2: Add mandatory-failure tests**

Inject persistent idempotency failure, broker fuse off, kill switch, account disabled, and broker uncertain state. Assert broker dispatch is blocked exactly where correctness requires it.

- [ ] **Step 3: Verify full exact-head GREEN**

Record counts and external-job skips in `AGENTS.md`.

---

### Task 8: Add static launch-readiness latency/failure summary

**Files:**
- Modify: `cloudflare-v2/src/http/v1_admin_operations.js`
- Modify: focused operations tests.

**Interfaces:**
- Existing `GET /api/v1/admin/operations` gains only secret-free bounded resilience counters/latency summaries when available.
- No external analytics dependency is introduced.

- [ ] **Step 1: Write RED tests**

Prove owner/admin-only exact-workspace access and secret-free summaries for fallback counts, retry/uncertain rates and p50/p95/p99 values supplied by the internal metrics source.

- [ ] **Step 2: Implement additive read-only output**

If metrics source is unavailable, operations endpoint reports metrics unavailable but does not affect trading.

- [ ] **Step 3: Verify GREEN**

---

### Task 9: Update operational handoff and launch gates

**Files:**
- Modify: `AGENTS.md`

- [ ] **Step 1: Record exact RED/GREEN evidence**

Include commit SHAs, CI run IDs, test counts, and confirmation that all Cloudflare/deploy/probe jobs were skipped for static work.

- [ ] **Step 2: Preserve external acceptance blockers**

Real Telegram soak, managed Zitadel acceptance, MT5/cTrader demo probes/lifecycles, and sustained staging latency/failure measurements remain acceptance work rather than code rewrites.

- [ ] **Step 3: Keep Gate 10 closed**

Record that real-money cutover remains forbidden until all mandatory gates are GREEN and the user gives separate explicit final approval.
