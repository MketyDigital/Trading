# Trading V1 Production Development Audit

## Purpose

This is the detailed continuation record for the development-to-production audit of draft PR #2 on `design/enterprise-trading-event-core`. It is the technical pickup document behind `AGENTS.md`.

It does **not** authorize Cloudflare mutation, deployment, external probes, broker demo orders, `main` merge, real-money execution, or Gate 10.

## Authority order

When documents conflict, use this precedence:

1. `AGENTS.md` + `docs/superpowers/plans/2026-09-03-production-v1-launch-master-plan.md`.
2. Latest approved Sept 3 technical specs/plans:
   - `docs/superpowers/specs/2026-09-03-production-execution-bridge-design.md`
   - `docs/superpowers/plans/2026-09-03-production-execution-bridge-implementation-plan.md`
   - `docs/superpowers/specs/2026-09-03-hot-path-isolation-and-resilience-design.md`
   - `docs/superpowers/plans/2026-09-03-hot-path-isolation-and-resilience.md`
   - `docs/superpowers/plans/2026-09-03-destination-retry-outbox.md`
3. Current acceptance/cutover runbooks:
   - `cloudflare-v2/docs/PRODUCTION_V1_ACCEPTANCE_READINESS.md`
   - `cloudflare-v2/docs/PRODUCTION_V1_CUTOVER_RUNBOOK.md`
   - `cloudflare-v2/docs/NON_LIVE_MULTI_SOURCE_ACCEPTANCE.md`
4. Sept 2 identity/source/TradingView documents where still referenced by the Sept 3 launch program.
5. Sept 1 foundation docs are historical context, not the definition of final production readiness.

Later Sept 3 cross-cutting resilience/cutover contracts control where they tighten an earlier component plan. Relevant chronology:

- execution bridge design: `d5075cc...` ~08:51 UTC;
- destination retry plan: `f124b5e8ad23fcb313da9a38627d520838a5d462` 09:50 UTC;
- hot-path resilience design: `1a01ae503f6d504e4d3d12747ea1f2b7139162af` 12:28 UTC;
- hot-path resilience plan: `cd35b5f8f13f603e3b2f2f68186fe0b365a3df53` 12:32 UTC;
- production cutover runbook: `119c603094f98a33fb4b401675ed38a34236c329` 14:15 UTC.

## Repository / verification baseline

- Repository: `MketyDigital/Trading`
- Branch: `design/enterprise-trading-event-core`
- Draft PR: #2 -> `main`
- Trusted pre-audit runtime/content tree: `89944d3b6aa4b03f6bb1a1107594e9acfa424fb3`
- Last exact trusted PR CI for that tree: run `33766769463` SUCCESS.
- Test evidence at that run: Node/trading-core 649/649, MT5 14/14, Container MTProto 11/11, external MTProto 22/22; Cloudflare inspect/probe/deploy/accept jobs skipped.
- Audit add/delete history advanced the branch with no runtime tree difference before the audit docs were added.
- Audit checkpoints already recorded:
  - `9a2b1e05437da8bfb7beacab190092eb5905b649`
  - `af53fe94bd985843eb47916564642449e94fd4c5`
  - `e5d83c663afc8e00bb8ba7441d831ac7f6fa0f7d`
- Matching AGENTS synchronizations already recorded:
  - `265684933aede9ffca230457bc9a02ad90f950cd`
  - `13dc1d4861c106a7c65bbdf2c60f3b2c91a3a9c0`
  - `c5f58123518d9dd03489b0437e422c97e1817366`

No current documentation-only audit head is to be called exact-head GREEN until an applicable workflow actually verifies it.

## Current development stage

`LATEST-APPROVED STATIC PRODUCTION AUDIT COMPLETE ENOUGH TO PLAN REMEDIATION / REMEDIATION REQUIRED BEFORE REMAINING REAL ACCEPTANCE`

The Sept 3 Production V1 Launch Master Plan remains controlling. General production still requires applicable real identity/source/demo-broker acceptance, end-to-end staging/failure soak, operations/rollback/security drills, shadow production, production-infrastructure demo, separate tiny-live approval, tiny-live acceptance, and controlled beta.

This PR is not at branch-finishing/merge stage.

## Audit method

For every prior GREEN claim:

1. read the latest approved requirement;
2. trace the actual HTTP, Queue, scheduled retry, persistence, coordinator and adapter call chain;
3. distinguish standalone helper/unit success from production composition;
4. identify exact root cause before proposing code;
5. production changes must use TDD RED first;
6. exact implementation head must receive ordinary PR CI GREEN before a GREEN claim;
7. protected Cloudflare/demo/live workflows remain skipped unless separately authorized;
8. synchronize this file and `AGENTS.md` after every meaningful verified batch.

---

# Confirmed audit findings

## F1 — Worker Trading access fuse is not structurally enforced on all broker-capable paths

**Status:** CONFIRMED STATIC SAFETY GAP.

- `v1_entry.fetch()` correctly protects externally reachable Trading business routes with `TRADING_ACCESS_ENABLED`.
- `v1_entry.queue()` runs source queue processing below that fetch guard.
- source queue runtime invokes `handleV1EventsRequest()` directly.
- `runV1ProductionExecutionStage()` checks `BROKER_EXECUTION_ENABLED` but not `TRADING_ACCESS_ENABLED`.
- scheduled destination recovery checks the broker fuse but not the Trading access fuse.

Impact: if broker execution were later enabled while Trading access was disabled, non-HTTP execution/recovery paths are not structurally denied by the Trading-access master fuse. Current deployed defaults remain fail-closed, so this is not evidence that live execution occurred.

## F2 — workspace entitlement is not a final broker-dispatch authority check

**Status:** CONFIRMED STATIC SAFETY GAP.

- admin authorization checks `trading_workspace_access.trading_access_enabled`.
- production broker execution loads exact trade account but does not re-query exact workspace entitlement immediately before dispatch.
- latest execution/resilience/cutover contracts require workspace entitlement revocation to win before dispatch.

## F3 — account active/execution/safety authority is loaded once per multi-action account plan

**Status:** CONFIRMED STATIC SAFETY GAP.

- coordinator loads the account before the action loop.
- multiple legs/actions then use the same loaded active/execution/safety state.
- a kill/execution-disable change after action N is not proven to block action N+1 immediately.

Required direction: current account authority must be reloaded/revalidated immediately before every broker action.

## F4 — source disablement is authenticated at ingest but not revalidated before broker dispatch/retry

**Status:** CONFIRMED STATIC SAFETY GAP.

- ingest loads an active source, verifies HMAC, and binds caller-independent server workspace/source identity.
- broker execution does not reload source state before dispatch.
- later resilience design explicitly identifies source disablement as a critical revocation.
- durable data can support a safe final check: `trading_events` records source/workspace identity and destination deliveries are designed to link to the trading event.

Do not reintroduce caller source/workspace hints as authority.

## F5 — successful broker delivery can remain durably unbound from Trade State after state-write failure

**Status:** CONFIRMED STATIC RECOVERY GAP.

- MT5/cTrader executor persists successful destination delivery and broker IDs before returning.
- coordinator then binds those IDs to the exact Trade State leg.
- if binding fails, coordinator reports `STATE_BIND_FAILED` but delivery remains `SUCCEEDED`.
- retry scanner only processes `RETRYABLE` rows.
- canonical source replay is a terminal duplicate.
- duplicate executor result is currently skipped by state binding.

Impact: real broker state can be safely deduplicated yet remain missing from the Position Group leg, preventing complete management/audit/recovery.

Required direction: repair Trade State from already-persisted successful delivery/broker truth. Never resend the broker order merely to repair state.

## F6 — legacy `trade_accounts` workspace FK reintroduces MKSaaS/Trading coupling

**Status:** CONFIRMED CHECKED-IN SCHEMA GAP; live constraint must later be verified read-only before migration.

Checked-in legacy schema defines:

`trade_accounts.workspace_id REFERENCES public.workspaces(id) ON DELETE CASCADE`.

But the approved shared-Zitadel/Trading architecture requires:

- Trading workspaces to be Trading-owned;
- Trading-only customers to require no MKSaaS DB profile/workspace;
- removal of one product’s access not to implicitly remove the other product’s data;
- `trading_workspace_access` deliberately has no FK to `public.workspaces`.

Migrations 0001–0011 add Trading execution columns/privileges but do not remove/repoint the legacy `trade_accounts` FK.

Impact:

- a Trading-only workspace cannot cleanly own a broker account without a corresponding legacy/shared workspace row under the checked-in constraint;
- `ON DELETE CASCADE` can couple deletion of a shared/MKSaaS workspace to deletion of Trading broker-account rows.

Before designing/applying an additive migration, inspect the real constraint read-only in an explicitly authorized environment. Do not mutate shared schema blindly.

## F7 — production risk-to-volume sizing is not based on broker-authoritative live economics

**Status:** CONFIRMED PRODUCTION SAFETY GAP.

Current production composition:

1. `handleV1EventsRequest()` requires `TRADING_V1_SIMULATION` planning before production execution.
2. `createV1SimulationDependencies()` supplies instrument/prices/exposure from static `TRADING_V1_SIMULATION_*` environment JSON and DB trade-account rows.
3. `buildExecutionPlan()` performs the actual risk-to-lots calculation from those planning inputs.
4. `runV1ProductionExecutionStage()` forwards the resulting planned actions/lots.
5. MT5/cTrader production adapters later load live broker catalog metadata but only translate/normalize already-computed lots.

The master launch plan requires risk-to-volume assertion against broker-reported metadata before broker send. The foundation risk contract requires balance/equity, broker tick economics, volume constraints, current exposure and daily loss.

Additional structural evidence:

- checked-in `trade_accounts` does not provide a complete broker-authoritative balance/equity/risk snapshot;
- `normalizeAccount()` expects `risk_percent` / `risk_amount` fields for risk modes, while checked-in schema exposes `lot_sizing_type` + `lot_value`; migrations do not add the expected risk fields;
- MT5 bridge symbol snapshots expose tick-value data, but current `fromMT5Symbols()` does not map tick value into the canonical live catalog used by production;
- cTrader live catalog currently normalizes symbol/volume metadata but does not provide a production loss-per-lot/profit-calculation authority to the risk engine.

Required direction: before any risk-increasing broker action, derive/verify permitted lots from current exact account state + live broker-authoritative symbol/economics/price data. Simulation/planning may remain useful for intent/audit, but cannot be the final monetary-risk authority.

## F8 — live platform volume normalization can silently increase planned volume

**Status:** CONFIRMED PRODUCTION SAFETY GAP.

The risk engine intentionally floors volume and rejects when the smallest broker-valid volume would exceed configured risk.

However live translation currently uses normalization helpers that round/clamp:

- MT5 `normalizeVolumeForMT5()` rounds to step and clamps to broker min/max;
- cTrader `normalizeVolumeForCTrader()` rounds protocol volume and clamps to min/max.

Existing tests explicitly expect MT5 `0.001` with broker minimum `0.01` to become `0.01`.

Impact: a planned/risk-sized amount can be increased by live translation. This can bypass the risk engine’s explicit “do not raise to broker minimum” safety rule.

Required direction: execution translation must fail closed when a risk-increasing volume is below live minimum, above maximum, or requires a step change that increases allowed risk. Safe downward normalization may be permitted only under an explicit deterministic rule.

## F9 — normal production execution drops `tradingEventId` before delivery persistence

**Status:** CONFIRMED DURABILITY/AUTHORITY GAP.

- execution coordinator receives `eventId`.
- `createProductionExecutionDependencies()` accepts `tradingEventId` and passes it to the destination-delivery store.
- `runV1ProductionExecutionStage()` currently constructs production dependencies with `{ env, supabase, workspaceId }` only; it does not pass `result.eventId` as `tradingEventId`.
- integration tests assert `eventId` reaches the coordinator but do not assert the dependency layer receives it.

Impact: normal production destination-delivery rows may persist `trading_event_id=null`, weakening event→source→delivery audit/recovery authority and making F4/F5 repair harder.

Required direction: propagate exact server-owned persisted event ID into the production dependency/delivery context and test it end-to-end.

## F10 — final dispatch-time account policy recheck does not receive reliable live risk/exposure inputs

**Status:** CONFIRMED PRODUCTION SAFETY GAP.

`evaluateAccountPolicy()` expects, for new risk:

- `totalLots`;
- `riskPercent`;
- `currentDailyPnlPercent`;
- `currentOpenRiskPercent`;
- symbol and safety policy.

Current final coordinator composition does not reliably provide those values:

- coordinator policy request passes `lots` rather than `totalLots`;
- its risk percent depends on `action.riskPercent` / plan risk fields, but normal planned open actions do not carry that field;
- execution stage forwards differently named optional fields (`dailyPnlPct`, `currentRiskUsd`, `openExposureLots`) that the coordinator does not consume;
- ordinary orchestrator READY output does not populate those final-policy fields anyway;
- planning exposure is currently static simulation configuration, not a fresh dispatch-time broker/account exposure snapshot.

Direct coordinator unit tests pass because fixtures manually provide `riskPercent` and `currentDailyPnlPercent`; that does not prove real production composition.

Impact: kill switch and some simple controls are rechecked, but max lots, max risk, daily-loss and open-risk limits are not reliably re-evaluated from fresh authoritative data immediately before broker send.

Required direction: final authority/risk loader must provide current policy inputs using canonical names and broker/server-authoritative state for each risk-increasing action.

---

# Integration incompletions

## I1 — runtime execution snapshot helper is unit-GREEN but not integrated in production

Latest resilience Task 5 requires bounded non-secret snapshot reuse while final safety authority remains fresh. `runtime_execution_snapshot.js` exists and has good isolated tests, but current production composition does not instantiate/use it.

Treat previous “Task 5 GREEN as a pure cache” as helper-level GREEN, not full latest-approved Task 5 completion.

## I2 — warm broker-context architecture is not fully composed

- MT5 persistent bridge process exists, but production dependency creation reloads bridge health/account/symbol metadata per action.
- cTrader production dispatch creates/authenticates/closes a runtime per action.
- later resilience design calls for warm sessions and bounded metadata reuse.

This is primarily performance/resilience work; safety authority must stay fresh and must not be cached away.

---

# Unresolved environment boundary

## U1 — MT5 metadata GET authentication/private-network boundary

**Status:** NOT YET CLASSIFIED AS A VULNERABILITY.

- POST `/v1/command` is HMAC-authenticated.
- bridge GET `/v1/account`, `/v1/symbols`, `/v1/tick` are unauthenticated.
- production/demo code consumes them via HTTPS `MT5_BRIDGE_URL`.
- bridge defaults to localhost, but repo docs do not prove whether the externally consumed HTTPS endpoint is guaranteed private behind a trusted tunnel/proxy/network boundary.

Before production, either:

1. prove/document/test private-only reachability in an authorized staging topology; or
2. add authenticated metadata requests.

Static remediation planning should choose the safer option without assuming an undocumented private network.

---

# Contracts re-confirmed during audit

- signed source ingest loads an active source, verifies HMAC, and overwrites caller workspace hints with server `source.workspace_id`;
- broker master fuse is a structural first guard inside `executeProductionPlan()`;
- exact account workspace/id/active/execution flags are checked on the row that coordinator loads;
- persistent destination idempotency and retry state are real durable execution authority;
- retry claims are bounded and optimistic-concurrency guarded;
- uncertain broker outcomes are not intended for blind retry;
- Trade State binding targets exact workspace shard/group/leg when it succeeds;
- cTrader live environment requires separate server-side live opt-in;
- Wrangler defaults keep all four launch controls false;
- no real external environment action was performed in this static audit.

---

# Root-cause consolidation / proposed remediation boundaries

The confirmed findings can be fixed without inventing caller authority or redesigning the entire platform.

### Boundary A — one final server-authoritative execution check

A focused final authority/risk loader should be keyed by server-owned:

`(workspaceId, tradingEventId, accountId)`

and immediately before **every** broker action resolve/revalidate:

- both Worker master fuses before dependency work where applicable;
- exact persisted event/workspace/source identity;
- source remains active and workspace-bound;
- workspace entitlement remains enabled;
- exact account remains active/execution-enabled;
- latest safety policy/kill switch;
- current broker/account risk state needed for daily/open-risk limits;
- current broker-authoritative symbol/risk/volume metadata for new risk.

Cached runtime snapshots may accelerate non-authoritative configuration only. They may never override this check.

### Boundary B — broker-authoritative risk materialization

For risk-increasing actions, planning intent should be materialized to final executable lots only after current broker/account metadata is available. Final live normalization must never raise risk above the permitted result.

### Boundary C — successful-delivery state-binding repair

Persist enough trusted group/leg/account/event context with the delivery to repair a missing Trade State execution binding from an already-successful delivery response. Repair must never resend a broker action.

### Boundary D — Trading-owned trade-account tenancy

Design an additive migration only after read-only live-schema confirmation. Trading broker accounts must no longer require or cascade from an MKSaaS workspace row.

### Boundary E — bounded warm context

After safety correctness is fixed, reuse non-secret broker metadata and bounded cTrader/MT5 execution context where safe. Final authority remains fresh.

---

# Current gate interpretation

Do not treat previous blanket “Static resilience Tasks 1–9 complete” wording as sufficient to advance into real Gates 4–9.

- Gate 1: historical GREEN.
- Gate 2: historical GREEN/exited; do not repeat without reason.
- Gate 3: deferred/fail-closed.
- Gates 4–7: static foundations/bridges remain useful but real acceptance still pending.
- Gates 8–9: static audit reopened; remediation required first.
- Gate 10: CLOSED / not started.

---

# Exact pickup point

1. Treat F1–F10, I1–I2 and U1 as the frozen current audit scope unless remediation TDD exposes a new directly related defect.
2. Write one focused Superpowers implementation plan for static production remediation before changing runtime code.
3. Prioritize safety/durability first:
   - dual-fuse/non-HTTP gating;
   - final source/workspace/account/safety/risk authority;
   - exact `tradingEventId` propagation;
   - fail-closed live volume/risk materialization;
   - successful-delivery Trade State repair;
   - Trading-owned trade-account tenancy migration contract.
4. Then integrate bounded runtime snapshots/warm broker context without weakening final authority.
5. Handle MT5 metadata GET boundary through authenticated metadata requests unless a separately authorized environment proves an equally strong private transport contract before that task is implemented.
6. Every production-code task: TDD RED -> verify intended failure -> minimal implementation -> focused GREEN -> ordinary full PR CI exact-head GREEN.
7. Keep Cloudflare/probe/demo/live exact-marker jobs skipped for static remediation.
8. Synchronize this document and `AGENTS.md` with exact heads/run IDs/test counts after every meaningful verified milestone.
9. Only after the static remediation audit is GREEN return to separately authorized real Gates 4–9.

## Safety state during static remediation

```text
TRADINGVIEW_DIRECT_INGRESS_ENABLED=false
TRADINGVIEW_CERT_PROBE_ENABLED=false
TRADING_ACCESS_ENABLED=false
BROKER_EXECUTION_ENABLED=false
```

Do not deploy, mutate Cloudflare, run protected external probes, place broker orders, merge `main`, or enable real-money execution without the exact later gate/approval contract.
