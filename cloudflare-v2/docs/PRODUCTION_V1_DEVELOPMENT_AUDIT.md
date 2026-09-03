# Trading V1 Production Development Audit

## Purpose

This document is the detailed continuation record for the development-to-production audit of draft PR #2 on `design/enterprise-trading-event-core`. It exists so a new session can resume from the latest approved architecture and verified evidence without treating older milestone language as the current production-ready definition.

This document does not authorize Cloudflare mutation, deployment, external probes, broker demo orders, `main` merge, real-money execution, or Gate 10.

## Authority order

Use the following precedence whenever documents appear to disagree:

1. `AGENTS.md` plus `docs/superpowers/plans/2026-09-03-production-v1-launch-master-plan.md` for current operational/launch truth.
2. Latest approved Sept 3 technical specs/plans, especially:
   - `docs/superpowers/specs/2026-09-03-production-execution-bridge-design.md`
   - `docs/superpowers/plans/2026-09-03-production-execution-bridge-implementation-plan.md`
   - `docs/superpowers/specs/2026-09-03-hot-path-isolation-and-resilience-design.md`
   - `docs/superpowers/plans/2026-09-03-hot-path-isolation-and-resilience.md`
   - `docs/superpowers/plans/2026-09-03-destination-retry-outbox.md`
3. Current production acceptance/cutover runbooks:
   - `cloudflare-v2/docs/PRODUCTION_V1_ACCEPTANCE_READINESS.md`
   - `cloudflare-v2/docs/PRODUCTION_V1_CUTOVER_RUNBOOK.md`
   - `cloudflare-v2/docs/NON_LIVE_MULTI_SOURCE_ACCEPTANCE.md`
4. Sept 2 identity/source/TradingView documents only where still referenced by the Sept 3 launch program.
5. Sept 1 foundation documents are historical context and do not define final production readiness.

## Repository state at audit restart

- Repository: `MketyDigital/Trading`
- Branch: `design/enterprise-trading-event-core`
- Draft PR: #2 -> `main`
- Previously trusted content tree: `89944d3b6aa4b03f6bb1a1107594e9acfa424fb3`
- Audit add/remove history advanced the branch to `44a524bd9a61c35f5e0e4d0c8a2287b6db2e952f` with zero file differences versus `89944d3...` before this document was added.
- Last verified PR CI on the trusted tree: run `33766769463` SUCCESS; Node/trading-core 649/649, MT5 14/14, Container MTProto 11/11, external MTProto 22/22; Cloudflare inspect/probe/deploy/accept jobs skipped.
- PR remains draft; no merge or live activation is authorized.

## Latest master-plan production definition

The Sept 3 Production V1 Launch Master Plan remains controlling. Production-ready/general launch still requires real evidence for applicable gates including real identity/source/demo-broker acceptance, end-to-end staging/failure soak, operations/rollback/security drills, shadow production, production-infrastructure demo, separate tiny-live approval, tiny-live acceptance, and controlled beta.

Therefore this branch is still under development toward real production. It is not at branch-finishing/merge stage.

## Root-cause audit method

For each claimed GREEN contract:

1. read the latest approved requirement;
2. trace the real runtime call chain, including HTTP, Queue, scheduled retry, database authority, coordinator and broker dependencies;
3. distinguish a standalone helper/test from actual production composition;
4. identify the exact missing boundary before proposing a fix;
5. use TDD RED before production-code modification;
6. verify exact implementation head through ordinary PR CI;
7. keep protected Cloudflare/demo/live workflows skipped unless separately authorized;
8. synchronize this document and `AGENTS.md` after each verified batch.

## Confirmed audit findings — checkpoint 1

### F1 — Worker Trading access fuse is not structurally enforced on all broker-capable paths

Latest approved execution design requires both Worker fuses before a broker adapter can be reached and states that `TRADING_ACCESS_ENABLED=false` makes broker execution impossible regardless of account configuration.

Current runtime trace:

- `v1_entry.fetch()` correctly blocks externally reachable `/api/v1/events`, `/api/v1/admin/*`, and TradingView webhook routes when `TRADING_ACCESS_ENABLED=false`.
- `v1_entry.queue()` delegates directly to `createSourceQueueRuntime()`.
- `createSourceQueueRuntime()` calls `handleV1EventsRequest()` directly.
- `runV1ProductionExecutionStage()` checks `BROKER_EXECUTION_ENABLED` but does not check `TRADING_ACCESS_ENABLED`.
- scheduled destination retry checks the broker fuse but not the Trading access fuse.

Impact: with broker fuse true while Trading access is false, a non-HTTP Queue/retry path is not structurally denied by the Trading access fuse. Deployment defaults currently keep both false, so this is a static contract gap, not evidence that live execution occurred.

Status: CONFIRMED STATIC GAP. No fix applied yet.

### F2 — Exact workspace entitlement is not revalidated in the production broker execution path

Latest approved execution lock #4 requires `trading_workspace_access.trading_access_enabled=true` for the exact workspace. The cutover runbook also requires final account/workspace/safety state to be revalidated server-side immediately before broker dispatch.

Current runtime trace:

- signed source ingest loads an active source and correctly overwrites caller workspace hints with `source.workspace_id`;
- `createProductionExecutionDependencies().accountLoader()` queries `trade_accounts` by exact workspace/account;
- the production dependency/coordinator path inspected so far does not query `trading_workspace_access.trading_access_enabled` before broker dispatch;
- workspace entitlement is enforced on the admin authorization path, but that is not the live source-to-broker path.

Impact: a workspace entitlement revocation is not yet proven to be an execution lock immediately before dispatch.

Status: CONFIRMED STATIC GAP. No fix applied yet.

### F3 — Mutable account safety/kill authority is loaded once per multi-action account plan, not immediately before every broker action

Latest resilience architecture requires critical safety revocation to override cached/previous state immediately or force authoritative revalidation before dispatch. The cutover runbook requires final account/workspace/safety revalidation immediately before broker dispatch.

Current coordinator trace:

- `runAccountPlan()` calls `accountLoader()` once before iterating `plan.actions`;
- active/execution-enabled/safety policy are derived from that one loaded row;
- all actions in that account plan then use the same account/safety snapshot.

Impact: in a multi-leg/multi-action plan, an account disable/execution-disable/kill switch changed after action N is not proven to stop action N+1 immediately.

Status: CONFIRMED STATIC GAP. No fix applied yet.

## Confirmed integration incompletions — checkpoint 1

### I1 — Runtime execution snapshot helper exists but is not integrated into production execution composition

The latest approved resilience Task 5 requires a versioned runtime execution snapshot to reduce repeated non-critical configuration hydration while retaining fresh final safety authority.

Current state:

- `runtime_execution_snapshot.js` exists and has strong isolated tests for scope, TTL/version, bounds, secret stripping, invalidation and immutability;
- production execution composition inspected so far does not instantiate/use this cache;
- existing failure-injection test proves a stale standalone cache cannot override a separately fresh account load, but does not prove production cache integration.

Status: IMPLEMENTATION HELPER GREEN / APPROVED TASK INTEGRATION INCOMPLETE.

### I2 — Approved warm broker-context performance architecture is not yet fully composed

The latest resilience design calls for warm broker adapters/sessions and bounded metadata reuse.

Current state:

- MT5 uses a persistent external bridge process, but production dispatch reloads bridge health/account/symbol metadata for each action;
- cTrader production dispatch creates/authenticates a runtime and closes it for each action;
- therefore warm session/metadata reuse required by the latest performance architecture is not yet demonstrated in production composition.

Status: PERFORMANCE/RESILIENCE INTEGRATION INCOMPLETE; not yet classified as a safety defect.

## Important contracts already confirmed during this audit

- Authenticated source authority is server-owned: ingest loads active source, verifies HMAC, and rebinds `workspace_hint` to `source.workspace_id`; caller workspace hints do not become authority.
- Broker master fuse remains a first structural guard inside `executeProductionPlan()` before account loader/dispatch/state/latency work.
- Exact account workspace/id matching, active state and `execution_enabled` are checked by the coordinator on its loaded account record.
- Persistent destination idempotency/retry state remains the broker execution ledger; uncertain outcomes are not intended for blind retry.
- cTrader live runtime still requires separate server-side live opt-in.
- default Wrangler profiles keep all four launch controls false.
- no real external environment action has been performed during this audit.

## Current gate interpretation

Do not treat the previous broad statement “Static resilience Tasks 1–9 are complete” as sufficient to advance into real Gates 4–9 until the confirmed static gaps above are resolved and exact-head verified.

Gate 2 remains historically GREEN/exited and does not need repeating solely because of this audit. Gate 3 remains deferred/fail-closed. Gate 10 remains CLOSED.

The active development stage is now:

`LATEST-APPROVED STATIC PRODUCTION AUDIT / REMEDIATION REQUIRED BEFORE REMAINING REAL ACCEPTANCE`

## Exact pickup point

Resume in this order:

1. Finish tracing all execution locks and retry paths against the Sept 3 execution/resilience specs to ensure F1–F3 are complete root causes and discover any sibling gaps before writing code.
2. Review MT5 metadata transport boundary and cTrader/MT5 warm-context behavior against the latest resilience design.
3. Write one focused remediation implementation plan based only on confirmed latest-approved gaps.
4. Implement safety gaps one at a time with TDD RED -> minimal GREEN -> exact-head PR CI.
5. Then implement/verify the approved snapshot/warm-context integration without weakening final authority.
6. Re-audit the complete execution call graph and failure-injection matrix.
7. Synchronize this document and `AGENTS.md` with exact RED/GREEN heads/run IDs/test counts.
8. Only after static audit/remediation is GREEN return to separately authorized real Gates 4–9.

## Safety state while audit/remediation is active

Keep:

```text
TRADINGVIEW_DIRECT_INGRESS_ENABLED=false
TRADINGVIEW_CERT_PROBE_ENABLED=false
TRADING_ACCESS_ENABLED=false
BROKER_EXECUTION_ENABLED=false
```

Do not deploy, mutate Cloudflare, run protected external probes, place broker orders, merge `main`, or enable real-money execution without the exact later gate/approval contract.
