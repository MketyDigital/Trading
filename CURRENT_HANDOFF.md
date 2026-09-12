# Current Development Handoff

Read root `AGENTS.md` for the architectural and security boundaries. This file records the newest verified production state and supersedes older dated baseline sections when they conflict.

## Current state — production infrastructure healthy

The DB-first connectivity release from PR #36 is launched, and the remaining external broker-gateway blocker was fixed on 2026-09-12 by PR #38.

Key release commits:

- PR #36 merge: `23369f9d14afb4daa153f90832ef3cbb2be9652e`
- production frontend follow-up: `96db5ff65fb252b9324a29a741085fce5f140dd8`
- PR #38 gateway bootstrap fix: `6ef2b6f55c01d7c1cb62a9f921267282f67b9b2f`

Production migrations applied and verified:

- `trading_0027_external_mtproto_collectors`
- `trading_0028_mt5_connector_provider_mode`

The released system includes DB-authoritative source/account configuration, broker symbol catalogs with fail-closed resolution, cTrader cBot catalog sync, outbound paired MT5 Connector, hosted/external MTProto ingress, and the legacy MT5 HTTP bridge as advanced compatibility.

## Production browser / Worker state

The real Chromium production gate is green. It verifies access-code sign-in, workspace loading, major portal views, cTrader/MT5 controls, stable MT5 EXE download, disposable destination/template mutations, desktop/mobile rendering, session restoration/logout, staff-API protection and absence of unexpected browser/HTTP errors.

The Cloudflare Worker remains the sole trading/orchestration authority. Caller-supplied workspace/account/provider/credential/destination/broker/role/routing/execution hints are never authority.

## Runtime controls — preserve owner state

Deployment never rewrites the persisted Mkety owner broker switch. Current verified production state remains:

- deployment broker capability: **ON**
- persisted owner broker switch: **ON**
- effective broker execution: **ON** at the global-control layer
- persisted switch timestamp: `2026-09-11T13:24:57.011+00:00`

This state was intentionally preserved. Account/source/route/risk/symbol/kill-switch gates remain independently authoritative.

Current production trading-account inventory after probe cleanup:

- one existing cTrader cBot test row, label `main test`;
- provider mode `ctrader_cbot`;
- broker identity still `pending:*`;
- account row remains active as previously configured;
- `execution_enabled = false`;
- account kill switch remains true;
- no real production broker identity is synchronized.

No current admin/runtime setting was rewritten during this release.

## Shared cTrader / MT5 gateway — production healthy

The existing Coolify application `Cbot Tcp gateway` was discovered through the production Coolify API credentials stored in GitHub, force-redeployed from current `main`, and verified publicly.

The first clean redeploy proved the deployment path but reproduced MT5 HTTP 502. Root cause was then isolated in the production Docker image: `ctrader-cbot-gateway/Dockerfile` launched `src/server.js` directly, so only the cTrader listener started even though the repository bootstrap and Caddy topology supported MT5.

PR #38 changed the production image entrypoint to `src/bootstrap.js` and added a regression test requiring the shared bootstrap. The test was observed RED on the old Dockerfile and GREEN after the fix. Trading V1 CI and cTrader cBot CI were both green before merge.

Post-merge Coolify cutover evidence:

- deployed repository: `MketyDigital/Trading`
- deployed branch: `main`
- deployed commit observed by Coolify: `6ef2b6f55c01d7c1cb62a9f921267282f67b9b2f`
- Compose: `/ctrader-cbot-gateway/deploy/coolify/docker-compose.yml`
- Coolify deployment result: `finished`
- public `/health`: five consecutive successful responses from `mkety-ctrader-cbot-gateway`
- `wss://cbot.mkety.com:25345/v1/cbot`: WebSocket upgrade succeeded; unauthenticated session failed closed with `1008 AUTH_REQUIRED`
- `wss://cbot.mkety.com:25345/v1/mt5`: WebSocket upgrade succeeded; unauthenticated session failed closed with `1008 AUTH_REQUIRED`

The earlier MT5 502 / stale-listener blocker is resolved. Temporary Coolify discovery/cutover workflows were removed after verification.

### Worker gateway credential state

Production Worker pairing creation has already proved that usable gateway signing/control configuration exists in the deployed Cloudflare state. GitHub production override inputs for those Worker values were previously absent, so future secret synchronization remains deployment-hardening work, not a current production-connectivity blocker. Do not expose or copy signing/control secrets through logs or chat merely to make the environments look symmetrical.

## MTProto production boundary — external VM is transport-only

The external MTProto VM is **not Mkety infrastructure** and must not be treated as a production-readiness dependency. It is a dumb outbound sender only.

Its contract is intentionally narrow:

1. receive Telegram messages using its own Telegram client/session;
2. POST the message/payload to the single opaque Mkety ingestion endpoint it has been given;
3. know nothing about Mkety workspaces, allowed chats, sources, collectors, routes, brokers, risk, account state or execution policy.

All authority remains inside Mkety. The Worker / Mkety-owned Cloudflare runtime resolves the authenticated ingress, source/chat authorization, DB selection, canonical event identity, replay protection, parsing, routing, risk and execution gates.

The existing source-specific external endpoint already supports this boundary because the external sender can be given one complete opaque URL and simply POST to it. Shared collector infrastructure (`trading_ingress_collectors` and `/api/v1/external/mtproto/collect...`) remains an internal Mkety capability for Mkety-owned collector/ingress topology; it is **not required merely to make an unrelated external VM production-ready**.

Production currently has zero `trading_ingress_collectors` rows. That is valid and is not a blocker. Do not manufacture a collector token or require changes on an external VM unless a separately approved Mkety-owned collector topology actually needs one.

Hosted MTProto (`cloudflare-v2/containers/mtproto-listener`) remains separate and Mkety-owned.

## Verification evidence

Current production/release evidence includes:

- Trading V1 Worker/trading-core, MT5 bridge and MTProto suites: green;
- cTrader Worker/gateway tests: green;
- actual cTrader `.algo` build: green;
- Coolify/portable deployment-stack validation: green;
- Windows MT5 Connector regression/build/checksum/release: green;
- production DB migrations 0027/0028 applied and verified;
- Cloudflare Worker/container deployment and health gates: green;
- real production Chromium E2E: green after the gateway fix;
- external Coolify gateway redeployed from current `main`: green;
- repeated public gateway health: green;
- public cTrader WebSocket route: green and fail-closed;
- public MT5 WebSocket route: green and fail-closed;
- temporary probe accounts removed and disposable access codes revoked;
- temporary deployment/diagnostic workflows removed from `main`.

## What is still intentionally unproven

Infrastructure is production-ready, but there is no real/demo broker account connected in the current production workspace. Therefore a true broker-side acceptance cannot be fabricated.

The next acceptance work requires actual connector clients/accounts, not more infrastructure changes:

1. connect an approved demo MT5 terminal with `MketyMT5Connector.exe` and sync its real identity/symbol catalog;
2. connect/sync an approved demo cTrader account/cBot if cBot acceptance is required;
3. exercise a controlled source → canonical parse → persisted route → risk/symbol gates → demo broker execution/reconciliation flow;
4. keep the existing account execution state and kill switch unchanged unless that specific demo acceptance explicitly authorizes a temporary change;
5. introduce no real-money broker account until demo acceptance is complete.

Do not treat the globally enabled broker capability as sufficient authority to execute a trade. Final source, route, account, execution, kill-switch, risk and symbol checks remain mandatory.
