# Production Execution Bridge Design

## Status
Approved architecture for production-completion work on `design/enterprise-trading-event-core`.

## Problem
Mkety Trading already has mature source ingestion, deterministic/AI-bounded interpretation, durable canonical event idempotency, trade-state correlation, account policy/risk planning, MT5/cTrader platform translation, persistent destination idempotency, and demo-tested broker adapters. The main `/api/v1/events` production path is intentionally simulation-only and accepts no broker executor dependency. In addition, `TRADING_ACCESS_ENABLED` is pinned false in deployed profiles but is not yet a Worker-wide runtime fuse across the V1 application surface.

The production V1 launch therefore needs an explicit, fail-closed execution bridge rather than an implicit extension of simulation.

## Goals
1. Make `TRADING_ACCESS_ENABLED` a real Worker-wide activation fuse for authenticated Trading application APIs while keeping health and internal infrastructure diagnostics available as required.
2. Preserve the existing simulation pipeline unchanged as the planning/audit authority.
3. Add a separate execution coordinator that can consume only already-validated planned actions.
4. Require every execution lock before any broker adapter can be reached.
5. Reuse existing MT5/cTrader executors and persistent destination idempotency.
6. Record successful broker identifiers back into durable Trade State.
7. Isolate failures per account/destination; one failure must not roll back successful siblings.
8. Keep both Worker master fuses unavailable to tenant/admin mutation APIs.
9. Keep production and staging broker execution disabled until the explicit later launch gate.

## Non-goals
- No enabling `BROKER_EXECUTION_ENABLED` in this implementation batch.
- No live broker credentials.
- No real-money orders.
- No weakening TradingView certificate trust.
- No merging `main`.
- No redesign of existing source adapters, parsing, risk math, Position Groups, MT5 bridge protocol, or cTrader protocol semantics.

## Execution locks
A broker adapter may be reached only when all applicable locks pass:

1. Worker `TRADING_ACCESS_ENABLED=true`.
2. Worker `BROKER_EXECUTION_ENABLED=true`.
3. Authenticated source is active and workspace-authoritative.
4. `trading_workspace_access.trading_access_enabled=true` for the exact workspace.
5. Exact destination/account belongs to the authenticated workspace and is active.
6. `trade_accounts.execution_enabled=true`.
7. Account safety policy allows the requested action.
8. Account kill switch is not blocking the action.
9. Destination/platform configuration is complete and server-side only.
10. Persistent destination delivery idempotency reservation succeeds before broker dispatch.
11. For TradingView-originated events, direct-ingress runtime fuse, active TradingView source, and certificate-fingerprint trust must already have passed at ingress.

Failure of any lock returns a fail-closed non-executing result. No caller-controlled field can substitute for a failed lock.

## Architecture

### 1. Worker access fuse
Add one shared runtime guard for the externally authenticated V1 Trading application surface. When `TRADING_ACCESS_ENABLED` is false, business APIs return a deterministic fail-closed response before database membership/source/execution work. Health remains readable and internal infrastructure routes retain their existing independent service-token controls so operators can diagnose and prepare staging while user access is disabled.

### 2. Simulation remains authoritative planning
`handleV1EventsRequest` continues to authenticate source HMAC, reserve canonical Trading Event identity, interpret, and optionally create simulation plans. `orchestrateTradingEventSimulation` remains executor-free. It is not converted into a live orchestrator.

### 3. Separate execution coordinator
Introduce a focused execution coordinator that receives trusted server-side inputs only:
- exact workspace ID;
- canonical event/event ID;
- previously validated account plan/action set;
- server-loaded account/destination records;
- global runtime fuses;
- persistent destination store;
- platform executor dependencies.

The coordinator returns per-account/per-destination outcomes. It cannot accept arbitrary broker credentials from the event body and cannot enable a master fuse.

### 4. Destination dispatch
Reuse the existing fanout isolation contract and existing MT5/cTrader executors. Each action must carry persistent idempotency keys. Platform adapters remain responsible for broker-specific translation and execution semantics.

### 5. Durable state update
After a successful open action, bind broker position/order/deal identifiers and actual fill information back to the exact Position Group leg through the existing Trade State internal API. Management actions operate only against exact previously bound identifiers or canonical planned state where appropriate.

### 6. Failure isolation
Each destination action produces `SUCCEEDED`, `FAILED`, `REJECTED`, `BLOCKED`, or `DUPLICATE`. A failed account/destination never cancels or replays successful siblings. Retries use the existing destination idempotency record rather than rebuilding an event.

## Runtime modes

### Access disabled
`TRADING_ACCESS_ENABLED=false`
- authenticated Trading business/admin APIs fail closed;
- broker execution is impossible regardless of account configuration;
- health/internal operational diagnostics remain available under their existing controls.

### Access enabled, broker disabled
`TRADING_ACCESS_ENABLED=true`
`BROKER_EXECUTION_ENABLED=false`
- identity/admin/source/event functionality may operate;
- event planning/simulation may operate;
- execution coordinator returns explicit broker-disabled outcomes;
- no MT5/cTrader broker adapter is called.

### Broker enabled
`TRADING_ACCESS_ENABLED=true`
`BROKER_EXECUTION_ENABLED=true`
- still requires every workspace/source/account/safety/destination/idempotency lock;
- first production use is prohibited until Gate 10 and separate explicit user approval.

## Admin/control policy
Tenant owner/admin may control existing workspace-scoped account `execution_enabled` and account kill switch state. No Trading role receives permission to mutate `TRADING_ACCESS_ENABLED` or `BROKER_EXECUTION_ENABLED`; those remain deployment/ops-level master fuses.

## Staged implementation

### Phase A — global access fuse
Make `TRADING_ACCESS_ENABLED` an actual runtime guard with exact tests proving disabled access stops before membership/source/account work while health/internal routes retain required availability.

### Phase B — hard-disabled execution boundary
Add the execution coordinator interface and tests proving `BROKER_EXECUTION_ENABLED=false` prevents all executor/store mutation calls. Wire it only behind trusted server-side planning outputs without enabling deployment configuration.

### Phase C — broker-disabled end-to-end staging
Prove event -> plan -> destination selection -> execution coordinator reaches `BROKER_EXECUTION_DISABLED`, with zero broker adapter calls and durable state unchanged except permitted planning/audit state.

### Phase D — demo adapter acceptance
Use existing Gate 7 exact-marker demo lifecycle bridges to validate MT5 and cTrader broker adapters with demo credentials and persistent idempotency only. This phase does not alter production master fuses.

### Phase E — production cutover
Only after all mandatory gates are GREEN and the user separately approves Gate 10: deploy reviewed exact head and deliberately change the production broker master fuse. Tiny controlled scope, kill-switch ready, with rollback evidence.

## Safety invariants
- `BROKER_EXECUTION_ENABLED=false` must make broker adapter invocation structurally impossible.
- `TRADING_ACCESS_ENABLED=false` must make externally authenticated Trading application access structurally unavailable.
- account `execution_enabled=true` alone never authorizes broker execution.
- owner/admin permissions never include master-fuse mutation.
- unknown roles, missing membership, workspace mismatch, inactive source/account/destination, missing broker metadata, or idempotency-store failure all fail closed.
- no secrets appear in event payloads, API responses, logs, commits, or test fixtures.
- cTrader raw `ProtoOASymbol.lotSize` protocol-cent semantics remain unchanged.
- no implementation phase enables TradingView direct ingress.

## Acceptance criteria
The architecture is ready for later cutover when tests and staged evidence prove:
1. access fuse denial happens before tenant business work;
2. broker fuse denial happens before any executor or delivery reservation;
3. exact workspace/account isolation for execution planning and dispatch;
4. account execution flag and kill switch are enforced server-side;
5. persistent destination idempotency prevents duplicate broker actions;
6. successful broker IDs bind to exact Position Group legs in demo acceptance;
7. sibling destination failure isolation;
8. no admin endpoint can mutate master fuses;
9. all default deployment profiles retain both master fuses false until explicit later launch approval.
