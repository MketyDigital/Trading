# Multi-Source Provider Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generalize Trading V1 into a multi-source provider platform where MTProto, MT5, cTrader, TradingView, custom APIs, and future sources can coexist; admins can choose a default source per family; Cloudflare Container MTProto is the preferred first-party Telegram runtime while pure DO and external listeners remain supported.

**Architecture:** Extend the existing Trading-owned `source_connections` registry and signed `/api/v1/events` path rather than creating a Telegram-specific parallel subsystem. Provider adapters normalize transport-specific identity into provider-independent canonical source event identities, and existing persistent event reservation remains the idempotency authority. MTProto runtimes are interchangeable implementations behind the same provider contract.

**Tech Stack:** Cloudflare Workers, Durable Objects, Cloudflare Containers, Cloudflare Queues, JavaScript/Node, Python Telethon, Supabase/PostgreSQL, existing HMAC V1 ingress, Node test runner, Python unittest, Wrangler.

**Spec:** `docs/superpowers/specs/2026-09-02-multi-source-provider-and-mtproto-runtime-design.md`

## Global Constraints

- Never merge `main` without explicit user instruction.
- TDD is mandatory: write and observe an exact failing test before production code.
- Preserve legacy `/api/webhook/process_signal` behavior.
- Preserve existing Trading V1 signed-ingress authentication and server-resolved workspace trust boundary.
- No live meaningful-capital broker execution.
- No secrets in logs, tests, commits, API responses, or chat.
- Unconfigured source providers remain inert and must not block configured providers.
- Multiple source providers may be enabled simultaneously.
- At most one default source is allowed per `(workspace_id, source_family)`.
- Default means preference, not exclusivity.
- Cross-provider replays of the same native event must deduplicate before trading actions.
- Update `AGENTS.md` after each meaningful implementation batch.

---

### Task 1: Source Provider Registry Types and Canonical Identity

**Files:**
- Create: `cloudflare-v2/src/sources/provider_registry.js`
- Create: `cloudflare-v2/src/sources/canonical_event_id.js`
- Test: `cloudflare-v2/tests/source_provider_registry.test.mjs`
- Test: `cloudflare-v2/tests/canonical_source_event_id.test.mjs`

**Interfaces:**
- Produces: `SOURCE_FAMILIES`, `PROVIDER_TYPES`, `getProviderDefinition(providerType)`, `normalizeProviderRecord(record)`.
- Produces: `buildCanonicalSourceEventId({sourceFamily, nativeIdentity, accountScope}) -> string`.
- Consumers: source registry persistence, V1 ingress adapter, MTProto providers, admin APIs.

- [ ] **Step 1: Write failing provider-registry tests**

Assert definitions exist for `cloudflare_container_mtproto`, `cloudflare_do_mtproto`, `external_mtproto`, `tradingview_webhook`, `mt5_source_bridge`, `ctrader_source`, and `custom_signed_api`; assert each maps to the correct source family; assert unknown providers fail closed.

- [ ] **Step 2: Run the focused tests and observe RED**

Run: `cd cloudflare-v2 && node --test tests/source_provider_registry.test.mjs`

Expected: FAIL because the provider registry module does not exist.

- [ ] **Step 3: Implement the minimal provider registry**

Create immutable definitions containing provider type, source family, runtime kind, and whether a native event identity strategy is available. `normalizeProviderRecord()` validates `enabled`, `isDefault`, `priority`, and provider/source-family consistency without inspecting secrets.

- [ ] **Step 4: Write failing canonical identity tests**

Cover Telegram identities from Container and DO providers producing the same key for the same account scope/chat/message; TradingView IDs; MT5 transaction IDs; cTrader event IDs; malformed identity rejection.

- [ ] **Step 5: Run canonical identity tests and observe RED**

Run: `cd cloudflare-v2 && node --test tests/canonical_source_event_id.test.mjs`

Expected: FAIL because the helper does not exist.

- [ ] **Step 6: Implement provider-independent identity generation**

Telegram canonical form: `telegram:<accountScope>:<chatId>:<messageId>`. Provider implementation names must never appear in the resulting key. Other families use stable native IDs prefixed only by source family and required scope.

- [ ] **Step 7: Run both focused suites GREEN**

Run: `cd cloudflare-v2 && node --test tests/source_provider_registry.test.mjs tests/canonical_source_event_id.test.mjs`

- [ ] **Step 8: Commit**

Commit message: `feat: add source provider registry and canonical identities`.

---

### Task 2: Trading-Owned Source Connection Schema and Default Semantics

**Files:**
- Create: `cloudflare-v2/db/migrations/0003_multi_source_provider_registry.sql`
- Create: `cloudflare-v2/src/sources/source_connection_store.js`
- Test: `cloudflare-v2/tests/source_connection_store.test.mjs`

**Interfaces:**
- Consumes: provider registry from Task 1.
- Produces: `listEnabledSources(workspaceId)`, `getSourceById(sourceId)`, `setDefaultSource(workspaceId, sourceFamily, sourceId)`, `disableSource(sourceId)`.

- [ ] **Step 1: Write failing store-contract tests against a fake Supabase client**

Cover multiple enabled families, multiple providers in one family, exactly one default per family, changing default without disabling alternatives, disabling the current default leaving no default, unconfigured family returning an empty list.

- [ ] **Step 2: Run RED**

Run: `cd cloudflare-v2 && node --test tests/source_connection_store.test.mjs`

- [ ] **Step 3: Add migration**

Extend `source_connections` with `source_family`, `provider_type`, `is_default`, `priority`, `display_name`, `external_identity`, provider `config` JSONB, health fields, and indexes. Add a partial unique index enforcing one default per workspace/source-family where enabled/default. Do not add foreign keys to shared Mkety `workspaces`.

- [ ] **Step 4: Implement the store**

Keep all persistence in Trading-owned tables. `setDefaultSource()` validates the target belongs to the workspace/family and performs clear-then-set using a database RPC or transaction-safe equivalent; if atomic multi-statement support is unavailable through the current Supabase wrapper, add a Trading-owned SQL function in the migration.

- [ ] **Step 5: Run GREEN**

Run: `cd cloudflare-v2 && node --test tests/source_connection_store.test.mjs`

- [ ] **Step 6: Commit**

Commit message: `feat: add multi-source connection registry`.

---

### Task 3: V1 Ingress Uses Canonical Native Event Identity

**Files:**
- Modify: `cloudflare-v2/src/http/v1_events.js`
- Modify: existing V1 ingest/source-auth module that resolves registered sources
- Test: `cloudflare-v2/tests/v1_cross_provider_idempotency.test.mjs`

**Interfaces:**
- Consumes: authenticated source record + canonical identity helper.
- Produces: unchanged `/api/v1/events` HTTP contract with provider-independent external event reservation.

- [ ] **Step 1: Write RED acceptance tests**

Register/fake two authenticated Telegram providers for the same workspace/session scope: Container and DO. Send the same chat/message through both and assert the first is accepted and the second returns `duplicate:true` without orchestration. Also assert different message IDs do not collide and unauthenticated sources cannot exploit canonical dedupe.

- [ ] **Step 2: Run RED**

Run: `cd cloudflare-v2 && node --test tests/v1_cross_provider_idempotency.test.mjs`

- [ ] **Step 3: Implement canonicalization after source authentication**

Resolve workspace/source first, derive canonical native identity from authenticated source configuration plus payload metadata, then reserve the event using that identity. Preserve existing externally supplied IDs for provider types where canonical native IDs are unavailable.

- [ ] **Step 4: Run focused GREEN and existing V1 acceptance suites**

Run the new test plus all `v1_*` tests.

- [ ] **Step 5: Commit**

Commit message: `feat: deduplicate native events across source providers`.

---

### Task 4: Cloudflare Container MTProto Provider Contract

**Files:**
- Create: `cloudflare-v2/src/sources/mtproto/container_provider.js`
- Create: `cloudflare-v2/containers/mtproto-listener/Dockerfile`
- Create: `cloudflare-v2/containers/mtproto-listener/requirements.txt`
- Create: `cloudflare-v2/containers/mtproto-listener/listener.py`
- Create: `cloudflare-v2/containers/mtproto-listener/health.py`
- Test: `cloudflare-v2/tests/mtproto_container_provider.test.mjs`
- Test: `cloudflare-v2/containers/mtproto-listener/test_listener.py`

**Interfaces:**
- Produces JS provider lifecycle interface: `start()`, `stop()`, `status()`, `restart()` against a container binding.
- Python listener consumes environment/bootstrap configuration supplied by the managing Worker/DO and emits compact Telegram source events to an internal enqueue/signed-ingress endpoint.

- [ ] **Step 1: Write RED JS provider lifecycle tests using a fake container binding**

Assert unconfigured provider does nothing, enabled provider starts exactly one instance, health maps to common health states, restart is idempotent, secrets are not returned.

- [ ] **Step 2: Run RED**

Run: `cd cloudflare-v2 && node --test tests/mtproto_container_provider.test.mjs`

- [ ] **Step 3: Implement minimal JS provider lifecycle wrapper**

No Telegram code in Worker. Keep one provider instance per configured Telegram session identity.

- [ ] **Step 4: Write RED Python listener tests**

Mock Telethon client and outbound sink. Cover: one session handling multiple chats, outgoing message ignored, native Telegram identity preserved, receive loop not blocked by downstream send, reconnect state callback, sanitized health, session restoration contract.

- [ ] **Step 5: Run RED Python tests**

Run: `cd cloudflare-v2 && PYTHONPATH=containers/mtproto-listener python -m unittest containers/mtproto-listener/test_listener.py -v`

- [ ] **Step 6: Implement Telethon listener skeleton**

Use Telethon with automatic reconnect, event handlers, a bounded local async handoff queue, health state, and no trading interpretation. Do not embed credentials in image layers. Persistent session material is injected/restored through the provider bootstrap mechanism.

- [ ] **Step 7: Add Docker image**

Base on a small Python linux/amd64 image, install pinned Telethon dependency, run non-root where practical, expose only the internal health/control port required by the Worker/DO.

- [ ] **Step 8: Run JS and Python focused GREEN**

- [ ] **Step 9: Commit**

Commit message: `feat: add cloudflare container mtproto provider`.

---

### Task 5: Reliable MTProto Handoff and Recovery Contract

**Files:**
- Create: `cloudflare-v2/src/sources/source_event_queue.js`
- Modify: Container provider and Python listener handoff contract
- Test: `cloudflare-v2/tests/source_event_queue.test.mjs`
- Extend: `cloudflare-v2/containers/mtproto-listener/test_listener.py`

**Interfaces:**
- Produces: `enqueueSourceEvent(authenticatedSource, event)` and queue-consumer normalization into signed/internal V1 ingress.

- [ ] **Step 1: Write RED queue tests**

Cover immediate handoff, retry-safe payload, no secrets in payload, canonical native identity fields preserved, consumer retry duplicates becoming harmless V1 duplicates.

- [ ] **Step 2: Run RED**

- [ ] **Step 3: Implement compact queue boundary**

Queue payload contains registered source ID, native source identity components, event timestamps, text/structured payload, reply/thread/edit metadata, and no decrypted source secret.

- [ ] **Step 4: Add listener recovery/checkpoint tests**

Cover persisted last-observed IDs/update state and startup catch-up hook. Do not claim zero downtime; require replay-safe recovery.

- [ ] **Step 5: Implement minimal recovery contract**

- [ ] **Step 6: Run GREEN**

- [ ] **Step 7: Commit**

Commit message: `feat: add reliable source event handoff`.

---

### Task 6: Harden Pure Durable Object MTProto as an Alternate Provider

**Files:**
- Modify: `cloudflare-v2/src/listener/listener_node.js`
- Create: `cloudflare-v2/src/sources/mtproto/do_provider.js`
- Test: `cloudflare-v2/tests/mtproto_do_provider.test.mjs`

**Interfaces:**
- Consumes same MTProto native event shape as Container provider.
- Produces same canonical Telegram identity and health model.

- [ ] **Step 1: Write RED tests around existing listener behavior**

Cover persisted mtcute update/session state, catch-up configuration, alarm-based reconnect, disconnected health, queue/signed-V1 handoff, and same canonical identity as Container provider.

- [ ] **Step 2: Run RED and record exact gaps**

- [ ] **Step 3: Implement provider wrapper and harden existing DO**

Do not make the DO the required/default runtime. Preserve current control endpoints where compatibility requires them but stop returning raw session strings from normal status/control responses.

- [ ] **Step 4: Run GREEN**

- [ ] **Step 5: Commit**

Commit message: `feat: harden durable object mtproto provider`.

---

### Task 7: External MTProto + MT5 + cTrader + TradingView + Custom Source Registration

**Files:**
- Create: `cloudflare-v2/src/sources/provider_config_validation.js`
- Test: `cloudflare-v2/tests/multi_source_coexistence.test.mjs`

**Interfaces:**
- Consumes provider registry and source connection store.
- Produces provider-specific non-secret configuration validation while leaving execution/destination adapters unchanged.

- [ ] **Step 1: Write RED coexistence tests**

One workspace has Container MTProto, external MTProto backup, MT5 source bridge, cTrader source, TradingView webhook, and custom signed API all enabled. Assert listing/selection works; missing one provider's configuration does not affect others; defaults are family-scoped.

- [ ] **Step 2: Run RED**

- [ ] **Step 3: Implement validation**

Validate only the provider being configured. Reuse encrypted-secret primitives for secrets. Do not couple source configuration to destination/execution account enablement.

- [ ] **Step 4: Run GREEN**

- [ ] **Step 5: Commit**

Commit message: `feat: support heterogeneous trading source providers`.

---

### Task 8: Admin Source Management API

**Files:**
- Create: `cloudflare-v2/src/http/v1_admin_sources.js`
- Modify: V1 entry/router registration
- Test: `cloudflare-v2/tests/v1_admin_sources.test.mjs`

**Interfaces:**
- Uses existing Zitadel Trading admin authentication.
- Produces read/list/status/default/enable/disable operations without exposing secret material.

- [ ] **Step 1: Write RED auth and behavior tests**

Cover wrong org, missing Trading role, disabled Trading entitlement, list enabled/unconfigured states, set default, disable default, no secret leakage.

- [ ] **Step 2: Run RED**

- [ ] **Step 3: Implement minimal admin endpoints**

Keep writes scoped to Trading-owned `source_connections` and existing encrypted secret store patterns.

- [ ] **Step 4: Run GREEN**

- [ ] **Step 5: Commit**

Commit message: `feat: add trading source administration api`.

---

### Task 9: Non-Live Acceptance, CI, Documentation, and Soak Harness

**Files:**
- Create: `cloudflare-v2/src/testing/source_provider_acceptance.js`
- Create: `cloudflare-v2/scripts/mtproto_container_soak.mjs`
- Modify: `cloudflare-v2/package.json`
- Modify: `.github/workflows/trading-v1-ci.yml` only if additional pure tests need explicit invocation
- Modify: `AGENTS.md`
- Modify: `cloudflare-v2/docs/STAGING_V1_RUNBOOK.md`

**Interfaces:**
- Produces non-live provider acceptance and a long-duration soak harness that can be run only when external Container/Telegram credentials are configured through environment/secrets.

- [ ] **Step 1: Write RED acceptance tests for provider selection and fallback**

Cover preferred/default provider healthy, preferred unavailable with another enabled provider still functioning, no provider configured, and duplicate event arrival from two providers.

- [ ] **Step 2: Implement acceptance harness**

No secret output. No live trading. Soak harness records disconnect/reconnect, message receive latency, catch-up, duplicates, and health transitions.

- [ ] **Step 3: Run full local verification**

Run `npm run test:ci`, Python MT5 bridge tests, MTProto listener unit tests, and `npx wrangler deploy --dry-run`.

- [ ] **Step 4: Push and require CI GREEN**

Do not claim complete until Worker/core, MT5 bridge, MTProto pure tests, and Wrangler dry-run are successful at the exact branch head.

- [ ] **Step 5: Update operational docs**

Document source provider types, default semantics, Container runtime configuration, DO alternative, external listener signing, queue binding, health fields, cost-sensitive deployment guidance, and non-live soak procedure.

- [ ] **Step 6: Update `AGENTS.md`**

Record exact commit/CI evidence, safety boundaries, remaining external configuration, and next safe action.

- [ ] **Step 7: Commit**

Commit message: `docs: record multi-source provider acceptance`.
