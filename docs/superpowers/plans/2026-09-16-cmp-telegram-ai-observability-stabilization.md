# CMP, Telegram, AI Provider and Operations Observability Stabilization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix CMP and Telegram DEMO blockers now, then harden database-backed multi-provider AI and two-tier customer/admin observability without regressing trading behavior.

**Architecture:** Keep deterministic trading authority separate from AI and presentation. Immediate fixes extend concise MARKET aliases and make verbatim Telegram delivery/reporting independent from parser success. Broader work introduces provider-specific DB-authoritative AI adapters plus a normalized operation journal with customer-safe and Mkety-admin serializers.

**Tech Stack:** Cloudflare Worker JavaScript, Supabase/PostgreSQL, Telegram Bot API, MetaTrader 5 connector, cTrader Open API, OpenAI/Azure OpenAI/Gemini/Vertex/Cloudflare AI/AWS Bedrock HTTP APIs, Node test runner, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-09-16-cmp-telegram-ai-observability-stabilization-design.md`

## Global Constraints

- LIVE remains globally/workspace/account disabled during stabilization and DEMO acceptance.
- Deterministic persisted authority beats AI/caller hints.
- AI cannot authorize trading and provider failure cannot broaden routing/execution.
- New AI provider credentials/config are database-authoritative; no provider credential/config env fallback.
- Customer Operations is workspace-scoped and infrastructure-neutral.
- Mkety Admin diagnostics are site-wide/full-context but never expose plaintext secrets.
- Preserve all existing management, reply/follow-up, broker/platform/symbol/replay/reconciliation behavior.

---

### Task 1: CMP/current-market aliases

**Files:**
- Modify: `cloudflare-v2/src/pipeline/machine_plan.js`
- Test: `cloudflare-v2/tests/machine_plan.test.mjs`
- Create: `cloudflare-v2/tests/cmp_market_aliases.test.mjs`

**Interfaces:**
- Existing `buildMachinePlan(event)` remains unchanged externally.
- New aliases only affect concise unambiguous MARKET commands.

- [ ] Add RED tests for `BUY XAUUSD (CMP)`, `SELL GOLD @ CURRENT MARKET PRICE`, `BUY EURUSD AT MARKET`, `SELL XAUUSD C.M.P`, `BUY GOLD CURRENT MKT PRICE`, and commentary/question counterexamples.
- [ ] Extend concise-market residue normalization to strip approved current-market aliases before blocker/residue evaluation.
- [ ] Verify each accepted alias returns READY/MARKET/MARKET-entry/fastEntry/incomplete and counterexamples remain NEEDS_INTERPRETATION.
- [ ] Run machine-plan, interpreter, fast-completion and full test:ci suites.

### Task 2: Telegram rejection diagnostics and verbatim independence

**Files:**
- Modify: `cloudflare-v2/src/destinations/telegram_destination.js`
- Modify: `cloudflare-v2/src/destinations/v1_destination_delivery_stage.js`
- Modify: `cloudflare-v2/src/destinations/v1_destination_delivery_acceptance.js`
- Test: `cloudflare-v2/tests/user_controls_verbatim_threading_acceptance.test.mjs`
- Create: `cloudflare-v2/tests/telegram_delivery_diagnostics.test.mjs`

**Interfaces:**
- `sendTelegramDestination()` keeps `ok/status/errorCode` and adds sanitized `providerCode/providerDescription/retryAfter` where available.
- Forward-as-is route sends raw source text even when interpretation is NEEDS_REVIEW/NO_ACTION, while template/AI modes keep current interpretation requirements.
- Per-event Telegram success/failure is durably journaled.

- [ ] RED: Bot API 400/401/403 response is parsed and normalized without token leakage.
- [ ] RED: routed `none` destination sends raw text with interpretation NEEDS_REVIEW and never invokes AI/cleanup/template reconstruction.
- [ ] RED: Telegram failure persists an event-linked operation/delivery outcome with useful sanitized reason.
- [ ] Implement minimal transport/result changes and keep reply mapping/idempotency semantics intact.
- [ ] Run verbatim/threading, destination, route and test:ci suites.

### Task 3: AI provider audit and DB-authoritative adapters

**Files:**
- Modify: `cloudflare-v2/src/ai/universal_ai.js`
- Modify: `cloudflare-v2/src/ai/workspace_ai.js`
- Modify: `cloudflare-v2/src/http/v1_admin_ai.js`
- Add focused provider adapter modules/tests as needed.
- Add migration only if provider-specific config/diagnostic schema cannot fit existing safe JSON/columns.

**Interfaces:**
- First-class provider types: `openai`, `azure_openai`, `gemini`, `vertex_ai`, `cloudflare_ai`, `aws_bedrock`.
- Provider calls return normalized internal result `{success,text?,providerId,providerType,model,latencyMs,httpStatus?,providerCode?,retryable?,errorClass?,sanitizedMessage?}`.

- [ ] Verify OpenAI current model/API request compatibility.
- [ ] Implement Azure OpenAI auth/endpoint/deployment/api-version contract.
- [ ] Implement Gemini API contract.
- [ ] Implement Vertex AI project/location/model/credential contract.
- [ ] Remove Cloudflare account-ID env fallback; DB config only.
- [ ] Implement Bedrock region/model/credential request/signing contract appropriate to runtime.
- [ ] Eliminate provider credential/config env fallback and plaintext new writes.
- [ ] Verify database key presence/status without exposing secret material.
- [ ] Add health/test action per provider and persist sanitized result.

### Task 4: Normalized operation journal

**Files:**
- Create migration/table or extend existing durable journal with operation stage/outcome metadata.
- Add storage/service modules.
- Integrate ingress, interpretation/AI attempts, route select/skip, Telegram, broker planning/execution, management, replay/reconciliation and connector state.

- [ ] Define normalized stage/status/error taxonomy and correlation IDs.
- [ ] Persist every success/failure/skip with workspace and resource references.
- [ ] Ensure broker success + persistence failure records repair state rather than resend authority.
- [ ] Add retention/indexing/pagination requirements.

### Task 5: Customer Operations serializer/UI

**Files:**
- Modify customer Operations APIs/dashboard.
- Tests for tenant isolation and infrastructure redaction.

- [ ] Show workspace-only operation history, statuses, timestamps and actionable reasons.
- [ ] Permit user-facing nouns only: source/feed/route/Telegram/MT5/cTrader/broker/terminal/VPS connector/AI provider/model/signal/trade/management/destination.
- [ ] Never expose Cloudflare/Workers/OCI/Coolify/internal queues/database/service URLs/stack traces or other tenants.
- [ ] Map internal errors into actionable customer-safe messages.

### Task 6: Mkety Admin site-wide diagnostics

**Files:**
- Modify Mkety staff/admin APIs/dashboard.
- Tests for staff auth and secret redaction.

- [ ] Site-wide filter by workspace/source/feed/route/destination/account/provider/status/time/correlation ID.
- [ ] Show internal component/provider/HTTP/circuit/retry context necessary for support.
- [ ] Link customer-visible operation to full admin diagnostic using correlation ID.
- [ ] Never expose plaintext credentials/tokens/passwords.

### Task 7: Non-regression, docs and acceptance

**Files:**
- Update `AGENTS.md`, `CURRENT_HANDOFF.md`, operator/customer manual and DEMO acceptance runbooks.

- [ ] Run full Worker/trading test:ci, MT5 connector release, MTProto and frontend contracts.
- [ ] Confirm management/replies/fast/follow-up/replay/reconciliation/cTrader/MT5/capability-driven symbols remain green.
- [ ] Fresh zero-LIVE production audit before merge/deploy.
- [ ] Merge only reviewed exact green head and verify production deploy/E2E/readiness/configuration.
- [ ] Re-test CMP and Telegram from real Starpips source; inspect persisted operation evidence.

## Current-session boundary

Implement Tasks 1 and 2 now. Document production AI/provider findings and hand off Tasks 3–7 for the next session after exact-head CI and DEMO-safe deployment of immediate fixes.
