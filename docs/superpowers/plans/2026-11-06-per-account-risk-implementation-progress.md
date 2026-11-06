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
