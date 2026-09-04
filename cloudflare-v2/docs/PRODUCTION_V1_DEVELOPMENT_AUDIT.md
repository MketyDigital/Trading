# Trading V1 Production Development Audit

## Purpose
Detailed continuation/evidence record for development-to-production work on draft PR #2, branch `design/enterprise-trading-event-core`. This is the technical companion to `AGENTS.md` and must allow a future session to resume without reconstructing intent from chat history.

This document does **not** authorize Cloudflare/Zitadel/Supabase mutation, protected external probes, demo/live broker orders, `main` merge, real-money execution, or Gate 10.

## Authority order
1. current `AGENTS.md` + `docs/superpowers/plans/2026-09-03-production-v1-launch-master-plan.md`;
2. latest approved Sept 3 technical specs/plans, especially execution bridge, hot-path resilience, destination retry and production-readiness remediation;
3. current acceptance/cutover runbooks;
4. Sept 2 identity/source/TradingView documents where still referenced by Sept 3;
5. Sept 1 foundation documents as historical context only.

Later Sept 3 resilience/cutover contracts control where stricter.

## Enterprise production invariants
- Sources normalize Telegram MTProto, TradingView, MT5, cTrader and custom API into one durable canonical Trading Event.
- Deterministic parsing/planning is primary. AI may assist ambiguity/presentation but may never become execution authority; unresolved ambiguity is `NEEDS_REVIEW`.
- Event/destination/order idempotency is durable and workspace-scoped.
- Human delivery and broker execution are isolated sibling fan-out paths.
- Immediately before every broker action, reload exact persisted event/source, Trading-owned workspace entitlement, exact account active/execution/kill state, fresh risk/exposure, broker symbol/economics and final executable volume.
- Caller-selected workspace/account/provider/destination/broker/credential/execution hints are never authority.
- Risk-increasing live volume never silently clamps/rounds upward.
- Protective/risk-reducing management remains available under drawdown/open-risk locks unless kill switch blocks it.
- Successful broker truth must converge to Trade State. State-binding repair uses persisted successful broker truth and never resends solely to repair state.
- Uncertain broker outcomes are reconciled, never blindly retried.
- Execution snapshots and warm broker contexts are optimization only and never replace fresh authority.
- cTrader raw `ProtoOASymbol.lotSize` protocol-cent semantics remain unchanged.

## Repository / baseline
- Repository: `MketyDigital/Trading`
- Branch: `design/enterprise-trading-event-core`
- Draft PR: #2 -> `main`
- Trusted pre-audit tree: `89944d3b6aa4b03f6bb1a1107594e9acfa424fb3`
- Pre-remediation broad CI: run `33766769463` SUCCESS; Node/trading-core 649/649, MT5 14/14, Container MTProto 11/11, external MTProto 22/22; protected Cloudflare jobs skipped.
- Frozen audit-scope commit: `7b175a548c9134b0e88ba4fa5977de51142b6cd3`.
- Static remediation plan: `docs/superpowers/plans/2026-09-03-production-readiness-remediation.md`, plan commit `567d8fe06c291eb393b5c23b3bd2d2dfbb65dbe4`.
- Controlling launch master blob: `48983550b3c33a7c3517c236370ffbc3d1d1788d`.

## Current development stage
**STATIC PRODUCTION REMEDIATION COMPLETE — GATE 4 PROTECTED TOOLING STATIC GREEN — REAL ZITADEL IDENTITY/WORKSPACE ACCEPTANCE PENDING.**

Static remediation acceptance implementation head remains `a7da981a5daec426b5aad840739555edfbc68819` with run `33865341673`, job `100998803951` SUCCESS:
- Node/trading-core **685/685 PASS**;
- MT5 **14/14 PASS**;
- Container MTProto **11/11 PASS**;
- external MTProto **22/22 PASS**;
- protected Cloudflare inspect/probe/deploy/accept jobs all **SKIPPED**.

Gate 4 protected-tooling exact-head verification is `e018ce79d2c7cc9018775b71281be033691f58b8`, ordinary PR run `33869550721`, test job `101012027592` SUCCESS:
- Node/trading-core **687/687 PASS**;
- MT5 **14/14 PASS**;
- Container MTProto **11/11 PASS**;
- external MTProto **22/22 PASS**;
- protected Cloudflare inspect/probe/deploy/accept jobs all **SKIPPED**.

The protected real-identity Gate 4 acceptance job was **not invoked** during tooling implementation/verification. No real Zitadel/Supabase identity acceptance evidence has yet been produced.

This PR is not at branch-finishing/merge stage. General production still requires applicable real Gates 4–9, shadow production, production-infrastructure demo, separate tiny-live approval, tiny-live acceptance, controlled beta, and no unresolved severity-1/2 safety issue.

## Development method
For any remaining implementation work:
1. trace the latest approved requirement through the real runtime call graph;
2. write failing regression first when a real contract gap exists;
3. verify intended RED on ordinary PR CI;
4. implement the minimum production change;
5. never weaken a safety contract just to satisfy a test;
6. require exact-head ordinary PR CI GREEN before calling a milestone GREEN;
7. keep protected Cloudflare/demo/live jobs skipped unless separately authorized;
8. reconcile current branch head/blob before every write;
9. synchronize this file and `AGENTS.md` after every meaningful verified milestone.

---

# Remediation milestone evidence

## Task 1 — both Worker master fuses on every broker-capable path
**Finding F1 — STATIC GREEN / RESOLVED.**
- RED: `7961849db8355c67801db5f68c3d5357f0768f99`, run `33782879644`, job `100740562007`.
- GREEN: `1632889c6b26e88451ece25ba13c649b43357c5a`, run `33783267187`, job `100741828652` SUCCESS.
- Production execution and scheduled retry both require `TRADING_ACCESS_ENABLED=true` plus `BROKER_EXECUTION_ENABLED=true` before broker-capable work.

## Task 2 — final durable execution authority and persisted event linkage
**Findings F2/F3/F4/F9 — STATIC GREEN / RESOLVED.**
- Final RED: `71be214f260adf9800bee362ede92ebe62888d5e`, run `33783879937`, job `100743853586`.
- Final implementation: `9ba95eea33748aea1ab641e2aab4e0aec67068dc`.
- GREEN: run `33784508546`, job `100745907350` SUCCESS.
- Runtime authority chain is exact persisted event -> originating source -> Trading workspace entitlement -> exact trade account; reload is per action and retry.

## Task 3 — broker-authoritative risk, strict execution volume, canonical final policy
**Findings F7/F8/F10 — STATIC GREEN / RESOLVED.**
- Initial broker-risk RED: `825f8839b2ac53265547af547bc790e753f3f0da`, run `33785080713`, job `100747771938`.
- Strict-volume RED: `e9a4729699b7617ea44d12f9b15708264fe573b5`.
- Final policy RED: `fc1496e7b62b4e11c385d0a8fed3ca8a783b8c24`, run `33785495528`, job `100749133738`.
- Final implementation: `a3a507b569499524d6de75ad8c519db5dd944efb`.
- GREEN: run `33843616430`, job `100930741996`; Node 669/669, MT5 14/14, Container 11/11, external 22/22.
- Final risk-increasing action is verified from current broker account/symbol economics; unsafe/no reliable loss model fails closed. MT5/cTrader OPEN never increases intended risk by clamp-up/round-up.

## Task 4 — successful broker truth -> durable Trade State repair without resend
**Finding F5 — STATIC GREEN / RESOLVED.**
- RED sequence proved broker success + state-bind failure had no safe convergence path.
- Final implementation: `30be3bddb586e6a9bf02dea4520c338e3510287c`.
- GREEN: run `33850696335`, job `100952562634`; Node 675/675, MT5 14/14, Container 11/11, external 22/22.
- Delivery stays terminal `SUCCEEDED`; `STATE_BINDING_PENDING` is a separate repair obligation. Repair reads persisted broker truth and never dispatches broker work.

## Task 5 — Trading-owned trade-account tenancy migration contract
**Finding F6 — STATIC GREEN / RESOLVED.**
- Final implementation: `9a13bd2fa928d39cce826d05b005129fa10a68f3`.
- GREEN run `33851400665`; Node 678/678, MT5 14/14, Container 11/11, external 22/22.
- Static migration repoints `trade_accounts.workspace_id` from shared MKSaaS workspace lifecycle to Trading-owned workspace authority, preserving rows and failing closed on missing Trading workspace provisioning.
- No real database migration was applied by this remediation task.

## Task 6 — runtime execution snapshot integration
**Finding I1 — STATIC GREEN / RESOLVED.**
- Final implementation: `400880cab6502c75ac487830bc3a90bb022f485c`.
- GREEN run `33853785408`, job `100962282286`; Node 681/681, MT5 14/14, Container 11/11, external 22/22.
- Coordinator order remains fresh durable authority -> advisory snapshot -> fresh broker-risk materialization -> final policy -> dispatch.
- Snapshot contains only explicit safe non-secret/non-authoritative configuration; miss/failure is a cache miss, never authorization.

## Task 7 — authenticated MT5 metadata + bounded warm broker contexts
**Findings U1/I2 — STATIC GREEN / RESOLVED.**
- Final implementation: `619fa842ee29addecc9cbbd3fad6bec6efe59f60`.
- GREEN run `33856378784`, job `100970541404`; Node 685/685, MT5 14/14, Container 11/11, external 22/22.
- MT5 `/v1/account`, `/v1/symbols`, `/v1/tick` requests use server-owned HMAC/timestamp authentication.
- MT5 may reuse only the freshly loaded exact-action context from risk validation into that dispatch.
- cTrader may reuse one runtime only inside the exact account/group batch; finalize closes it once, scope mismatch/failure disposes or rejects reuse.
- Fresh durable source/workspace/account/kill/risk authority remains per action.

## Task 8 — integrated failure-matrix static acceptance
**STATIC GREEN / RESOLVED.**

### Audit conclusion before final assertion
Re-reading the current coordinator/integration/retry/repair contracts showed the production runtime already covered every required failure row. No runtime correction was justified. The one evidence weakness was that normal production delivery event linkage was implicit rather than asserted at the persistent delivery-store boundary.

### Minimal evidence change
- Commit `a7da981a5daec426b5aad840739555edfbc68819` (`test: assert durable production event linkage`) tightened `production_execution_integration.test.mjs` so normal production delivery explicitly proves the exact persisted `tradingEventId` is written as durable delivery authority rather than caller-shaped hints.
- No production code changed for Task 8.

### Exact failure matrix
1. **Trading access false / broker fuses:** execution stage and destination retry both stop before broker-capable dependency construction/dispatch.
2. **Source revocation:** durable event/retry source authority is re-resolved; inactive/missing/foreign source fails closed.
3. **Workspace revocation:** exact workspace entitlement is part of fresh authority; stale enabled snapshots cannot override fresh workspace/source/account revocation.
4. **Account revocation between actions:** final durable authority reload occurs before every action; account active/execution/kill changes after action one block action two.
5. **Broker-min/off-step unsafe lots:** MT5/cTrader risk-increasing OPEN rejects below-minimum or non-step canonical volume rather than increasing risk.
6. **Stale/missing risk/exposure/economics:** final production broker-risk materialization uses fresh broker account/symbol economics and canonical policy fields; changed economics that reduce permissible size block, and absent reliable loss-at-stop economics fail closed.
7. **Persisted event linkage:** production stage forwards persisted event identity, normal persistent delivery now explicitly asserts `tradingEventId`, and scheduled retry reconstructs source/workspace authority from durable delivery/event linkage.
8. **Broker success + state-bind failure:** dispatch occurs once; failure records repair obligation; repair binds persisted successful broker IDs and never calls broker dispatch.

### Exact-head GREEN
- Acceptance head: `a7da981a5daec426b5aad840739555edfbc68819`.
- PR run: `33865341673`.
- Test job: `100998803951` SUCCESS.
- Node/trading-core: **685/685 PASS**.
- MT5: **14/14 PASS**.
- Container MTProto: **11/11 PASS**.
- External MTProto: **22/22 PASS**.
- `cloudflare-inspect`, Gate 3 zone/probe, Gate 2 acceptance, and paid deploy jobs: **SKIPPED**.

Task 8 therefore closes the static production-readiness remediation package. No Cloudflare mutation, deployment, protected external probe, database mutation, demo broker order, or live broker order occurred.

---

# Frozen finding status
- F1 RESOLVED Task 1.
- F2 RESOLVED Task 2.
- F3 RESOLVED Task 2 for mutable account authority; dynamic final risk/exposure completed Task 3.
- F4 RESOLVED Task 2.
- F5 RESOLVED Task 4.
- F6 RESOLVED Task 5.
- F7 RESOLVED Task 3.
- F8 RESOLVED Task 3.
- F9 RESOLVED Task 2 and explicitly re-asserted at delivery boundary in Task 8.
- F10 RESOLVED Task 3.
- I1 RESOLVED Task 6.
- I2 RESOLVED Task 7.
- U1 RESOLVED Task 7.

All frozen static findings are resolved. This is not equivalent to real production acceptance.

---

# Gate 4 readiness assessment — real Zitadel identity and workspace authorization

## Controlling Gate 4 contract
Launch master Gate 4 requires the real non-live identity environment to prove:
1. actual Trading Zitadel project/application and expected organization/workspace mapping;
2. immutable Zitadel `sub` as identity; never email;
3. successful login alone cannot access Trading while `TRADING_ACCESS_ENABLED=false`;
4. controlled Trading entitlement/membership is exact-workspace and exact-sub;
5. owner/admin/operator/viewer roles match documented permissions;
6. no workspace role implicitly grants broker execution;
7. wrong project, wrong organization/workspace, absent membership, revoked membership, unknown role, disabled entitlement, and second-tenant user all fail closed;
8. tenant A cannot read/mutate source/account/destination/health/retry/idempotency/control state for B;
9. broker execution remains separately disabled.

## Existing static/source evidence
Current CI already proves the internal composition contract through the real authorization functions/stores with deterministic doubles, including:
- RS256 JWT signature + issuer/audience/exp/nbf validation;
- exact project-specific role claim with no generic fallback when `ZITADEL_PROJECT_ID` is configured;
- exact workspace-bound organization role;
- exact `(workspace_id, zitadel_subject)` membership;
- missing/disabled/wrong-workspace membership failure;
- same subject independent across multiple Trading workspaces;
- owner/admin/operator/viewer permission boundaries;
- membership administration scoped to exact workspace and last-owner protection;
- Trading auth modules contain no MKSaaS database/shared-workspace dependency;
- Trading-only identity model is supported;
- no workspace role grants broker master-fuse/execution authority.

This source/CI evidence does not by itself prove the external Zitadel project/application or current real database/environment mapping.

## Historical environment evidence from runbook
`STAGING_V1_RUNBOOK.md` records that migration `0009_trading_workspace_memberships.sql` was live-applied and verified on 2026-09-02, with RLS enabled, client table privileges absent, service-role access retained, zero initial membership rows, existing Trading entitlement disabled, and `zitadel_org_id` unset. That historical statement must be revalidated during a separately authorized Gate 4 acceptance run before relying on it as current environment truth.

## Gate 4 protected tooling TDD evidence
A bounded protected Gate 4 workflow/harness was approved and implemented after the earlier readiness assessment.

### RED
- Gate 4 contract tests were added first at head `a0759701…`.
- Ordinary CI produced the intended RED: **687 tests total, 685 passed, exactly 2 intended failures** for the missing protected workflow/runner tooling.
- Protected Cloudflare/identity acceptance work did not run during RED.

The RED contract required:
- exact marker-only workflow triggering;
- protected `staging` environment;
- ordinary tests as a prerequisite;
- non-broker/read-only behavior;
- no Cloudflare deployment/mutation commands;
- secret-free runner output;
- positive existing-Mkety and Trading-only identity cases;
- wrong project and wrong organization negatives;
- missing and disabled Trading membership negatives;
- owner/admin/operator/viewer role coverage;
- second-tenant isolation;
- broker execution remaining separately disabled.

### Implementation
The tooling batch added:
- a protected Gate 4 Zitadel identity acceptance workflow using the repository's established exact-marker protected-gate pattern;
- a thin read-only acceptance runner exposed through `npm run accept:zitadel:gate4`;
- Gate 4 trigger/runbook documentation.

The runner deliberately uses the production Zitadel JWT verification + Trading workspace/membership authorization composition directly rather than normal Trading application routes. This is required because `TRADING_ACCESS_ENABLED` remains false until Gate 4 is accepted. The runner therefore can validate the real identity plane read-only without temporarily opening the Trading application API.

The protected contract keeps both:
```text
TRADING_ACCESS_ENABLED=false
BROKER_EXECUTION_ENABLED=false
```
throughout Gate 4 identity acceptance. No broker adapter is part of the Gate 4 runner.

### First GREEN failure and root cause
The first tooling GREEN attempt failed only in the static Node contract. Root cause was an over-broad test assertion banning the bare word `cloudflare`; that accidentally matched the harmless repository path `working-directory: cloudflare-v2`.

This was a test false positive, not a production/workflow safety defect. The assertion was narrowed to forbid actual Wrangler/Cloudflare deployment or mutation commands while retaining the non-broker/read-only requirements.

### Exact-head GREEN
- Fix/verified head: `e018ce79d2c7cc9018775b71281be033691f58b8` (`test: narrow Gate 4 mutation assertion`).
- Ordinary PR run: `33869550721` SUCCESS.
- Test job: `101012027592` SUCCESS.
- Node/trading-core: **687/687 PASS**.
- MT5: **14/14 PASS**.
- Container MTProto: **11/11 PASS**.
- External MTProto: **22/22 PASS**.
- Protected Cloudflare inspect/probe/deploy/accept jobs: **SKIPPED**.

The CI log explicitly contains:
- `Gate 4 Zitadel acceptance is exact-marker, staging-protected and non-broker` — PASS;
- `Gate 4 runner is secret-free and covers positive, negative, role and tenant isolation cases` — PASS.

No real Gate 4 token/JWKS/database acceptance probe, deployment, environment mutation, or broker action occurred in this tooling batch.

## Gate 4 current interpretation
Gate 4 tooling is **STATIC GREEN / READY TO RUN**, but Gate 4 itself is **NOT YET REAL-ACCEPTED**.

The next bounded action, only after separate explicit authorization, is to trigger the exact protected Gate 4 identity acceptance workflow under the documented marker and protected `staging` environment, with required server-side credentials/configuration already present. The run must stay read-only, secret-free, and broker-disabled.

A real Gate 4 GREEN claim will require exact run/job evidence for the positive/negative/role/tenant-isolation cases against the actual non-live Zitadel + Trading membership plane. Static tooling success is not a substitute.

---

# Current gate interpretation
- Gate 1 historical GREEN.
- Gate 2 historical GREEN/exited; do not repeat without reason.
- Gate 3 deferred/fail-closed because genuine TradingView-originated acceptance capability remains unavailable.
- **Gate 4: protected tooling STATIC GREEN; real non-live Zitadel identity/workspace acceptance pending and not invoked.**
- Gates 5–7 static foundations exist; real acceptance pending.
- Gates 8–9 static remediation prerequisite is satisfied; real E2E/ops acceptance still pending.
- Gate 10 CLOSED/not started.

After Gate 4, continue separately authorized real acceptance in order: Gate 5 Telegram MTProto soak -> Gate 6 real demo source probes -> Gate 7 dedicated demo destination lifecycle -> Gate 8 E2E/failure soak -> Gate 9 operations/rollback/security -> Gate 10 A shadow -> B production-infrastructure demo -> C tiny controlled live only with separate explicit approval and explicit thresholds -> D beta -> E general production.

Gate 10 Phase C requires explicit max per-trade risk, max volume, max concurrent/open risk, daily loss ceiling, allowed symbols, and kill/rollback contacts/procedure. Never invent defaults.

## Exact pickup point
1. Read `AGENTS.md` and this audit first; reconcile current branch/PR head before writes.
2. Static remediation completion is anchored at `a7da981a5daec426b5aad840739555edfbc68819`, run `33865341673`, job `100998803951`: 685/685 + 14/14 + 11/11 + 22/22, protected jobs skipped.
3. Gate 4 protected tooling static readiness is anchored at `e018ce79d2c7cc9018775b71281be033691f58b8`, run `33869550721`, job `101012027592`: 687/687 + 14/14 + 11/11 + 22/22, protected jobs skipped.
4. Current next work is **real Gate 4 non-live Zitadel identity/workspace acceptance**, not additional static remediation.
5. Before any real Gate 4 invocation, re-read the Gate 4 trigger/runbook, `SHARED_ZITADEL_ENTERPRISE_IDENTITY.md`, `STAGING_V1_RUNBOOK.md`, and launch master Gate 4 contract.
6. Verify the exact marker, protected `staging` environment, required server-side configuration names, read-only runner scope, secret-free output contract, and both master fuses pinned false.
7. Do **not** invoke the Gate 4 protected workflow or mutate Zitadel/Cloudflare/Supabase until separate real-environment Gate 4 authorization is explicitly given.
8. After any separately authorized Gate 4 run, record exact workflow/run/job/case evidence here and in `AGENTS.md` before moving to Gate 5.

## Safety state
```text
TRADINGVIEW_DIRECT_INGRESS_ENABLED=false
TRADINGVIEW_CERT_PROBE_ENABLED=false
TRADING_ACCESS_ENABLED=false
BROKER_EXECUTION_ENABLED=false
```
Do not deploy, mutate Cloudflare/Zitadel/Supabase, run protected external probes, place broker orders, merge `main`, or enable real-money execution without the exact later gate/approval contract.