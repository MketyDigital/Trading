# Mkety Enterprise Trading V1 Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the smallest production-grade enterprise foundation for Mkety Trading: secure multi-tenant ingress, Zitadel-controlled access, durable idempotency, low-latency Telegram delivery, AI-assisted formatting with deterministic fallback, and simulation-safe machine execution plumbing.

**Architecture:** Keep `cloudflare-v2/` as the standalone Trading runtime. The Worker becomes a thin orchestrator around versioned trading-event contracts, auth/entitlement checks, ingestion, fast human-delivery fan-out, and a separate simulation-only machine path. AI is used aggressively for Telegram formatting when configured and within a strict latency budget, while deterministic formatting is the immediate fallback; machine execution never consumes rendered HTML and remains simulation-only in this batch.

**Tech Stack:** Cloudflare Workers, Durable Objects, Supabase/PostgreSQL, `@mtcute/web`, Telegram Bot API, Zitadel OIDC/JWKS, Node test runner (`node:test`), GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-09-01-enterprise-trading-event-core-design.md`

## Global Constraints

- All active implementation stays under `cloudflare-v2/` except repository-level CI and documentation.
- Do not change legacy root runtime files.
- Preserve current Telegram source/listener behavior while introducing the new event contract behind it.
- Human signal delivery and machine planning are parallel paths; neither waits unnecessarily for the other.
- AI is preferred for configured Telegram formatting when it can satisfy the route latency budget; deterministic formatting is the immediate fallback.
- Machine execution must never use Telegram HTML as its source of truth.
- Real-money execution stays disabled in V1 foundation.
- Every source and destination operation must be idempotent.
- Workspace authority comes from authenticated server-side identity/entitlement mapping, never arbitrary browser `workspace_id` input.
- No secrets may be committed or returned to browsers/logs.
- Every meaningful batch updates `AGENTS.md` with branch/PR state, tests, migrations/config, blockers and next safe start.

---

## File Structure

### New files

- `cloudflare-v2/src/events/trading_event.js` — versioned `TradingEventEnvelope` normalization/validation.
- `cloudflare-v2/src/security/source_auth.js` — HMAC source authentication, timestamp/replay checks.
- `cloudflare-v2/src/security/zitadel_auth.js` — Zitadel JWKS verification and trusted entitlement extraction.
- `cloudflare-v2/src/formatting/telegram_formatter.js` — AI-first-with-budget Telegram formatting and deterministic fallback.
- `cloudflare-v2/src/pipeline/human_delivery.js` — low-latency Telegram fan-out.
- `cloudflare-v2/src/pipeline/machine_plan.js` — deterministic simulation-only machine plan contract.
- `cloudflare-v2/src/config/validate_env.js` — safe configuration validation.
- `cloudflare-v2/db/migrations/0001_enterprise_v1_foundation.sql` — additive V1 tables/columns/indexes.
- `cloudflare-v2/tests/*.test.mjs` — unit/contract tests.
- `.github/workflows/trading-v1-ci.yml` — CI for `cloudflare-v2`.

### Modified files

- `cloudflare-v2/package.json` — test scripts.
- `cloudflare-v2/src/index.js` — thin routing/orchestration into new modules while keeping legacy-compatible `/api/webhook/process_signal`.
- `cloudflare-v2/src/listener/listener_node.js` — emit the universal envelope without exposing session secrets.
- `cloudflare-v2/src/ai/universal_ai.js` — align provider field names/env injection and expose bounded formatting call.
- `cloudflare-v2/db/schema.sql` — retained as bootstrap reference but aligned only after migration exists.
- `AGENTS.md` — progress evidence and next safe start.

---

### Task 1: Establish test runner and CI safety net

**Files:**
- Modify: `cloudflare-v2/package.json`
- Create: `cloudflare-v2/tests/smoke.test.mjs`
- Create: `.github/workflows/trading-v1-ci.yml`

**Interfaces:**
- Produces: `npm test` and CI that runs tests from `cloudflare-v2/` on PRs/pushes.

- [ ] **Step 1: Write the failing smoke test**

```js
import test from 'node:test';
import assert from 'node:assert/strict';

import worker from '../src/index.js';

test('worker module exports fetch and scheduled handlers', () => {
  assert.equal(typeof worker.fetch, 'function');
  assert.equal(typeof worker.scheduled, 'function');
});
```

- [ ] **Step 2: Run test to verify current tooling fails**

Run: `cd cloudflare-v2 && npm test`
Expected: FAIL because no `test` script exists.

- [ ] **Step 3: Add test script and CI**

`package.json` scripts:

```json
{
  "test": "node --test tests/*.test.mjs",
  "test:ci": "node --test tests/*.test.mjs"
}
```

CI runs `npm ci` then `npm run test:ci` from `cloudflare-v2/`.

- [ ] **Step 4: Run tests**

Run: `cd cloudflare-v2 && npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

Commit: `test: add trading worker test harness and ci`

---

### Task 2: Introduce the universal Trading Event contract

**Files:**
- Create: `cloudflare-v2/src/events/trading_event.js`
- Create: `cloudflare-v2/tests/trading_event.test.mjs`
- Modify: `cloudflare-v2/src/listener/listener_node.js`
- Modify: `cloudflare-v2/src/index.js`

**Interfaces:**
- Produces: `normalizeTradingEvent(input)` returning `{ ok, event, errors }`.
- Event shape includes `version`, `workspace_hint`, `source`, `external_event_id`, `occurred_at`, `received_at`, `text`, `structured_payload`, `thread`, `metadata`.

- [ ] **Step 1: Write failing normalization tests**

Cover:
- Telegram legacy payload maps to `source.type='telegram_mtproto'`.
- TradingView/custom REST payload can use the same envelope.
- Missing `external_event_id` or source identity fails closed for authenticated ingress.
- Thread/reply/edit metadata is preserved.

- [ ] **Step 2: Verify tests fail**

Run: `cd cloudflare-v2 && node --test tests/trading_event.test.mjs`
Expected: FAIL because module does not exist.

- [ ] **Step 3: Implement minimal normalizer**

Key export:

```js
export function normalizeTradingEvent(input, options = {}) {
  // returns deterministic canonical envelope only; no AI here
}
```

- [ ] **Step 4: Adapt listener + legacy webhook**

`listener_node.js` sends the canonical fields while `/api/webhook/process_signal` continues accepting old `{ source_chat_id, source_message_id, raw_text }` payloads and normalizes them internally.

- [ ] **Step 5: Run tests**

Run: `cd cloudflare-v2 && npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

Commit: `feat: add universal trading event contract`

---

### Task 3: Add source authentication, replay protection and persistent idempotency

**Files:**
- Create: `cloudflare-v2/src/security/source_auth.js`
- Create: `cloudflare-v2/tests/source_auth.test.mjs`
- Create: `cloudflare-v2/db/migrations/0001_enterprise_v1_foundation.sql`
- Modify: `cloudflare-v2/src/index.js`

**Interfaces:**
- Consumes: canonical Trading Event.
- Produces: `verifySignedSourceRequest(request, secret, nowMs)` and persistent event reservation by `(workspace_id, source_instance_id, external_event_id)`.

- [ ] **Step 1: Write failing HMAC tests**

Test valid signature, invalid signature, expired timestamp, replayed nonce/event id, and constant-time comparison behavior.

- [ ] **Step 2: Write failing migration contract test**

Assert migration defines additive tables for:
- `source_connections`
- `trading_events`
- `destination_deliveries`
- `entitlement_bindings`

with unique idempotency constraints and workspace foreign keys.

- [ ] **Step 3: Implement HMAC verification**

Headers:

```text
X-Mkety-Source-Id
X-Mkety-Timestamp
X-Mkety-Signature
```

Signature basis:

```text
v1:<timestamp>:<raw-body>
```

Use Web Crypto HMAC-SHA256.

- [ ] **Step 4: Add `/api/v1/ingest`**

It authenticates source, normalizes event, reserves idempotency persistently, then invokes parallel human/machine pipelines.

- [ ] **Step 5: Preserve trusted DO ingress**

Internal DO calls use a Worker secret/shared internal credential and the same canonical ingestion function instead of bypassing event validation.

- [ ] **Step 6: Run tests**

Run: `cd cloudflare-v2 && npm test`
Expected: PASS.

- [ ] **Step 7: Commit**

Commit: `feat: secure universal trading event ingress`

---

### Task 4: Implement Zitadel authentication and enterprise entitlement gate

**Files:**
- Create: `cloudflare-v2/src/security/zitadel_auth.js`
- Create: `cloudflare-v2/tests/zitadel_auth.test.mjs`
- Modify: `cloudflare-v2/src/index.js`
- Modify: `cloudflare-v2/db/migrations/0001_enterprise_v1_foundation.sql`

**Interfaces:**
- Produces: `authenticateEnterpriseRequest(request, env, entitlementStore)` returning trusted `{ subject, organizationId, workspaceId, roles, entitlementStatus }` or an HTTP-safe denial.
- Supports external Mkety control plane provisioning by mapping Zitadel org/subject/role claims to Trading workspace entitlement records.

- [ ] **Step 1: Write failing JWT verification tests**

Use generated test key material/JWK fixtures to verify:
- valid signature accepted;
- wrong issuer rejected;
- wrong audience rejected;
- expired/not-before token rejected;
- missing Trading entitlement rejected;
- `suspended` or `expired` entitlement rejected immediately.

- [ ] **Step 2: Implement JWKS verification with Web Crypto**

Validate `alg`, `kid`, signature, `iss`, `aud`, `exp`, `nbf` and trusted organization/role claims.

- [ ] **Step 3: Add entitlement mapping**

Trading owns a narrow `entitlement_bindings` record keyed to trusted Zitadel identity/org claims. Mkety main platform can provision or revoke the binding without Trading code changes.

- [ ] **Step 4: Protect all `/api/admin/*` routes**

Remove bearer-presence-only behavior. Never authorize from a browser-supplied workspace id.

- [ ] **Step 5: Run tests**

Run: `cd cloudflare-v2 && npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

Commit: `feat: enforce zitadel enterprise trading access`

---

### Task 5: Build AI-assisted low-latency Telegram formatting

**Files:**
- Create: `cloudflare-v2/src/formatting/telegram_formatter.js`
- Create: `cloudflare-v2/src/pipeline/human_delivery.js`
- Create: `cloudflare-v2/tests/telegram_formatter.test.mjs`
- Modify: `cloudflare-v2/src/ai/universal_ai.js`
- Modify: `cloudflare-v2/src/index.js`

**Interfaces:**
- Produces: `formatTelegramSignal({ event, route, aiRouter, latencyBudgetMs })`.
- Produces: `dispatchHumanDestinations({ event, routes, ... })`.

- [ ] **Step 1: Write failing latency-policy tests**

Test:
- straightforward already-formatted signal can bypass AI when route policy says `smart` and classifier confidence is high;
- route policy `ai_preferred` invokes AI first;
- AI response inside budget is used;
- AI timeout/error immediately falls back to deterministic formatter;
- fallback preserves symbol/action/entry/SL/TP text;
- one slow destination does not block other Telegram destinations.

- [ ] **Step 2: Fix AI router schema/env mismatches under tests**

Align `priority_rank`, configured credential accessor, and constructor-supplied env bindings. Keep secret decryption interface explicit; do not pretend plaintext is encrypted.

- [ ] **Step 3: Implement formatter policy**

Supported route setting:

```json
{
  "telegram_format_mode": "smart|ai_preferred|deterministic",
  "ai_format_budget_ms": 1200,
  "custom_header": "...",
  "custom_footer": "..."
}
```

`smart` uses a deterministic complexity classifier; `ai_preferred` always attempts AI within the budget; both fall back immediately.

- [ ] **Step 4: Parallelize Telegram fan-out**

Each destination gets independent idempotency key and timeout. Persist delivery result without blocking sibling destinations.

- [ ] **Step 5: Run tests**

Run: `cd cloudflare-v2 && npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

Commit: `feat: add latency-bounded intelligent telegram delivery`

---

### Task 6: Add simulation-only machine planning contract

**Files:**
- Create: `cloudflare-v2/src/pipeline/machine_plan.js`
- Create: `cloudflare-v2/tests/machine_plan.test.mjs`
- Modify: `cloudflare-v2/src/index.js`

**Interfaces:**
- Produces: `buildMachinePlan(event, context)` returning `NO_ACTION`, `NEEDS_INTERPRETATION`, or a normalized simulation plan.

- [ ] **Step 1: Write failing parser/planner tests**

Cover straightforward examples:

```text
BUY XAUUSD 2526 SL 2518 TP 2530 2535 2545
SELL GOLD NOW
BUY LIMIT EURUSD 1.1600 SL 1.1570 TP 1.1650
MOVE SL TO BE
CLOSE HALF
CANCEL PENDING
```

Tests assert machine output is structured and never derived from Telegram HTML.

- [ ] **Step 2: Implement deterministic straightforward parser**

Extract action/order type/symbol/entry/SL/TP array for unambiguous messages. Ambiguous natural language returns `NEEDS_INTERPRETATION` rather than guessing.

- [ ] **Step 3: Add optional AI interpretation fallback**

AI returns structured JSON only. The result is schema/semantic validated before becoming a simulation plan.

- [ ] **Step 4: Enforce simulation-only execution**

No V1 machine plan may call `DerivExecutor`, `CTraderExecutor` or `MT5Executor` for real trades. Return/store trace only.

- [ ] **Step 5: Run tests**

Run: `cd cloudflare-v2 && npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

Commit: `feat: add simulation-safe machine planning pipeline`

---

### Task 7: Environment validation, health endpoint and documentation handoff

**Files:**
- Create: `cloudflare-v2/src/config/validate_env.js`
- Create: `cloudflare-v2/tests/config_validation.test.mjs`
- Modify: `cloudflare-v2/src/index.js`
- Modify: `cloudflare-v2/db/schema.sql`
- Modify: `AGENTS.md`

**Interfaces:**
- Produces: safe `/api/health` and `/api/config/status` responses that report readiness without secret values.

- [ ] **Step 1: Write failing config tests**

Assert missing required configuration yields named missing-variable categories but never values. Optional integrations are reported separately.

- [ ] **Step 2: Implement safe validators/endpoints**

Readiness categories: database, Zitadel, internal source auth, Telegram, AI providers, execution adapters.

- [ ] **Step 3: Align bootstrap schema after migration**

Only after the migration is authoritative, reflect the same V1 additions in `schema.sql` for new installations.

- [ ] **Step 4: Run full verification**

Run:

```bash
cd cloudflare-v2
npm test
npx wrangler deploy --dry-run
```

Expected: all tests PASS and Wrangler dry-run succeeds.

- [ ] **Step 5: Update `AGENTS.md`**

Record exact branch/PR/commit state, test output, migration/config changes, remaining blockers, account-side Zitadel/Cloudflare/Supabase setup, and next safe starting point: correlation/Position Group V1.1.

- [ ] **Step 6: Commit**

Commit: `docs: record enterprise trading v1 foundation status`

---

## V1 Acceptance Criteria

V1 foundation is ready for controlled production use only when all are true:

1. GitHub CI is green.
2. `/api/v1/ingest` accepts canonical signed events from a DO, VM/Telethon, TradingView or custom system without core code changes.
3. Duplicate/replayed events cannot create duplicate deliveries/plans.
4. Telegram delivery is concurrent and latency-bounded; AI formatting is used where configured and useful, with immediate deterministic fallback.
5. Admin APIs cryptographically validate Zitadel and enforce active Trading entitlement/workspace scope.
6. Revoking/expiring an entitlement prevents admin/control access without deploying new Trading code.
7. Machine planning produces deterministic traces and cannot place real orders.
8. No browser response/log contains stored credentials or sessions.
9. Migration and bootstrap schema are aligned.
10. `AGENTS.md` contains verified evidence and the exact next safe starting point.

## Deferred to V1.1+

- Stateful correlation DO for fast-entry promotion/full-signal completion.
- Position Groups and multi-TP leg allocation.
- BE/TP ladder/partial-close management state machine.
- Broker-specific live adapters and real-money execution.
- Rich cross-broker risk engine.
- VIP billing lifecycle hardening beyond enterprise entitlement gating.
