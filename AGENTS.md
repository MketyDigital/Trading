# Trading V1 – Operational Source of Truth

## Mission
Launch Mkety Trading as a standalone enterprise Trading workspace product inside the Mkety ecosystem with an independent Trading runtime/data plane, strict workspace isolation, deterministic safety, durable idempotency and controlled rollout.

This file is the highest-priority handoff/source-of-truth for agentic work in `MketyDigital/Trading`.

## Hard boundaries

- Work only inside `MketyDigital/Trading`.
- Do not touch `MketyDigital/mksaas` or any MkSaaS repository, branch, issue, PR, file, deployment, or configuration.
- Do not enable real-money broker execution during launch-console work.
- Keep `BROKER_EXECUTION_ENABLED=false` until the owner explicitly approves a separate demo/live broker acceptance gate.
- Never commit real broker credentials, Telegram sessions, API keys, access tokens, Cloudflare secrets, Supabase service-role keys, or userbot sessions.
- Do not expose stored secrets back to browser/API responses. Return only booleans such as `credentialConfigured`.
- Do not let AI formatting alter canonical trading semantics: symbol, side, order type, entry, stop loss, take profits, volume/risk, and management action must remain deterministic/trusted.

## Current production baseline

- `main` contains the enterprise Trading V1 foundation and access-code onboarding.
- Production Worker has been deployed from `main` with access-code/dashboard access enabled.
- Production database migration for `trading_access_codes` and `trading_access_code_redemptions` has been applied.
- Broker execution remains disabled.
- `trade.mkety.com/api/v1/health` may report `not_ready` while `MKETY_ACCESS_ISSUER`, `MKETY_ACCESS_AUDIENCE`, and `MKETY_ACCESS_JWKS_URL` are missing. Access-code local sessions can still be tested when `TRADING_ACCESS_CODE_SESSION_ENABLED=true` and `TRADING_ACCESS_CODE_SESSION_SECRET` is configured.

## Active launch-completion branch

Branch: `feature/trading-launch-console-destinations-mtproto`

Draft PR: #8 `feat: complete Trading launch console destinations and MTProto setup`

Goal: complete the business-facing launch console so the owner can test the entire real system end to end without editing Supabase manually for normal setup.

## Approved launch-completion scope

1. Mkety-admin access-code manager.
2. Enterprise launch console.
3. V1 destination management.
4. Telegram destination delivery and formatting controls.
5. AI formatting controls with deterministic fallback.
6. Source-to-destination routing.
7. External VM MTProto setup as signed payload handoff only.
8. Cloudflare Container/DO MTProto setup with encrypted Telegram credentials.
9. Domain/custom-hostname clarity and setup instructions.
10. Trading/risk logic inventory visible in the dashboard.
11. Progress log and handoff docs kept current.

## Correct MTProto model

### External VM MTProto

External VM MTProto supports ready-made/existing userbots. Mkety must not collect Telegram `apiId`, `apiHash`, or `session` for this mode.

Mkety creates/registers:

- a source connection;
- source ID;
- signing/internal handoff details;
- expected payload format;
- destination route mapping.

The owner's VM/userbot reads Telegram and sends signed payloads to the Worker. The Worker verifies source identity, parses the signal, routes to destinations, and audits the result.

### Mkety-owned MTProto

Cloudflare Container MTProto and Cloudflare Durable Object MTProto are Mkety-hosted runtimes. These modes can collect Telegram `apiId`, `apiHash`, and `session`, encrypt them with `TRADING_MASTER_KEY`, and use runtime recovery/status screens.

## Destination model

A destination is where a processed signal goes.

Required destination types:

- Telegram channel/group;
- broker account;
- internal webhook/API;
- audit-only.

Telegram destination formatting modes:

- `none`: send source text almost unchanged;
- `clean`: remove footer/source branding/links according to owner rules, without changing trade numbers;
- `template`: deterministic branded layout;
- `ai_then_fallback`: AI may rewrite presentation, but fallback deterministic template must be used if AI fails/slow/unsafe.

## Access-code capabilities

Access-code-provisioned workspaces use independently enforceable capability flags:

- `tradingExecutionDestination` — allows broker-account/internal-webhook destination setup but never enables live broker execution;
- `telegramDestination` — allows Telegram destinations;
- `customSubdomain` — allows requested subdomain onboarding;
- `customHostname` — allows custom hostname admin controls.

Mkety staff UI provides Trading Only, Trading + Telegram, Full Access, and custom combinations. Server-side entitlement checks are authoritative. Existing non-access-code enterprise workspaces retain their prior behavior.

## Mkety admin vs enterprise owner

Mkety admin panel is for Mkety staff to create enterprise owner access codes, list/revoke them, and view redemption state.

Enterprise owner console is for customers to manage their workspace, sources, destinations, AI formatting, accounts/risk, domains, MTProto setup, and audit.

## Existing trading/risk logic to preserve and expose

- Signal classification: new signal, management, non-actionable/needs review.
- Sides: BUY, SELL, LONG, SHORT.
- Orders: MARKET, LIMIT, STOP, STOP_LIMIT.
- Entries: market, fixed price, range, fast/incomplete.
- Signal fields: symbol, entry, stop loss, TP1/TP2/TP3+, fast entry, incomplete signal.
- Management: move SL to breakeven, close half/50%, cancel pending, close all, close position.
- Risk sizing: fixed lots, risk percent, fixed risk amount.
- Risk inputs: equity, balance, entry, stop loss, tick size, tick value per lot, min/max/step lot, number of targets.
- Account policy: account disabled, kill switch, allowed symbols, max lots per trade, max risk percent, max daily loss percent, max open risk percent.
- Risk-reducing actions may remain available during drawdown locks unless kill switch is on.
- New accounts must default inactive, execution disabled, kill switch on.
- Event ingest must verify source, signature, timestamp, database workspace authority, external MTProto policy, duplicate reservation, and only then parse/AI/orchestrate.
- Caller-supplied workspace/account/provider/destination hints are never authority.

## Progress log

- 2026-09-07: Production foundation merged/deployed from `main`; Supabase access-code migration applied; broker execution disabled.
- 2026-09-07: Owner clarified external VM MTProto must be handoff-only and not collect Telegram credentials.
- 2026-09-07: Branch `feature/trading-launch-console-destinations-mtproto` created for launch-console completion.
- 2026-09-07: `AGENTS.md` updated as launch-completion source-of-truth and handoff file.
- 2026-09-07: Launch-completion design spec and implementation plan added.
- 2026-09-07: Destination schema migration `0015_trading_destinations_templates_routes.sql` added.
- 2026-09-07: V1 destination/template/source-route contract tests added and green.
- 2026-09-07: Deterministic Telegram formatting module added with semantic guard for symbol, side, order, entry, SL, and TP preservation.
- 2026-09-07: V1 destination admin API added and routed under `/api/v1/admin/destinations`, `/api/v1/admin/templates`, and `/api/v1/admin/routes`.
- 2026-09-08: Mkety-admin access-code contract tests added.
- 2026-09-08: MTProto setup contract tests added for external VM handoff-only and Mkety-hosted Container/DO credential boundaries.
- 2026-09-08: Mkety-admin access-code API added under `/api/v1/mkety-admin/access-codes`, guarded by `MKETY_TRADING_ADMIN_SECRET`/`TRADING_ADMIN_SECRET`.
- 2026-09-08: MTProto setup contract module added under `src/sources/mtproto/setup_contract.js`.
- 2026-09-08: Worker entrypoint routed Mkety-admin access-code API outside enterprise owner routes, but still secret-guarded.
- 2026-09-08: PR #8 CI failure was traced to one incorrect launch-console test expectation: safe HTML escaping rendered `Operations &amp; Audit`; the test expected raw `Operations & Audit`. Test-only fix committed and full Trading V1 CI returned green.
- 2026-09-08: Migration `0015` was hardened before production application with workspace-qualified foreign keys for template/destination/source routes; an isolation contract test was added. Full Trading V1 CI returned green after the hardening.
- 2026-09-08: Destination delivery/event-path integration, Telegram adapter, internal-webhook coverage, enterprise launch-console destination/template/route controls and `MTProto Setup` UI contract were completed and returned green in CI.
- 2026-09-08: Mkety staff access-code UI added at `/mkety-admin/access-codes`; staff secret remains memory-only, plaintext code is shown once, and list/revoke responses remain secret-safe.
- 2026-09-08: Access-code capability flags added for trading-execution destinations, Telegram destinations, custom subdomain and custom hostname. Creation/redemption now normalize these flags, force demo-only broker modes and `liveExecution=false`, and expose only safe entitlements.
- 2026-09-08: Server-side capability enforcement added for custom hostnames, subdomain redemption, destination creation/mutation/enable/credentials and route targeting. Existing non-access-code enterprise workspaces remain backward-compatible.
- 2026-09-08: External VM MTProto source onboarding corrected to handoff-only: it no longer accepts or stores Telegram account credentials and has no credential-replacement path; hosted Container/DO remain encrypted credential-bearing providers.
- 2026-09-08: Manual E2E launch runbook added at `docs/trading-launch-console-manual-e2e.md`.

## Next work

1. Run final full CI/security verification on PR #8 head.
2. Confirm migration `0015_trading_destinations_templates_routes.sql` is ready but leave it unapplied until merge/deploy authorization.
3. After explicit owner authorization: merge PR #8, apply migration `0015`, deploy with `BROKER_EXECUTION_ENABLED=false`, then execute the manual E2E runbook.
4. Keep customer DNS/custom-host production state and any real broker execution behind their own separate explicit authorization boundaries.

## Safety authorization boundary

Repository completion and safe staging/simulation acceptance may use production-shaped code with non-real/ephemeral credentials while all broker execution fuses remain disabled. Never enable real-money execution, connect real broker credentials, merge to `main`, or change customer DNS/custom-host production state without the separate explicit authorization required for that action.
