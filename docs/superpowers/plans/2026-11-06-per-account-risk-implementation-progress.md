# Per-account risk sizing implementation progress

**Updated:** 2026-11-06  
**Working branch:** `feature/per-account-risk-sizing`  
**Pull request:** #253 — draft, targeting `main`  
**Production status:** unchanged. No production deployment, account-policy update, migration application, or broker action was performed.

## Non-negotiable release constraints

- New risk functionality is opt-in and dormant by default.
- Deploying code, restarting a Worker/connector, or applying an additive schema change must not alter any existing account's sizing mode, risk settings, execution state, LIVE state, routes, or other preferences.
- Only a workspace owner may change risk settings.
- An owner may change only the explicitly selected account(s); no bulk/default activation.
- Existing fixed-lot and other currently configured account behaviour remains unchanged unless an owner explicitly edits that account.
- Follower risk policy is independent from the parent account and from every other follower.
- Risk-sized execution fails closed when stop-loss economics, account basis, or fresh broker constraints cannot be established.
- cTrader risk-sized OPEN remains blocked until reliable monetary stop-loss conversion is available.
- Changes stay on the feature branch until all tests and acceptance checks pass. Production deployment requires a separate, explicit release decision.

## Audit findings

### Implemented code present on the feature branch (not yet release-verified)

- Risk sizing engine and execution-plan integration.
- Equity-percent, balance-percent, and fixed-cash stop-loss risk modes.
- Per-TP-leg risk allocation and aggregate group exposure calculation.
- Per-leg and aggregate open-risk policy checks.
- Broker minimum/maximum/step volume handling and explicit minimum-volume policy.
- Portal follower risk persistence and local MT5 copier risk configuration.
- MT5 connector risk context and cTrader safeguards.
- Risk, execution-plan, follower, adapter, and connector tests.

Presence of these files is not proof of release readiness. The branch's CI currently reports failures in the risk-engine and execution-plan test suites.

### Release blockers

1. **Owner-only authorization:** the current account-control path uses the broad `accounts.write` permission, which is also granted to admins. A dedicated owner-role guard is required for every risk-policy mutation. Existing admin permissions for unrelated account controls must not be broaden or narrowed as a side effect.
2. **Complete account configuration path:** the account creation API still validates only the older sizing-mode set. The new risk modes need a complete, explicitly owner-authorized, per-account read/write path with strict field allowlists and validation.
3. **Migration history:** the feature branch edits an existing migration and introduces migration numbers already occupied in the applicable migration tracks. Applied migration files must remain immutable. New schema work must use unique, additive versions in each supported track.
4. **Risk-engine tests:** current CI failures include balance-only account basis handling and BUY/SELL range-entry sizing. Fix the underlying selection/entry logic without weakening fail-closed validation.
5. **Follower execution:** prove that every follower OPEN is sized from that follower's own account metrics and policy, then freshly revalidated immediately before dispatch. A follower failure must not suppress the parent or other followers.
6. **Production isolation:** add regression checks proving that deploy/restart/schema rollout leaves every existing account's settings and execution behaviour unchanged.
7. **Documentation:** reconcile the lot-sizing reference, architecture notes, implementation plan, and roadmap only after behaviour and tests are verified.

## Required acceptance matrix

| Scenario | Required result |
|---|---|
| Deploy new code with no owner edits | Every existing account retains its exact current configuration and behaviour |
| Worker or connector restart | No risk policy is activated or rewritten |
| Owner changes one account | Only that selected account changes |
| Admin attempts risk mutation | Rejected; no persistence write |
| Invalid/incomplete risk configuration | Rejected without partial update |
| Missing/stale broker data or monetary SL model | Risk-sized OPEN blocked |
| Broker minimum exceeds permitted risk tolerance | OPEN blocked |
| cTrader risk-sized OPEN without reliable monetary SL conversion | OPEN blocked |
| Follower has its own risk policy | Follower is sized from its own account context |
| One follower fails | Parent and other followers continue independently |
| Existing fixed-lot account | Exact pre-release behaviour retained |
| Rollback | Existing account configuration and behaviour remain intact |

## Progress log

### 2026-11-06 — implementation resumed

- Re-inspected PR #253 and its complete changed-file inventory.
- Confirmed PR remains draft and targets `main`; implementation work is to remain isolated on `feature/per-account-risk-sizing`.
- Reconfirmed the risk engine and execution-plan source paths and reviewed their current implementation and tests.
- Reconfirmed that account-control authorization currently relies on `accounts.write`, which is not owner-exclusive.
- Reconfirmed the account-creation validator does not yet accept the new risk-sizing modes.
- Reconfirmed migration version collisions and modification of a historical migration.
- Reconfirmed risk-engine and execution-plan CI failures remain unresolved.
- No code, schema, production account, or deployment state was changed during this audit pass.
- No tests were run from this session: the available GitHub integration can inspect and commit repository files but does not provide a repository shell or local test runner. A pushed feature-branch commit can trigger the repository's CI for authoritative test execution; changes must not be described as passing until that CI result is inspected.

## Next implementation sequence

1. Fix the existing risk-engine and execution-plan failures; add regression coverage for both balance-only accounts and both BUY/SELL range sides.
2. Add a dedicated owner-only risk-policy mutation path and tests for owner allow / admin deny / cross-workspace deny.
3. Complete the per-account risk configuration contract, including explicit account selection, supported modes, validated limits, safe defaults, and no implicit activation.
4. Replace conflicting migration additions with unique additive migrations; leave every existing migration byte-for-byte unchanged.
5. Finish independent follower sizing, freshness checks, idempotency, and failure isolation tests.
6. Add deploy/restart non-mutation and existing fixed-lot compatibility acceptance tests.
7. Update the canonical docs and roadmap with verified behaviour and CI evidence.
8. Run full required CI, review the final diff, and keep the PR draft until every acceptance item is green.
9. Only after a separate owner release decision: plan a controlled production rollout with before/after account-state snapshots and a rollback path. No deployment is authorized by this progress log.


### 2026-11-06 — first risk-engine correction

- Inspected the failing CI job logs from Trading V1 CI run #3460. The failures shared one root cause: the risk engine defaulted `riskBasis` to `EQUITY`, even when the caller supplied only a valid broker balance. This caused balance-only risk sizing to fail before the monetary stop-loss model could be evaluated.
- Updated `cloudflare-v2/src/risk/risk_engine.js` to infer EQUITY only when equity is present and otherwise infer BALANCE, while preserving an explicitly selected basis.
- Updated `cloudflare-v2/src/execution/execution_plan.js` to pass the same safe basis inference into risk planning instead of forcing EQUITY when the account's equity field is absent.
- Strengthened `cloudflare-v2/tests/risk_engine.test.mjs` to assert the inferred BALANCE basis.
- Commits: `0fcbab0c`, `e781112a`, `fab01437`.
- The previous CI run #3461 was created before these code corrections and therefore cannot verify them. A new exact-head CI result is still required before this fix is marked verified.


### 2026-11-06 — owner-only configuration and schema compatibility

- Added `cloudflare-v2/src/security/risk_policy_authorization.js`. Only the exact workspace role `owner` passes the risk mutation guard; `admin`, `operator`, and `viewer` are denied even though admins retain ordinary `accounts.write`.
- Enforced owner-only changes to follower links/risk settings in the account-controls route.
- Added owner-only checks to the account-connection update path whenever the selected account is in risk mode, a risk mode is selected, or risk-policy fields are submitted.
- Added account risk configuration validation and persistence for:
  - percentage risk with explicit equity/balance basis;
  - fixed-cash risk using the same existing persisted `risk_percent` sizing type plus `lot_sizing_config.riskMode=fixed_cash`;
  - per-leg, aggregate-open, daily-loss and broker-minimum tolerance controls in the account safety policy;
  - explicit selected-account and workspace scoping.
- Kept the persisted sizing type compatible with the existing D1 schema CHECK constraint. Explicit UI/API aliases are canonicalized to `risk_percent`; no account table rebuild or new sizing enum is required.
- Updated execution planning, production risk revalidation, and orchestration normalization to read the persisted risk basis and fixed-cash mode. Added regression tests for balance-only broker snapshots, persisted balance basis, fixed-cash planning/revalidation, owner-only authorization, and the account configuration API.
- Account onboarding now accepts owner-selected risk modes but still forces new accounts inactive, execution-disabled, and kill-switched. Admins cannot submit risk modes or risk-limit fields during onboarding.
- Restored `0046_broker_aware_lot_sizing_modes.sql` byte-for-byte to the version on `main`.
- Removed the colliding follower-risk migration files and reintroduced the additive schema changes only in the active D1 `0006` and namespaced PostgreSQL `0006` tracks. The legacy `db/migrations` public-schema track was deliberately excluded because it is not part of the current production storage path. Updated the follower repository test to load D1 migration `0006`.
- Updated `docs/LOT_SIZING_MODES.md` with the canonical storage contract, owner authorization, risk caps, per-leg semantics, follower independence, and fail-closed platform rules.
- Tests added/updated but not yet CI-verified. Trading V1 CI run #3496 was queued for an earlier commit in this implementation sequence; it does not include all later commits in this log. No local repository shell is available here to run Node tests directly.
- Production remains untouched: no migration applied, no account policy written to production, and no deployment triggered.

## Current remaining work

1. Confirm full Trading V1 CI against the latest feature-branch head; resolve every test failure.
2. Add/verify route-level tests for follower owner-only changes and verify per-follower policy does not inherit parent risk policy.
3. Complete follower dispatch acceptance: each follower must use its own broker account snapshot and fresh symbol economics immediately before OPEN; one follower failure must not suppress the parent or sibling followers.
4. Recheck cTrader risk-sized OPEN rejection and MT5 broker-minimum/exposure handling with integration tests.
5. Add deploy/restart/schema non-mutation tests and verify existing fixed-lot account behavior.
6. Review the full branch diff and update all related design/roadmap docs with only CI-verified outcomes.
7. Keep PR #253 draft and do not deploy until all checks pass and a separate explicit production release decision is made.


### 2026-11-06 — follower isolation and production safety regression coverage

- Added route-level tests proving only a workspace owner can configure portal follower risk; an admin with ordinary account-write permission is rejected before the follower repository is called.
- Added a production execution dependency test proving a balance-percent follower uses its own broker balance even when the link's supplied basis says equity and the broker equity differs.
- Added a production dependency test proving cTrader risk-sized OPEN remains blocked until a reliable monetary loss-at-stop model exists.
- Added account update regression coverage proving partial updates preserve a previously selected fixed-cash mode and balance basis.
- Added a D1 migration regression test that snapshots an existing fixed-lot account before applying the new follower-risk migration and asserts that its sizing, execution, and safety fields remain byte-for-byte equivalent afterward.
- Confirmed the PR changed-file inventory now contains only the new unique migration versions for follower risk; the historical 0046 migration and existing 0051/0005 migration files are no longer changed by this PR.
- Updated production account normalization to consume persisted risk basis and fixed-cash mode consistently in planning and final broker revalidation.
- Latest Trading V1 CI run #3504 was queued for the prior progress-log commit; subsequent code/test commits were added after it. The latest complete branch state still needs its own CI run and a full green result.

### Latest status

- Owner-only account risk update path: implemented with route tests; CI pending.
- Owner-only follower risk update path: implemented with route tests; CI pending.
- Percentage and fixed-cash account risk persistence: implemented using the existing schema-compatible `risk_percent` type and config fields; CI pending.
- Risk caps and broker-minimum policy persistence: implemented with validation; CI pending.
- Historical migration immutability and unique follower migration numbering: corrected; D1 non-mutation regression added; CI pending.
- Follower independent risk planning/revalidation: code path reviewed and balance-basis regression added; remaining end-to-end dispatch/failure-isolation acceptance still required.
- cTrader risk-sized OPEN: fail-closed code path retained and regression added; CI pending.
- Production deployment/restart acceptance: not yet fully proven; no deployment has been performed.


### 2026-11-06 — latest implementation additions

- Added an end-to-end coordinator regression where one follower's broker-risk context fails while the explicitly routed parent and a sibling follower still dispatch successfully. The test also verifies that each account plan receives its own follower risk mode/amount/percentage.
- Added production dependency coverage proving follower risk is recalculated from a fresh broker account snapshot on every OPEN dispatch; the test changes the follower's balance between reads and expects the monetary budget and lots to be recalculated downward.
- Added a cTrader regression for risk-sized OPEN rejection and a D1 migration non-mutation test for existing account sizing/execution state.
- Added owner onboarding coverage for fixed-cash risk stored using the canonical `risk_percent` type, with `riskMode=fixed_cash` and cash value above 100. This avoids misinterpreting a cash budget as a percentage.
- Corrected onboarding validation to determine percentage-vs-cash validation from the explicit persisted risk mode.
- Latest code/test commit: `ba263f87`. Trading V1 CI run #3514 was created for an earlier code commit and remains queued; it does not include these newest onboarding tests. A new latest-head CI result is required before any implementation can be called verified.


### 2026-11-06 — risk-basis precedence hardening

- Updated account normalization, execution planning, and final broker revalidation to prefer an explicitly persisted `lot_sizing_config.riskBasis` over a legacy fallback basis field. This prevents an old/default equity value from overriding an owner's explicit balance selection.
- Strengthened the production risk-authority regression to include a conflicting legacy `risk_basis: equity` field while asserting that persisted `riskBasis: balance` controls the calculation.
- Latest code/test commit: `62a4750e`. CI for this exact branch head is pending; prior queued CI runs do not verify these newest changes.


### 2026-11-06 — CI feedback and floating-point test correction

- Inspected Trading V1 CI run #3504 logs. The original balance-basis and BUY/SELL range-entry failures are now passing in that run.
- The remaining visible risk-engine failure was a strict floating-point equality assertion for seven 0.1-lot legs (`0.7` versus `0.7000000000000001`). The same exact-equality pattern existed in the execution-plan dynamic-TP test.
- Replaced both aggregate-lot assertions with a tight numeric tolerance (`1e-12`); production risk calculations and volume rounding were not weakened or changed.
- CI #3504 also marked `execution_plan.test.mjs` failed, but its diagnostic output was truncated to the first 6,000 characters, before the later test failure detail. The aggregate-lot assertion was the corresponding strict-float issue in that suite; the next CI run must confirm both files green.
- Follow-up commits: `21dee683` and `2dfc2490`. Latest-head CI remains required; prior run #3514 was created before these test corrections.


### 2026-11-06 — production non-activation check and CI diagnostics

- Added a production account-loader regression proving that reading an existing fixed-lot account leaves its lot size, active flag, execution flag and kill switch unchanged; the test also asserts the loader performs only reads.
- Increased the CI diagnostic capture limit from 6,000 to 20,000 characters so future failing test files include the full TAP failure context in the workflow logs and step summary.
- Corrected the strict floating-point aggregate-lot assertions in both risk-engine and execution-plan dynamic-TP tests using a (1e-12) tolerance. No runtime sizing or risk limits were relaxed.
- Latest code commits: `2dfc2490`, `5b1624ea`. The latest complete branch head still requires its own CI result; #3504 is a pre-fix failing run and #3514 predates the latest tests.


### 2026-11-06 — migration-track scope correction

- Rechecked the migration inventory and found that `cloudflare-v2/db/migrations` is the retired public-schema/RLS migration track. Removed the previously created `0052_account_follower_risk_sizing.sql` from the feature branch.
- Follower-risk schema changes now exist only in the current D1 migration track (`0006`) and the namespaced PostgreSQL track (`0006`) used by the current storage architecture. No new migration was added to the retired public-schema track.
- The original historical `0046` file remains restored to `main`; existing `0051` and `0005` files remain untouched.


### 2026-11-06 — local MT5 copier ownership and opt-in review

- Reviewed the local MT5 copier profile manager, persisted profile metadata, supervisor, worker and risk-sizing engine.
- New local profiles default to no copy role, `copy_enabled=false`, and fixed-lot mode; saving a profile does not start a copier worker.
- Local risk changes are made through the locally controlled profile manager, which is the ownership boundary for this desktop-only feature. The user must explicitly configure the follower and confirm the separate `Start local copy` action; the UI warns that broker orders may be opened immediately.
- Changing an active local pair stops its worker before writing the new startup risk policy. Each risk-sized copy uses the follower terminal's own account funds and mapped symbol's contract/SL economics; missing risk data or a below-minimum volume fails closed.
- Added the local copier opt-in and profile-ownership boundary to `docs/LOT_SIZING_MODES.md`.


### 2026-11-06 — owner-only dashboard controls

- Extended the unified trading-account dashboard to display the account's risk mode, risk basis, and configured risk limits.
- The account-list API now returns an owner capability flag for the active D1 path. The dashboard only presents the risk configuration workflow when that flag confirms the current workspace membership is `owner`.
- Owners can configure percentage or fixed-cash risk, equity/balance basis, per-leg/open/daily caps, broker-minimum tolerance and FLOOR/REJECT behaviour from the selected account's Edit flow.
- Admins do not see risk-mode controls. They can still edit non-risk account details (label/roles) without touching existing owner-managed risk settings; backend checks remain authoritative.
- Added API tests for owner capability metadata, admin non-risk edits on risk-configured accounts, and preservation of an already-active/live-enabled account's execution flags when its owner edits risk settings.
- The legacy public-schema account-list response was intentionally left unchanged; the active D1 path carries the owner capability metadata.


### 2026-11-06 — dashboard script validation and owner editor refinements

- Added a Node test that extracts and parses the embedded dashboard script, then asserts owner capability gating and the risk controls are present.
- The account dashboard now displays the configured broker-minimum tolerance and labels risk policy as owner-managed for non-owners.
- Refined the backend authorization condition so an admin may still edit non-risk metadata (such as account label and source/execution roles) on a risk-configured account, while any sizing/risk-policy field mutation remains owner-only.
- Added regression coverage for that admin metadata-only case and for the active/live account state remaining unchanged during owner risk edits.
- Current branch head has not yet received a fresh Trading V1 CI run. CI #3514 is an earlier run that fails the pre-fix strict floating-point assertions; the fixes and new dashboard tests are later commits and remain unverified until CI runs on the current head.


### 2026-11-06 — owner-only dashboard completion and latest CI

- Added the owner-only risk editor to the unified trading-account dashboard. It operates on the explicitly selected account and supports percentage or fixed-cash risk, explicit equity/balance basis, per-leg/open/daily caps, minimum-volume tolerance, and FLOOR/REJECT minimum-lot handling.
- The active D1-backed account-list response supplies `riskPolicyEditable` from the authenticated workspace membership. Non-owners do not receive the risk editor; backend owner authorization remains the security boundary.
- Non-owners may still edit safe account metadata on an account that already has risk sizing, but the UI and API preserve the existing risk policy and sizing fields. Added route tests for the owner capability flag and admin metadata-only updates.
- Added an embedded dashboard script parse test to catch syntax regressions in the dynamically injected UI.
- Reviewed the MT5 connector release workflow: on a pull request it only builds, tests, smoke-tests and uploads a Windows artifact. Publishing a versioned connector release is gated to a tag or an explicit dispatch from `main`; this PR run is not publishing a release.
- Latest-head CI run #3543 is running on PR head `985d9c231dfb4544fcb2b78afc651e25517f5417`. MT5 Compatibility CI #131 has passed. cTrader cBot CI #532 is queued. MT5 Connector Release #292 is packaging/testing only and currently building the artifact.
- No production deployment, release publication, schema application, or account-policy write has occurred.


### 2026-11-06 — execution-plan CI diagnosis follow-up

- Trading V1 CI #3543 reached the test step and still failed in `execution_plan.test.mjs`; the captured log was cut off during TAP output before the failing assertion, so it did not provide enough evidence to make a safe runtime change.
- Updated `cloudflare-v2/scripts/test_ci_diagnostic.mjs` to use Node's concise `spec` test reporter per file. The next run should expose the actual failing assertion rather than truncating the useful detail behind successful TAP output.
- Latest diagnostic-script commit: `80f3c9be`. Trading V1 CI #3546 is running against that commit. MT5 Compatibility CI #134 is green; cTrader CI #535 and connector packaging run #295 are in progress/queued.
- No production state or deployment has been touched. The failing execution-plan suite remains a release blocker until its exact failure is diagnosed and corrected, then latest-head CI passes.


### 2026-11-06 — preserve existing minimum-volume behaviour

- Trading V1 CI #3546 produced the actionable failure: an existing adaptive-sizing regression expected the broker minimum floor, but the risk branch had changed the shared fixed-lot normalizer to reject below-minimum requests.
- Compared the implementation directly with `main`. Production's existing fixed/adaptive path floors to the broker minimum and caps at broker maximum. That behaviour must remain unchanged for accounts that have not opted into risk sizing.
- Restored that legacy fixed/adaptive minimum-floor contract while keeping the new risk-sizing path's separate monetary-risk tolerance and FLOOR/REJECT controls authoritative. This does not weaken the risk-sized OPEN checks.
- Replaced the contradictory fixed-lot rejection test with a regression proving an existing fixed-lot account still produces the same broker-minimum volume as `main`.
- Runtime fix commit: `3125afff`; regression commit: `332f8dab`. A fresh Trading V1 run is required to verify the fix.


### 2026-11-06 — first green full Trading V1 and MT5 compatibility run

- Trading V1 CI #3550 passed all Worker/trading-core tests, pure MT5 bridge tests, and pure MTProto Python tests on the feature code including the legacy minimum-volume compatibility correction.
- MT5 Compatibility CI #138 passed.
- cTrader cBot CI #539 is still queued; MT5 Connector Release #299 has passed connector unit tests and produced the Windows executable, with packaged entrypoint smoke tests still running.
- Trading V1's production deployment/acceptance/inventory jobs were skipped for this pull request. No production deployment or storage migration was run.
- The remaining release blockers are cTrader CI, connector packaged smoke/artifact completion, final diff review, migration upgrade/rollback acceptance, non-production UI/dispatch acceptance, and owner-approved release decision.


### 2026-11-06 — MT5 connector release workflow completed without publishing

- MT5 Connector Release #299 completed successfully: pure connector tests, Windows executable build, packaged manager/worker smoke tests, checksum generation and artifact upload all passed.
- Its `publish-release` job was skipped as expected for this pull request; no versioned connector release was published.
- cTrader cBot CI #539 has progressed: gateway tests passed; deployment-stack container/compose validation, cBot build and Worker/dashboard tests are still running. These are build/test jobs, not production deployment jobs.
