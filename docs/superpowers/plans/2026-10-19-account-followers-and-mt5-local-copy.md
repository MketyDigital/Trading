# Account followers and isolated MT5 local copy implementation plan

## 1. Baseline and audit

- Run the existing Cloudflare and MT5 connector suites with local dependencies.
- Trace route resolution, state correlation, production execution, TP observation, and connector profile/worker boundaries.
- Add regression tests before changing behavior.

## 2. Additive schema and repositories

- Add Postgres and D1 migrations for `trading_account_followers` plus due/fanout indexes.
- Add a fenced, replication-aware follower-link repository with one-parent-per-follower validation and unchanged-write suppression.
- Expose the repository from `createTradingPersistenceRuntime`.
- Add migration/constraint tests for both SQL dialects.

## 3. Portal follower fanout

- Add a pure parent-link expansion helper and tests proving one batched lookup, stable ordering, no duplicate parents, and no route-row mutation.
- Integrate expansion at the event planning boundary so explicit parent routes remain unchanged and follower plans use their own account catalogs/policies.
- Derive follower group/idempotency keys and lot policy without changing parent plans.
- Ensure management, edit, fast completion, target progression, and partial/full close actions reach the follower group independently.
- Add opt-in admin account controls and workspace scoping tests; keep UI additive.

## 4. Broker-originated observation audit/fix

- Extend read-only broker close observation classification for MT5 and cTrader to distinguish TP, SL, manual close, partial close, and unresolved evidence.
- Persist an observation fingerprint/version and skip unchanged writes.
- Add due-only/keyset scan and bounded recovery behavior for unresolved/non-critical observations.
- Trigger canonical parent lifecycle fanout only after exact account/position/deal confirmation; do not infer open-position SL/TP edits until a current-position snapshot feed is available.
- Add tests ensuring failed or unavailable first-leg context never blocks a complete signal and that sibling followers remain independent.

## 5. Isolated MT5 local copier

- Extend profile manifest parsing/saving with backward-compatible copy metadata and validation.
- Add pure snapshot diff/copy planning and local replay journal modules.
- Add an optional copier supervisor process with one parent and one follower profile, exact terminal identity checks, and demo-first safety gates.
- Add manager view-model methods/UI controls for mark parent/follower, map parent, set lot policy, enable/disable, and status.
- Keep copier process separate from gateway workers and verify existing supervisor tests remain green.

## 6. Verification and handoff

- Run focused repository/orchestrator/observation tests, all JavaScript tests, and all Python connector tests.
- Run static checks for migration ordering and credential leakage.
- Verify no live account or production endpoint is touched; report branch/commit and deployment status.


## 7. Risk-policy extension status — 2026-11-06

This section records the risk-policy extension to the follower work above. “Implemented” means code and regression coverage are present on the feature branch; it does not mean the release gate has passed.

| Work item | Branch status | Release evidence still required |
|---|---|---|
| Owner-only per-account risk mutation | Implemented in account route; exact owner role required | Latest full CI and cross-workspace authorization suite |
| Owner-only portal follower risk mutation | Implemented in account-controls route | Latest full CI and route-level cross-workspace suite |
| Owner dashboard risk editor | Implemented in unified account dashboard; capability comes from active D1 account-list response | Browser/UI acceptance in a deployed non-production environment |
| Percentage risk with explicit equity/balance basis | Implemented | Full risk-engine and production execution CI |
| Fixed cash risk per TP leg | Implemented using canonical persisted risk mode | Full fixed-cash planning and revalidation CI |
| Per-leg, aggregate-open, daily-loss caps | Persisted and validated | Acceptance against realistic broker snapshots and concurrent OPENs |
| Broker minimum-volume tolerance and FLOOR/REJECT | Persisted and validated | Broker contract/minimum edge-case acceptance |
| Fresh independent follower risk sizing | Implemented and covered by broker-snapshot regression | Latest CI plus broker-dispatch integration acceptance |
| Parent/sibling failure isolation | Coordinator regression added | Latest CI plus dispatch idempotency/replay acceptance |
| cTrader monetary SL economics | Fail-closed for risk-sized OPEN without reliable conversion | Keep blocked until reliable broker economics are independently verified |
| Local MT5 copier risk settings | Implemented as opt-in local profile policy; separate Start local copy action | Latest packaged connector build and local demo-terminal acceptance |
| Existing-account non-activation | Read-only loader regression and additive migration snapshot test added | Deploy/restart acceptance in isolated staging with before/after account snapshots |
| Migration compatibility | Active D1 and namespaced PostgreSQL additive follower-risk migrations use new versions; historical migration files are untouched | Apply both migration tracks to clean and representative upgrade fixtures, with rollback rehearsal |

### Explicit release gates

- [ ] Trading V1 CI on the latest code head passes.
- [ ] cTrader cBot CI passes.
- [ ] MT5 Compatibility CI passes on the latest relevant code head.
- [ ] MT5 Connector Release workflow builds, runs connector tests, smoke-tests packaged entrypoints and uploads the artifact; no versioned release is published from this pull request.
- [ ] Account/follower authorization tests prove owner-only mutation and workspace isolation.
- [ ] Existing fixed-lot account state and execution behavior are unchanged by code rollout, worker restart and schema rollout.
- [ ] Follower independent sizing, fresh revalidation, idempotency and sibling failure isolation pass integration acceptance.
- [ ] cTrader remains blocked for risk-sized OPEN until its monetary SL model is reliable.
- [ ] Production rollout and rollback plan are approved separately by the owner.

No production migration, account-policy write, connector release publication or deployment is authorized by this plan.
