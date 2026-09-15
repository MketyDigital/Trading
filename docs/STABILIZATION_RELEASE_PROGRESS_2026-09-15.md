# Trading Release Stabilization Progress — 2026-09-15

## Purpose

This file is an execution ledger only. It **does not replace, shorten, or rewrite** the approved initial plans/specifications.

Primary authorities remain:

- `AGENTS.md`
- `docs/superpowers/specs/2026-09-15-production-stabilization-demo-readiness.md`
- `docs/superpowers/plans/2026-09-15-production-stabilization-demo-readiness.md`
- `docs/superpowers/specs/2026-09-15-access-reissue-rotation-design.md`
- `docs/superpowers/plans/2026-09-15-access-reissue-rotation.md`
- `docs/superpowers/specs/2026-09-15-fast-followup-tp-reply-stabilization-design.md`
- `docs/superpowers/plans/2026-09-15-fast-followup-tp-reply-stabilization.md`
- earlier release handoff supplied by the operator in the ChatGPT session.

If this progress ledger conflicts with current code, current production state, or `AGENTS.md`, stop and reconcile before proceeding.

## Immutable release order from the initial handoff

A. Pin/reproduce current state  
B. Finish atomic access rotation + Admin UI  
C. Eliminate production-test pollution  
D. Reconcile recent PRs only (#86, #87, #88)  
E. Fix exact CI root cause  
F. Run full CI  
G. Final production re-audit  
H. Deploy verified release candidate and run production preflight  
I. Fresh real DEMO acceptance

Do not skip directly to DEMO.

## Safety invariants

- LIVE execution remains disabled throughout stabilization and DEMO acceptance.
- The persisted database runtime control is the **only autonomous LIVE execution switch**. Deployment must not turn LIVE on/off and must not become a second autonomous LIVE switch.
- Production deploy remains main-only through the existing workflow.
- No old PR is merged wholesale into #89.
- Fresh broker risk/position context remains mandatory where required for management authorization.
- Broker-success/state-persistence failure is repaired without broker resend unless reconciliation proves no broker action occurred.
- Production browser/E2E probes must be read-only and non-polluting.

## Current release candidate

- PR: #89 `Stabilize fast follow-ups, TP parsing, replies, and MT5 Wine support`
- Branch: `fix/tp-fast-followup-replies-wine-20260915`
- Head at this ledger update: `6fc5b1d4432dfc00ba9d81caa6a5ab4e83ee817b`
- Base: `main`
- PR remains draft/open and mergeable.

## Progress against the initial plan

### A. Pin/reproduce current state — COMPLETE for current iteration

- Current PR #89 head re-read after each material change.
- Original hidden CI failure was recovered through a dedicated diagnostic workflow artifact rather than guessing.
- Root cause of the earlier diagnostic discrepancy was a stale synthetic PR merge ref; refreshed PR merge refs were verified afterward.

### B. Atomic access rotation + Admin UI — IMPLEMENTED, verification still part of final CI

Implemented on #89:

- `cloudflare-v2/db/migrations/0034_atomic_access_code_rotation.sql`
- worker reissue path delegates to `rotate_trading_access_code` RPC.
- database RPC locks workspace row, validates workspace/owner, merges additive entitlements, forces `brokerModes=['demo']` and `liveExecution=false`, creates replacement, revokes predecessor active codes, merges workspace access metadata, and commits transactionally.
- RPC execution is restricted to `service_role`.
- migration `trading_0034_atomic_access_code_rotation` was applied successfully to production Supabase project `vdblajgxrfndjesoyayy`.
- production function existence was re-queried after migration.
- admin UI now explicitly says `Reissue / Rotate access` and makes clear that prior active access codes are revoked on successful rotation.
- refresh-session restoration compares token `access_code_id` against the current workspace/membership access identity and rejects stale sessions with `ACCESS_SESSION_SUPERSEDED`.
- privileged local-bearer authorization also reloads current workspace/membership and rejects superseded local bearers.

Still required before marking release complete:

- final full CI on the final release SHA;
- production behavior verification after deployment without mutating legitimate access state merely for testing.

### C. Eliminate production-test pollution — IMPLEMENTED in release workflow, final CI/deploy verification pending

- `.github/workflows/production-frontend-e2e.yml` has been converted to a read-only production browser smoke.
- it no longer creates/redeems/revokes/purges disposable production access fixtures.
- `cloudflare-v2/scripts/production_e2e_readonly_guard.mjs` structurally refuses known production mutation patterns.
- production smoke checks public login DOM, account setup controls, staff admin page presence, production health, and staff API authorization boundary without authenticating or writing production data.

Production inventory re-check so far:

- canonical Starpips workspace remains present.
- canonical Mkay workspace remains present.
- no additional trading-workspace rows were found in the workspace audit at this point.
- Starpips latest access code is active and predecessor is revoked.
- Mkay expired code belongs to a legitimate workspace and must not be deleted merely because it is expired.

Still required:

- complete orphan/dependency/read-only audit across memberships, codes, redemptions, sources, routes, destinations, templates, accounts, position state and test-pattern owners.

### D. Recent PR reconciliation — IN PROGRESS, targeted only

PR #87:

- already merged to `main`; do not re-import.
- #89 inherits its Telegram verbatim + durable close baseline.

PR #88:

- no wholesale merge.
- #89 already contains newer fast-completion/correlator and TP parsing work.
- added isolated regression coverage for two exact #88 safety cases not explicitly represented by #89 tests:
  - grouped prices inside one comma-separated TP list;
  - conflicting duplicate numbered TP indexes must fail closed.

PR #86:

- no wholesale merge.
- #89 already contains MTProto wrapped-reply recovery, BE safety, durable close/opening-history preservation and selected management continuity behavior.
- explicit broker position/order identity correlation was added to #89 under regression coverage.
- added isolated regression coverage for #86 risk-reduction availability invariants:
  - close does not depend on unavailable dynamic exposure context;
  - risk-increasing OPEN still fails closed when required exposure is unavailable;
  - MT5 BE uses fresh broker market context without requiring dynamic exposure service.

Still required:

- finish semantic comparison of #86 changed files and prove no still-correct behavior is absent;
- final targeted check that #88 is fully superseded by current #89 behavior.

### E. Exact CI root cause — COMPLETE for the previously hidden failure

A dedicated diagnostic workflow captured Node test output as an artifact. The failure was traced to the synthetic PR merge ref containing the old sequential reissue code while the real branch head already contained the new RPC path. A subsequent branch update regenerated the PR merge ref and the refreshed merge commit was verified to contain the RPC implementation.

Do not remove safety behavior to satisfy CI.

### F. Full CI — PENDING on the current/final head

Previous intermediate head `9f92a0b38d3590bb2ec4919c046b3d5d27be495b` was verified green for:

- Trading V1 CI
- cTrader cBot CI
- PR89 Node Test Diagnostic

Additional regression coverage and workflow changes have been added since then. Therefore that earlier green run is **not** final release evidence.

Required:

- run/follow all release-gating CI on the final head;
- inspect any failure exactly;
- remove the temporary diagnostic workflow only after the ordinary CI path gives sufficient evidence, then re-run final CI if its removal changes the head.

### G. Final production re-audit — IN PROGRESS

Already re-queried:

- runtime controls: `trading_access_enabled=true`, `broker_execution_enabled=true`, `live_broker_execution_enabled=false`.
- atomic RPC exists in production.
- canonical workspace audit currently returns only Starpips and Mkay.
- access-code audit shows current Starpips code active and predecessor revoked; Mkay legitimate expired code remains.
- foreign-key relationships for trading workspace/access domain were inspected before any cleanup.

Still required:

- memberships/orphan check;
- access-code redemption/orphan check;
- sources/routes/destinations/templates linkage;
- broker accounts and environment flags;
- position groups/legs integrity;
- source/destination test-pattern residue;
- branding/workspace metadata preservation;
- final LIVE=false proof immediately before DEMO.

### H. Deploy/preflight — PENDING

Rules:

- production deploy only from merged/reviewed `main` through `.github/workflows/production-cloudflare-deploy.yml`.
- deployment observes persisted runtime controls but does not become an autonomous LIVE switch.
- after deploy, verify the actual deployed release revision/equivalent deployment evidence, production health, runtime controls, DEMO/LIVE account flags, route/source authority, and connector/gateway health.

Only after this gate is green may the operator be asked to send the fresh DEMO signal.

### I. Fresh real DEMO acceptance — PENDING

Operator will send the real DEMO source events. Assistant will observe/inspect production evidence from the system side.

Required evidence remains the full AGENTS.md matrix, including:

- normal Telegram Bot API source;
- MTProto source;
- Telegram `none` exact forwarding and other configured destination modes;
- independent destination failure isolation;
- exactly-once broker open on intended DEMO destinations;
- replay/idempotency;
- fast/incomplete -> full completion on one logical trade;
- reply/thread management;
- SL/TP and BE;
- partial close;
- full close with durable close timestamp/zero remaining volume/opening history retained;
- pending/cancel where applicable;
- connector restart/reconnect;
- durable recovery without duplicate execution;
- final proof LIVE remained disabled.

Do not state `DEMO preflight is green. Send the test signal now.` until CI, deployment, deployed revision verification, production preflight and LIVE=false checks are all freshly green.

## Current next steps

1. Run/follow CI for head `6fc5b1d4432dfc00ba9d81caa6a5ab4e83ee817b` and inspect the two newly ported #86/#88 regression suites.
2. Finish semantic PR #86/#88 comparison; do not import whole files unless a concrete missing behavior is proven.
3. Complete read-only production dependency/orphan audit and current DEMO/LIVE account audit.
4. Reconcile final branch with all approved specs and `AGENTS.md` feature-by-feature.
5. Remove temporary diagnostic workflow when no longer needed, then run final CI on the actual final SHA.
6. Mark PR ready/merge only after final review and green gates.
7. Allow production deploy from merged `main`; verify production health/revision/runtime/account/source/route/connector state.
8. When every preflight gate is green and LIVE is still false, request the operator DEMO signal with the exact approved sentence.
9. Observe the full DEMO lifecycle and query durable/broker/destination evidence after each step.
10. Re-query LIVE state after DEMO. Any later LIVE test requires a separate explicit user authorization; it must never be enabled automatically.
