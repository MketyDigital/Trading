# Production Stabilization and DEMO Readiness Spec

## Status

Approved for implementation on 2026-09-15. This specification consolidates the outstanding production-access, execution, Telegram, management, persistence, CI, and acceptance requirements into PR #89.

## Goal

Make PR #89 the verified superset of the active stabilization work so the system can begin a fresh real DEMO acceptance run without enabling LIVE execution.

## Absolute safety constraints

- LIVE execution must remain disabled throughout implementation, cleanup, verification, and DEMO acceptance.
- Persisted workspace, source, route, destination, account, and runtime authority override caller hints.
- Fresh broker risk/position context remains mandatory for broker management actions such as `MOVE_SL_TO_BE`; no fix may weaken that fail-closed requirement.
- If broker success already occurred and only state binding/persistence failed, repair state only; do not resend the broker action without reconciliation proving it did not occur.
- One destination failure must not cancel independent sibling destinations.
- No test may create fake/test access users or workspaces in production after this stabilization.

## Scope A — Access-code reissue / rotation

### Current defect

Reissuing an access code currently creates another active code for the same workspace and can replace workspace metadata wholesale. For Starpips this left both an old and a new code active and risks erasing unrelated workspace configuration/branding metadata.

### Required behavior

1. Reissue must retain the existing workspace ID.
2. Reissue must preserve existing workspace configuration, branding, destinations, routes, and unrelated metadata.
3. Reissue permission semantics are additive by default: permissions newly selected are added; permissions not mentioned are preserved. Permission removal must be a separate explicit operation.
4. Reissue must rotate credentials: all prior active codes for the same workspace become unusable immediately when the new code is created.
5. Existing sessions/refresh credentials/bearers issued from an older access generation must fail authorization after rotation.
6. The newly issued code/session must authorize only the current workspace and current entitlements.
7. `brokerModes` remains DEMO-only and `liveExecution` remains false.
8. Admin UI must clearly distinguish first-time Create from Reissue/Rotate.
9. Redemption/login must merge metadata rather than replacing unrelated workspace or membership metadata.

## Scope B — Production access-data repair and cleanup

The production trading-access domain must contain only the legitimate customer workspaces after dependency-safe cleanup:

- Starpips Forex — `fxhighpriest01@gmail.com`
- Mkay — `mkpoikankes@gmail.com`

Requirements:

1. Preserve the canonical Starpips workspace and all legitimate attached production configuration.
2. Preserve the canonical Mkay workspace and migrate/preserve any legitimate configuration from obsolete duplicate Mkay workspaces before removal.
3. Revoke old Starpips access codes after the rotation fix is deployed/applied.
4. Remove fake/test/E2E/diagnostic/probe trading workspaces, memberships, codes, redemptions, routes, destinations, sources, accounts, and dependent state in foreign-key-safe order.
5. Do not delete unrelated Supabase Auth users merely because they are not one of the two trading-access customers.
6. Recover/retain branding only from evidence-backed existing production state or history; do not invent a brand value.
7. Verify cleanup with post-transaction counts and whitelist queries.

## Scope C — Execution / Telegram / management consolidation

PR #89 must be the effective superset of the relevant work in PRs #86 and #88 where those changes still apply to current code.

Required end-to-end behavior includes:

- source ingestion and authentication;
- Telegram Bot API and MTProto source handling;
- deterministic/AI interpretation and safe fallback;
- repeated/comma TP parsing;
- fast/incomplete signal -> later full-signal promotion without duplicate broker opens;
- reply/thread correlation;
- persisted route resolution;
- independent Telegram/cTrader/MT5 fanout;
- Telegram `none`, `clean`, `template`, and `ai_then_fallback` destination modes;
- TP/SL updates, partial close, full close, pending cancellation, and `MOVE_SL_TO_BE`;
- management continuity after restart/redeployment;
- fresh broker-side risk/position context for management authorization;
- broker reconciliation before retry after uncertain outcomes;
- durable broker identifiers and opening/closing history;
- destination failure isolation.

Older PR code must not be copied blindly. Port only behavior that remains correct against the current PR #89 architecture and tests.

## Scope D — Durable-state null and close-state correctness

Nullable numeric durable-state fields must preserve `null` as `null`; valid numeric zero must remain `0`. `Number(null)` or equivalent coercion must never silently turn a missing value into zero.

Full close/cancel materialization must preserve opening history while recording completed lifecycle state, including close timestamp and zero remaining volume where appropriate.

## Scope E — CI and test isolation

1. Add regression coverage before fixing reproducible defects.
2. Access tests must prove:
   - same workspace retained;
   - branding/unrelated metadata preserved;
   - additive entitlements;
   - old code fails after rotation;
   - old refresh/session/bearer fails after rotation;
   - new access succeeds;
   - no duplicate workspace;
   - LIVE remains false.
3. Persistence tests must prove null preservation and valid zero preservation.
4. Management tests must prove local validation plus fresh broker risk context without weakening fail-closed behavior.
5. Test harnesses must use isolated/local/test data and must not pollute production Supabase.
6. CI must pass Worker/trading-core, Telegram, MTProto, MT5, and other release-gating suites applicable to PR #89.

## Scope F — Fresh real DEMO acceptance

After CI is green, run a fresh production-state preflight before any real broker action:

- re-query runtime controls;
- verify `live_broker_execution_enabled=false`;
- verify target DEMO account execution is enabled and LIVE accounts are execution-disabled;
- verify current source/route/destination/account authority;
- verify connector/gateway health separately from Worker health.

The real DEMO acceptance must produce evidence for:

1. normal open;
2. fast/incomplete -> full-signal promotion without duplicate open;
3. TP/SL protection/update;
4. break-even management;
5. partial/full close as applicable;
6. Telegram destination delivery/format behavior;
7. destination isolation;
8. durable Supabase readback after the broker action;
9. restart/recovery continuity where practical;
10. final proof LIVE stayed disabled before, during, and after acceptance.

## Completion rule

Do not call this stabilization complete merely because code exists in multiple PRs. Completion requires a single current PR #89 head whose relevant automated tests pass, production access state is repaired, fake test data is removed/prevented, durable-state readback is correct, fresh DEMO acceptance succeeds, and LIVE execution is still disabled.