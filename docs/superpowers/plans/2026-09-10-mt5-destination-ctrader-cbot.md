# MT5 Destination + cTrader cBot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete MT5 destination pairing/runtime addressing and add cTrader Cloud cBot as a second safe destination execution method beside the existing cTrader Open API.

**Architecture:** MT5 pairing will replace the bootstrap pairing URL with a verified public HTTPS terminal bridge URL while preserving the current HMAC bridge protocol. cTrader cBot mode will add a new provider mode and a shared Mkety gateway: Worker commands enter over authenticated HTTPS and are delivered to Cloud cBots over secure WebSockets on port 25345; the cBot remains a thin execution adapter.

**Tech Stack:** Cloudflare Worker JavaScript, Supabase, Node.js gateway, WebSocket, cTrader Algo C#, existing Mkety canonical execution/risk/idempotency layers.

**Spec:** `docs/superpowers/specs/2026-09-10-mt5-destination-ctrader-cbot-design.md`

## Global Constraints

- MT5 source/master capture is out of scope and must remain unchanged.
- Existing broker execution gates remain authoritative and live execution is not enabled by this work.
- New accounts remain inactive, execution-disabled, and kill-switched by default.
- Secrets remain encrypted at rest and are never committed.
- cTrader Open API behavior remains unchanged and stays the recommended connection method.
- cTrader Cloud cBot WebSocket traffic uses port 25345.

---

### Task 1: Repair MT5 destination pairing runtime URL

**Files:**
- Modify: `cloudflare-v2/src/http/external_mt5_bridge_endpoint.js`
- Test: existing external MT5 bridge endpoint test under `cloudflare-v2/tests/`

**Interfaces:**
- Consumes: pairing POST body containing `accountId`, `serverName`, optional environment metadata, and `bridgeUrl`.
- Produces: encrypted MT5 credentials containing the verified runtime `bridgeUrl` and existing `bridgeSecret`.

- [ ] Add a failing test proving a pairing request with a public HTTPS bridge URL persists that URL in encrypted credentials while preserving the bridge secret.
- [ ] Add failing tests rejecting missing, non-HTTPS, credential-bearing, and malformed bridge URLs.
- [ ] Add a failing test proving bridge metadata/account mismatch does not mark the account connected.
- [ ] Run the focused test and confirm the new assertions fail for the missing behavior.
- [ ] Implement URL normalization/validation, signed bridge verification using the existing MT5 metadata protocol, account identity verification, and credential re-encryption.
- [ ] Run the focused MT5 endpoint tests and the MT5 executor/protocol tests.
- [ ] Commit the independently working MT5 destination repair.

### Task 2: Add cTrader cBot connection onboarding

**Files:**
- Modify: `cloudflare-v2/src/security/connection_credentials.js`
- Modify: `cloudflare-v2/src/http/v1_admin_connections.js`
- Modify: relevant connection UI/client file discovered from current repo
- Test: relevant connection credential/admin connection tests

**Interfaces:**
- Consumes: new connection provider mode `ctrader_cbot`.
- Produces: inactive `trade_accounts` row with encrypted one-time cBot token, `awaiting_cbot` provider status, and one-time gateway setup details.

- [ ] Add failing credential tests for the cBot credential kind and rejecting unsupported fields.
- [ ] Add failing admin connection tests for `ctrader_cbot`, one-time setup material, safe defaults, and unchanged `ctrader_openapi` behavior.
- [ ] Run focused tests and confirm failure.
- [ ] Implement the minimal cBot credential kind and onboarding branch, including gateway readiness configuration.
- [ ] Update UI copy to present `Direct Connection — Recommended` and `Cloud Auto Trader` without changing Open API flow.
- [ ] Run connection tests and commit onboarding.

### Task 3: Add Worker-side cBot command protocol and executor

**Files:**
- Create: `cloudflare-v2/src/adapters/ctrader_cbot_protocol.js`
- Create: `cloudflare-v2/src/adapters/ctrader_cbot_executor_v2.js`
- Modify: `cloudflare-v2/src/execution/production_execution_deps.js`
- Test: new focused protocol/executor tests under `cloudflare-v2/tests/`

**Interfaces:**
- Consumes: existing canonical destination action, persisted cBot account connection, idempotency key, risk-approved execution request.
- Produces: authenticated gateway command with command ID/account binding/issued-expiry timestamps/action payload and normalized execution result.

- [ ] Add failing tests for deterministic command envelopes, expiry, account binding, duplicate-safe delivery identity, and fail-closed gateway errors.
- [ ] Run focused tests and verify red.
- [ ] Implement protocol helpers and the minimal executor using the gateway internal HTTPS control API.
- [ ] Extend production dispatch to select the cBot executor only for persisted `ctrader_cbot` accounts while leaving Open API dispatch unchanged.
- [ ] Run focused execution tests and commit.

### Task 4: Add shared cBot gateway service

**Files:**
- Create: `ctrader-cbot-gateway/package.json`
- Create: `ctrader-cbot-gateway/src/server.js`
- Create: `ctrader-cbot-gateway/src/protocol.js`
- Create: `ctrader-cbot-gateway/test/protocol.test.js`
- Create: `ctrader-cbot-gateway/test/gateway.test.js`
- Create: `ctrader-cbot-gateway/README.md`

**Interfaces:**
- Consumes: authenticated internal Worker commands over HTTPS/control transport and outbound cBot WebSocket sessions on port 25345.
- Produces: account-bound session registry, command delivery, correlated execution results, heartbeat/online state.

- [ ] Add failing protocol tests for token authentication, account binding, expiry and duplicate command rejection.
- [ ] Add failing gateway tests for offline account failure, connected delivery, result correlation and timeout behavior.
- [ ] Run gateway tests and verify red.
- [ ] Implement the minimal Node gateway with separate internal control endpoint and WebSocket listener configuration defaulting to port 25345.
- [ ] Ensure secrets are environment-only and logs never print tokens or trading credentials.
- [ ] Run gateway tests and commit.

### Task 5: Add cTrader Cloud cBot client

**Files:**
- Create: `ctrader-cbot/MketyCloudAutoTrader/MketyCloudAutoTrader.csproj`
- Create: `ctrader-cbot/MketyCloudAutoTrader/MketyCloudAutoTrader.cs`
- Create: `ctrader-cbot/README.md`

**Interfaces:**
- Consumes: gateway URI on port 25345 plus one-time Mkety connection token.
- Produces: authenticated cBot session, account identity heartbeat, execution acknowledgements/results.

- [ ] Define a small pure C# command-validation unit that can be tested independently of cTrader runtime: command ID, expiry, account binding and duplicate cache.
- [ ] Add tests for those validation rules before wiring trading API calls.
- [ ] Implement the cBot with `AccessRights.None` and `cAlgo.API.WebSocketClient`, reconnect handling, authentication and heartbeat.
- [ ] Implement market/pending open, modify protection, full/partial close and pending cancellation using cTrader Algo trading APIs.
- [ ] Keep all Telegram parsing, strategy and risk decisions out of the cBot.
- [ ] Document Cloud startup steps and the no-customer-VPS requirement.
- [ ] Commit the cBot client.

### Task 6: Integration, regression and acceptance documentation

**Files:**
- Modify: `README.md` and/or current trading connection documentation
- Add/modify: focused test fixtures as needed

**Interfaces:**
- Consumes: Tasks 1-5.
- Produces: documented setup and verified regression state without changing live safety switches.

- [ ] Run the Cloudflare V2 full Node test suite.
- [ ] Run focused MT5 bridge/protocol tests.
- [ ] Run cBot gateway tests.
- [ ] Build/test the cBot project where the environment supports the cTrader SDK; otherwise record the exact external build prerequisite without claiming a successful build.
- [ ] Verify Open API cTrader tests still pass unchanged.
- [ ] Verify no MT5 source files changed.
- [ ] Verify no secret material exists in the diff.
- [ ] Update setup documentation for MT5 destination bridge URL and cTrader Cloud Auto Trader.
- [ ] Commit documentation and prepare the feature branch for pull-request review.
