# Mkety Trading — final DEMO release handoff — 2026-09-16

This addendum records the final stabilization work immediately before the next customer-side DEMO acceptance run. `AGENTS.md` remains the primary operational authority; no safety invariant in it is relaxed by this document.

## Safety posture

- LIVE remains prohibited during this release/acceptance stream.
- Production `live_broker_execution_enabled` was re-queried after the database migrations and is `false`.
- Mkay and Starpips Forex remain DEMO-only (`brokerModes=["demo"]`, `liveExecution=false`).
- The cTrader LIVE account remains `execution_enabled=false` and `live_execution_enabled=false`.
- DEMO cTrader and MT5 accounts remain `live_execution_enabled=false`.
- Passing DEMO acceptance does not authorize LIVE. LIVE requires a separate explicit production decision after evidence review.

## Fixed release blockers

1. **Broker execution now honors logical Telegram feed authority.** `v1_simulation_deps.js` resolves the incoming native Telegram chat to an active `source_feed`, gives active feed-specific routes precedence over connection/default routes, and only falls back to legacy connection routes when there are no active feed-specific routes for that feed.
2. **Broker route symbol filters now apply before accounts enter planning.** The same fail-closed canonical-symbol route evaluator used by destination routing is applied to broker account selection.
3. **Canonical symbol extraction matches the real parser shape.** Route filters read `interpretation.intent.symbol.canonical` while retaining compatibility aliases.
4. **Existing Telegram allowlists are materialized as child feeds.** Migration `0038_backfill_telegram_source_feeds.sql` was applied idempotently. The Starpips external MTProto source now has three active child feeds matching its three persisted allowed chat IDs.
5. **Normal Telegram Bot source UI is present in the actual composed Connections page.** The BotFather token and allowed chat/channel controls are covered by composed-portal regression tests, including refresh behavior after creation.
6. **Dedicated Telegram Bot source creation persists child feeds.** If child-feed persistence fails after source insertion, the disabled partial source is compensating-deleted before the API reports failure, preventing half-created retry state.
7. **Reusable Telegram destination credentials survive ordinary endpoint edits.** Omitting `credentialConnectionId` now means preserve; explicit `null` remains the intentional clear action. Replacing local credentials still intentionally clears the shared connection.
8. **Staff workspace/access UI selects the current workspace record deterministically.** Active current access wins over stale revoked history; if no active row remains, the newest historical row is displayed.
9. **Subscription lifecycle is workspace-preserving and DEMO-safe.** Migration `0037_subscription_access_lifecycle.sql` was applied. Reissue/renewal rotates the access credential on the same workspace, preserves workspace configuration, revokes prior active codes, restores subscription access, forces DEMO broker modes and `liveExecution=false`, and locks workspace trading access when the current code is revoked.
10. **Returning-session/logout behavior is server-authoritative.** Revoked/expired/superseded subscription state is revalidated server-side and the frontend clears stale local session state on authoritative denial.

## Regression evidence

The following defects were first reproduced RED and then fixed:

- feed-specific broker routing still selected the parent/default account;
- symbol-filtered broker routing still selected an incompatible sibling account;
- normal Telegram Bot source creation did not materialize child feeds in its dedicated handler;
- failed child-feed persistence left a partial Telegram Bot source row;
- staff workspace list could select stale historical access rows;
- normal Bot source creation did not guarantee visible Connections refresh;
- generic destination updates could implicitly clear a reusable Telegram bot credential;
- existing Telegram source allowlists had no child-feed rows.

Trading V1 CI was green after the broker/feed fixes and again after the Telegram source rollback fix. A fresh full CI run is required on the final branch head after this documentation commit before merge.

## Database changes applied

### `0037_subscription_access_lifecycle`

Applied to Supabase project `vdblajgxrfndjesoyayy`.

Verification:

- `public.sync_trading_workspace_access_code_status()` exists, SECURITY DEFINER, empty search path.
- `public.rotate_trading_access_code(...)` exists, SECURITY DEFINER, empty search path.
- only `postgres` and `service_role` retain execute privileges for these functions.
- `trading_access_code_workspace_lock` AFTER UPDATE trigger exists.
- LIVE controls/accounts remained unchanged after migration.

### `0038_backfill_telegram_source_feeds`

Applied to the same project.

Verification:

- Starpips source `48860770-4b2c-4b13-b49f-7d998f9d7ed5` now has three active child feeds matching persisted allowed chat IDs.
- the migration creates no routes and broadens no allowlist; it only materializes persisted authorization.

## Next acceptance run

After the final branch is merged and production deployment/E2E/readiness checks are green, run the customer-side DEMO acceptance again while observing server-side evidence.

Required acceptance cases:

1. Connections UI visibly exposes normal Telegram Bot source token + allowed chats and granular source-feed routing.
2. A source feed routed only to Telegram does not reach broker accounts.
3. A feed with a broker-specific route reaches only that destination.
4. A Deriv volatility signal reaches the compatible Deriv cTrader DEMO route and does not reach Octa MT5.
5. XAUUSD can be used for cross-broker cTrader/MT5 DEMO validation when the MT5 terminal/connector is online.
6. Telegram destination bot reuse works across separate chat/channel endpoints without duplicating credentials.
7. Replay of the same source event does not duplicate broker execution.
8. Follow-up/management messages correlate to the original durable position group as designed.
9. One failing destination does not cancel successful siblings.
10. Final audit shows zero LIVE broker actions and all LIVE gates still disabled.

Do not enable LIVE as part of this checklist.