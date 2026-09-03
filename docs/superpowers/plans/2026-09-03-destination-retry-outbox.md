# Durable Destination Retry and Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make broker destination execution recover independently from source-event replay while preserving persistent exactly-once intent, tenant isolation, fail-closed ambiguity handling, and all production master fuses OFF.

**Architecture:** Extend the existing `destination_deliveries` record into the durable execution/outbox state machine rather than introducing a second authority. A delivery is reserved before dispatch and may become `SUCCEEDED`, `RETRYABLE`, `FAILED`, or `UNCERTAIN`; only explicitly safe failures may be claimed for automatic retry. MT5 recovery must first close the bridge crash gap by reconciling a deterministic broker marker before replay; cTrader pre-send failures may retry, but post-send timeout/connection uncertainty is quarantined until broker-side reconciliation exists. A bounded recovery runtime scans/claims only due retryable deliveries and reconstructs dispatch from server-persisted trusted action data, never from source-event replay or caller credentials.

**Tech Stack:** Cloudflare Workers ES modules, Supabase/PostgreSQL, Node.js 22 tests, Python 3.12 MT5 bridge tests, MT5 Python API bridge, cTrader Open API JSON protocol, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-09-03-production-execution-bridge-design.md` plus the operational next-action contract in `AGENTS.md`.

## Global Constraints

- Work only on `design/enterprise-trading-event-core` / draft PR #2; never merge `main` without explicit user instruction.
- Keep `TRADINGVIEW_DIRECT_INGRESS_ENABLED=false`.
- Keep `TRADINGVIEW_CERT_PROBE_ENABLED=false`.
- Keep deployed `TRADING_ACCESS_ENABLED=false` until real Gate 4 acceptance/explicit launch progression.
- Keep deployed `BROKER_EXECUTION_ENABLED=false` until Gate 10 and separate explicit user approval.
- No real-money execution, live broker credentials, Cloudflare deploy marker, or real broker call in this implementation batch.
- Tenant isolation is exact by workspace, destination/account, event, idempotency key, retry record, and broker credential authority.
- Source-event replay is never the broker retry mechanism; canonical source dedupe remains terminal.
- Persistent destination idempotency remains the single execution authority.
- Automatic retry requires proof that replay cannot create a second broker action; ambiguous post-send state must become `UNCERTAIN`, not `RETRYABLE`.
- Sibling destination/account failures remain isolated.
- Preserve cTrader raw `ProtoOASymbol.lotSize` protocol-cent semantics.
- Never store or log bridge secrets, access tokens, database credentials, Telegram sessions, or arbitrary credential-bearing broker responses.
- Batch changes and use the single PR regression workflow; Cloudflare/action exact-marker jobs remain skipped.

---

### Task 1: Make `destination_deliveries` a real retry state machine and fix the production reservation contract

**Files:**
- Modify: `cloudflare-v2/src/persistence/supabase_delivery_store.js`
- Create: `cloudflare-v2/db/migrations/0011_destination_delivery_retry_state.sql`
- Modify: `cloudflare-v2/db/schema.sql`
- Test: `cloudflare-v2/tests/supabase_delivery_store.test.mjs`
- Create: `cloudflare-v2/tests/destination_retry_migration.test.mjs`

**Interfaces:**
- `reserve(idempotencyKey, requestPayload)` returns `{ ok: true, duplicate: false, row }` for the first durable reservation.
- Existing `SUCCEEDED` delivery remains terminal duplicate and returns persisted result.
- Add `markRetryable(idempotencyKey, failure, { nextAttemptAt })`.
- Add `markUncertain(idempotencyKey, failure)`.
- Keep `fail(idempotencyKey, failure)` as terminal failure.
- Add `claimRetry(idempotencyKey, { now, leaseUntil })` which atomically changes one exact due `RETRYABLE` row to `PENDING`, increments `attempt_count`, clears retry error state as appropriate, and returns the claimed row; non-due/non-retryable claims return no claim.
- Add `listRetryable({ now, limit })` scoped to the store workspace/destination authority where used, or a separate server-only recovery query in Task 4 if cross-workspace scanning is cleaner.

- [ ] **Step 1: Write the failing production-store tests.**

Add assertions covering:
```js
const first = await store.reserve('k1', { destinationType: 'mt5', action: { type: 'OPEN_POSITION' } });
assert.equal(first.ok, true);
assert.equal(first.duplicate, false);
```

Then prove:
- `SUCCEEDED` duplicate returns `duplicate=true` and persisted public result;
- `markRetryable()` sets `status='RETRYABLE'`, a bounded error code, and `next_attempt_at`;
- `claimRetry()` succeeds only for exact due `RETRYABLE`, increments `attempt_count`, and moves to `PENDING`;
- concurrent/second claim does not acquire the same delivery;
- `markUncertain()` sets `UNCERTAIN` and cannot be auto-claimed;
- terminal `FAILED` cannot be auto-claimed.

- [ ] **Step 2: Write the migration contract test.**

Require additive retry metadata on `destination_deliveries`:
```sql
next_attempt_at TIMESTAMPTZ,
lease_expires_at TIMESTAMPTZ,
last_attempt_at TIMESTAMPTZ,
failure_class TEXT
```

Require an index suitable for bounded due-retry scans. Do not loosen the existing unique `(workspace_id, idempotency_key)` constraint or RLS posture.

- [ ] **Step 3: Run RED.**

Run the ordinary PR regression with only these new tests changed. Expected: existing tests remain GREEN; new reservation/retry/migration contracts fail because the store has no retry state machine and fresh `reserve()` omits `ok:true`.

- [ ] **Step 4: Implement the minimal state machine.**

Use conditional Supabase updates for claims. The claim update must include exact workspace + idempotency key + `status='RETRYABLE'` + due-time eligibility so two workers cannot both acquire the same retry. On claim, increment attempts using a server-safe method; if atomic increment cannot be guaranteed through the current client chain, add a narrowly scoped service-role SQL/RPC function in the migration and test its exact workspace/idempotency predicates.

- [ ] **Step 5: Run targeted and full verification.**

Run Node test suite plus MT5/MTProto Python suites. No external action job.

- [ ] **Step 6: Record Task 1 evidence in `AGENTS.md`.**

### Task 2: Close the MT5 bridge replay crash gap before allowing automatic broker retry

**Files:**
- Modify: `cloudflare-v2/bridges/mt5_bridge.py`
- Modify: `cloudflare-v2/bridges/test_mt5_bridge.py`
- Modify if needed: `cloudflare-v2/src/adapters/mt5_executor_v2.js`
- Test if needed: `cloudflare-v2/tests/mt5_executor_v2.test.mjs`

**Interfaces:**
- Add deterministic bounded broker marker `command_marker(command_id)` using a cryptographic digest so it fits MT5's comment limit and does not collide through ordinary truncation.
- Before executing a command whose replay-ledger entry is absent, reconcile the exact marker + configured magic/account against active orders/positions and bounded recent broker history.
- If exact prior execution is found, reconstruct normalized response, persist it into the bridge replay ledger, and return it as duplicate/recovered without another `order_send`.
- If broker state is ambiguous rather than provably absent, fail closed and do not call `order_send`.

- [ ] **Step 1: Write Python RED tests.**

Prove:
- marker is deterministic and within MT5 comment length;
- ledger hit never calls broker execution;
- ledger miss + matching existing broker order/deal/position reconstructs prior success and never calls `order_send`;
- ledger miss + ambiguous lookup fails closed;
- only a provably absent marker can proceed to fresh execution;
- a simulated crash after broker acceptance but before ledger write is recovered on replay without a second broker order.

- [ ] **Step 2: Verify RED locally/through ordinary regression.**

Expected: new reconciliation contracts fail while existing bridge tests remain GREEN.

- [ ] **Step 3: Implement reconciliation with bounded broker queries.**

Use configured account/magic plus exact deterministic marker. Do not infer identity from symbol/side/volume alone. Keep management commands tied to already bound broker IDs and the same command idempotency semantics.

- [ ] **Step 4: Classify MT5 transport failures.**

Once bridge replay/reconciliation is proven, failures that occur at the Worker→bridge transport boundary may be marked `RETRYABLE` because resending the identical command ID is broker-reconciled. Deterministic broker rejection remains terminal `FAILED`; malformed/authority failures remain terminal.

- [ ] **Step 5: Run full Node/Python verification and record evidence.**

### Task 3: Make cTrader retry classification fail closed

**Files:**
- Modify: `cloudflare-v2/src/adapters/ctrader_session.js` only if explicit send-state metadata is needed.
- Modify: `cloudflare-v2/src/adapters/ctrader_executor_v2.js`
- Test: `cloudflare-v2/tests/ctrader_session.test.mjs`
- Test: `cloudflare-v2/tests/ctrader_executor_v2.test.mjs`

**Interfaces:**
- Distinguish failures that are provably before `socket.send()` from failures that happen after send may have occurred.
- Pre-send failures may be `RETRYABLE`.
- Post-send timeout, connection loss with pending request, or any response ambiguity is `UNCERTAIN` until cTrader broker-side reconciliation by client order ID is implemented and acceptance-tested.
- Deterministic cTrader rejections are terminal `FAILED`.

- [ ] **Step 1: Write RED tests for send-state classification.**

Prove socket-not-open / synchronous send failure is safe-to-retry only when no bytes were accepted by the socket abstraction. Prove timeout after successful `send()` and connection close with a pending request are uncertain and never auto-retried.

- [ ] **Step 2: Implement minimal classification metadata/error types.**

Do not add blind order-history guessing and do not resend an uncertain command.

- [ ] **Step 3: Run targeted/full verification and record evidence.**

### Task 4: Add bounded server-side destination recovery runtime

**Files:**
- Create: `cloudflare-v2/src/execution/destination_retry_runtime.js`
- Modify: `cloudflare-v2/src/v1_entry.js`
- Test: `cloudflare-v2/tests/destination_retry_runtime.test.mjs`
- Modify: `cloudflare-v2/tests/v1_entry.test.mjs` or equivalent scheduled-runtime test if needed.

**Interfaces:**
- `createDestinationRetryRuntime()` returns an async scheduled/runtime function.
- First execution lock is server-side `BROKER_EXECUTION_ENABLED === true`; when false, return `{ status: 'BROKER_EXECUTION_DISABLED', scanned: 0, dispatched: 0 }` before Supabase or broker dependency construction.
- Scan only bounded due `RETRYABLE` deliveries.
- Atomically claim each row before dispatch.
- Reconstruct execution from persisted trusted request payload plus server-loaded exact workspace/account/destination state.
- Re-run current account active/execution/safety/kill-switch/destination locks before broker dispatch; retry authorization is never frozen from the original attempt.
- Never process `UNCERTAIN`, `FAILED`, or `SUCCEEDED` rows automatically.
- One failed retry never blocks siblings.
- Cap attempts and use bounded exponential backoff; exhausted attempts become terminal `FAILED` or reviewed `UNCERTAIN` according to broker classification.

- [ ] **Step 1: Write RED runtime tests.**

Prove broker-disabled structural zero-work, due-only scanning, atomic claim, current account lock revalidation, sibling isolation, attempt cap/backoff, and no source-event replay.

- [ ] **Step 2: Implement runtime with injected dependencies first.**

Keep recovery logic independently testable; production composition may use the existing `createProductionExecutionDependencies` and service-role Supabase factory only after the global fuse check.

- [ ] **Step 3: Wire scheduling without changing deployment fuses.**

Reuse an existing cron path where possible. The recovery runtime must be harmless with `BROKER_EXECUTION_ENABLED=false`; do not add a Cloudflare-only security dependency and preserve Free-profile validity.

- [ ] **Step 4: Run full regression.**

Node/Worker, MT5 bridge, Container MTProto, and external MTProto suites must all be GREEN; Cloudflare/deploy/probe jobs skipped.

### Task 5: Static end-to-end retry acceptance and operational documentation

**Files:**
- Create: `cloudflare-v2/tests/production_destination_retry_acceptance.test.mjs`
- Modify: `AGENTS.md`
- Modify if useful: `cloudflare-v2/docs/STAGING_V1_RUNBOOK.md`

**Interfaces:**
- Static acceptance proves one Telegram/V1-planned broker action can fail after source-event reservation and recover through destination retry state without replaying/reinterpreting the source event.

- [ ] **Step 1: Add acceptance tests.**

Required cases:
- source/canonical event remains one record;
- first destination attempt creates one idempotency row;
- MT5 retry uses the identical command ID and resolves to one broker action under bridge replay/reconciliation;
- cTrader ambiguous post-send outcome becomes `UNCERTAIN` and does not issue a second order;
- successful retry binds broker IDs exactly once to the intended Trade State leg;
- account kill switch/global broker fuse becoming OFF before retry blocks dispatch;
- no tenant can claim/retry another tenant's delivery.

- [ ] **Step 2: Run exact-head full regression only.**

No Cloudflare marker and no real broker credentials.

- [ ] **Step 3: Update `AGENTS.md` with exact RED/GREEN heads/runs and remaining real acceptance blockers.**

- [ ] **Step 4: Do not enable master fuses or merge.**

After static retry recovery is GREEN, proceed to real Telegram Gate 5 soak and broker **demo** Gate 6/7/8 acceptance using protected credentials. Real-money activation remains Gate 10 plus a separate explicit user approval.
