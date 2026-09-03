# Trading V1 Production Development Audit

## Purpose

This is the detailed continuation record for the development-to-production audit/remediation of draft PR #2 on `design/enterprise-trading-event-core`. It is the technical pickup document behind `AGENTS.md`.

It does **not** authorize Cloudflare mutation, deployment, external probes, broker demo/live orders, `main` merge, real-money execution, or Gate 10.

## Authority order

When documents conflict, use this precedence:

1. `AGENTS.md` + `docs/superpowers/plans/2026-09-03-production-v1-launch-master-plan.md`.
2. Latest approved Sept 3 technical specs/plans, especially production execution bridge, hot-path resilience, and destination retry.
3. Current production acceptance/cutover runbooks.
4. Sept 2 identity/source/TradingView documents where still referenced by the Sept 3 launch program.
5. Sept 1 foundation docs are historical context only.

Later Sept 3 resilience/cutover rules control where they tighten earlier component plans.

## Repository / verification baseline

- Repository: `MketyDigital/Trading`
- Branch: `design/enterprise-trading-event-core`
- Draft PR: #2 -> `main`
- Trusted pre-audit runtime/content tree: `89944d3b6aa4b03f6bb1a1107594e9acfa424fb3`
- Last broad pre-remediation CI on that tree: run `33766769463` SUCCESS; Node/trading-core 649/649, MT5 14/14, Container MTProto 11/11, external MTProto 22/22; protected Cloudflare jobs skipped.
- Frozen audit-scope commit: `7b175a548c9134b0e88ba4fa5977de51142b6cd3`.
- Matching pre-remediation `AGENTS.md` synchronization: `a9eecb4b9f843dbdbfc36c81961c7efa76c255af`.
- Static remediation implementation plan: `docs/superpowers/plans/2026-09-03-production-readiness-remediation.md`, commit `567d8fe06c291eb393b5c23b3bd2d2dfbb65dbe4`.
- Task 1 detailed evidence sync: `905ec9ba10a35a7fb0ea6e6337da2364c73b049b`.
- Task 1 AGENTS sync: `531c96fc469fdb9944ba1afce6d81988bc16cda3`.

## Current development stage

`STATIC PRODUCTION REMEDIATION IN PROGRESS — TASK 2 GREEN / TASK 3 NEXT`

The Production V1 Launch Master Plan remains controlling. General production still requires applicable real Gates 4–9, shadow production, production-infrastructure demo, separate tiny-live approval, tiny-live acceptance, controlled beta, and no unresolved severity-1/2 safety issue.

This PR is not at branch-finishing/merge stage.

## Method

For every remediation task:

1. trace the latest approved requirement through the real runtime call graph;
2. write a failing regression first;
3. verify intended RED on an exact PR head;
4. implement only the minimum production change;
5. debug any failed GREEN attempt from root cause rather than weakening the contract;
6. require ordinary PR CI exact-head GREEN before calling the milestone GREEN;
7. keep protected Cloudflare/demo/live jobs skipped unless separately authorized;
8. synchronize this file and `AGENTS.md` after each meaningful verified milestone.

---

# Remediation milestone evidence

## Task 1 — enforce both Worker master fuses on every broker-capable path

**Finding addressed:** F1.  
**Status:** STATIC GREEN / F1 RESOLVED.

### RED
- integration-test commit: `3bc54e60b85c065dfade8039fe0c9e0303aabacd`;
- retry-test RED head: `7961849db8355c67801db5f68c3d5357f0768f99`;
- PR run: `33782879644`;
- mandatory test job: `100740562007`;
- Worker/trading-core failed on the intended new missing-access-fuse regressions;
- protected Cloudflare jobs skipped.

### Implementation / debugging / GREEN
- execution-stage guard: `fc69dafa78803429c49028a31457a75746faf187`;
- production retry guard: `11a143abc7c71e55beb5b2505048a1e3963d16f0`;
- first GREEN attempt run `33783066190`, job `100741166130` exposed older positive test-fixture drift; production behavior was not weakened;
- fixture-correction/final head: `1632889c6b26e88451ece25ba13c649b43357c5a`;
- final PR run: `33783267187`;
- test job: `100741828652` SUCCESS;
- Worker/trading-core, pure MT5 bridge, Container/external MTProto Python all SUCCESS;
- all Cloudflare inspect/probe/deploy/accept jobs SKIPPED.

**Resolved contract:** every production broker-capable entry/recovery path requires Trading access plus the broker master fuse before broker-capable work can begin.

---

## Task 2 — final durable execution authority and exact persisted event linkage

**Findings addressed:** F2, F3, F4, F9.  
**Status:** STATIC GREEN / F2, F3, F4, F9 RESOLVED.

### RED

Tests were added before production authority code:

- final authority module contract: `85ba2c9352bc81b209227bd98d8d5e97a06dda84`;
- persisted-event propagation test: `d94e98a1fa79bb0f557e8561676985146b41225b`;
- per-action authority reload/revocation test: `903e53e6db4a22b9fbe40ee7b98d775595898644`;
- durable retry source-revocation RED head: `71be214f260adf9800bee362ede92ebe62888d5e`.

Exact RED verification:

- feature head: `71be214f260adf9800bee362ede92ebe62888d5e`;
- PR run: `33783879937`;
- mandatory test job: `100743853586`;
- Worker/trading-core failed on the intended missing final-authority contracts;
- protected Cloudflare inspect/probe/deploy/accept jobs were skipped.

The RED regressions require:

- `result.eventId` to become server-owned `tradingEventId` for production dependency/delivery context;
- exact persisted event/workspace/source/workspace-entitlement/account authority;
- inactive/missing/cross-workspace source or account, disabled workspace entitlement, and account execution revocation to fail closed;
- authority reload inside each action loop so a revocation after action 1 blocks action 2;
- scheduled retry to use durable delivery `workspace_id`, `trading_event_id`, and exact destination/account identity rather than request-payload source/workspace hints.

### Minimal implementation

- created final authority loader: `543830329988630d7aef1e63cd292a93b568a76c`;
- propagated persisted event ID through execution stage: `2b3bcba4a6cc8b84830f471eecd783ece7be1b2f`;
- composed authority loader and durable event identity into production dependencies/delivery store: `de30aec9263d4000a204abe83952018294de9f0a`;
- per-action coordinator authority reload final implementation head: `9ba95eea33748aea1ab641e2aab4e0aec67068dc`.

The new `createProductionExecutionAuthorityLoader()` is bound to server-owned `(workspaceId, tradingEventId)` and resolves only durable records:

1. exact `trading_events` row;
2. exact originating `source_connections` row and active/workspace authority;
3. exact `trading_workspace_access` entitlement;
4. exact `trade_accounts` row and current active/execution state.

The coordinator reloads this authority **inside every action loop** and dispatches using the current account row. Retry receives the same loader from the durable destination-delivery event/account context. Caller source/workspace/event hints do not become authority.

### Verification nuance

A normal branch push workflow for `9ba95eea...` was skipped by workflow design and is not counted as GREEN evidence:

- push run: `33784443633` — SKIPPED.

The correct ordinary verification is the PR workflow:

- exact feature head: `9ba95eea33748aea1ab641e2aab4e0aec67068dc`;
- PR merge-ref SHA contained that head: `4648138510fc4d97e07817d05d3cae72d91ae4fe`;
- PR run: `33784508546`;
- mandatory test job: `100745907350` SUCCESS;
- Worker/trading-core SUCCESS;
- pure MT5 bridge SUCCESS;
- Container/external MTProto Python SUCCESS;
- all Cloudflare inspect/probe/deploy/accept jobs SKIPPED.

No Cloudflare mutation, protected external probe, deployment, broker order, or live action occurred.

**Resolved contracts:**

- workspace entitlement is now a final server-side execution authority;
- originating source active/workspace authority is revalidated before dispatch/retry;
- account active/execution/safety authority can change between two actions and is reloaded before the next action;
- normal production destination delivery now retains the exact persisted `tradingEventId`, enabling durable event→source recovery/audit traversal.

---

# Frozen audit findings / current status

## F1 — Worker Trading access fuse missing on non-HTTP broker-capable paths
**Status: RESOLVED STATIC GREEN in Task 1.**

## F2 — workspace entitlement not final broker-dispatch authority
**Status: RESOLVED STATIC GREEN in Task 2.**

## F3 — account/safety authority loaded once per multi-action plan
**Status: RESOLVED STATIC GREEN in Task 2.**

## F4 — source disablement not revalidated before dispatch/retry
**Status: RESOLVED STATIC GREEN in Task 2.**

## F5 — successful broker delivery can remain durably unbound from Trade State after state-write failure
**Status: OPEN / Task 4.** Repair must use persisted successful delivery/broker truth and never resend solely to repair Trade State.

## F6 — legacy `trade_accounts` workspace FK reintroduces MKSaaS/Trading coupling
**Status: OPEN / Task 5.** Static migration contract required; real schema must be inspected read-only before later application.

## F7 — production risk-to-volume sizing not broker-authoritative at send time
**Status: OPEN / Task 3.** Simulation planning calculates monetary risk-to-lots; live adapters currently translate precomputed lots without a final broker-authoritative risk assertion.

## F8 — live MT5/cTrader volume normalization can increase planned volume
**Status: OPEN / Task 3.** Production translation must fail closed rather than round/clamp a risk-increasing quantity upward.

## F9 — normal production stage drops `tradingEventId`
**Status: RESOLVED STATIC GREEN in Task 2.** Exact persisted event ID now reaches execution dependencies and destination delivery context.

## F10 — final dispatch policy recheck lacks reliable total-lots/risk/daily/open-risk inputs
**Status: OPEN / Task 3.** Final policy/risk materialization must use the exact canonical fields plus fresh server/broker authority.

## I1 — runtime execution snapshot helper not integrated
**Status: OPEN / Task 6.** Non-authoritative optimization only.

## I2 — warm broker context/session reuse incomplete
**Status: OPEN / Task 7.**

## U1 — MT5 metadata GET transport boundary
**Status: OPEN / Task 7.** Static plan chooses authenticated metadata GET hardening rather than relying on undocumented private-only topology.

---

# Root-cause boundaries retained for remaining implementation

### A. Broker-authoritative risk materialization

Simulation remains planning/audit authority, but immediately before risk-increasing broker send the final executable volume and policy must be validated against current server-loaded account configuration plus broker-authoritative account/symbol economics. If reliable monetary loss-at-stop cannot be established, fail closed.

### B. Strict production volume validation

Production execution must never increase planned/risk-approved volume merely to satisfy broker minimum/step. Below-minimum, above-maximum, or invalid-step execution quantity must block rather than clamp upward.

### C. Successful-delivery state-binding repair

Repair exact Trade State from persisted delivery success + trusted group/leg/broker identifiers. No broker resend.

### D. Trading-owned trade-account tenancy

Create an additive migration contract so Trading broker accounts no longer require/cascade from MKSaaS workspace rows; do not apply it until authorized real-schema inspection confirms prerequisites.

### E. Bounded warm context

Use snapshot/session reuse only for non-authoritative metadata/performance. Fresh final safety/risk authority always wins.

---

# Current gate interpretation

- Gate 1: historical GREEN.
- Gate 2: historical GREEN/exited; do not repeat without reason.
- Gate 3: deferred/fail-closed.
- Gates 4–7: static foundations/bridges remain useful; real acceptance pending.
- Gates 8–9: static remediation required before real acceptance.
- Gate 10: CLOSED / not started.

## Exact pickup point

1. Task 1 is static GREEN at `1632889c...` / run `33783267187`.
2. Task 2 is static GREEN at feature head `9ba95eea...` / PR run `33784508546`, job `100745907350`.
3. Start **Task 3 RED only** from `docs/superpowers/plans/2026-09-03-production-readiness-remediation.md`.
4. Task 3 tests must first prove, through real production composition where applicable:
   - `maxLotsPerTrade` blocks when the final action total exceeds it;
   - `maxRiskPercent` blocks with the real execution-stage/coordinator data shape;
   - current daily loss and current open-risk limits block before broker send;
   - MT5 requested lots below live broker minimum or off-step THROW rather than clamp/round upward;
   - cTrader canonical lots producing below-minimum/off-step protocol volume THROW rather than clamp/round upward;
   - a risk-percent OPEN is blocked when current broker-authoritative account/symbol economics make the planned lots exceed configured risk;
   - missing reliable loss-at-stop model fails closed.
5. Verify Task 3 RED through ordinary PR CI before modifying production risk/volume code.
6. Continue Tasks 4–8 only after their own RED/GREEN cycles.
7. Only after static remediation is exact-head GREEN return to separately authorized real Gates 4–9.

## Safety state during static remediation

```text
TRADINGVIEW_DIRECT_INGRESS_ENABLED=false
TRADINGVIEW_CERT_PROBE_ENABLED=false
TRADING_ACCESS_ENABLED=false
BROKER_EXECUTION_ENABLED=false
```

Do not deploy, mutate Cloudflare, run protected external probes, place broker orders, merge `main`, or enable real-money execution without the exact later gate/approval contract.
