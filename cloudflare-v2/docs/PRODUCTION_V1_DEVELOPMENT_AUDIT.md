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

## Current development stage

`STATIC PRODUCTION REMEDIATION IN PROGRESS — TASK 1 GREEN / TASK 2 NEXT`

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
- exact PR run: `33782879644`;
- mandatory test job: `100740562007`;
- `Run Worker and trading-core tests` failed after the new missing-access-fuse assertions were introduced;
- protected Cloudflare inspect jobs were skipped.

The new regressions prove the intended contract:

- normal execution with `TRADING_ACCESS_ENABLED=false` and broker fuse true must return `TRADING_ACCESS_DISABLED` and construct zero production dependencies;
- production scheduled retry with Trading access disabled must perform zero Supabase construction, due scan, claim, dependency construction, or broker execution.

### Minimal implementation

- normal execution-stage guard commit: `fc69dafa78803429c49028a31457a75746faf187`;
- production retry guard commit: `11a143abc7c71e55beb5b2505048a1e3963d16f0`.

The normal execution stage now checks Trading access before constructing account plans/dependencies. Production scheduled retry now checks Trading access before creating the retry runtime/Supabase/due scan. Existing broker-fuse behavior remains independently fail-closed.

### First GREEN attempt / debugging

- head: `11a143abc7c71e55beb5b2505048a1e3963d16f0`;
- run: `33783066190`;
- job: `100741166130`;
- Node/trading-core failed; protected Cloudflare jobs remained skipped.

Systematic debugging found test-fixture drift: older positive hot-path tests enabled only `BROKER_EXECUTION_ENABLED` because they predated the explicit two-fuse production contract. Production behavior was **not** weakened.

- fixture-correction head: `1632889c6b26e88451ece25ba13c649b43357c5a`.

### Exact-head GREEN

- exact head: `1632889c6b26e88451ece25ba13c649b43357c5a`;
- PR run: `33783267187`;
- mandatory test job: `100741828652` SUCCESS;
- Worker/trading-core step SUCCESS;
- pure MT5 bridge step SUCCESS;
- Container/external MTProto Python step SUCCESS;
- `cloudflare-inspect`, `cloudflare-inspect-gate3-zones`, `cloudflare-probe-gate3-tradingview`, `cloudflare-deploy-paid`, and `cloudflare-accept-gate2` all SKIPPED.

No Cloudflare mutation, probe, deploy, broker order, or live action occurred.

**Resolved contract:** every production broker-capable entry/recovery path now requires the Trading-access master fuse as well as the broker master fuse before broker-capable work can begin.

---

# Frozen audit findings / current status

## F1 — Worker Trading access fuse missing on non-HTTP broker-capable paths

**Status: RESOLVED STATIC GREEN in Task 1.** See exact RED/GREEN evidence above.

## F2 — workspace entitlement is not a final broker-dispatch authority check

**Status: OPEN / Task 2.** Admin authorization checks entitlement, but the live source-to-broker path does not yet revalidate exact `trading_workspace_access.trading_access_enabled` immediately before each broker action.

## F3 — account active/execution/safety authority is loaded once per multi-action plan

**Status: OPEN / Task 2.** A revocation after action N is not yet proven to block action N+1 immediately.

## F4 — source disablement is not revalidated before dispatch/retry

**Status: OPEN / Task 2.** Ingest authority is correct, but final execution/retry does not yet reload originating source authority.

## F5 — successful broker delivery can remain durably unbound from Trade State after state-write failure

**Status: OPEN / Task 4.** Repair must use persisted successful delivery/broker truth and must never resend solely to repair Trade State.

## F6 — legacy `trade_accounts` workspace FK reintroduces MKSaaS/Trading coupling

**Status: OPEN / Task 5.** Checked-in schema references shared `public.workspaces(id) ON DELETE CASCADE`. Static migration contract will be authored, but real schema must be inspected read-only before later application.

## F7 — production risk-to-volume sizing is not broker-authoritative at send time

**Status: OPEN / Task 3.** Simulation planning currently performs the monetary risk-to-lots calculation; live adapters only translate the precomputed lots.

## F8 — live MT5/cTrader volume normalization can increase planned volume

**Status: OPEN / Task 3.** Production translation must fail closed rather than round/clamp a risk-increasing quantity upward.

## F9 — normal production stage drops `tradingEventId` before destination-delivery persistence

**Status: OPEN / Task 2.** Exact persisted event ID must reach production dependencies/delivery store.

## F10 — final dispatch policy recheck lacks reliable current lots/risk/daily/open-risk inputs

**Status: OPEN / Task 3.** Final policy/risk materialization must use exact canonical field names and fresh server/broker authority.

## I1 — runtime execution snapshot helper not integrated

**Status: OPEN / Task 6.** Snapshot may optimize non-secret configuration only; final authority remains fresh.

## I2 — warm broker context/session reuse incomplete

**Status: OPEN / Task 7.** MT5 metadata is reloaded per action; cTrader runtime is authenticated/closed per action.

## U1 — MT5 metadata GET transport boundary

**Status: OPEN / Task 7.** Static remediation plan chooses authenticated metadata GET hardening rather than relying on undocumented private-only topology.

---

# Root-cause boundaries retained for implementation

### A. Final server-authoritative execution check

Immediately before every broker action, keyed by server-owned `(workspaceId, tradingEventId, accountId)`, revalidate persisted event/source identity, source active/workspace match, workspace entitlement, exact account active/execution/safety/kill state, and current risk inputs. Caller hints are never authority.

### B. Broker-authoritative risk materialization

Simulation remains planning/audit. Final risk-increasing lots must be verified/materialized from current broker/account truth before send. Live normalization may not raise intended risk.

### C. Successful-delivery state-binding repair

Repair exact Trade State from already-persisted delivery success + trusted group/leg/broker identifiers. No broker resend.

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

1. Task 1 is complete and F1 is static GREEN at `1632889c...` / run `33783267187`.
2. Start **Task 2 RED only** from `docs/superpowers/plans/2026-09-03-production-readiness-remediation.md`.
3. First Task 2 regressions must prove:
   - `result.eventId` becomes `tradingEventId` in production dependency/delivery context;
   - exact event/workspace/source/workspace-entitlement/account authority fails closed on mismatch/revocation;
   - authority is reloaded inside the action loop so revocation after action 1 blocks action 2;
   - retry uses durable delivery `workspace_id` + `trading_event_id` + exact account destination context and never request-payload source/workspace hints.
4. Verify Task 2 RED through ordinary PR CI before production implementation.
5. Continue Tasks 3–8 only after their own RED/GREEN cycles.
6. Only after static remediation is exact-head GREEN return to separately authorized real Gates 4–9.

## Safety state during static remediation

```text
TRADINGVIEW_DIRECT_INGRESS_ENABLED=false
TRADINGVIEW_CERT_PROBE_ENABLED=false
TRADING_ACCESS_ENABLED=false
BROKER_EXECUTION_ENABLED=false
```

Do not deploy, mutate Cloudflare, run protected external probes, place broker orders, merge `main`, or enable real-money execution without the exact later gate/approval contract.
