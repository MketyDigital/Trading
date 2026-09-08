# Current Development Handoff

Read root `AGENTS.md` first for production boundaries and the Trading V1 production baseline.

## Current state — PR #13 complete and launched

PR #13, `fix: returning owner sessions and admin runtime controls`, has been merged to `main` and deployed to production.

- PR: #13 — merged
- Verified feature head: `613c3cdba0ea247059bb03b916ac73e2493123e1`
- Merge commit: `a6f3bd1bcdea14381511812ce3eb0662fe15fe48`
- Production release-trigger commit: `de324920132a4e5d0b7b0681eebd4df12a7a5f5f`
- Production deployment run: `34273032195`
- Deployed Cloudflare Worker version: `fd933071-6849-4f42-b86e-1df554726a37`
- Migration `0017_trading_runtime_controls.sql`: applied to production
- `MKETY_TRADING_ADMIN_SECRET`: confirmed configured by production credential gate without exposing its value
- Trading V1 Node, MT5, and MTProto suites: passed on the verified feature head
- Final feature-head and release-head CodeQL: passed for JavaScript/TypeScript, Python, and Actions
- Production health: `ready: true`

## Broker execution acceptance posture

The two independent broker gates remain intentionally split:

`BROKER_EXECUTION_ENABLED` **AND** persisted `broker_execution_enabled`

Current production state after deployment:

- deployment/outer broker capability: **ON**
- persisted Mkety owner broker switch: **OFF**
- effective broker execution: **OFF / blocked**

The persisted switch was re-verified directly in production Supabase after deployment. Do not enable real-money broker execution during ordinary frontend acceptance.

## Returning-owner authentication state

Production now includes the PR #13 returning-owner session implementation:

- short-lived local bearer sessions
- signed refresh credentials
- HttpOnly `mkety_trading_refresh` cookie
- `/api/v1/access/session`
- `/api/v1/access/logout`
- returning access-code login handling
- owner-email binding
- workspace and owner-membership revalidation during restoration
- fail-closed runtime-control reads

Production deployment enables access-code redemption and returning-session support. The deployment derives a key-separated access-code session signing secret from `TRADING_MASTER_KEY` when a dedicated `TRADING_ACCESS_CODE_SESSION_SECRET` is not configured.

## Production verification evidence

Production deployment run `34273032195` passed all of its gates, including:

- main-only deployment guard
- required production credentials by name only
- Cloudflare authentication
- Cloudflare for SaaS DNS/fallback-origin validation
- dual-gate Wrangler production configuration
- production dry-run
- Worker/container deployment
- production health probe
- persisted owner broker switch verification
- temporary secrets-file cleanup

The production runtime-control response verified:

- `brokerExecutionCapabilityEnabled: true`
- `brokerExecutionEnabled: false`
- `effectiveBrokerExecutionEnabled: false`

## Historical plan and handoff

Detailed PR #13 handoff:

`docs/superpowers/handoffs/2026-09-08-returning-auth-admin-runtime-controls-handoff.md`

Implementation plan:

`docs/superpowers/plans/2026-09-08-returning-auth-admin-runtime-controls.md`

Those files now describe the completed implementation history rather than an active blocker. Future work should start from the deployed `main` baseline and preserve the two-gate broker safety model unless a separately reviewed real-money activation change is explicitly authorized.
