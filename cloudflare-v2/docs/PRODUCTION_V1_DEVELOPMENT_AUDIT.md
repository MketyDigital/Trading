# Trading V1 Production Development Audit

## Purpose
Detailed continuation/evidence record for development-to-production work on draft PR #2, branch `design/enterprise-trading-event-core`. This is the technical companion to `AGENTS.md` and must allow a future session to resume without reconstructing intent from chat history.

This document does **not** authorize Cloudflare/Zitadel/Supabase mutation, protected external probes, real Telegram acceptance, demo/live broker orders, `main` merge, real-money execution, or Gate 10.

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
**STATIC PRODUCTION REMEDIATION COMPLETE — GATE 4 AND GATE 5 PROTECTED TOOLING STATIC GREEN — REAL GATE 4 ACCEPTANCE REMAINS NEXT.**

Static remediation acceptance remains anchored at `a7da981a5daec426b5aad840739555edfbc68819`, run `33865341673`, job `100998803951` SUCCESS:
- Node/trading-core **685/685 PASS**;
- MT5 **14/14 PASS**;
- Container MTProto **11/11 PASS**;
- external MTProto **22/22 PASS**;
- protected jobs **SKIPPED**.

Gate 4 tooling readiness remains anchored at `e018ce79d2c7cc9018775b71281be033691f58b8`, run `33869550721`, job `101012027592` SUCCESS:
- Node/trading-core **687/687 PASS**;
- MT5 **14/14 PASS**;
- Container MTProto **11/11 PASS**;
- external MTProto **22/22 PASS**;
- protected real identity job was not invoked.

Gate 5 tooling readiness is anchored at `5514d0fbff1d599580f042fbb77b34a3c927f8a5`, ordinary PR run `33898184523`, job `101105739815` SUCCESS:
- Node/trading-core **690/690 PASS**;
- MT5 **14/14 PASS**;
- Container MTProto **11/11 PASS**;
- external MTProto **22/22 PASS**;
- protected Cloudflare jobs **SKIPPED**.

Dedicated Gate 5 workflow run `33898179333` also completed SUCCESS for its regression prerequisite job `101105722547`; the protected real `mtproto-soak-gate5` job `101105937826` was **SKIPPED** because the exact real-acceptance marker was not used.

Neither Gate 4 nor Gate 5 real acceptance has been run. This PR is not at branch-finishing/merge stage. General production still requires applicable real Gates 4–9, shadow production, production-infrastructure demo, separate tiny-live approval, tiny-live acceptance, controlled beta, and no unresolved severity-1/2 safety issue.

## Development method
For remaining implementation work:
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

# Static remediation milestone evidence

## Task 1 — both Worker master fuses on every broker-capable path
**F1 STATIC GREEN / RESOLVED.**
- RED: `7961849db8355c67801db5f68c3d5357f0768f99`, run `33782879644`, job `100740562007`.
- GREEN: `1632889c6b26e88451ece25ba13c649b43357c5a`, run `33783267187`, job `100741828652` SUCCESS.
- Production execution and scheduled retry both require `TRADING_ACCESS_ENABLED=true` plus `BROKER_EXECUTION_ENABLED=true` before broker-capable work.

## Task 2 — final durable execution authority and persisted event linkage
**F2/F3/F4/F9 STATIC GREEN / RESOLVED.**
- Final RED: `71be214f260adf9800bee362ede92ebe62888d5e`, run `33783879937`, job `100743853586`.
- Final implementation: `9ba95eea33748aea1ab641e2aab4e0aec67068dc`.
- GREEN: run `33784508546`, job `100745907350` SUCCESS.
- Runtime authority chain is exact persisted event -> originating source -> Trading workspace entitlement -> exact trade account; reload is per action and retry.

## Task 3 — broker-authoritative risk, strict execution volume, canonical final policy
**F7/F8/F10 STATIC GREEN / RESOLVED.**
- Initial broker-risk RED: `825f8839b2ac53265547af547bc790e753f3f0da`, run `33785080713`, job `100747771938`.
- Strict-volume RED: `e9a4729699b7617ea44d12f9b15708264fe573b5`.
- Final policy RED: `fc1496e7b62b4e11c385d0a8fed3ca8a783b8c24`, run `33785495528`, job `100749133738`.
- Final implementation: `a3a507b569499524d6de75ad8c519db5dd944efb`.
- GREEN: run `33843616430`, job `100930741996`; Node 669/669, MT5 14/14, Container 11/11, external 22/22.
- Final risk-increasing action is verified from current broker account/symbol economics; unsafe/no reliable loss model fails closed. MT5/cTrader OPEN never increases intended risk by clamp-up/round-up.

## Task 4 — successful broker truth -> durable Trade State repair without resend
**F5 STATIC GREEN / RESOLVED.**
- Final implementation: `30be3bddb586e6a9bf02dea4520c338e3510287c`.
- GREEN: run `33850696335`, job `100952562634`; Node 675/675, MT5 14/14, Container 11/11, external 22/22.
- Delivery stays terminal `SUCCEEDED`; `STATE_BINDING_PENDING` is a separate repair obligation. Repair reads persisted broker truth and never dispatches broker work.

## Task 5 — Trading-owned trade-account tenancy migration contract
**F6 STATIC GREEN / RESOLVED.**
- Final implementation: `9a13bd2fa928d39cce826d05b005129fa10a68f3`.
- GREEN run `33851400665`; Node 678/678, MT5 14/14, Container 11/11, external 22/22.
- Static migration repoints `trade_accounts.workspace_id` from shared MKSaaS workspace lifecycle to Trading-owned workspace authority, preserving rows and failing closed on missing Trading workspace provisioning.
- No real database migration was applied by this remediation task.

## Task 6 — runtime execution snapshot integration
**I1 STATIC GREEN / RESOLVED.**
- Final implementation: `400880cab6502c75ac487830bc3a90bb022f485c`.
- GREEN run `33853785408`, job `100962282286`; Node 681/681, MT5 14/14, Container 11/11, external 22/22.
- Coordinator order remains fresh durable authority -> advisory snapshot -> fresh broker-risk materialization -> final policy -> dispatch.
- Snapshot contains only explicit safe non-secret/non-authoritative configuration; miss/failure is a cache miss, never authorization.

## Task 7 — authenticated MT5 metadata + bounded warm broker contexts
**U1/I2 STATIC GREEN / RESOLVED.**
- Final implementation: `619fa842ee29addecc9cbbd3fad6bec6efe59f60`.
- GREEN run `33856378784`, job `100970541404`; Node 685/685, MT5 14/14, Container 11/11, external 22/22.
- MT5 `/v1/account`, `/v1/symbols`, `/v1/tick` requests use server-owned HMAC/timestamp authentication.
- MT5 may reuse only the freshly loaded exact-action context from risk validation into that dispatch.
- cTrader may reuse one runtime only inside the exact account/group batch; finalize closes it once, scope mismatch/failure disposes or rejects reuse.
- Fresh durable source/workspace/account/kill/risk authority remains per action.

## Task 8 — integrated failure-matrix static acceptance
**STATIC GREEN / RESOLVED.**
- Acceptance head: `a7da981a5daec426b5aad840739555edfbc68819`.
- PR run: `33865341673`; test job `100998803951` SUCCESS.
- Node/trading-core 685/685; MT5 14/14; Container MTProto 11/11; external MTProto 22/22; protected jobs skipped.
- Matrix proved: access-fuse blocking, source/workspace/account revocation, account kill between actions, broker-min/off-step rejection, fresh risk/economic authority, durable event linkage, and broker-success state repair without resend.
- No runtime production change was required beyond an explicit durable-event-linkage regression assertion.

## Frozen finding status
F1–F10, I1, I2 and U1 are all **STATIC RESOLVED**. This is not equivalent to real environment acceptance.

---

# Gate 4 readiness — real Zitadel identity/workspace authorization

## Controlling contract
Real Gate 4 must prove:
1. actual Trading Zitadel project/application and expected organization/workspace mapping;
2. immutable Zitadel `sub` identity, never email;
3. successful login alone cannot access Trading while `TRADING_ACCESS_ENABLED=false`;
4. exact Trading entitlement/membership for exact workspace/sub;
5. owner/admin/operator/viewer permissions;
6. no workspace role grants broker execution;
7. wrong project/org/workspace, absent/revoked membership, unknown role, disabled entitlement and second-tenant access all fail closed;
8. second-tenant source/account/destination/health/retry/idempotency/control isolation;
9. broker execution remains separately disabled.

Historical `STAGING_V1_RUNBOOK.md` evidence from 2026-09-02 records migration `0009_trading_workspace_memberships.sql` live-applied with RLS, no client table privileges, service-role access retained, zero initial membership rows, entitlement disabled and `zitadel_org_id` unset. This must be revalidated before being treated as current environment truth.

## Gate 4 protected tooling TDD evidence
### RED
- Contract head `a0759701…`.
- Ordinary CI: 687 total, 685 passed, exactly two intended missing-tooling failures.

### Implementation / GREEN
- Protected exact-marker workflow and read-only runner implemented with both fuses false.
- First GREEN attempt exposed only a test false positive caused by banning the bare word `cloudflare`; it matched `working-directory: cloudflare-v2` and was narrowed without weakening workflow safety.
- Verified head: `e018ce79d2c7cc9018775b71281be033691f58b8`.
- Ordinary PR run `33869550721`, job `101012027592` SUCCESS: 687/687 + 14/14 + 11/11 + 22/22.
- Protected identity job not invoked.

Gate 4 tooling is **STATIC GREEN / READY TO RUN**. Gate 4 itself is **NOT REAL-ACCEPTED**.

---

# Gate 5 readiness — real Telegram MTProto soak/recovery

## Controlling contract
Launch master Gate 5 requires real non-live evidence for all three Telegram providers:
- `cloudflare_container_mtproto`;
- `cloudflare_do_mtproto`;
- `external_mtproto`.

Real Gate 5 must exercise dedicated test Telegram account/channel traffic, new and edited messages, disconnect/restart/reconnect, catch-up/replay, persistent duplicate collapse, downstream failure isolation, cross-provider convergence on one canonical native message identity, and Container non-selection for DO/external sources. It must not claim zero-loss beyond the observed soak window.

## Existing static foundation
Before the protected workflow was added, the repository already contained:
- independent Container/DO/external provider runtimes;
- canonical provider-independent Telegram identity;
- persistent recovery state/runtime/supervisor;
- cross-provider replay/idempotency tests;
- source/provider isolation tests;
- Container provider-selection guards;
- an observation-only `npm run soak:mtproto:container` harness measuring connectivity, health transitions, reconnects, event latency, catch-up and duplicate observations.

The gap was operational: there was no exact-marker protected Gate 5 workflow/trigger and no one fail-closed runner combining evidence from all three providers.

## Gate 5 protected tooling TDD evidence
### RED
- Contract test commit: `df9bd1b0f6804df4366dec0a091848ffd84ba796` (`test: define Gate 5 MTProto protected soak contract`).
- Ordinary PR run: `33897870408`.
- Job: `101104697579`.
- Worker/trading-core step failed as intended on the newly introduced missing Gate 5 tooling contract; later Python stages were skipped.
- Protected jobs remained skipped.

The RED contract required:
- trigger-only workflow path `cloudflare-v2/docs/GATE5_MTPROTO_SOAK_TRIGGER.md`;
- exact branch + commit marker `source: accept mtproto gate 5`;
- protected `staging` environment;
- ordinary regression prerequisite;
- `TRADING_ACCESS_ENABLED=false` and `BROKER_EXECUTION_ENABLED=false`;
- all three provider health/event inputs;
- secret-free runner;
- reconnect/catch-up/duplicate evidence;
- edited-message evidence;
- downstream isolation;
- cross-provider duplicate convergence;
- Container isolation.

### Implementation
The GREEN batch added:
1. `.github/workflows/gate5-mtproto-soak.yml`.
2. `cloudflare-v2/scripts/gate5_mtproto_soak.mjs` exposed as `npm run accept:mtproto:gate5`.
3. `cloudflare-v2/docs/GATE5_MTPROTO_SOAK_TRIGGER.md`.
4. Sanitized evidence extensions to `mtproto_container_soak.mjs`:
   - edited-message count;
   - downstream-isolation observation flag;
   - Container-touch observation flag;
   - SHA-256 digest set for canonical event identities, allowing cross-provider equality checks without printing raw Telegram canonical IDs.

The Gate 5 runner launches the three passive observation soaks concurrently, then fails closed unless every provider has final healthy/connected state, reconnect, catch-up, duplicate replay, edited-message evidence and downstream-isolation evidence. It additionally requires one canonical digest shared by at least two providers and proves the Container provider touched Container runtime while DO/external did not.

The runner output is sanitized to provider type, opaque source id, health/status counts, isolation booleans and fixed reasons. It does not output raw canonical Telegram IDs, message bodies, Telegram sessions, API hashes, phone numbers or bearer tokens.

### Exact-head GREEN
- Implementation head: `5514d0fbff1d599580f042fbb77b34a3c927f8a5`.
- Ordinary PR run: `33898184523` SUCCESS.
- Test job: `101105739815` SUCCESS.
- Node/trading-core: **690/690 PASS**.
- MT5: **14/14 PASS**.
- Container MTProto: **11/11 PASS**.
- external MTProto: **22/22 PASS**.
- protected Cloudflare inspect/probe/deploy/accept jobs: **SKIPPED**.

Dedicated Gate 5 workflow verification:
- run `33898179333` SUCCESS;
- regression prerequisite job `101105722547` SUCCESS across Node, MT5 and both MTProto Python suites;
- protected `mtproto-soak-gate5` job `101105937826` **SKIPPED** because the exact authorization marker was not used.

No real Telegram account/session/channel was connected or exercised, no restart/downstream failure was injected, no Container was deliberately started, no Cloudflare/Zitadel/Supabase state was mutated, and no broker action occurred. Therefore Gate 5 tooling is **STATIC GREEN / READY TO RUN**, while Gate 5 itself is **NOT REAL-ACCEPTED**.

---

# Current gate interpretation
- Gate 1 historical GREEN.
- Gate 2 historical GREEN/exited; do not repeat without reason.
- Gate 3 deferred/fail-closed because genuine TradingView-originated acceptance capability remains unavailable.
- **Gate 4: protected tooling STATIC GREEN; real non-live Zitadel identity/workspace acceptance pending and not invoked.**
- **Gate 5: protected tooling STATIC GREEN; real Telegram MTProto soak/recovery acceptance pending and not invoked.**
- Gate 6 static source/demo probe tooling exists; real source acceptance pending.
- Gate 7 static demo destination tooling exists; real demo lifecycle pending.
- Gates 8–9 static remediation prerequisite is satisfied; real E2E/ops acceptance still pending.
- Gate 10 CLOSED/not started.

Launch order remains Gate 4 real identity -> Gate 5 real Telegram soak -> Gate 6 real demo source probes -> Gate 7 dedicated demo destination lifecycle -> Gate 8 E2E/failure soak -> Gate 9 operations/rollback/security -> Gate 10A shadow -> 10B production-infrastructure demo -> 10C tiny controlled live only with separate explicit approval and owner-set thresholds -> beta -> general production.

Gate 10 Phase C requires explicit max per-trade risk, max volume, max concurrent/open risk, daily loss ceiling, allowed symbols, and kill/rollback contacts/procedure. Never invent defaults.

## Exact pickup point
1. Read `AGENTS.md` and this audit first; reconcile current branch/PR head before writes.
2. Static remediation completion: `a7da981a5daec426b5aad840739555edfbc68819`, run `33865341673`, job `100998803951`.
3. Gate 4 tooling readiness: `e018ce79d2c7cc9018775b71281be033691f58b8`, run `33869550721`, job `101012027592`.
4. Gate 5 tooling readiness: `5514d0fbff1d599580f042fbb77b34a3c927f8a5`, run `33898184523`, job `101105739815`; dedicated run `33898179333`, regression job `101105722547`, protected soak job `101105937826` skipped.
5. Current next launch-order work remains **real Gate 4 non-live Zitadel identity/workspace acceptance**. Gate 5 static readiness may be inspected but must not leapfrog Gate 4 without an explicit launch-plan revision.
6. Before a real Gate 4 invocation, re-read `cloudflare-v2/docs/GATE4_ZITADEL_ACCEPTANCE_TRIGGER.md`, `SHARED_ZITADEL_ENTERPRISE_IDENTITY.md`, `STAGING_V1_RUNBOOK.md` and launch master Gate 4.
7. Do not invoke Gate 4 or Gate 5 protected workflows or mutate real environment state without separate exact real-environment authorization for that gate.
8. After separately authorized Gate 4 evidence is recorded in both handoff files, proceed to Gate 5 using `cloudflare-v2/docs/GATE5_MTPROTO_SOAK_TRIGGER.md` and its exact marker only when separately authorized.

## Safety state
```text
TRADINGVIEW_DIRECT_INGRESS_ENABLED=false
TRADINGVIEW_CERT_PROBE_ENABLED=false
TRADING_ACCESS_ENABLED=false
BROKER_EXECUTION_ENABLED=false
```
Do not deploy, mutate Cloudflare/Zitadel/Supabase, run protected external probes, start real Telegram acceptance, place broker orders, merge `main`, or enable real-money execution without the exact later gate/approval contract.
