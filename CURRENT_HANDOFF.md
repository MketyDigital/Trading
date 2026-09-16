# Current Development Handoff

Read root `AGENTS.md` first. This file records the newest implementation/release state and supersedes older handoffs when they conflict. Exact pre-update handoff history is preserved at `docs/archive/2026-09-16-pre-subscription-CURRENT_HANDOFF.md`.

## Active implementation — 2026-09-16

Active branch / PR:

- branch: `fix/frontend-access-lifecycle-red`
- PR: `#96` — real-user frontend visibility + persistent workspace subscription lifecycle
- branch is **not production until merged to `main` and production deployment completes**

### Scope

1. Make the normal Telegram Bot API source controls visible in the actual composed customer Connections page, including Bot token and allowed chat/channel IDs.
2. Treat each customer as one persistent Trading workspace. Access-code reissue/renewal rotates access on the same workspace rather than creating duplicate workspaces.
3. Revocation acts as a workspace subscription lock while preserving memberships, accounts, sources, routes, destinations, templates, settings, branding and audit history.
4. Returning browser sessions are bound to the current access-code ID. Revoked, expired or superseded access is rejected server-side.
5. Staff UI is workspace-centric: historical access-code rows remain in the database but do not appear as duplicate customer workspaces.
6. Visible Sign out must call `/api/v1/access/logout` before local browser session cleanup/reload.
7. Stabilization remains DEMO-only. This stream never authorizes LIVE.

### Current implementation files

- `cloudflare-v2/db/migrations/0037_subscription_access_lifecycle.sql`
- `cloudflare-v2/src/access/trading_access_codes.js`
- `cloudflare-v2/src/persistence/supabase_access_code_store.js`
- `cloudflare-v2/src/dashboard_returning_session.js`
- `cloudflare-v2/src/dashboard_mkety_admin_access_codes.js`
- `cloudflare-v2/src/dashboard_telegram_bot_source.js`
- `cloudflare-v2/scripts/test_ci_diagnostic.mjs`
- `cloudflare-v2/tests/access_subscription_lifecycle.test.mjs`
- `cloudflare-v2/tests/access_reissue_rotation.test.mjs`
- `cloudflare-v2/tests/frontend_real_user_visibility.test.mjs`
- `cloudflare-v2/docs/TRADING_ACCESS_CODE_ONBOARDING.md`

### Compatibility/debugging findings resolved on this branch

A first implementation unintentionally changed unrelated Mkety staff-admin API contracts. Existing Worker tests correctly caught the regression. The admin handler was restored to the proven API behavior rather than changing tests around the breakage.

The last remaining Worker failure was isolated to the visible Sign out regression contract. Root cause: local session cleanup had moved behind a helper, so the composed-page contract no longer proved the server logout -> portal-session clear -> reload sequence. The production code was fixed explicitly rather than weakening the test.

Trading V1 CI run `2755` on commit `16cb5f0039844ee4ea0c58d97bacd7a53e05d1a1` completed successfully: Worker/trading-core, pure MT5 bridge and pure MTProto tests all passed. Later documentation/security-hardening commits must receive a fresh green run before merge.

### Migration 0037

`0037_subscription_access_lifecycle.sql` is additive to the existing access-code model and replaces the existing rotation function introduced by migration 0034.

It:

- adds `sync_trading_workspace_access_code_status()` trigger behavior so revoking the currently referenced Trading access code disables that workspace's `trading_access_enabled` state;
- preserves membership enable/disable state;
- keeps all workspace configuration rows in place;
- rotates/reissues a replacement code on the SAME workspace;
- revokes previous active codes inside the same database transaction;
- restores the subscription-locked workspace on reissue;
- preserves/merges existing entitlements but forces `brokerModes=["demo"]` and `liveExecution=false`;
- uses `SECURITY DEFINER` with empty `search_path` and schema-qualified database objects;
- does not provide any path that enables LIVE execution.

Do not claim this migration is applied until a production migration query proves it.

### Fresh production safety audit before migration

On 2026-09-16 the live database was queried directly before any 0037 application.

Verified runtime controls:

- `trading_access_enabled = true`
- `broker_execution_enabled = true`
- `live_broker_execution_enabled = false`

Verified current workspaces:

- `Mkay` — `brokerModes=["demo"]`, `liveExecution=false`
- `Starpips Forex` — `brokerModes=["demo"]`, `liveExecution=false`

Verified LIVE guard account:

- cTrader LIVE account UUID `4dbe17df-40b0-412a-88de-9bbc562969c7`
- `environment=live`
- `execution_enabled=false`
- `live_execution_enabled=false`

Production already contains `public.rotate_trading_access_code(...)`. `public.sync_trading_workspace_access_code_status()` was not present before 0037, confirming the new migration has not yet been applied at this handoff point.

### Supabase compatibility review

Current Supabase guidance was checked during review. In particular, security-definer functions should use a pinned empty `search_path` with schema-qualified objects. Migration 0037 was hardened to follow that pattern before production application.

No service-role or other secret is exposed to the browser. Subscription status revalidation remains server-side and fail-closed for access-code-bound sessions.

### Documentation state

Current lifecycle/operator contract is documented in:

- `cloudflare-v2/docs/TRADING_ACCESS_CODE_ONBOARDING.md`
- root `AGENTS.md`
- this handoff

Exact previous root documents are preserved under `docs/archive/` so historical source-feed/multi-terminal and older production evidence remains available without masquerading as the active workstream.

## Earlier source-feed / Telegram endpoint / multi-MT5 stream

The preceding 2026-09-16 stream designed and implemented child Telegram `source_feeds`, feed-scoped routing, canonical-symbol route filters, reusable Telegram destination-bot credentials, normal Telegram Bot API source credential mapping, and deterministic multi-terminal MT5 connector flags (`--terminal`, `--config`, `--ledger`). Its exact prior handoff and AGENTS state are preserved in the archive files above.

Those features remain non-regression requirements. In particular:

- source connection is the transport/session boundary;
- allowed Telegram chats may become independently routable child feeds;
- feed-specific routes narrow that feed only, with legacy connection-route fallback where designed;
- one saved Telegram delivery bot may back many destination channel endpoints;
- simultaneous Octa/FBS/Deriv MT5 accounts on one Windows VPS require separate MT5 terminal processes and separate connector instance state;
- selective routing/filtering may only narrow execution and may never bypass broker symbol/risk/account authority.

## Immediate completion sequence

1. Require fresh green CI on the latest branch head after migration hardening/docs updates.
2. Review the final PR diff for unrelated feature removal or changed safety authority.
3. Apply migration 0037 through the normal Supabase migration path only after green review.
4. Re-query the trigger/function definition and LIVE safety rows immediately after migration.
5. Merge reviewed PR #96 to `main` and let the normal production deployment workflow deploy it.
6. Verify the production customer page, Telegram Bot source fields, returning-session restore, visible logout, revocation lock and same-workspace reissue against safe/non-LIVE test data.
7. Re-query final runtime/workspace/LIVE-account safety state. Passing these checks does not authorize LIVE.

## Completion definition

Do not call this stream complete merely because the branch unit tests pass. Completion requires:

- latest branch CI green;
- migration 0037 applied and verified;
- reviewed merge to `main`;
- production deployment green;
- production frontend/session lifecycle verification green;
- no configuration loss on the tested workspace lifecycle;
- no regression to source routing/destination/broker safety behavior;
- final proof that global LIVE is OFF, workspace `liveExecution=false`, and all LIVE account execution flags remain OFF.
