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
