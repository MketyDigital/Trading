# Returning Auth + Admin Runtime Controls — Current Handoff

**Recorded:** 2026-09-08

**Repository:** `MketyDigital/Trading`

**Status:** Active development continuation. Do not treat this branch as production-ready until the required CI, migration, merge, deploy, and smoke checks below are complete.

## 1. Exact continuation point

- Active draft PR: **#13 — `fix: returning owner sessions and admin runtime controls`**
- Branch: `fix/returning-auth-admin-runtime-controls`
- Current recorded PR head before this handoff commit: `4ce897703e25f5a61cacf56b78d68c2f2013eb97`
- Base branch: `main`
- Base SHA observed from PR metadata: `fdb17e41226fe4b65b86e8b38b77d9a01c2072da`
- Implementation plan: `docs/superpowers/plans/2026-09-08-returning-auth-admin-runtime-controls.md`
- Existing production source-of-truth: root `AGENTS.md`
- Production manual acceptance guide: `docs/trading-launch-console-manual-e2e.md`

The production baseline in `AGENTS.md` is the already-deployed PR #12 release. PR #13 is the follow-up that changes returning-user authentication and broker runtime-control behavior. Do not confuse the PR #12 production state with the PR #13 development state.

## 2. Goal of PR #13

PR #13 has three connected goals:

1. **Returning enterprise owner sessions** — users who already completed access-code onboarding should be able to return without repeating one-time onboarding.
2. **Database-backed Mkety owner broker master switch** — broker execution must require both the deployment capability gate and a persisted Mkety-owner runtime switch.
3. **Production configuration alignment** — production should deploy the Mkety admin secret and may enable the outer broker capability only after the persisted switch exists and defaults OFF.

The intended security model is:

`effective broker execution = BROKER_EXECUTION_ENABLED && persisted broker_execution_enabled`

The persisted owner switch defaults OFF and must fail closed. Enterprise customers must never control the global owner switch.

## 3. Implemented work visible in PR #13

### Returning owner authentication

The branch implements/refactors support for:

- signed short-lived local Trading bearer sessions;
- signed refresh-token support;
- HttpOnly refresh cookie named `mkety_trading_refresh`;
- returning-session endpoint `POST /api/v1/access/session`;
- logout endpoint `POST /api/v1/access/logout`;
- access-code classification that distinguishes first onboarding from returning access;
- owner-email binding/validation;
- portal/session restoration work;
- membership/workspace revalidation before renewed access.

Access codes remain bounded onboarding credentials. The refresh credential is not intended to be exposed to browser JavaScript.

### Persisted broker runtime control

The branch adds migration:

- `cloudflare-v2/db/migrations/0017_trading_runtime_controls.sql`

The migration creates `public.trading_runtime_controls`, restricts it to known Trading control keys, enables RLS, removes public/anon/authenticated privileges, grants service-role access, and seeds:

- `broker_execution_enabled = false`

The branch also adds/changes the runtime-control persistence, execution gate, Mkety admin API/UI, and related tests so broker dispatch is only possible when both gates are enabled.

### Production deployment alignment

The production workflow changes include:

- require GitHub secret `MKETY_TRADING_ADMIN_SECRET`;
- pass it to Wrangler as `MKETY_TRADING_ADMIN_SECRET`;
- change the production outer capability `BROKER_EXECUTION_ENABLED` to `true` only in conjunction with the persisted owner switch;
- after deployment, call the Mkety admin runtime-controls endpoint and verify:
  - deployment broker capability is ON;
  - persisted owner broker switch is OFF;
  - effective broker execution is OFF;
- keep effective live broker execution blocked during acceptance.

This production workflow change must **not** be deployed before migration `0017_trading_runtime_controls.sql` is applied successfully and current CI is green.

## 4. Current verification evidence

### CodeQL

For PR head `4ce897703e25f5a61cacf56b78d68c2f2013eb97`:

- CodeQL run: `34266866611`
- Conclusion: **success**

### Trading V1 CI

For the same recorded PR head:

- Trading V1 CI run: `34266870914`
- Conclusion: **failure**
- Failing job: `102198314457` (`test`)
- Failing step: **Run Worker and trading-core tests**
- Dependency installation: passed
- Pure MT5 bridge tests: skipped because the Node stage failed first
- Pure MTProto Python tests: skipped because the Node stage failed first
- Cloudflare inspect/deploy gates: skipped downstream, as intended

Therefore **PR #13 is not yet verified and must not be merged/deployed in its current state**.

The most recent code commit before this handoff was:

- `4ce897703e25f5a61cacf56b78d68c2f2013eb97` — `test: satisfy owner runtime gate in idempotency simulation`

The next development action is to isolate the exact current failing Node assertion/test from job `102198314457`, reproduce/inspect the affected test and implementation, and make the smallest correct fix without weakening the new dual-gate safety model.

## 5. Task status matrix

### Task 1 — Returning owner session

Implementation is materially present on the branch. Before marking complete, verify all of the following on the final head:

- refresh cookie issued on successful onboarding/login path;
- cookie is `HttpOnly`, `Secure`, `SameSite=Lax`;
- `POST /api/v1/access/session` renews a short bearer;
- renewal revalidates persisted membership/workspace/entitlements;
- invalid/expired/tampered refresh token fails closed;
- `POST /api/v1/access/logout` clears the refresh cookie;
- portal automatically restores a valid returning session;
- one-time access-code onboarding semantics are preserved;
- another user/email cannot reuse an owner-bound code/session.

**Status:** implemented, final full-suite verification pending because current Node CI is red.

### Task 2 — Database-backed owner broker switch

Implementation is materially present on the branch. Before marking complete, verify:

- migration creates/seeds the singleton control safely;
- default persisted value is OFF;
- missing/failed DB lookup blocks execution;
- deployment gate OFF always blocks execution;
- deployment gate ON + persisted switch OFF blocks execution;
- both gates ON is the only state that can reach broker dispatch;
- customer/tenant APIs cannot mutate the owner-global switch;
- Mkety admin endpoint fails closed when admin secret is absent/invalid;
- Mkety admin UI/API can read/write only the intended control;
- operations/audit records remain correct.

**Status:** implemented, final full-suite verification pending; production migration not yet authorized as complete until applied and checked.

### Task 3 — Production secret/runtime alignment

Workflow implementation is present. Remaining execution work:

- current CI must return green first;
- confirm `MKETY_TRADING_ADMIN_SECRET` exists in the production GitHub environment without exposing its value;
- apply migration `0017_trading_runtime_controls.sql` to production;
- verify seeded owner switch is OFF;
- merge PR #13 only after required review/verification;
- deploy from the correct `main` commit;
- verify workflow checks the persisted switch remains OFF after deployment;
- verify production health;
- run owner/frontend acceptance with effective broker execution still OFF.

**Status:** code/workflow prepared; rollout not complete.

## 6. Required next steps — execute in this order

1. **Inspect the failed Node CI output** for run `34266870914`, job `102198314457`, and identify the exact failing test/assertion.
2. **Use systematic debugging/TDD**: determine whether the regression is a stale test fixture or an actual implementation bug. Do not change expected safety behavior merely to make CI green.
3. **Apply the smallest fix** on `fix/returning-auth-admin-runtime-controls`.
4. **Run/observe fresh Trading V1 CI** on the new head.
5. Require the complete CI test job to pass, including:
   - Worker/trading-core Node suite;
   - pure MT5 bridge tests;
   - pure MTProto Python tests.
6. Confirm **CodeQL is green on the final head**.
7. Review the final PR diff for accidental secret exposure, auth bypass, tenant control of the owner switch, or weakened broker safety.
8. **Apply production migration `0017_trading_runtime_controls.sql`** before deploying workflow behavior that expects the control.
9. Verify database row `broker_execution_enabled` exists and is **false**.
10. Confirm production `MKETY_TRADING_ADMIN_SECRET` is configured by name only; never print its value.
11. Merge PR #13 to `main` only after all required checks are green.
12. Trigger/perform the production Cloudflare deployment from the merged `main` commit.
13. Verify deploy workflow confirms:
    - outer broker capability ON;
    - owner switch OFF;
    - effective broker execution OFF.
14. Verify `https://trade.mkety.com/` health/availability and returning-session behavior.
15. Run frontend/manual E2E acceptance using `docs/trading-launch-console-manual-e2e.md`, adding the returning-session and Mkety-owner runtime-control checks below.
16. Only after a separate explicit owner-approved broker acceptance phase may the persisted broker switch be turned ON. Do not enable real-money execution as part of ordinary frontend acceptance.

## 7. Frontend acceptance additions for PR #13

In addition to the existing Trading Launch Console manual E2E:

### Returning session

1. Create/redeem an access code for an owner and enter the workspace normally.
2. Confirm the browser receives the session without exposing the refresh credential to JavaScript.
3. Reload/reopen the portal after the short bearer needs restoration.
4. Confirm the portal restores the owner session through `/api/v1/access/session` without asking the owner to perform one-time onboarding again.
5. Sign out.
6. Confirm `/api/v1/access/logout` clears the returning credential and the portal no longer restores the session.
7. Confirm another owner/email cannot use the original owner's bound credentials.

### Mkety owner broker switch

1. Open the Mkety staff/admin surface with authorized admin access.
2. Confirm the runtime-control UI reports the deployment capability separately from the persisted owner switch.
3. During general frontend acceptance, confirm owner switch is OFF and effective execution is OFF.
4. Confirm an enterprise tenant cannot see or change this global switch.
5. Do not enable the owner switch merely to test the ordinary frontend.

## 8. Non-negotiable safety boundaries

- Do not touch `MketyDigital/mksaas` or other repositories.
- Never commit/log production secrets, session tokens, broker credentials, Telegram sessions, service-role keys, or admin secret values.
- Do not expose refresh credentials to JavaScript.
- Do not allow callers to choose workspace/account/destination authority through untrusted payload fields.
- Do not weaken persisted route/account/workspace checks.
- Do not change the seeded broker owner switch from OFF in the migration.
- Do not deploy the two-gate production workflow before the runtime-control migration exists in production.
- Do not claim broker execution is safe because only one of the two gates is OFF; both gates are required and the persisted lookup must fail closed.
- Do not enable real-money broker execution during normal frontend acceptance.

## 9. Expected product behavior after successful completion

Once PR #13 is fixed, fully verified, migrated, merged, and deployed:

- first-time enterprise users can onboard using access codes;
- returning enterprise owners can regain their session without repeating one-time onboarding;
- logout reliably ends the returning browser session;
- workspace membership and entitlements remain authoritative on renewal;
- Mkety staff retain a private, database-backed global broker master switch;
- broker execution requires two independent gates;
- the production deployment may have broker capability available while the owner switch safely remains OFF;
- ordinary Trading Launch Console/frontend acceptance can be performed without live-money execution;
- all PR #12 launch features remain available: sources/connections, destinations, persisted routes, Telegram formatting/delivery, MTProto options, access-code entitlements, broker-account configuration, operations/audit, and custom-hostname controls where entitled.

## 10. Completion definition

Do not mark this handoff complete until there is fresh evidence for all of the following:

- final PR head identified;
- full Trading V1 CI green;
- final-head CodeQL green;
- migration `0017_trading_runtime_controls.sql` applied successfully;
- persisted owner switch verified OFF after migration;
- PR #13 merged to `main`;
- production deployment succeeds from the merged `main` commit;
- post-deploy runtime-control verification shows capability ON, owner switch OFF, effective execution OFF;
- production health check succeeds;
- returning-session smoke test succeeds;
- frontend E2E acceptance is ready for/has been performed by owner with live broker execution still disabled.

When any of those facts change, update this handoff with the exact commit SHA, workflow/run IDs, deployment ID/version, migration evidence, and remaining blocker rather than relying on chat history.