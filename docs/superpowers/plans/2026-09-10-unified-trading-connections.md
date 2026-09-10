# Unified Trading Connections Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver broker-agnostic cTrader OAuth onboarding, editable/reviewable connection lifecycle controls, safe external MTProto endpoint management, and MT5 Bridge/Cloud connection modes without enabling real broker execution.

**Architecture:** Extend the existing admin source/account APIs instead of replacing them. Persist new non-secret connection metadata in additive columns, keep credentials in the existing encrypted envelopes, route cTrader OAuth through a dedicated server-side module, and represent MT5 Bridge/Cloud as provider modes on the existing trading-account model. Existing source/account records remain readable and default into legacy-compatible provider modes.

**Tech Stack:** Cloudflare Workers ES modules, Supabase/PostgreSQL migrations, Node test runner, existing Mkety encryption/authorization helpers, cTrader Open API OAuth REST flow.

**Spec:** `docs/superpowers/specs/2026-09-10-unified-trading-connections-design.md`

## Global Constraints

- Work only in `MketyDigital/Trading`.
- Do not enable real broker execution.
- Persisted owner master switch must remain `brokerExecutionEnabled=false` and effective execution BLOCKED.
- No cTrader client secret, OAuth token, MT5 password, ingress secret or cloud credential may be committed or returned by normal reads.
- New accounts remain inactive, execution-disabled, kill-switch-on by default.
- Existing source/account records and legacy external MTProto endpoints remain compatible.

---

### Task 1: Additive connection metadata persistence

**Files:**
- Create: `cloudflare-v2/db/migrations/0023_unified_trading_connections.sql`
- Test: `cloudflare-v2/tests/unified_trading_connections_migration.test.mjs`

**Interfaces:**
- Produces additive `trade_accounts.provider_mode`, `trade_accounts.environment`, `trade_accounts.roles`, `trade_accounts.provider_config` and source metadata compatibility required by later tasks.

- [ ] Write migration contract test asserting additive/default-safe fields and uniqueness for one physical provider/account/workspace connection.
- [ ] Commit failing test.
- [ ] Add migration with nullable/backward-compatible defaults and no execution-state mutation.
- [ ] Verify migration contract in CI.

### Task 2: Editable source lifecycle and safe external MTProto management

**Files:**
- Modify: `cloudflare-v2/src/http/v1_admin_sources.js`
- Modify: `cloudflare-v2/src/http/v1_admin_source_ingress_secret.js`
- Modify: `cloudflare-v2/src/http/external_mtproto_endpoint.js`
- Test: `cloudflare-v2/tests/admin_source_connection_management.test.mjs`

**Interfaces:**
- Produces `PUT /api/v1/admin/sources/:id`, `DELETE /api/v1/admin/sources/:id`, safe source detail with stable endpoint metadata, and one-time secret rotation.

- [ ] Add failing tests for safe metadata update, immutable provider/family, delete permissions, stable external endpoint visibility, and one-time secret rotation.
- [ ] Implement store update/delete methods and public stable endpoint metadata without plaintext secret disclosure.
- [ ] Accept both legacy secret-in-path and new stable-endpoint authentication paths.
- [ ] Verify source tests and existing source tests in CI.

### Task 3: Unified trading-account lifecycle and MT5 hybrid modes

**Files:**
- Modify: `cloudflare-v2/src/http/v1_admin_accounts.js`
- Test: `cloudflare-v2/tests/admin_account_connection_management.test.mjs`

**Interfaces:**
- Produces safe provider modes `legacy`, `ctrader_oauth`, `mt5_bridge`, `mt5_cloud`; roles `source`/`execution`; account `GET/PUT/DELETE`; Bridge pairing metadata; Cloud provider readiness.

- [ ] Add failing tests for account detail/edit/delete, roles without duplicate physical account, Bridge setup metadata, Cloud unavailable state, and unchanged execution safety.
- [ ] Extend public account normalization and store lifecycle methods.
- [ ] Permit Bridge account creation without broker password while keeping Cloud credential-required and encrypted.
- [ ] Keep Cloud mode unavailable unless an explicit provider is configured.
- [ ] Verify account tests and execution safety tests in CI.

### Task 4: cTrader OAuth server flow

**Files:**
- Create: `cloudflare-v2/src/http/v1_ctrader_oauth.js`
- Modify: `cloudflare-v2/src/v1_entry.js`
- Test: `cloudflare-v2/tests/ctrader_oauth_connections.test.mjs`

**Interfaces:**
- Produces `GET /api/v1/admin/accounts/ctrader/oauth/start` and callback handling using `CTRADER_CLIENT_ID`, `CTRADER_CLIENT_SECRET`, `CTRADER_REDIRECT_URI`; encrypted token persistence and discovered-account normalization.

- [ ] Add failing tests for not-configured readiness, short-lived workspace/user-bound state, callback rejection on invalid/expired state, token exchange secret handling, and inactive/execution-off persisted accounts.
- [ ] Implement OAuth URL generation using official cTrader `id.ctrader.com` grant endpoint and `openapi.ctrader.com/apps/token` exchange.
- [ ] Persist only encrypted token envelopes; never return access/refresh/client secret.
- [ ] Add account-discovery adapter boundary so protocol account discovery can be supplied without manual broker password/server entry.
- [ ] Verify OAuth tests in CI.

### Task 5: Connections portal UX

**Files:**
- Modify: `cloudflare-v2/src/dashboard_enterprise_portal.js`
- Test: `cloudflare-v2/tests/enterprise_portal_lifecycle_controls.test.mjs`

**Interfaces:**
- Produces separate Signal Inputs and Trading Accounts UX; Connect cTrader; Connect MT5 Bridge/Cloud; View/Edit/Enable/Disable/Rotate/Remove controls.

- [ ] Add failing portal assertions for cTrader OAuth CTA, MT5 mode chooser, editable source/account controls, visible non-secret endpoint, and no manual cTrader password/server fields.
- [ ] Update portal forms/renderers/actions while preserving existing endpoints and mobile table containment.
- [ ] Keep secret fields write-only and show configured status instead of stored values.
- [ ] Verify portal and 390px overflow regression tests in CI.

### Task 6: Full branch verification and delivery

**Files:**
- No product file unless a regression is found.

**Interfaces:**
- Produces a reviewable PR with CI evidence and no production execution change.

- [ ] Run full `cloudflare-v2` Node test suite through repository CI.
- [ ] Review diff for accidental secrets, execution-gate changes and destructive migrations.
- [ ] Open PR to `main` and verify Trading V1 CI is green.
- [ ] Do not merge/deploy until all checks pass; after merge, guarded production deployment must still verify owner switch OFF/effective execution BLOCKED.
