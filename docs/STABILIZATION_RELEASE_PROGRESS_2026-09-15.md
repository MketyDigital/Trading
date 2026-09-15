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
- Last fully-green checkpoint before diagnostic-workflow removal: `7a627635db5cd23fe01137abc8b2d9454998f04d`
- Diagnostic workflow removal commit: `fa4f9b9d7fdbd376a9a02c8e6c9d54d713d28595`
- Base: `main`
- PR remains draft/open and mergeable until the post-ledger final CI is green.

## Progress against the initial plan

### A. Pin/reproduce current state — COMPLETE

- PR #89 head is re-read after each material change.
- Original hidden CI failure was recovered through a dedicated diagnostic workflow artifact rather than guessed.
- Root cause of the earlier diagnostic discrepancy was a stale synthetic PR merge ref; refreshed PR merge refs were verified afterward.
- The final diagnostic workflow is now removed because ordinary CI independently passed on the same branch head.

### B. Atomic access rotation + Admin UI — IMPLEMENTED

Implemented on #89:

- `cloudflare-v2/db/migrations/0034_atomic_access_code_rotation.sql`
- worker reissue path delegates to `rotate_trading_access_code` RPC.
- database RPC locks workspace row, validates workspace/owner, merges additive entitlements, forces `brokerModes=['demo']` and `liveExecution=false`, creates replacement, revokes predecessor active codes, merges workspace access metadata, and commits transactionally.
- RPC execution is restricted to `service_role`.
- migration `trading_0034_atomic_access_code_rotation` was applied successfully to production Supabase project `vdblajgxrfndjesoyayy` and function existence was re-queried.
- admin UI explicitly says `Reissue / Rotate access` and explains prior active codes are revoked only on successful rotation.
- refresh-session restoration rejects stale access-code identities with `ACCESS_SESSION_SUPERSEDED`.
- privileged local-bearer authorization reloads current workspace/membership and rejects superseded local bearers.

Remaining proof is final CI on the actual final SHA and non-destructive production behavior verification after deployment.

### C. Eliminate production-test pollution — COMPLETE IN CODE; POST-DEPLOY SMOKE STILL REQUIRED

- `.github/workflows/production-frontend-e2e.yml` is read-only.
- it no longer creates/redeems/revokes/purges disposable production access fixtures.
- `cloudflare-v2/scripts/production_e2e_readonly_guard.mjs` structurally refuses known production mutation patterns.
- production smoke checks public login DOM, account setup controls, staff admin page presence, production health, and staff API authorization boundary without authenticating or writing production data.
- current production scan found zero test/e2e/synthetic/fixture/playwright markers across workspaces, sources, destinations, templates, and accounts.

### D. Recent PR reconciliation — COMPLETE, TARGETED ONLY

PR #87:

- already merged to `main`; not re-imported.
- #89 inherits its Telegram verbatim + durable close baseline.

PR #88:

- not merged wholesale.
- #89 contains newer fast-completion/correlator and TP parsing work.
- isolated regressions were added for grouped prices inside one comma-separated TP list and conflicting duplicate numbered TP indexes failing closed.

PR #86:

- not merged wholesale.
- #89 contains MTProto wrapped-reply recovery, BE safety, durable close/opening-history preservation and management continuity behavior.
- explicit broker position/order identity correlation is covered.
- isolated regressions prove risk-reducing close/BE paths do not depend on unavailable dynamic exposure while risk-increasing OPEN still fails closed when required exposure is unavailable.

### E. Exact CI root cause — COMPLETE

The diagnostic workflow captured Node test output as an artifact. The failure was traced to the synthetic PR merge ref containing old sequential reissue code while the real branch head already contained the new RPC path. A subsequent branch update regenerated the PR merge ref and ordinary CI passed on the refreshed branch.

Do not remove safety behavior to satisfy CI.

### F. Full CI — GREEN ON LAST CHECKPOINT; FINAL POST-LEDGER RUN REQUIRED

Checkpoint `7a627635db5cd23fe01137abc8b2d9454998f04d` passed:

- Trading V1 CI
- cTrader cBot CI
- PR89 Node Test Diagnostic

That checkpoint includes the ported #86/#88 safety regressions plus the fresh-open `openedAt` durability regression. The temporary diagnostic workflow has since been removed, which changed the SHA. Therefore one final ordinary CI pass is required on the post-ledger head before merge.

### G. Final production re-audit — COMPLETE FOR PRE-MERGE STATE

Production authority was re-queried read-only.

Important schema correction:

- trading-domain FKs point to `trading_workspace_access`, **not** the legacy `workspaces` table.
- an intermediate audit against `workspaces` therefore produced false orphan signals; no mutation was performed.
- re-auditing against the actual FK authority shows zero orphan workspace/account/group/leg references.

Verified production state:

- runtime controls: `trading_access_enabled=true`, `broker_execution_enabled=true`, `live_broker_execution_enabled=false`.
- exactly two legitimate trading workspaces exist in `trading_workspace_access`: Starpips Forex and Mkay.
- both memberships resolve to legitimate workspaces and are enabled owners.
- all access-code redemptions resolve to legitimate access codes and workspaces.
- Starpips branding/metadata is preserved.
- one active MTProto source exists for Starpips; current stored health is `DISABLED`, so post-deploy source/connector health must be rechecked before DEMO.
- two active broker destinations exist and both report `HEALTHY`.
- two active source->broker routes exist: cTrader and MT5; every route resolves to its source/destination/workspace.
- cTrader DEMO account is active, execution-enabled, environment=`demo`, live execution disabled.
- MT5 DEMO account is active, execution-enabled, environment=`demo`, server=`OctaFX-Demo`, live execution disabled.
- cTrader LIVE account remains active as a configured account but `execution_enabled=false` and `live_execution_enabled=false`.
- position integrity: 43 groups, zero orphan workspace references, zero orphan account references.
- leg integrity: 53 legs, zero orphan workspace references, zero orphan group references.
- known test-marker scan returned zero across workspaces, sources, destinations, templates, and accounts.

Historical durable rows are not rewritten merely to make old data look newer. Fresh post-deploy DEMO evidence remains authoritative for the corrected fast-correlation/open/close behavior.

### H. Deploy/preflight — PENDING FINAL CI + MERGE

Rules:

- production deploy only from merged/reviewed `main` through `.github/workflows/production-cloudflare-deploy.yml`.
- deployment observes persisted runtime controls but does not become an autonomous LIVE switch.
- after deploy, verify the actual deployed release revision/equivalent deployment evidence, production health, runtime controls, DEMO/LIVE account flags, route/source authority, source/connector/gateway health, and read-only frontend smoke.

Only after this gate is green may the operator be asked to send the fresh DEMO signal.

### I. Fresh real DEMO acceptance — PENDING

Operator will send the real DEMO source events. Assistant will observe/inspect production evidence from the system side.

Required evidence remains the full `AGENTS.md` matrix, including:

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

1. Run/follow ordinary CI on the post-ledger branch SHA; inspect any failure exactly.
2. Mark PR #89 ready only if that final CI is green and the PR head has not moved unexpectedly.
3. Merge #89 to `main` using an expected-head SHA guard.
4. Verify the existing production Cloudflare deployment workflow is the one triggered from `main` and follow its result; do not expose or replace secrets.
5. Verify deployed revision/equivalent evidence, `/health`, persisted runtime controls, DEMO/LIVE account flags, routes, source/connector/gateway state, and read-only frontend smoke.
6. Re-query `live_broker_execution_enabled` immediately before DEMO; it must still be false.
7. Only when Gate H is green, ask the operator for the fresh DEMO signal using the approved sentence.
8. Observe the full DEMO lifecycle and query durable/broker/destination evidence after each step.
9. Re-query LIVE state after DEMO. Any later LIVE test requires separate explicit user authorization and must never be enabled automatically.
