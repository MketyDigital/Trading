# Trading V1 Production Cutover and Rollback Runbook

This runbook defines the operational contract for moving Mkety Trading from verified static/staging foundations toward production. It does **not** authorize a deployment, a live probe, broker execution, a `main` merge, or real-money trading.

The authoritative launch plan remains:

`docs/superpowers/plans/2026-09-03-production-v1-launch-master-plan.md`

The operational source of truth remains:

`AGENTS.md`

## Hard hot-path rules

These rules are invariant through staging, shadow production, demo execution, tiny-live acceptance, beta, and general launch:

1. Clear machine-readable trading instructions are deterministic. AI is never required for clear execution.
2. Ambiguous execution may use bounded AI interpretation, but AI failure, timeout, provider circuit-open, or invalid output must degrade to `NEEDS_REVIEW`; it must never guess an executable instruction.
3. Telegram AI is presentation-only. Deterministic canonical trade semantics remain authoritative and Telegram AI/network failure is destination-local.
4. Audit, analytics, readiness metrics, reporting, notifications, historical queries, admin UI, and destination AI are not synchronous broker-dispatch dependencies.
5. Persistent canonical-event and destination/order idempotency remain mandatory. If persistent idempotency authority is unavailable, broker dispatch fails closed.
6. Final account/workspace/safety state is revalidated server-side immediately before broker dispatch. Runtime snapshots are non-authoritative optimizations only.
7. Broker/platform metadata is authoritative for symbol, precision, volume, account mode, order semantics, and execution economics.
8. An uncertain broker outcome is reconciled; it is never blindly retried as though the first send definitely failed.
9. Caller-supplied workspace, account, provider, credential, destination, broker, role, or execution hints are never authority.
10. Tenant isolation remains exact across workspace, source, event, provider, account, destination, retry, idempotency, health, metrics, and credentials.
11. Telemetry and circuit-breaker internal failures may not block otherwise-correct deterministic work. Mandatory safety/idempotency failures remain fail-closed.
12. No operational/admin action may implicitly enable a Worker-wide master execution fuse.

## Default safety state

Unless a separately authorized acceptance phase explicitly requires otherwise, keep all four master controls OFF:

```text
TRADINGVIEW_DIRECT_INGRESS_ENABLED=false
TRADINGVIEW_CERT_PROBE_ENABLED=false
TRADING_ACCESS_ENABLED=false
BROKER_EXECUTION_ENABLED=false
```

Real-money execution is additionally forbidden until Gate 10 Phase C and a separate explicit user approval. Approval of this runbook, the launch plan, a PR, CI, staging, shadow production, or demo execution is **not** tiny-live approval.

## Pre-cutover evidence package

Before any production-infrastructure phase, record in `AGENTS.md`:

- exact candidate commit SHA;
- exact mandatory CI run and test counts;
- migration ledger status and whether any migration is pending;
- exact deployed Worker/version only after a separately authorized deployment;
- prior known-good Worker/version for rollback;
- state of the four master controls;
- enabled production source/provider families;
- enabled broker destination families and whether they are simulation/demo/live;
- unresolved acceptance blockers;
- exact next safe action.

Never record secret values, Telegram sessions, bearer tokens, HMAC keys, database service keys, broker credentials, private keys, AI keys, or encrypted payload material.

## Secret-free readiness signals

Operators must be able to observe these classes of signal before live money is introduced:

- Worker/runtime errors and restart/crash patterns;
- Queue backlog and DLQ depth;
- source/provider health and reconnect/replay activity;
- event processing latency and source-to-broker-send latency;
- broker round-trip latency and broker connectivity;
- source-to-destination-ack latency;
- canonical duplicate rate;
- destination retry/failure rate;
- uncertain broker outcome rate;
- broker rejection/failure rate;
- ambiguity-AI `NEEDS_REVIEW` count/rate;
- destination-AI deterministic-fallback count/rate;
- database/configuration failures;
- Zitadel authorization failures;
- risk-block events and kill-switch activations;
- Container instance/usage behavior where the Paid Container provider is enabled.

The admin operations resilience summary is read-only and non-authoritative. Metrics-source failure must be reported as unavailable and must never affect trading execution.

### Readiness threshold rule

Do not invent universal numeric thresholds in code or this runbook. Before a real acceptance window, the operator must record the reviewed threshold/window for each metric that will gate that phase. A threshold breach, unexplained regression, or missing mandatory metric blocks advancement until explained and accepted or fixed through a new RED/GREEN batch.

## Kill and rollback hierarchy

Use the narrowest control that safely contains the incident, but escalate immediately when scope is uncertain.

### Level 1 — destination/source local isolation

Use when one source/provider/destination is unhealthy and tenant/sibling isolation is proven healthy:

- disable the affected source or destination;
- preserve healthy siblings;
- do not reset persistent event/order idempotency to force a retry;
- reconcile uncertain broker/destination outcomes before re-enabling.

### Level 2 — account execution kill

Use when one broker account is unsafe, stale, misconfigured, disconnected, or producing unexplained outcomes:

- activate the account kill switch or disable account execution;
- leave Worker master broker fuse unchanged if other accounts are demonstrably safe;
- reconcile broker truth and persistent Trade State before re-enabling.

### Level 3 — workspace/product access isolation

Use when authorization, workspace configuration, or tenant-local execution safety is uncertain:

- disable the affected workspace entitlement/source/account controls;
- for a product-wide access concern, set `TRADING_ACCESS_ENABLED=false`;
- preserve health/internal diagnostic endpoints needed for recovery where the existing fail-closed model permits them.

### Level 4 — global broker execution stop

Use immediately for any possible systemic execution-safety issue, including sizing mismatch, duplicate orders, cross-tenant leakage, kill-control failure, unexplained broker state across accounts, or unsafe retry behavior:

```text
BROKER_EXECUTION_ENABLED=false
```

Do not re-enable until the root cause is understood, affected broker state is reconciled, exact-head regression is GREEN, and the applicable acceptance gate is re-run.

### TradingView ingress containment

For TradingView transport/certificate uncertainty:

```text
TRADINGVIEW_DIRECT_INGRESS_ENABLED=false
TRADINGVIEW_CERT_PROBE_ENABLED=false
```

Never weaken to caller headers, URL/body secrets, subject/CN/SAN matching, or IP-only authentication.

## Deployment rollback procedure

A deployment/rollback drill must be performed in staging before Gate 9 can be externally GREEN.

1. Record candidate SHA, candidate Worker version, prior known-good Worker version, and migration ledger state.
2. Keep broker execution OFF during the rollback drill.
3. Run post-deploy secret-free smoke checks: health, bindings/capability presence, queue path, persistent duplicate behavior, simulation/non-broker destination, and expected master-fuse states.
4. If a stop condition occurs, restore the recorded prior known-good Worker version using the approved Cloudflare rollback/deployment mechanism for that environment.
5. Re-run the same smoke checks after rollback.
6. Verify no schema rollback is attempted blindly. Database migrations are independently reviewed for forward/backward compatibility and ledger state.
7. Record only non-secret evidence in `AGENTS.md` and the staging acceptance record.

Never improvise a production rollback target. The exact prior known-good version must be recorded before changing the environment.

## Recovery authority after restart/replay

After Worker, Queue, Durable Object, Telegram runtime, database, or broker reconnect/restart:

- Supabase/persistent stores remain authority for canonical event and destination/order idempotency where designed;
- durable Trade State remains authority for correlated trade/Position Group state where designed;
- broker-reported account/order/position state remains authority for actual broker execution state;
- source-native identity remains authority for replay convergence;
- in-memory runtime snapshot caches and provider circuit breakers are disposable, non-authoritative runtime aids;
- metrics/readiness summaries are observational only;
- replay must converge on the existing persistent identity rather than create a second orchestration;
- uncertain broker state must be reconciled before a new send is permitted.

## Staged rollout contract

### Phase A — shadow production

Broker execution remains OFF. Real production source/identity/infrastructure traffic may only be observed after the preceding real acceptance gates are satisfied and the deployment is separately authorized.

Required evidence:

- intended canonical actions compared against known/manual expectations;
- persistent duplicate/replay behavior;
- source/provider isolation;
- authorization/tenant isolation;
- latency/failure metrics across an accepted observation window;
- no unresolved safety/isolation discrepancy.

### Phase B — production infrastructure with dedicated demo broker

Only explicit demo accounts are allowed. Repeat broker-authoritative risk, volume, order lifecycle, management, idempotency, restart/replay, failure isolation, kill and rollback cases under production infrastructure.

Success in Phase B does not authorize live trading.

### Phase C — tiny controlled live

This phase is CLOSED until the user gives a separate explicit live-cutover approval after all mandatory prior gates are GREEN.

Before enabling exactly one reviewed live account, record owner-approved limits for:

- maximum per-trade risk;
- maximum volume;
- maximum concurrent positions/open risk;
- daily loss ceiling;
- allowed symbols;
- account/workspace/global kill contacts and procedure.

No default or invented financial threshold is acceptable.

### Phase D — controlled beta

Only after tiny-live acceptance, add a very small explicitly reviewed cohort. Monitor broker-specific failures, latency, duplicate/retry behavior, source health, support burden, and kill/rollback readiness.

### Phase E — general production

General launch requires recorded beta evidence and no unresolved severity-1/2 trading-safety issue. Update `AGENTS.md` with exact production SHA, deployed version, enabled providers/destinations, current fuse state, monitoring/rollback references, and remaining backlog.

## Immediate stop conditions

Stop advancement and contain execution if any of these occurs:

- duplicate broker order or unexplained duplicate orchestration;
- broker volume/sizing/precision mismatch;
- broker state cannot be reconciled after an uncertain outcome;
- account/workspace/global kill control does not behave as documented;
- authorization bypass or cross-tenant data/state leakage;
- caller-supplied authority affects workspace/provider/account/broker selection;
- persistent idempotency authority is unavailable or inconsistent;
- source replay produces a second canonical execution;
- AI output alters canonical execution semantics or ambiguity is guessed executable;
- one optional dependency failure blocks unrelated deterministic broker work;
- secret/token/session/credential material appears in logs, metrics, health, API output, or committed artifacts;
- rollback target or migration state is unknown;
- a mandatory readiness signal is unavailable during a phase that requires it;
- sustained staging/shadow evidence shows an unexplained safety, isolation, retry, or latency regression.

## Gate status rule

Static CI and static failure-injection evidence can prove implementation contracts, but they do not substitute for real acceptance. Gate 9 remains externally pending until the monitoring, kill-control, rollback, recovery, security, and sustained staging drills required by the master plan are executed in the authorized environment and recorded.

Gate 10 remains closed until all applicable mandatory gates are GREEN and separate explicit tiny-live approval is received.
