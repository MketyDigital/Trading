# Trading V1 – Operational Source of Truth

## Mission
Launch Mkety Trading as a standalone enterprise Trading workspace product inside the Mkety ecosystem with an independent Trading runtime/data plane, strict workspace isolation, deterministic safety, durable idempotency and controlled rollout.

This file is the highest-priority handoff/source-of-truth for agentic work in `MketyDigital/Trading`.

## Hard boundaries

- Work only inside `MketyDigital/Trading`.
- Do not touch `MketyDigital/mksaas` or any MkSaaS repository, branch, issue, PR, file, deployment, or configuration.
- Do not enable real-money broker execution during launch-console or frontend acceptance work.
- Keep `BROKER_EXECUTION_ENABLED=false` until the owner explicitly approves a separate demo/live broker acceptance gate.
- Never commit real broker credentials, Telegram sessions, API keys, access tokens, Cloudflare secrets, Supabase service-role keys, or userbot sessions.
- Do not expose stored secrets back to browser/API responses. Return only safe state such as `credentialConfigured`.
- Do not let AI formatting alter canonical trading semantics: symbol, side, order type, entry, stop loss, take profits, volume/risk, and management action remain deterministic/trusted.
- Caller-supplied workspace, account, provider, credential, destination, broker, role, routing, or execution hints are never authority.

## Current production baseline — 2026-09-08

- PR #12 `fix: complete enterprise connections and 2026 AI guidance` was squash-merged to `main`.
- Feature merge commit: `f2e50e5b5fc6eb0bf1a5c245e177a7684315071e`.
- Production rollout-trigger commit: `ab8505de2a7de1dd72dcabd0178f6564e7879662`.
- Permanent Trading V1 CI on the final clean PR head passed Worker/trading-core Node tests, pure MT5 bridge tests, and pure MTProto Python tests.
- Final clean PR head: `0e8ff122c44ff321c3a67b2db9af98b5f5c9e101`.
- Required CI run: `34250264724`, test job `102142599263`, conclusion `success`.
- Production deployment run: `34250788623`, deployment job `102144448360`, conclusion `success`.
- GitHub CodeQL on rollout commit `ab8505de...` completed successfully in run `34250788225`.
- Production Worker script: `mkety-copier-engine`.
- Current deployed Worker version: `2b8a49c4-21f6-4727-b118-b81aea4f91ed`.
- Cloudflare Container image digest: `sha256:49ce922edddbdb3fb25ad7f617480a78e908d5fc2b22d274b537866b7a0e4ed1`.
- Production health probe returned HTTP 200 with `status: ready`, `ready: true`, `simulationReady: true`, `mtprotoContainerReady: true`, and no mandatory missing configuration.
- Production health reports local access-code auth enabled; central Mkety signed auth remains optional/not configured.
- Cloudflare for SaaS foundation is active. Existing managed DNS records `saas-origin.mkety.com` and `trading-customers.mkety.com` were already correct during deploy; no conflicting DNS was overwritten.
- `TRADING_ACCESS_ENABLED=true`.
- `TRADING_ACCESS_CODE_REDEMPTION_ENABLED=true`.
- `TRADING_ACCESS_CODE_SESSION_ENABLED=true`.
- `TRADING_CUSTOM_HOSTNAMES_ENABLED=true`.
- `TRADINGVIEW_DIRECT_INGRESS_ENABLED=false`.
- `TRADINGVIEW_CERT_PROBE_ENABLED=false`.
- `BROKER_EXECUTION_ENABLED=false`.
- Real-money execution is not authorized.

## Production migration ledger

Supabase project `Mkety Digital` is healthy. The production migration ledger confirms the Trading schema required by the current console is already applied, including:

- `trading_0003_multi_source_provider_registry`
- `trading_0004_cross_provider_event_identity`
- `trading_0005_mtproto_provider_credentials`
- `trading_0006_mtproto_recovery_state`
- `trading_0007_internal_privilege_hardening`
- `trading_0008_default_source_search_path`
- `trading_0009_workspace_memberships`
- `trading_0010_tradingview_public_source_handle`
- `trading_0011_destination_delivery_retry_state`
- `trading_0012_trade_accounts_trading_workspace_fk`
- `trading_0013_workspace_hostnames`
- `trading_0014_connection_credentials`
- `trading_access_code_onboarding`
- `trading_destinations_templates_routes`
- `enterprise_console_reconciliation_v2`

PR #12 added no new database migration. No Trading migration is pending for the deployed release.

## Simple authoritative architecture

### Customer entry

The only normal customer entry is `https://trade.mkety.com/`.

Access-code authentication is active. The customer enters an access code and owner email; the portal creates a short-lived Trading session automatically. Customers do not copy workspace IDs or bearer tokens manually.

`/mkety-admin/access-codes` is the separate Mkety staff surface for issuing/revoking enterprise access codes.

### External VM MTProto

External/user-owned MTProto is transport-only:

`Telegram userbot -> private source-bound TRADING_ENDPOINT -> Worker`

The external userbot does not own workspace selection, chat policy, AI, formatting, branding, destinations, or broker routing. Mkety does not collect Telegram `apiId`, `apiHash`, or `session` for this provider. The Worker authenticates the source and enforces persisted Telegram chat policy before AI or routing.

### Mkety-hosted MTProto

Cloudflare Container/DO providers may store encrypted Telegram login credentials. Hosted sources must declare their allowed Telegram `chat_ids`; the Worker re-checks them before AI/trading logic.

### Core Worker authority

After ingress the Worker owns:

1. workspace/source identity and authorization;
2. source-native idempotency/replay convergence;
3. Telegram chat authorization;
4. deterministic canonical signal parsing;
5. bounded AI only where allowed;
6. formatting/branding without semantic drift;
7. persisted source-to-destination route resolution;
8. explicit broker-account destination selection;
9. destination delivery/retry;
10. audit/operations records;
11. final account/workspace/safety revalidation before any future broker dispatch.

No broker account is selected merely because it exists in a workspace.

## Launch feature inventory

### Enterprise portal

- single enterprise portal/session;
- access-code onboarding;
- entitlement-aware views and controls;
- session restore and sign-out;
- workspace overview;
- operations/audit visibility.

### Connections / sources

- TradingView webhook;
- custom signed API;
- External VM MTProto handoff-only;
- Cloudflare Container MTProto;
- Cloudflare DO MTProto;
- MT5 source bridge;
- cTrader source;
- source connect/disconnect controls;
- authoritative Telegram account/chat scope;
- one-time external MTProto ingress secret/endpoint.

### Broker accounts and execution safety

- MT5/cTrader account management;
- explicit activate/deactivate;
- account execution enable/disable flag;
- account kill switch;
- allowed symbols and risk policy support;
- broker-account destinations use explicit persisted account IDs;
- global `BROKER_EXECUTION_ENABLED=false` remains the master acceptance fuse.

### Destinations and routing

Required destination types:

- Telegram channel/group;
- broker account;
- internal webhook/API;
- audit-only.

Persisted source-to-destination routes are workspace-scoped and can be enabled/disabled. Caller payload hints cannot override them.

### Telegram formatting

Formatting modes:

- `none`;
- `clean`;
- `template`;
- `ai_then_fallback`.

AI formatting is presentation-only. Deterministic fallback preserves symbol, side, order type, entry, stop loss and take-profit semantics.

### AI providers

- AI providers are workspace-configured.
- Provider model is explicit configuration; hidden model fallbacks were removed.
- Missing model fails configuration instead of silently choosing a legacy model.
- AI provider failures/circuit-breakers cannot change deterministic trading semantics.

### Enterprise administration

- team/member controls;
- custom hostname controls when entitled;
- branding;
- source credentials and destination credentials handled through protected APIs;
- list/read APIs expose only secret-safe state;
- Mkety staff access-code manager remains isolated from tenant authentication.

## Access-code capabilities

Access-code-provisioned workspaces use independently enforceable capability flags:

- `tradingExecutionDestination` — allows broker-account/internal-webhook destination setup but never enables live broker execution;
- `telegramDestination` — allows Telegram destinations;
- `customSubdomain` — allows requested subdomain onboarding;
- `customHostname` — allows custom hostname admin controls.

Mkety staff UI provides Trading Only, Trading + Telegram, Full Access, and custom combinations. Server-side entitlement checks are authoritative.

## Trading/risk logic preserved

- Signal classification: new signal, management, non-actionable/needs review.
- Sides: BUY, SELL, LONG, SHORT.
- Orders: MARKET, LIMIT, STOP, STOP_LIMIT.
- Entries: market, fixed price, range, fast/incomplete.
- Signal fields: symbol, entry, stop loss, TP1/TP2/TP3+, fast entry, incomplete signal.
- Management: move SL to breakeven, close half/50%, cancel pending, close all, close position.
- Risk sizing: fixed lots, risk percent, fixed risk amount.
- Risk inputs: equity, balance, entry, stop loss, tick size, tick value per lot, min/max/step lot, number of targets.
- Account policy: account disabled, kill switch, allowed symbols, max lots per trade, max risk percent, max daily loss percent, max open risk percent.
- New accounts default inactive, execution disabled, kill switch on.
- Risk-reducing actions may remain available during drawdown locks unless kill switch is on.

## Verification evidence from the 2026-09-08 completion batch

The CI regression was traced to stale tests that created hosted MTProto sources without the now-required persisted chat allowlist. Runtime behavior was correct: the Worker rejected those fixtures with `MTPROTO_CHAT_NOT_AUTHORIZED` before AI/routing. Fixtures were updated to use `config.chat_ids`, and the complete permanent suite returned green.

Temporary diagnostic/shard workflows used to isolate the regression were removed before final clean-head CI and are not part of the production repository state.

Production deploy evidence:

- production credential-presence gate: passed;
- Cloudflare authentication: passed;
- Cloudflare for SaaS foundation: passed;
- managed DNS records: already correct;
- generated safe production config checks: passed;
- secure temporary secrets file creation/removal: passed;
- Wrangler production dry-run: passed;
- Worker + MTProto Container deployment: passed;
- production health probe: passed;
- recorded safety posture: broker execution disabled.

## Known non-blocking follow-ups

- Central Mkety signed auth is optional and currently not configured; access-code auth is active and production-ready for frontend acceptance.
- Supabase security advisor currently reports shared-project findings outside this Trading release, including `public.rls_auto_enable()` being callable as a `SECURITY DEFINER` function by `anon`/`authenticated`, the `vector` extension in `public`, leaked-password protection disabled, and multiple RLS-enabled tables with no policies. Do not mutate shared Mkety database security objects from this Trading repo without a separately scoped review because other Mkety applications may depend on them.
- GitHub Actions warns that `actions/checkout@v4` and `actions/setup-node@v4` target deprecated Node 20 internally and are forced onto Node 24 by the current runner. This is non-blocking but should be cleaned up when newer action majors are adopted.

## Next safe action

The production release is deployed and ready for owner-driven frontend E2E acceptance with broker execution OFF.

Use `docs/trading-launch-console-manual-e2e.md` and validate, in order:

1. Mkety staff access-code creation;
2. customer access-code sign-in at `trade.mkety.com`;
3. entitlement-aware controls;
4. source creation and connect/disconnect;
5. destinations;
6. formatting/AI fallback;
7. explicit source-to-destination routes;
8. deterministic test signal;
9. Telegram delivery/idempotency where configured;
10. operations/audit;
11. hostname entitlement behavior without making unauthorized customer DNS changes;
12. session restore/sign-out.

Do not enable real-money broker execution during this acceptance pass.

## Live-money authorization boundary

Repository completion, production Worker deployment, access-code frontend acceptance, source/destination configuration, simulation, and non-broker destination testing do not authorize live-money execution.

`BROKER_EXECUTION_ENABLED` must remain `false` until a separate owner-approved demo/live broker acceptance phase records reviewed account/risk limits and completes the applicable safety gates in `cloudflare-v2/docs/PRODUCTION_V1_CUTOVER_RUNBOOK.md`.
