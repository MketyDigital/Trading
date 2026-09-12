# PR #36 Audit Remediation and Cutover Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish PR #36 without mixing hosted MTProto, external shared MTProto, cTrader, MT5, database, gateway, or deployment responsibilities, and cut over only after every relevant acceptance gate is green.

**Architecture:** Preserve the existing Mkety Worker as the sole trading authority. External Telegram is transport-only through a shared authenticated collector; hosted MTProto remains source-bound. cTrader and MT5 remain adapters behind persisted routes, durable account/risk authority, generic account symbol resolution, and delivery idempotency. The shared gateway remains a transport service on the Azure/Coolify host and is deployed separately from the Cloudflare Worker.

**Tech Stack:** Cloudflare Worker/Node 22, Supabase/Postgres, Python 3.11/3.12, MetaTrader5 Python API, cTrader Automate/.NET, Node WebSocket gateway, Caddy/Docker Compose, GitHub Actions, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-11-db-first-ingress-symbols-mt5-outbound-design.md`

## Global Constraints

- Work only in `MketyDigital/Trading`.
- Never make caller payloads authoritative for workspace, source, route, broker account, credentials, or risk.
- Keep hosted MTProto source-bound; shared collector mode applies only to `cloudflare-v2/external/mtproto-adapter`.
- Customer-specific trading configuration belongs in Supabase, not required deployment environment variables.
- Preserve the current persisted owner broker switch; deployment must report it, never silently force it ON or OFF.
- Do not enable real-money execution as part of this implementation.
- Do not expose broker passwords, service-role keys, gateway control secrets, Telegram sessions, or other stored secrets to customer APIs/UI.
- Resolve broker symbols against the actual connected account catalog and fail closed on missing/ambiguous matches.
- Preserve the existing MT5 execution/replay engine and cTrader execution semantics.
- Remove temporary diagnostic CI before the final verified head.

---

### Task 1: Restore external MTProto legacy compatibility and normalize shared-collector onboarding

**Files:**
- Modify: `cloudflare-v2/external/mtproto-adapter/app.py`
- Modify: `cloudflare-v2/external/mtproto-adapter/v1_sink.py` only if root-cause tracing proves required
- Modify: `cloudflare-v2/external/mtproto-adapter/test_adapter.py`
- Modify: `cloudflare-v2/external/mtproto-adapter/test_collector_mode.py`
- Modify: `cloudflare-v2/src/http/v1_mkety_admin_ingress_collectors.js`
- Test: `cloudflare-v2/tests/v1_mkety_admin_ingress_collectors.test.mjs`

**Interfaces:**
- Legacy mode: source id + source secret signs `/api/v1/events` exactly as before.
- Collector mode: clean `/api/v1/external/mtproto/collect` endpoint plus one collector bearer token; no local chat allowlist.
- Admin collector response: expose the clean collector endpoint and one-time token as separate fields; path-token compatibility may remain server-side but is not the recommended listener configuration.

- [ ] Reproduce the failing legacy signature test and trace the exact bytes/timestamp/signature received by the test sink.
- [ ] Add/adjust a focused regression test proving legacy signed mode verifies and collector mode sends only bearer authentication.
- [ ] Make the minimal adapter fix without changing hosted MTProto.
- [ ] Change collector admin create/rotate responses so `endpointUrl` is the clean `/collect` URL while `oneTimeToken` remains separate.
- [ ] Run both external-adapter Python suites and collector Worker tests.

### Task 2: Make the MT5 Windows connector release-safe on Windows

**Files:**
- Modify: `cloudflare-v2/bridges/mt5_bridge.py` only if the reusable `ReplayLedger` lacks a close method
- Modify: `mt5-connector/mkety_mt5_connector.py`
- Modify: `mt5-connector/test_connector.py`
- Test/build: `.github/workflows/mt5-connector-release.yml`

**Interfaces:**
- `MketyMt5Connector.close()` closes its replay ledger/resources deterministically.
- Tests must release SQLite handles before temporary-directory cleanup on Windows.

- [ ] Add a failing resource-lifecycle test/Windows-safe cleanup expectation.
- [ ] Add the smallest explicit close path around `ReplayLedger` and invoke it in connector shutdown/tests.
- [ ] Run pure connector tests on Windows CI.
- [ ] Build `MketyMT5Connector.exe`, checksum it, and upload the PR artifact without publishing a release from the PR.

### Task 3: Make MT5 first-run onboarding match the customer-facing UX

**Files:**
- Modify: `mt5-connector/mkety_mt5_connector.py`
- Modify: `mt5-connector/test_connector.py`
- Modify: `cloudflare-v2/src/dashboard_mt5_connector_connections.js`
- Modify: `cloudflare-v2/tests/mt5_connector_frontend.test.mjs`
- Modify: `mt5-connector/README.md`

**Interfaces:**
- Double-click/no-argument first run prompts for the one-time pairing token when no local config exists.
- Default gateway is baked in as `wss://cbot.mkety.com:25345/v1/mt5`; customer does not have to type it.
- CLI `--token`, `--config`, and `--reset` remain supported for advanced/operator use.

- [ ] Add tests for first-run prompt/config creation without broker credentials.
- [ ] Implement a simple console first-run prompt rather than a new GUI framework.
- [ ] Update portal copy to say: download, keep MT5 logged in, open connector, paste one-time token, then sync identity.
- [ ] Ensure portal does not tell customers to paste a WebSocket URL.
- [ ] Re-run frontend contract and connector tests.

### Task 4: Reconcile MT5 pairing/reconnect lifecycle with DB-first execution authority

**Files:**
- Modify: `cloudflare-v2/src/config/config_ownership.js`
- Modify: `cloudflare-v2/tests/config_ownership.test.mjs`
- Modify: `cloudflare-v2/src/http/v1_admin_mt5_connector.js`
- Modify: `ctrader-cbot-gateway/src/mt5_protocol.js`
- Modify: `ctrader-cbot-gateway/src/mt5_server.js`
- Modify tests under `ctrader-cbot-gateway/test/` and `cloudflare-v2/tests/mt5_connector_onboarding.test.mjs`

**Interfaces:**
- Supabase remains authoritative for account existence, provider status, identity, activation/execution/kill-switch, symbol catalog, routes, risk, and server-side pairing state.
- Local reconnect credential is transport authentication only and cannot authorize a trade by itself.
- Pair tokens remain short-lived and purpose-scoped; reconnect credentials remain instance-bound.
- Revoked/deleted/disabled DB accounts remain non-executable even if a physical socket remains connected.

- [ ] Add explicit tests documenting the authority boundary instead of claiming the reconnect secret itself is DB-resident.
- [ ] Remove stale original pair-token storage from the long-lived encrypted account credentials after successful sync if it is not required for dispatch.
- [ ] Preserve only gateway URL/control credential server-side for Worker-to-gateway control after sync.
- [ ] Re-run onboarding, production dispatch, risk-context and gateway protocol suites.

### Task 5: Harden database migrations and verify them against production schema

**Files:**
- Modify: `cloudflare-v2/db/migrations/0027_external_mtproto_collectors.sql`
- Review: `cloudflare-v2/db/migrations/0028_mt5_connector_provider_mode.sql`

**Interfaces:**
- `trading_ingress_collectors` is service-role-only with RLS enabled; plaintext tokens are never stored.
- `trade_accounts.provider_mode` accepts `mt5_connector` without weakening existing provider values.

- [ ] Replace search-path-dependent `uuid_generate_v4()` with `gen_random_uuid()` (available in production).
- [ ] Re-read current production constraints immediately before applying.
- [ ] Apply 0027 and 0028 only after code CI is green.
- [ ] Verify table/index/RLS/grants and provider-mode constraint with SQL.
- [ ] Run Supabase security and performance advisors and record Trading-relevant findings without mutating unrelated shared-project objects.

### Task 6: Expand production browser/release contracts for outbound MT5

**Files:**
- Modify: `.github/workflows/production-frontend-e2e.yml`
- Modify: `cloudflare-v2/tests/ctrader_cbot_deployment_workflow.test.mjs`
- Modify: `cloudflare-v2/tests/mt5_connector_release_contract.test.mjs`

**Interfaces:**
- Production browser gate must see `MT5 Connector — Recommended`, create-pairing control, advanced HTTP bridge separation, and the expected release asset URL.
- E2E must not enable account execution or live trading.

- [ ] Add browser assertions for the outbound MT5 form/copy without creating a live broker connection.
- [ ] Keep old HTTP Bridge reachable only as advanced compatibility.
- [ ] Ensure release workflow publishes only from main/tag, never from PR.
- [ ] Verify cTrader release behavior is unchanged.

### Task 7: Update operator/customer documentation to the audited architecture

**Files:**
- Modify: `docs/MKETY_TRADING_OPERATOR_CUSTOMER_MANUAL.md`
- Modify: `cloudflare-v2/external/mtproto-adapter/README.md`
- Modify: `ctrader-cbot-gateway/README.md`
- Modify: `mt5-connector/README.md`

**Interfaces:**
- External shared collector and hosted MTProto are explicitly distinct.
- Recommended MT5 path is outbound connector; HTTP bridge is advanced compatibility.
- Gateway deploy is explicitly a separate Azure/Coolify operation from Worker deploy.
- Customer instructions match the actual EXE behavior.

- [ ] Replace stale MT5-Bridge-as-current language.
- [ ] Document clean shared collector endpoint + separate collector token.
- [ ] Document MT5 `/v1/mt5` and private control paths in the shared gateway.
- [ ] Document safe rollout ordering and rollback.

### Task 8: Remove diagnostics and run final full verification

**Files:**
- Delete: `.github/workflows/diagnostic-trading-tests.yml`
- Potentially update: `CURRENT_HANDOFF.md`, `AGENTS.md` only after verified cutover evidence exists.

**Verification matrix:**
- Trading V1 Node/Worker tests.
- Hosted MTProto Python tests.
- External MTProto adapter Python tests.
- MT5 bridge/reconciliation tests.
- MT5 outbound connector Windows tests + PyInstaller build.
- cTrader gateway tests.
- cTrader `.algo` actual build.
- Coolify/portable Docker Compose/Caddy validation.
- Production frontend browser E2E after Worker deployment.
- Final PR diff/secret scan and current-head CI.

- [ ] Remove temporary diagnostic workflow.
- [ ] Run/observe all required CI checks on the clean head.
- [ ] Use `superpowers:verification-before-completion` before claiming green.
- [ ] Keep PR draft until all repository-controlled checks pass.

### Task 9: Production-safe cutover in dependency order

**Order:**
1. DB migrations 0027/0028.
2. Merge verified PR.
3. Worker production deployment and health/runtime-control verification.
4. Publish verified MT5 Windows release asset from main.
5. Deploy updated shared gateway to the existing Azure/Coolify application.
6. Create shared external MTProto collector credential through protected Mkety-admin API.
7. Update the external listener to clean collector endpoint + collector token; do not alter hosted MTProto container configuration.
8. Verify unselected Telegram chat => 202 accepted/ignored; selected chat => correct persisted source/workspace/event pipeline.
9. Demo-connect outbound MT5 and sync real terminal identity/catalog.
10. Re-sync existing cTrader cBot identity/catalog.
11. Keep account execution disabled unless separately approved for demo/live broker acceptance.

- [ ] Perform every step accessible through connected tooling and record any infrastructure step that requires external Coolify/VM/listener access rather than pretending it was completed.
- [ ] Preserve the current persisted owner broker switch value throughout deployment.
