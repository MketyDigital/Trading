# Lightweight TradingView Direct Ingress Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. TDD is mandatory for every production change.

**Goal:** Add a first-class, lightweight TradingView webhook source that resolves tenant/source authority server-side, verifies the expected webhook transport, and hands safe events to the existing source queue without weakening signed V1 or introducing broker/execution coupling.

**Architecture:** Add one non-secret public lookup handle to the Trading-owned `source_connections` table. A dedicated `POST /api/v1/webhooks/tradingview/<public_source_handle>` route verifies Cloudflare TLS client-auth metadata against an explicitly configured SHA-256 certificate fingerprint allowlist, resolves one active `tradingview_webhook` source server-side, normalizes a small alert payload, strips caller authority/credential fields, and enqueues through the existing `SOURCE_EVENT_QUEUE`. The existing queue consumer re-resolves the source and enters the normal signed V1 pipeline. Direct ingress defaults fail-closed and remains operationally disabled until real non-live Cloudflare/TradingView transport acceptance proves the expected certificate identity.

**Tech Stack:** Cloudflare Workers, Cloudflare Queues, Node.js ESM, Supabase/PostgreSQL, existing Trading source registry/idempotency pipeline, Wrangler.

**Spec:** `docs/superpowers/specs/2026-09-02-lightweight-tradingview-direct-ingress-design.md`

## Global Constraints

- Keep this implementation light: one route, one transport verifier, one source lookup, one existing queue handoff.
- Never weaken or modify the authentication contract of `POST /api/v1/events`.
- `public_source_handle` is a lookup identifier, never a secret or authentication credential.
- Never put reusable source secrets in TradingView URL/query/body fields.
- Transport verification must fail closed unless direct ingress is explicitly enabled, Cloudflare reports a verified presented client certificate, and its SHA-256 fingerprint matches configured allowlisted fingerprint(s).
- The exact source row resolved server-side is the only workspace/source authority.
- Caller workspace/source/destination/broker/execution/credential fields are ignored/stripped and never enter the queue.
- TradingView direct ingress is source-only; it does not call broker/destination adapters and cannot enable execution.
- One TradingView source failure must not affect another TradingView source or Telegram/MT5/cTrader/custom sources.
- Existing persistent V1 idempotency remains authoritative for replay/restart handling.
- No MKSaaS/shared Mkety database dependencies.
- No real-money execution and no merge to `main` without explicit user instruction.
- TDD: exact RED before production code; all four mandatory CI gates GREEN after each meaningful implementation batch.
- Update `AGENTS.md` after every meaningful GREEN/environment checkpoint.
- Source/CI completion does not prove real TradingView transport authentication; staging must verify the actual certificate fingerprint before enabling the feature.

---

### Task 1: Add non-secret public source handle and exact active-source lookup

**Files:**
- Create: `cloudflare-v2/tests/tradingview_public_handle_migration.test.mjs`
- Create: `cloudflare-v2/db/migrations/0010_tradingview_public_source_handle.sql`
- Modify: `cloudflare-v2/src/sources/source_connection_store.js`
- Modify: `cloudflare-v2/tests/source_connection_store.test.mjs`
- Modify: `AGENTS.md`

**Interfaces:**
- Adds nullable `public_source_handle TEXT` to Trading-owned `source_connections`.
- Adds a unique partial index for non-null handles.
- `createSourceConnectionStore(supabase).getActiveTradingViewSourceByPublicHandle(handle)` returns only an active source whose provider is `tradingview_webhook` and family is `tradingview`, or `null`.
- Store normalization may expose `publicSourceHandle` internally but public-handle lookup never grants authority by itself.

- [ ] **Step 1: Write migration RED test**

Require migration `0010_tradingview_public_source_handle.sql`, additive column, unique partial index, and no references/mutations to shared Mkety/MKSaaS tables.

- [ ] **Step 2: Write source-store RED tests**

Cover exact handle query, required filters (`public_source_handle`, `is_active=true`, `provider_type=tradingview_webhook`, `source_family=tradingview`), null for blank/missing handle, and no cross-provider/cross-workspace inference.

- [ ] **Step 3: Run exact RED**

Commit only tests and verify CI fails solely because migration/store capability is absent.

- [ ] **Step 4: Add migration**

```sql
BEGIN;
ALTER TABLE public.source_connections
    ADD COLUMN IF NOT EXISTS public_source_handle TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_source_connections_public_source_handle
    ON public.source_connections(public_source_handle)
    WHERE public_source_handle IS NOT NULL;
COMMIT;
```

Do not populate handles automatically and do not change existing RLS/client privilege posture.

- [ ] **Step 5: Extend source store minimally**

Add `public_source_handle` to selection/normalization and implement exact active TradingView handle lookup with `maybeSingle()`.

- [ ] **Step 6: Full four-gate GREEN + handoff update**

Commit production change and record exact RED/GREEN evidence. Migration remains checked-in only until live database preconditions are separately inspected.

---

### Task 2: Add explicit fail-closed TradingView transport verifier

**Files:**
- Create: `cloudflare-v2/src/security/tradingview_transport.js`
- Create: `cloudflare-v2/tests/tradingview_transport.test.mjs`
- Modify: `AGENTS.md`

**Interfaces:**
- `verifyTradingViewTransport(request, env = {}) -> { ok: true } | { ok: false, reason: 'TRADINGVIEW_TRANSPORT_NOT_VERIFIED' }`
- Explicit enable flag: `TRADINGVIEW_DIRECT_INGRESS_ENABLED`.
- Fingerprint configuration: `TRADINGVIEW_TLS_CLIENT_CERT_SHA256`, allowing one or more comma-separated SHA-256 fingerprints.
- Reads only Cloudflare `request.cf.tlsClientAuth` metadata.
- Requires `certPresented === '1'`, `certVerified === 'SUCCESS'`, and exact normalized fingerprint match.
- Result never includes observed/configured fingerprint, DN, IP, or certificate data.

- [ ] **Step 1: Write RED verifier tests**

Cover disabled flag, missing fingerprint config, missing TLS metadata, unverified/presented mismatch, wrong fingerprint, matching fingerprint with case/colon normalization, and secret-free result.

- [ ] **Step 2: Run exact RED**

Expected only missing verifier module/capability failures.

- [ ] **Step 3: Implement pure verifier**

Normalize configured/observed SHA-256 values by lowercasing and removing separators/whitespace. Never trust IP or source handle as primary authentication.

- [ ] **Step 4: Full four-gate GREEN + handoff update**

No database, queue, V1 auth, or broker code changes in this task.

---

### Task 3: Add lightweight TradingView webhook handler and exact router hook

**Files:**
- Create: `cloudflare-v2/src/http/tradingview_webhook.js`
- Create: `cloudflare-v2/tests/tradingview_webhook.test.mjs`
- Create: `cloudflare-v2/tests/v1_tradingview_entry.test.mjs`
- Modify: `cloudflare-v2/src/v1_entry.js`
- Modify: `AGENTS.md`

**Interfaces:**
- Route: `POST /api/v1/webhooks/tradingview/<public_source_handle>`.
- Reuses `verifyTradingViewTransport`, `createSourceConnectionStore`, and `createSourceEventQueue`.
- Default body limit: 64 KiB.
- Alert requires non-empty `event_id` plus either non-empty `text` or non-empty `structured_payload`.
- Queue event contains stable native identity `metadata.native_identity.event_id` and no caller authority/credential data.

- [ ] **Step 1: Write handler RED tests**

Cover:
- POST only;
- transport verification occurs before source lookup/queue;
- unknown/disabled handle returns 404;
- malformed JSON/empty event ID/no content return 400;
- oversized request returns 413;
- caller workspace/source/destination/broker/execution/secret-like fields are recursively stripped;
- valid request enqueues exactly once and returns 202;
- queue error returns 503 and does not claim success;
- response never exposes internal workspace/source/certificate/secret data.

- [ ] **Step 2: Write router RED tests**

Exact TradingView prefix routes to injected handler without reaching legacy; nearby `/api/v1/webhooks/*` paths remain closed/404 rather than delegating to legacy; `/api/v1/events` remains routed to existing HMAC handler unchanged.

- [ ] **Step 3: Run exact RED**

Verify failures are only missing handler/router capability.

- [ ] **Step 4: Implement handler**

Order: method -> transport verify -> route handle -> source lookup -> body bound/parse/normalize -> existing queue enqueue -> compact response. Use server receive time when `occurred_at` is absent. Never put workspace ID in queue payload.

- [ ] **Step 5: Wire exact route**

Add injected `tradingViewHandler` to `createTradingV1Entrypoint`. Close unmatched `/api/v1/webhooks/*` routes with existing 404 helper.

- [ ] **Step 6: Full four-gate GREEN + handoff update**

No broker/destination changes and no execution enablement.

---

### Task 4: Isolation acceptance, staging docs, live migration verification

**Files:**
- Create: `cloudflare-v2/tests/tradingview_ingress_acceptance.test.mjs`
- Modify: `cloudflare-v2/docs/STAGING_V1_RUNBOOK.md`
- Modify: `AGENTS.md`
- Modify: this plan

**Acceptance:**

- [ ] **Step 1: Write acceptance RED where any remaining gap exists**

Prove:
1. two TradingView sources with different handles resolve independently;
2. same `event_id` from two workspaces remains separate downstream because source/workspace authority is server-resolved;
3. malicious authority fields never enter queued event;
4. source A transport/source/queue failure cannot affect source B;
5. TradingView failure cannot affect an existing Telegram/MT5/cTrader/custom producer path;
6. queue consumer re-resolves exact source before signed V1 dispatch;
7. canonical downstream TradingView identity uses `tradingview:<accountScope>:<event_id>`;
8. `/api/v1/events` HMAC behavior remains unchanged;
9. no broker/destination/execution state is imported or mutated by TradingView handler;
10. all responses/status objects are secret-free.

- [ ] **Step 2: Update staging runbook**

Document only configuration names, never values:
- `TRADINGVIEW_DIRECT_INGRESS_ENABLED`
- `TRADINGVIEW_TLS_CLIENT_CERT_SHA256`
- `SOURCE_EVENT_QUEUE`
- Supabase service configuration already required by V1.

Real staging acceptance must send non-trading TradingView test alerts, observe the actual Cloudflare `tlsClientAuth` behavior, establish the trusted SHA-256 fingerprint out-of-band, verify fast 202 acknowledgement/replay behavior, and keep direct ingress disabled if certificate identity cannot be proven.

- [ ] **Step 3: Full exact-head four-gate GREEN**

Record Node/MT5/MTProto/Wrangler evidence.

- [ ] **Step 4: Inspect live Trading Supabase before migration**

Confirm `0010` absent, `source_connections` matches expected precondition, existing entitlement remains disabled, and no source/live execution data needs mutation.

- [ ] **Step 5: Apply only migration `0010` if preconditions match**

Verify migration ledger, column/index, existing RLS/service-only privileges, and that no handle/source row was created automatically. Do not configure a real TradingView fingerprint/source.

- [ ] **Step 6: Update final handoff and rerun exact-head CI**

Source/CI/database readiness may be called complete only with fresh evidence. Real TradingView transport acceptance remains an external non-live staging gate; live broker execution remains disabled.
