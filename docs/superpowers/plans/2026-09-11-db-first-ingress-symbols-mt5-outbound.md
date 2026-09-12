# DB-First Ingress, Cross-Broker Symbols, and Outbound MT5 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver shared authenticated Telegram collection with database filtering, system-wide DB-first dynamic configuration, account-wide broker symbol catalogs for cTrader/MT5, and an outbound paired MT5 connector while preserving the existing canonical execution engine.

**Architecture:** The existing Mkety Worker remains authoritative. New transports authenticate themselves, then resolve workspace/source/account authority from Supabase. Symbol resolution uses actual broker catalogs and fails closed on ambiguity. MT5 changes from inbound HTTP as the recommended customer route to outbound authenticated WebSocket sessions that reuse the existing MT5 trading engine.

**Tech Stack:** Cloudflare Worker / Node.js, Supabase/PostgreSQL, Python/MetaTrader5, cTrader Automate C#, Node WebSocket gateway, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-09-11-db-first-ingress-symbols-mt5-outbound-design.md`

## Global Constraints

- Existing Mkety Worker remains the single authoritative execution system.
- No customer VPS requirement.
- Dynamic customer/workspace configuration belongs in Supabase unless technically required as bootstrap/local connector state.
- Transport authentication must remain fail-closed.
- Broker execution uses the existing deterministic canonical trade model; formatted/AI presentation text is never the final broker command.
- Symbol resolution applies to all cTrader/MT5 brokers and instruments and never guesses ambiguous symbols.
- Do not change the persisted Mkety owner broker switch during deployment.

---

### Task 1: Shared authenticated MTProto collector

**Files:**
- Create: `cloudflare-v2/db/migrations/0027_external_mtproto_collectors.sql`
- Create: `cloudflare-v2/src/http/external_mtproto_collector_endpoint.js`
- Modify: `cloudflare-v2/src/storage/supabase_ingest_store.js`
- Modify: `cloudflare-v2/src/v1_entry.js`
- Modify: `cloudflare-v2/src/v1_connections_entry.js`
- Test: `cloudflare-v2/tests/external_mtproto_collector_endpoint.test.mjs`
- Test: `cloudflare-v2/tests/external_mtproto_collector_tenant_fanout.test.mjs`

**Interfaces:**
- Produces `sourceStore.findActiveExternalMtprotoSourcesForChat(chatId)` returning active source records with decrypted source secret only after collector authentication.
- Produces `handleExternalMtprotoCollectorRequest(request, env, deps)`.

- [ ] Write failing tests proving unauthenticated collector gets 401; authenticated unknown chat returns 202 and never calls event parsing; authenticated selected chat fans out to exactly matching active source(s), including multiple workspaces.
- [ ] Add migration with `trading_ingress_collectors(id uuid, collector_name text, token_hash text unique, is_active boolean, metadata jsonb, created_at, updated_at, last_seen_at)` and indexes. Store SHA-256 token hashes only.
- [ ] Extend Supabase source store with a chat-policy lookup using active `external_mtproto` rows and existing `config.allowed_chat_ids` / `chat_acceptance_mode` semantics.
- [ ] Implement collector token lookup/hash comparison, native Telegram identity normalization, source-bound signing, fanout through existing `handleV1EventsRequest`, and 202 ignored response for zero matches.
- [ ] Register `/api/v1/external/mtproto/collect` and `/api/v1/external/mtproto/collect/:token` before the legacy source-specific route.
- [ ] Run collector-focused tests and existing external MTProto endpoint/replay/tenant-isolation tests.
- [ ] Commit collector implementation.

### Task 2: Collector administration and listener-compatible setup

**Files:**
- Create: `cloudflare-v2/src/http/v1_mkety_admin_ingress_collectors.js`
- Modify: `cloudflare-v2/src/v1_connections_entry.js`
- Modify: `cloudflare-v2/src/dashboard_mkety_admin_access_codes.js` or closest existing Mkety-admin surface
- Test: `cloudflare-v2/tests/v1_mkety_admin_ingress_collectors.test.mjs`
- Test: `cloudflare-v2/tests/enterprise_connections_sync.test.mjs`

**Interfaces:**
- Produces create/list/rotate/revoke admin operations; plaintext token returned only on create/rotate.
- Produces one stable collector URL suitable for the existing `TRADING_ENDPOINT` setting.

- [ ] Write failing admin/API tests for create/list/rotate/revoke and secret-safe list responses.
- [ ] Implement DB-backed collector management under existing Mkety staff/admin authorization.
- [ ] Surface a copyable collector endpoint; prefer token-in-path compatibility so the existing listener can send all messages without requiring per-source headers.
- [ ] Update copy to explain that user source/chat selection remains in Mkety DB and the listener forwards all visible messages.
- [ ] Run admin/front-end contract tests and commit.

### Task 3: System-wide DB-first configuration guardrails

**Files:**
- Create: `cloudflare-v2/src/config/config_ownership.js`
- Test: `cloudflare-v2/tests/config_ownership.test.mjs`
- Modify: `.github/workflows/production-cloudflare-deploy.yml`
- Modify: `cloudflare-v2/wrangler.toml` only where static platform config genuinely belongs there
- Modify: documentation/manifests that currently present customer-specific MT5/cTrader settings as deployment env.

**Interfaces:**
- Produces documented/tested classifications `PLATFORM_BOOTSTRAP_KEYS` and dynamic DB-backed categories.

- [ ] Write failing tests that assert customer account IDs, broker servers, source chat IDs, routes, lot/risk policies and symbol aliases are not required production deployment environment variables.
- [ ] Implement configuration-ownership registry/documentation and remove stale customer-specific deployment requirements where they exist.
- [ ] Keep `TRADING_MASTER_KEY`, Supabase bootstrap credentials, shared cBot gateway keys and true infrastructure/provider application credentials as secrets/env.
- [ ] Change production acceptance so it reads/reports owner broker-switch state without requiring OFF and never writes it.
- [ ] Run production-workflow contract tests and commit.

### Task 4: Account-wide cross-broker symbol catalog

**Files:**
- Modify: `cloudflare-v2/src/normalization/symbol_catalog.js`
- Modify: `cloudflare-v2/src/normalization/trading_normalizer.js`
- Create: `cloudflare-v2/src/execution/account_symbol_catalog.js`
- Modify: `cloudflare-v2/src/execution/production_execution_deps.js`
- Modify: `cloudflare-v2/src/adapters/ctrader_cbot_executor_v2.js`
- Modify: `cloudflare-v2/src/adapters/mt5_executor_v2.js` as needed
- Test: `cloudflare-v2/tests/account_symbol_catalog.test.mjs`
- Test: `cloudflare-v2/tests/symbol_catalog.test.mjs`

**Interfaces:**
- Produces `resolveAccountSymbol(requested, catalog, aliases)` with exact > canonical > explicit alias > unique normalized-match ordering.
- Persists safe catalog snapshot and timestamp in account provider configuration or dedicated DB field/table.

- [ ] Write failing tests for broker suffixes/prefixes, synthetic/derived names, exact matches, aliases, missing symbols and ambiguity.
- [ ] Implement account-wide resolver on top of existing `resolveSymbolAgainstCatalog`; never add Deriv-specific branching.
- [ ] Add safe persistence/update helpers for account catalog + aliases.
- [ ] Make MT5 and cTrader cBot production dispatch resolve against persisted/current catalog before platform translation.
- [ ] Run normalizer, MT5 executor and cTrader executor tests and commit.

### Task 5: cTrader cBot publishes account-wide symbol catalog

**Files:**
- Modify: `ctrader-cbot/MketyCloudAutoTrader/MketyCloudAutoTrader.cs`
- Modify: `ctrader-cbot-gateway/src/server.js`
- Modify: `ctrader-cbot-gateway/src/protocol.js`
- Modify: `cloudflare-v2/src/http/v1_admin_ctrader_cbot.js`
- Modify: `cloudflare-v2/src/dashboard_ctrader_cbot_connections.js`
- Test: `ctrader-cbot-gateway/test/gateway.test.mjs`
- Test: `cloudflare-v2/tests/ctrader_cbot_protocol.test.mjs`
- Test: `cloudflare-v2/tests/v1_admin_ctrader_cbot.test.mjs`

**Interfaces:**
- cBot auth/refresh message can include a bounded `symbols` catalog independent of host chart symbol/timeframe.
- Gateway connection status returns safe `symbols` catalog.

- [ ] Write failing tests that prove one cBot session advertises multiple symbols and sync persists them without depending on a selected host pair.
- [ ] Add C# safe symbol snapshot generation using account-visible/tradable cTrader `Symbols` API.
- [ ] Extend gateway identity/session state with bounded validated symbol catalog and refresh messages.
- [ ] Persist catalog during Mkety cBot identity sync.
- [ ] Update frontend copy: one cBot instance per cTrader account; selected pair/timeframe does not limit Mkety execution symbols.
- [ ] Build `.algo`, run gateway/cBot tests and commit.

### Task 6: Outbound MT5 gateway/session protocol

**Files:**
- Create: `mt5-connector-gateway/package.json`
- Create: `mt5-connector-gateway/src/protocol.js`
- Create: `mt5-connector-gateway/src/server.js`
- Create: `mt5-connector-gateway/test/gateway.test.mjs`
- Create: `cloudflare-v2/src/adapters/mt5_connector_protocol.js`
- Create: `cloudflare-v2/src/adapters/mt5_connector_executor_v2.js`
- Modify: `cloudflare-v2/src/execution/production_execution_deps.js`

**Interfaces:**
- Pair token identifies one Mkety trade-account row.
- Authenticated session reports actual account ID, server, demo/live metadata and symbol catalog.
- Worker control API can preflight session identity and deliver one command with correlated response.

- [ ] Write failing gateway/protocol tests for token auth, account identity binding, offline rejection, replay, command expiry and response correlation.
- [ ] Implement shared outbound MT5 gateway using the cBot gateway's proven control/session architecture but a distinct protocol/version and service path.
- [ ] Implement Worker MT5 outbound executor that preflights actual session identity before reserving delivery and reuses existing canonical MT5 platform translation.
- [ ] Preserve existing HTTP bridge adapter as compatibility mode.
- [ ] Run gateway/Worker tests and commit.

### Task 7: Windows MT5 connector using existing engine

**Files:**
- Create: `mt5-connector/mkety_mt5_connector.py`
- Reuse/import: `cloudflare-v2/bridges/mt5_bridge.py` engine/replay helpers or extract focused reusable module
- Create: `mt5-connector/test_connector.py`
- Create: `mt5-connector/README.md`
- Create: `.github/workflows/mt5-connector-release.yml`

**Interfaces:**
- Connector accepts gateway URL + one-time pairing token once, derives actual terminal identity from MetaTrader5, receives post-pairing reconnect credential, stores it locally with restricted permissions, and reconnects outbound.
- Commands call the existing `MT5Engine.execute_reconciled` behavior.

- [ ] Write failing pure-Python tests with fake MT5 module for account/server discovery, catalog publication, pairing token handling, reconnect credential storage, command execution and replay reconciliation.
- [ ] Refactor only enough shared MT5 engine code to avoid duplicating trading logic.
- [ ] Implement outbound WebSocket connector and safe local state file; no customer broker password is sent to Mkety by this connector because MT5 terminal is already logged in.
- [ ] Add release packaging workflow (Windows executable artifact via PyInstaller if CI environment supports it) and checksum.
- [ ] Run pure MT5 bridge + connector tests and commit.

### Task 8: Mkety MT5 outbound pairing UI/API

**Files:**
- Modify: `cloudflare-v2/src/http/v1_admin_connections.js`
- Create/modify: MT5 connector pairing HTTP handler as needed
- Modify: `cloudflare-v2/src/dashboard_unified_connections.js`
- Test: `cloudflare-v2/tests/unified_connection_management.test.mjs`
- Test: `cloudflare-v2/tests/production_frontend...` relevant contracts

**Interfaces:**
- `provider_mode = mt5_connector` (new mode) with pending identity, encrypted pairing/reconnect credential, status `awaiting_connector` -> `connected`.

- [ ] Write failing API/UI tests for one-time pairing token creation, sync, connected state and no public bridge URL/env-variable instructions.
- [ ] Add DB migration/provider-mode constraint for `mt5_connector` if required.
- [ ] Make outbound MT5 Connector the recommended UI flow and label HTTP Bridge as compatibility/advanced until retired.
- [ ] Add download/setup steps once a release asset exists.
- [ ] Run connection/frontend tests and commit.

### Task 9: Canonical execution fast path verification

**Files:**
- Test: `cloudflare-v2/tests/canonical_execution_fast_path.test.mjs`
- Modify only existing parser/normalizer/platform-translation files if tests expose a concrete compatibility gap.
- Update: `docs/MKETY_TRADING_OPERATOR_CUSTOMER_MANUAL.md`

**Interfaces:**
- Existing canonical interpretation remains authoritative.

- [ ] Add a matrix of representative signal text shapes (compact, multiline, ranges, current-price, pending, multi-TP, management) that must converge to canonical intent or fail closed without depending on Telegram formatting templates.
- [ ] Verify broker route consumes canonical intent and account catalog, not destination presentation text.
- [ ] Verify deterministic `template` remains recommended for Telegram display only; `ai_then_fallback` cannot alter broker execution semantics.
- [ ] Update operator manual with exact customer/operator setup for shared Telegram collector, cBot account-wide symbols, outbound MT5 connector, DB/env ownership and execution path.
- [ ] Commit docs/tests.

### Task 10: Production migration, CI, rollout and live-safe acceptance

**Files:**
- Modify CI/deployment workflows only as required by prior tasks.

- [ ] Apply new Supabase migrations and verify constraints/indexes.
- [ ] Run complete Trading V1 Node suite, pure MT5 bridge/connector suite, MTProto suite, cBot gateway suite, `.algo` build and Docker/Compose validation.
- [ ] Open PR and review changed-file patch for secret leakage/customer-env regressions.
- [ ] Merge only after green CI.
- [ ] Verify production Worker health, current owner broker-switch state without changing it, shared collector auth behavior, cBot gateway health and frontend connection flows.
- [ ] For broker execution acceptance, use demo/non-live accounts only unless a real account is explicitly supplied and separately authorized.
