# Current Development Handoff

Read root `AGENTS.md` for the architectural and security boundaries. This file records the newest production state and supersedes older dated baseline sections when they conflict.

## Current state — DB-first connectivity release launched

PR #36, `feat: DB-first ingress, broker symbols and outbound MT5`, was verified, squash-merged to `main`, migrated and deployed to production on 2026-09-12.

- PR #36: merged
- Verified PR head: `146b1b5159de841d36e99424b3e306337f0e8fe3`
- Merge commit: `23369f9d14afb4daa153f90832ef3cbb2be9652e`
- Production frontend follow-up: `96db5ff65fb252b9324a29a741085fce5f140dd8`
- Current production deploy run: `34683301637` — success
- Current production frontend E2E run: `34683341055` — success
- Current deployed Cloudflare Worker version: `dbf3aa91-14ce-4778-baf8-efa6375653d3`
- Current MTProto container digest: `sha256:3984b6291f0a7131f886bcc4fc3575f5054b8b4c141d6fa57ae6c9b0dd9be633`
- Production health: `ready: true`, `simulationReady: true`, `mtprotoContainerReady: true`

Production migrations applied and verified:

- `trading_0027_external_mtproto_collectors`
- `trading_0028_mt5_connector_provider_mode`

The collector table is RLS-enabled and service-role-only. `trade_accounts.provider_mode` now accepts `mt5_connector` through a validated constraint.

## Released connectivity architecture

The Mkety Worker remains the sole trading authority. The release adds:

- shared authenticated external MTProto collection with DB-driven source/chat selection;
- backwards-compatible source-specific external MTProto ingestion;
- database-authoritative customer/account configuration;
- account-specific broker symbol catalogs and fail-closed symbol resolution;
- account-wide cTrader cBot catalog synchronization;
- outbound paired MT5 Connector over the shared gateway transport;
- existing MT5 HTTP Bridge retained as advanced compatibility;
- current canonical signal/risk/routing semantics preserved.

Stable release workflows succeeded from `main` for both the cTrader cBot and the Windows MT5 Connector. The MT5 release publishes `MketyMT5Connector.exe` and its checksum.

## Production browser acceptance

The real Chromium production gate is green on the current head. It verifies:

- access-code sign-in and real workspace loading;
- Overview, Connections, Routing, AI, Branding, Operations and Team views;
- cTrader Direct and Cloud Auto Trader controls;
- `MT5 Connector — Recommended`, the stable EXE download, pairing UI and Advanced HTTP Bridge separation;
- destination/template mutations using disposable E2E data;
- desktop and 390px mobile rendering without horizontal overflow;
- refresh-session restoration;
- server logout and refresh-cookie invalidation;
- staff API remaining non-public;
- no unexpected browser console/page or HTTP errors.

## Runtime controls — preserve owner state

Deployment never rewrites the persisted Mkety owner broker switch. The current verified production state is:

- deployment broker capability: **ON**
- persisted owner broker switch: **ON**
- effective broker execution: **ON**
- persisted switch timestamp remains `2026-09-11T13:24:57.011+00:00`

This state was intentionally preserved during migrations and both production deployments. Account/source/route/risk gates remain independently authoritative. The only current trade-account row is a demo cTrader cBot test connection with pending broker identity and `execution_enabled = false`; no production broker identity is presently synchronized.

## External gateway state — remaining infrastructure cutover

The code, release packages and deployment stack for the shared cTrader/MT5 gateway are complete and CI-green, but the independent Azure/Coolify gateway is not yet on the complete current deployment/configuration.

A production network probe from GitHub Actions on 2026-09-12 established:

- `cbot.mkety.com` resolves to the Azure host;
- TLS on public port `25345` verifies successfully with a valid certificate for `cbot.mkety.com`;
- public `GET /health` returns HTTP 200 from `mkety-ctrader-cbot-gateway`;
- `wss://cbot.mkety.com:25345/v1/cbot` upgrades with HTTP 101 and unauthenticated sessions fail closed with `AUTH_REQUIRED`;
- the gateway remains healthy immediately after the cTrader unauthenticated probe;
- `wss://cbot.mkety.com:25345/v1/mt5` currently returns HTTP **502**.

The current repository Caddy configuration routes `/v1/mt5` to `gateway:25347`, and the current gateway bootstrap starts the MT5 listener on that internal port. Therefore the 502 is consistent with the externally deployed Azure/Coolify application still running an older/incomplete gateway deployment where the MT5 backend listener is unavailable. Redeploy the existing Coolify application from current `main` before MT5 connector acceptance.

The Worker production credential gate also reports these four inputs absent as a complete set:

- `PRODUCTION_CTRADER_CBOT_GATEWAY_URL`
- `PRODUCTION_CTRADER_CBOT_WS_URL`
- `PRODUCTION_CBOT_TOKEN_SIGNING_KEY`
- `PRODUCTION_CBOT_CONTROL_SECRET`

Until the Azure/Coolify application is updated/configured with matching signing/control secrets and those values are configured in the GitHub production environment, cTrader cBot and outbound MT5 pairing/dispatch intentionally remain fail-closed from the Worker.

Expected public broker endpoints after gateway cutover:

- `wss://cbot.mkety.com:25345/v1/cbot`
- `wss://cbot.mkety.com:25345/v1/mt5`

See `ctrader-cbot-gateway/README.md` for the separate Coolify deployment and gateway acceptance checks.

## Shared external MTProto collector state

The DB schema/API/runtime are deployed, but production currently has zero `trading_ingress_collectors` rows. Do not manufacture or expose a plaintext collector token in source, logs or chat. Create the collector through the protected Mkety-admin flow when the external listener operator is ready to receive the one-time token, then switch only the external listener to the clean `/api/v1/external/mtproto/collect` endpoint. Hosted MTProto configuration remains separate.

## Verification evidence

Current-head repository/production evidence includes:

- Trading V1 Worker/trading-core + MT5 bridge + MTProto suites: green;
- cTrader Worker/gateway tests, actual `.algo` build and Coolify/portable stack validation: green;
- Windows MT5 Connector regression tests, standalone EXE build/checksum/release: green;
- CodeQL on the merged release: green;
- Cloudflare authentication/SaaS DNS/fallback-origin checks: green;
- production dry-run + Worker/container deploy: green;
- production health/runtime-control checks: green;
- real production Chromium E2E: green;
- public gateway DNS/TLS/health/cTrader transport: green;
- public MT5 gateway route: **blocked by external 502 until Coolify redeploy**.

## Next external acceptance step

The repository/Worker/database/frontend release is complete. The next work requiring infrastructure outside the currently connected repository/database tooling is:

1. redeploy/update `ctrader-cbot-gateway/deploy/coolify/docker-compose.yml` on the existing Azure/Coolify application from current `main`;
2. configure matching gateway signing/control secrets and production GitHub environment values;
3. re-verify gateway `/health`, TLS on port 25345, cTrader `/v1/cbot`, and MT5 `/v1/mt5` (MT5 must upgrade rather than return 502);
4. create one shared external MTProto collector and configure the external listener with its one-time token;
5. verify unselected Telegram chat => accepted/ignored and selected chat => correct persisted source/workspace pipeline;
6. connect a demo MT5 terminal and sync its real identity/catalog;
7. sync a demo cTrader account/catalog;
8. exercise broker acceptance through account/risk/route gates before any real account is introduced.

Do not treat a globally enabled broker capability as authority to execute a trade; final source, route, account, execution, kill-switch, risk and symbol checks remain mandatory.
