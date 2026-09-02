# Lightweight TradingView Direct Ingress Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a small direct TradingView webhook ingress that resolves one active Trading-owned source by a non-secret public handle, verifies trusted TradingView transport, sanitizes one stable native event, and enqueues it into the existing source-event queue without introducing broker authority or a second processing pipeline.

**Architecture:** The Worker receives `POST /api/v1/webhooks/tradingview/:handle`. A fail-closed transport verifier runs before source resolution or queueing. The server resolves the exact active `tradingview_webhook` source from `source_connections.webhook_handle`, ignores caller-supplied authority fields, requires a stable `event_id`, and enqueues a compact event into the existing `SOURCE_EVENT_QUEUE`; the existing queue consumer signs and dispatches it through `/api/v1/events` and the canonical V1 pipeline.

**Tech Stack:** Cloudflare Workers, JavaScript ESM, Node test runner, Supabase/PostgreSQL migrations, existing Trading source queue/V1 ingest.

**Spec:** `docs/superpowers/specs/2026-09-02-lightweight-tradingview-direct-ingress-design.md`

## Global Constraints

- Direct TradingView ingress is source-only and has zero broker/execution authority.
- The public webhook handle is an identifier, never authentication and never a credential.
- Do not place a secret in the TradingView URL or alert body.
- Transport verification must fail closed; if verified TradingView transport cannot be established in the real Cloudflare environment, direct ingress remains disabled.
- Source/workspace authority comes only from server-side source resolution.
- Ignore or strip caller-supplied `workspace_id`, `source_id`, destination, broker, execution, credential, and secret-like fields.
- Require a stable caller-provided `event_id`; do not synthesize an id from receive time.
- Reuse the existing source queue and signed V1 consumer; do not create a parallel interpretation/execution pipeline.
- One source failure must not affect another source or provider.
- Do not enable real-money execution.
- Do not merge `main` without explicit user instruction.
- TDD is mandatory: exact RED before production code, full GREEN before completion claims.
- After each meaningful batch, update `AGENTS.md` with exact RED/GREEN evidence, trust-boundary decisions, current head, and next safe continuation point.

---

### Task 1: TradingView public-handle storage and exact source lookup

**Files:**
- Create: `cloudflare-v2/db/migrations/0010_tradingview_webhook_handle.sql`
- Modify: `cloudflare-v2/src/sources/source_connection_store.js`
- Test: `cloudflare-v2/tests/tradingview_webhook_handle_migration.test.mjs`
- Test: `cloudflare-v2/tests/source_connection_store.test.mjs`

**Interfaces:**
- Produces migration column `source_connections.webhook_handle TEXT` with uniqueness for non-null handles.
- Produces `createSourceConnectionStore(supabase).getActiveTradingViewByHandle(handle)` returning one normalized active `source_family='tradingview'`, `provider_type='tradingview_webhook'` source or `null`.
- The lookup must not decrypt source secrets and must not accept workspace hints from the caller.

- [ ] **Step 1: Write failing migration and store tests**

Add tests requiring the migration column/index and exact active TradingView lookup. Also prove inactive, wrong-family, wrong-provider and missing handles return `null`, and the query filters exact `webhook_handle`, `is_active=true`, `source_family='tradingview'`, `provider_type='tradingview_webhook'`.

- [ ] **Step 2: Run the focused tests and verify RED**

Run `node --test tests/tradingview_webhook_handle_migration.test.mjs tests/source_connection_store.test.mjs` from `cloudflare-v2`. Expected: failure because migration `0010` and `getActiveTradingViewByHandle` do not exist.

- [ ] **Step 3: Add the minimal migration and store lookup**

Add `webhook_handle TEXT`, a partial unique index for non-null handles, include `webhook_handle` in source normalization, and implement exact active TradingView lookup. Do not read/decrypt `secret_ciphertext` for this lookup.

- [ ] **Step 4: Re-run focused tests and full Node suite**

Run the focused tests and `npm test`. Expected: PASS.

- [ ] **Step 5: Commit and update `AGENTS.md`**

Record exact RED/GREEN evidence and state that the public handle is non-secret and globally unique only as a routing identifier.

---

### Task 2: Fail-closed TradingView transport verifier

**Files:**
- Create: `cloudflare-v2/src/security/tradingview_transport.js`
- Create: `cloudflare-v2/tests/tradingview_transport.test.mjs`

**Interfaces:**
- Produces `verifyTradingViewTransport(request, env, { cf = request.cf } = {})` returning `{ ok: true }` only when configured trusted Cloudflare transport evidence is present.
- Missing/invalid/unproven evidence returns `{ ok: false, reason: 'TRADINGVIEW_TRANSPORT_UNVERIFIED' }`.
- Caller headers cannot self-assert verification.

- [ ] **Step 1:** Write failing verifier tests for verified fixture, unverified fixture, malformed metadata and spoofed headers.
- [ ] **Step 2:** Run focused test and confirm `ERR_MODULE_NOT_FOUND` RED.
- [ ] **Step 3:** Implement the smallest verifier using only Cloudflare-provided `request.cf`/injected metadata; no ordinary HTTP header is authoritative.
- [ ] **Step 4:** Run focused test and full Node suite to GREEN.
- [ ] **Step 5:** Commit and update `AGENTS.md`, explicitly retaining fail-closed staging posture and prohibiting silent IP-only authorization fallback.

---

### Task 3: Lightweight webhook handler and Worker route

**Files:**
- Create: `cloudflare-v2/src/http/tradingview_webhook.js`
- Modify: `cloudflare-v2/src/v1_entry.js`
- Create: `cloudflare-v2/tests/tradingview_webhook.test.mjs`
- Create: `cloudflare-v2/tests/v1_tradingview_entry.test.mjs`

**Interfaces:**
- Produces `handleTradingViewWebhookRequest(request, env, { sourceStore, sourceQueue, verifyTransport } = {})`.
- Route: `POST /api/v1/webhooks/tradingview/:handle`.
- Success: HTTP `202`, `{ ok: true, queued: true }`.
- Queued event contains only source-native identity/text/structured data plus safe transport metadata.

- [ ] **Step 1:** Write failing tests for success, unverified transport, unknown source, missing `event_id`, method mismatch, invalid/oversized JSON, authority stripping, queue failure and sibling-handle isolation.
- [ ] **Step 2:** Run focused tests and verify RED.
- [ ] **Step 3:** Implement order: method/path validation → transport verification → body size/JSON validation → stable `event_id` validation → exact server-side source lookup → safe event construction → existing source queue enqueue → 202.
- [ ] **Step 4:** Add only the exact TradingView route to `v1_entry.js`; preserve all existing routes.
- [ ] **Step 5:** Run focused tests and full Node suite to GREEN.
- [ ] **Step 6:** Commit and update `AGENTS.md` with route semantics, queue-only behavior, exact handle scoping, authority stripping and source isolation.

---

### Task 4: End-to-end non-live acceptance and final verification

**Files:**
- Create: `cloudflare-v2/tests/tradingview_ingress_acceptance.test.mjs`
- Modify: `cloudflare-v2/docs/NON_LIVE_MULTI_SOURCE_ACCEPTANCE.md`
- Modify: `AGENTS.md`

**Interfaces:**
- Acceptance composes direct TradingView handler → existing source queue envelope → existing signed queue consumer → V1 ingest test harness.
- No broker/live execution call is permitted.

- [ ] **Step 1:** Write acceptance tests for exact-source queueing, authority stripping, same-source duplicate handling, cross-source isolation, source-A failure not suppressing B, unverified transport never reserving, and coexistence with Telegram/MT5/cTrader/custom sources.
- [ ] **Step 2:** Run acceptance and confirm any RED is limited to the missing composition seam.
- [ ] **Step 3:** Make only the minimal integration correction required.
- [ ] **Step 4:** Run all mandatory gates: Node, MT5 bridge Python, Container MTProto Python, external MTProto Python, Wrangler dry-run.
- [ ] **Step 5:** Update acceptance docs and `AGENTS.md` with exact runs/commits, migration `0010` status, fail-closed transport status, no secrets in URL/body, no broker authority, current head and next safe continuation point.
- [ ] **Step 6:** Inspect the exact newest branch-head GitHub Actions run before any completion claim.

---

## Self-Review

- Spec coverage: direct route, transport verification, public handle lookup, stable event id, authority stripping, existing queue reuse, source isolation, fast acknowledgement, fail-closed staging posture, and no broker authority are all mapped.
- Placeholder scan: no implementation placeholders remain.
- Type consistency: handler consumes `getActiveTradingViewByHandle(handle)` and `enqueueSourceEvent(source, event)`; existing queue owns signing and V1 dispatch.
- Isolation check: no global retry state, cross-source credentials, shared health, direct broker calls, or caller-selected workspace/source authority are introduced.

## Execution Handoff

Execution mode for this approved ongoing session: **Inline Execution**, RED→GREEN, with `AGENTS.md` updated after every meaningful batch.