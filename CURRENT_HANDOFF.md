# Current Development Handoff

Read root `AGENTS.md` for the architectural and security boundaries. This file records the newest verified production state and supersedes older dated baseline sections when they conflict.

## Current state — DB-first connectivity release launched

PR #36, `feat: DB-first ingress, broker symbols and outbound MT5`, was verified, squash-merged to `main`, migrated and deployed to production on 2026-09-12.

- PR #36: merged
- Verified PR head: `146b1b5159de841d36e99424b3e306337f0e8fe3`
- Merge commit: `23369f9d14afb4daa153f90832ef3cbb2be9652e`
- Production frontend follow-up: `96db5ff65fb252b9324a29a741085fce5f140dd8`
- Production deploy run: `34683301637` — success
- Production frontend E2E run: `34683341055` — success
- Deployed Cloudflare Worker version: `dbf3aa91-14ce-4778-baf8-efa6375653d3`
- MTProto container digest: `sha256:3984b6291f0a7131f886bcc4fc3575f5054b8b4c141d6fa57ae6c9b0dd9be633`
- Production health: `ready: true`, `simulationReady: true`, `mtprotoContainerReady: true`

Production migrations applied and verified:

- `trading_0027_external_mtproto_collectors`
- `trading_0028_mt5_connector_provider_mode`

The collector table is RLS-enabled and service-role-only. `trade_accounts.provider_mode` accepts `mt5_connector` through the validated constraint.

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

Stable release workflows succeeded from `main` for both the cTrader cBot and Windows MT5 Connector. The MT5 release publishes `MketyMT5Connector.exe` and its checksum.

## Production browser acceptance

The real Chromium production gate is green. It verifies access-code sign-in, real workspace loading, all major portal views, cTrader/MT5 connection controls, the stable EXE download, destination/template mutations using disposable E2E data, desktop/mobile rendering, session restoration/logout, staff-API protection and absence of unexpected browser/HTTP errors.

## Runtime controls — preserve owner state

Deployment never rewrites the persisted Mkety owner broker switch. The current verified production state remains:

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

## External gateway state — remaining infrastructure blocker

Repository gateway code, release packages and the current Coolify Compose/Caddy configuration are complete and CI-green. The independent Azure/Coolify deployment at `cbot.mkety.com` is not yet healthy/current enough for final broker acceptance.

Production network probes on 2026-09-12 established:

- `cbot.mkety.com` resolves to Azure host `20.57.161.98`;
- TLS on public port `25345` has presented and verified a valid certificate for `cbot.mkety.com`;
- `/health` has returned HTTP 200 from `mkety-ctrader-cbot-gateway`;
- `/v1/cbot` has successfully upgraded with HTTP 101 and unauthenticated sessions fail closed with `AUTH_REQUIRED`;
- `/v1/mt5` has returned HTTP **502**, consistent with the externally deployed gateway missing the current MT5 backend listener/routing;
- a later authenticated cTrader compatibility probe reached Worker pairing creation successfully but the public gateway then returned TCP `ECONNREFUSED` on `20.57.161.98:25345` before WebSocket authentication, showing the external gateway listener is intermittently unavailable/stale.

The current repository topology is correct: Caddy exposes public `25345`, routes cTrader WebSocket traffic to internal `gateway:25346`, routes `/v1/mt5` to internal `gateway:25347`, and the current bootstrap starts both listeners. The external Azure/Coolify application therefore needs a clean redeploy from current `main` and service/log verification.

### Worker credential state

The production deployment workflow currently reports these GitHub production override inputs absent:

- `PRODUCTION_CTRADER_CBOT_GATEWAY_URL`
- `PRODUCTION_CTRADER_CBOT_WS_URL`
- `PRODUCTION_CBOT_TOKEN_SIGNING_KEY`
- `PRODUCTION_CBOT_CONTROL_SECRET`

However, a direct production API probe proved the deployed Worker still has usable preserved gateway configuration: it successfully created both MT5 and cTrader pairing material. This means prior Cloudflare Worker secrets/configuration survived the deploy even though the GitHub override inputs are absent.

Do not describe production as `MT5_CONNECTOR_NOT_CONFIGURED`; that is not the observed runtime state. The real blocker is the external Azure/Coolify gateway deployment/availability. Reconcile the GitHub production environment after the gateway redeploy so future deploys are explicit rather than relying on preserved Worker secret state.

Expected public broker endpoints after gateway cutover:

- `wss://cbot.mkety.com:25345/v1/cbot`
- `wss://cbot.mkety.com:25345/v1/mt5`

See `ctrader-cbot-gateway/README.md` for the separate Coolify deployment and gateway acceptance checks.

## Shared external MTProto collector state

The DB schema/API/runtime are deployed and verified, but production currently has **zero** `trading_ingress_collectors` rows. Do not manufacture or expose a plaintext collector token in source, logs or chat. Create the collector through the protected Mkety-admin flow only when the external listener operator is ready to receive the one-time token, then switch only that external listener to `/api/v1/external/mtproto/collect`. Hosted MTProto configuration remains separate.

## Verification evidence

Current release evidence includes:

- Trading V1 Worker/trading-core + MT5 bridge + MTProto suites: green;
- cTrader Worker/gateway tests, actual `.algo` build and Coolify/portable stack validation: green;
- Windows MT5 Connector regression tests, standalone EXE build/checksum/release: green;
- CodeQL on the merged release: green;
- production DB migrations 0027/0028 applied and verified;
- Cloudflare authentication/SaaS DNS/fallback-origin checks: green;
- production dry-run + Worker/container deploy: green;
- production health/runtime-control checks: green;
- real production Chromium E2E: green;
- public gateway DNS/TLS and cTrader protocol behavior observed healthy during one probe;
- public MT5 gateway route: blocked by external 502;
- later public gateway availability: intermittent TCP refusal;
- temporary probe accounts removed and disposable access codes revoked;
- obsolete diagnostic PR #17 closed;
- temporary diagnostic workflow removed from `main`.

## Exact next step

The repository, Supabase migrations, Cloudflare Worker, frontend and connector release artifacts are production-ready. The remaining production cutover is external infrastructure and real connector acceptance:

1. redeploy the existing Azure/Coolify application from current `main` using `ctrader-cbot-gateway/deploy/coolify/docker-compose.yml`;
2. verify both `gateway` and `caddy` containers remain healthy and inspect restart/error logs;
3. confirm internal listeners `25346`, `25347`, `8790`, `8791` are up;
4. confirm public `cbot.mkety.com:25345` stays continuously reachable;
5. verify `/health`, cTrader `/v1/cbot` and MT5 `/v1/mt5` WebSocket upgrades;
6. reconcile matching signing/control secrets into the GitHub production environment so future Worker deploys do not depend on preserved Cloudflare state;
7. create one shared external MTProto collector and configure the external MTProto listener with its one-time token;
8. verify unselected Telegram chat => accepted/ignored and selected chat => correct persisted source/workspace pipeline;
9. connect a demo MT5 terminal and sync its real identity/catalog;
10. sync a demo cTrader account/catalog;
11. exercise full source → parse → risk → route → demo broker acceptance before introducing any real account.

Do not treat the globally enabled broker capability as sufficient authority to execute a trade; final source, route, account, execution, kill-switch, risk and symbol checks remain mandatory.
