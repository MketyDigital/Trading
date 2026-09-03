# Trading V1 External Acceptance Readiness Matrix

This document is an operator-facing readiness map for the remaining real/non-live acceptance work in Production V1. It consolidates the existing launch plan, acceptance runbooks, protected workflows, and operational safety rules so an operator can see exactly what may be run, what must remain OFF, what evidence to capture, and how to exit each gate safely.

This document does **not** authorize a deployment, Cloudflare mutation, real probe, broker order, `main` merge, or real-money execution.

Authoritative references:

- `AGENTS.md`
- `docs/superpowers/plans/2026-09-03-production-v1-launch-master-plan.md`
- `cloudflare-v2/docs/NON_LIVE_MULTI_SOURCE_ACCEPTANCE.md`
- `cloudflare-v2/docs/PRODUCTION_V1_CUTOVER_RUNBOOK.md`

## Global rules before any real acceptance gate

1. Obtain separate authorization for the exact gate being executed.
2. Record the exact candidate commit SHA in `AGENTS.md` before environment work begins.
3. Confirm the protected environment/credentials required by that gate exist without exposing their values.
4. Keep the four Worker master controls OFF unless that exact gate's reviewed procedure explicitly requires a temporary exception:

```text
TRADINGVIEW_DIRECT_INGRESS_ENABLED=false
TRADINGVIEW_CERT_PROBE_ENABLED=false
TRADING_ACCESS_ENABLED=false
BROKER_EXECUTION_ENABLED=false
```

5. Never treat a successful static CI run as a substitute for real acceptance.
6. Never record secrets, sessions, tokens, private keys, API keys, service-role keys, broker credentials, or decrypted credential material in commits, logs, screenshots, acceptance notes, or `AGENTS.md`.
7. Record exact run/job identifiers and a secret-free result summary after each real acceptance milestone.
8. Return temporary test controls to their documented fail-closed state before declaring the gate exited.
9. Reconcile all broker/demo state before leaving a broker lifecycle gate. Do not leave unexplained open orders or positions.
10. Gate 10 remains CLOSED until all applicable mandatory gates are GREEN or an explicit reviewed scope removal is recorded, followed by separate explicit tiny-live approval.

---

## Gate 3 — TradingView certificate/direct ingress

**Current status:** DEFERRED / FAIL-CLOSED. Static production path is GREEN; genuine TradingView-originated acceptance is unavailable while a paid TradingView webhook tier is not available.

**Do not run now.**

### Required prerequisites before this gate may resume

- TradingView webhook capability that can originate the real request path.
- Reviewed certificate/mTLS acceptance setup matching the existing exact SHA-256 fingerprint trust model.
- Separate authorization for the TradingView acceptance gate.
- Known-good Worker version recorded for rollback if environment mutation is required.

### Safety requirements

- `BROKER_EXECUTION_ENABLED=false` throughout.
- `TRADING_ACCESS_ENABLED=false` unless the exact reviewed acceptance procedure requires otherwise.
- Direct ingress and certificate probe may only be enabled for the bounded acceptance window described by the approved gate procedure.
- Never weaken authentication to headers, URL/body secrets, CN/SAN/subject matching, or IP-only trust.

### Required evidence

- genuine TradingView-originated request accepted only with the expected Cloudflare TLS client-auth metadata;
- invalid/missing certificate path rejected;
- spoofed caller certificate headers ignored;
- duplicate canonical event convergence remains persistent;
- no broker execution occurs.

### Mandatory exit state

```text
TRADINGVIEW_DIRECT_INGRESS_ENABLED=false
TRADINGVIEW_CERT_PROBE_ENABLED=false
BROKER_EXECUTION_ENABLED=false
```

Record the exact run/probe/deployment evidence and rollback/version state in `AGENTS.md`.

---

## Gate 4 — Managed Zitadel real non-live identity acceptance

**Current status:** STATIC GREEN / real acceptance pending.

**Execution type:** manual, real identity acceptance only; no broker execution.

### Prerequisites

- configured Trading Zitadel project/application in the managed identity environment;
- real non-live test identities/memberships sufficient to exercise allowed and denied roles;
- configured callback/logout/session behavior for the Trading app;
- staging Trading application/environment reachable under the separately authorized gate procedure;
- separate authorization for Gate 4.

### Required checks

- login succeeds for a valid Trading user;
- logout terminates the expected application session;
- session expiry/refresh behavior is correct;
- callback/audience mismatch fails closed;
- exact `(workspace_id, zitadel_subject)` membership is enforced;
- owner/admin/operator/viewer behavior matches the Trading authorization policy;
- unknown role and non-member access fail closed;
- Trading authorization does not fall back to MKSaaS workspace/membership data;
- Trading and MKSaaS remain distinct Zitadel projects/apps and product databases.

### Safety requirements

```text
BROKER_EXECUTION_ENABLED=false
TRADINGVIEW_DIRECT_INGRESS_ENABLED=false
TRADINGVIEW_CERT_PROBE_ENABLED=false
```

Do not enable broker execution as part of identity acceptance.

### Required evidence

Record only secret-free evidence:

- candidate SHA;
- environment/gate name;
- accepted/denied identity scenarios;
- role/membership results;
- callback/audience negative-test result;
- confirmation of no MKSaaS authorization fallback;
- CI/run identifiers associated with the candidate where applicable.

### Block/rollback conditions

Stop Gate 4 if any user can cross workspace/product boundaries, if audience/callback validation is ambiguous, or if MKSaaS identity data becomes an authorization fallback. Restore the prior known-good app/configuration state according to the authorized environment procedure before further testing.

---

## Gate 5 — Telegram real runtime soak

**Current status:** STATIC GREEN / real account/channel soak pending.

**Execution type:** protected real Telegram connectivity soak, non-broker.

### Prerequisites

- protected staging Telegram credentials/session material configured outside the repository;
- scoped real test account/channel/source identifiers;
- staging source/provider configuration for only the intended soak scope;
- separate authorization for Gate 5.

The existing static soak harness is `npm run soak:mtproto:container` with `tests/mtproto_container_soak.test.mjs`; real acceptance must exercise the actual protected Telegram runtime rather than merely rerun the static harness.

### Required checks

- initial connection and health;
- reconnect/backoff stability;
- catch-up after a bounded disconnect;
- source-native replay/duplicate convergence;
- no duplicate downstream canonical orchestration;
- provider/source isolation under reconnect/replay;
- secret/session material absent from logs and summaries;
- observed source latency recorded for operational tuning;
- no broker execution command/path exercised.

### Safety requirements

```text
BROKER_EXECUTION_ENABLED=false
TRADINGVIEW_DIRECT_INGRESS_ENABLED=false
TRADINGVIEW_CERT_PROBE_ENABLED=false
```

`TRADING_ACCESS_ENABLED` should remain false unless the exact accepted soak path requires the external product API. Prefer the narrowest internal/provider path that proves the runtime behavior.

### Required evidence

- candidate SHA;
- soak window start/end;
- reconnect/recovery observations;
- replay/duplicate convergence result;
- non-secret latency summary;
- confirmation that no broker execution occurred;
- confirmation that logs/summaries were secret-free.

### Mandatory exit state

Disable any temporary test source/provider rows that are not intended to remain active and confirm the Worker broker fuse remains OFF.

---

## Gate 6 — MT5/cTrader real demo source probes

**Current status:** probe bridge GREEN / real demo probes pending.

**Execution type:** manually dispatched protected GitHub Actions workflow using the `staging` environment.

Workflow:

`.github/workflows/gate6-demo-probes.yml`

### Exact protected confirmations

MT5:

```text
demo: probe mt5 gate 6
```

cTrader:

```text
demo: probe ctrader gate 6
```

The workflow input `provider` may select `mt5`, `ctrader`, or `all`; the confirmation must exactly match the selected gate/provider contract enforced by the workflow.

### Prerequisites

- separate authorization for Gate 6;
- protected GitHub `staging` environment approval available;
- required MT5/cTrader demo probe credentials/configuration already stored as protected environment secrets/variables;
- candidate SHA recorded;
- no secret values copied into workflow inputs or acceptance notes.

### Workflow-enforced safety

Gate 6 forces the Worker broker execution fuse OFF and disables test-order behavior for the source probes. The probe contract is source/connectivity/normalization acceptance, not broker lifecycle execution.

Expected safety values include:

```text
REQUIRE_BROKER_FUSE_OFF=true
BROKER_EXECUTION_ENABLED=false
MT5_ENABLE_ORDER_TEST=false
```

The cTrader probe likewise requires the broker fuse to remain false.

### Required checks

For each selected source provider:

- connection/authentication succeeds against the intended demo environment;
- reconnect/backoff behavior is bounded;
- same-provider duplicate replay converges;
- normalized event shape matches the canonical Trading Event contract;
- provider isolation is preserved;
- no broker order is sent.

### Required evidence

- candidate SHA;
- workflow run ID and provider-specific job ID;
- selected provider;
- exact confirmation marker used;
- secret-free probe summary;
- duplicate/normalization/isolation result;
- explicit confirmation `BROKER_EXECUTION_ENABLED=false` and no order-test path ran.

### Exit state

No broker order exists from Gate 6. Keep the Worker broker fuse OFF.

---

## Gate 7 — MT5/cTrader dedicated demo broker lifecycles

**Current status:** lifecycle bridge GREEN / real demo lifecycles pending.

**Execution type:** manually dispatched protected GitHub Actions workflow using the `staging` environment.

Workflow:

`.github/workflows/gate7-demo-destinations.yml`

### Exact protected confirmations

MT5:

```text
demo: lifecycle mt5 gate 7
```

cTrader:

```text
demo: lifecycle ctrader gate 7
```

### Prerequisites

- separate authorization for Gate 7;
- dedicated broker **demo** accounts only;
- protected GitHub `staging` environment approval available;
- required broker-demo credentials/configuration already stored as protected environment secrets/variables;
- candidate SHA recorded;
- operator prepared to verify/clean up demo orders/positions before exit.

### Critical safety distinction

The Worker-wide production broker fuse remains OFF:

```text
BROKER_EXECUTION_ENABLED=false
```

The Gate 7 workflow may intentionally enable its dedicated adapter-level **demo order-test** controls so it can prove broker lifecycle semantics on explicitly configured demo accounts. Those adapter test controls are confined to this protected acceptance workflow and do not constitute Worker production execution enablement.

Examples from the workflow contract include:

```text
MT5_ENABLE_ORDER_TEST=true
CTRADER_EXECUTION_ENABLED=true
CTRADER_ENABLE_ORDER_TEST=true
```

These are valid only inside the dedicated Gate 7 demo acceptance path with the exact confirmation marker and protected staging environment. They must never be interpreted as authorization for a live account.

### Required lifecycle checks

As applicable to each broker/platform:

- market order lifecycle;
- pending order lifecycle;
- stop-loss/take-profit modification;
- partial close;
- breakeven/management behavior;
- pending-order cancellation;
- broker-authoritative volume/symbol/precision behavior;
- idempotent retry behavior;
- transient connectivity/reconnect outcome;
- uncertain broker outcome handling without blind duplicate send.

### Required evidence

- candidate SHA;
- workflow run ID and provider-specific job ID;
- exact confirmation marker;
- explicit demo-environment/account assertion;
- secret-free lifecycle summary;
- broker-authoritative volume/precision result;
- retry/reconnect/uncertain-outcome result;
- confirmation that Worker `BROKER_EXECUTION_ENABLED=false` throughout;
- cleanup/reconciliation result showing no unexplained test state remains.

### Immediate stop conditions

Stop the provider's Gate 7 acceptance if any sizing/precision mismatch, duplicate broker order, live-account ambiguity, unexplained broker state, blind retry after uncertain outcome, or cleanup failure occurs.

---

## Gate 8 — real end-to-end staging acceptance

**Current status:** static execution + retry bridge GREEN / real staging acceptance pending.

**Execution type:** separately authorized staging acceptance across actual configured staging boundaries. There is no authorization implied by the Gate 6/7 workflows.

### Prerequisites

- Gates required for the selected E2E scenario completed or explicitly excluded for that scenario;
- staging identity, source/provider, database, queue, state, destination, and monitoring paths configured;
- dedicated demo broker destinations only where broker lifecycle participation is required;
- candidate SHA and prior known-good Worker version recorded;
- rollback path reviewed;
- separate Gate 8 authorization.

### Required checks

Exercise representative staging flows across multiple users/workspaces/sources/destinations and prove:

- exact workspace/source/provider isolation;
- source authentication and authorization;
- persistent canonical duplicate convergence;
- deterministic clear-signal interpretation;
- bounded ambiguity behavior (`NEEDS_REVIEW` on AI failure rather than guessed execution);
- canonical Trade State/Position Group correlation;
- persistent destination/order idempotency;
- sibling destination failure isolation;
- audit/transition history sufficient to explain the flow;
- no broker order records or broker sends when execution is disabled;
- replay/retry after restart converges rather than forks orchestration;
- secret-free logs and operational output.

### Safety requirements

Prefer simulation/non-broker destinations for the broad E2E matrix. Any real broker interaction must remain within a separately accepted dedicated demo path. No live account may participate.

### Required evidence

- exact candidate/deployed staging SHA/version;
- test matrix with workspace/source/destination combinations;
- duplicate/replay results;
- failure-isolation results;
- audit/transition evidence summary;
- broker-disabled assertion where applicable;
- secret-free latency/failure observations;
- rollback/cleanup state.

---

## Gate 9 — production operations real staging acceptance

**Current status:** static operational implementation/resilience GREEN / real monitoring, kill, rollback, recovery, security and sustained-measurement acceptance pending.

**Execution type:** separately authorized staging operations drill; no live money.

Primary runbook:

`cloudflare-v2/docs/PRODUCTION_V1_CUTOVER_RUNBOOK.md`

### Prerequisites

- candidate SHA and deployed staging Worker version recorded;
- prior known-good Worker version recorded before any authorized deployment change;
- migration ledger reviewed;
- secret-free monitoring/readiness source available for the selected observation window;
- account/workspace/global kill controls accessible to the authorized operator;
- rollback mechanism reviewed before the drill;
- reviewed metric thresholds/observation windows recorded for the acceptance run;
- separate Gate 9 authorization.

Do **not** invent universal numeric thresholds. The acceptance owner must review and record the thresholds/windows relevant to the real staging environment before the measurement phase.

### Required checks

#### Security

- unauthorized external application access fails closed;
- role/workspace boundaries remain exact;
- no secret material appears in logs, readiness output, error payloads, or audit summaries;
- caller hints cannot select workspace/account/provider/broker authority.

#### Observability

Observe at least the applicable secret-free classes defined in the production cutover runbook:

- source/provider health;
- queue/DLQ behavior;
- source-to-broker-send latency;
- broker round-trip latency;
- source-to-destination-ack latency;
- duplicate rate;
- retry/failure rate;
- uncertain broker outcome rate;
- ambiguity-AI review/fallback behavior;
- database/configuration failures;
- authorization failures;
- risk/kill events;
- runtime/container health where applicable.

Readiness metrics are observational only. Metrics-source failure must become unavailable and must not affect trading.

#### Kill controls

Prove, within the authorized staging/demo scope:

- destination/source-local isolation;
- account execution/kill-switch containment;
- workspace/product access containment where applicable;
- global broker-fuse stop behavior;
- TradingView ingress containment if Gate 3 is in scope.

#### Rollback

- identify candidate version and prior known-good version before changing staging;
- execute the approved rollback drill with broker execution OFF;
- verify health/smoke behavior after rollback;
- do not blindly roll database migrations backward;
- record migration compatibility/ledger state.

#### Recovery

- Worker/runtime restart/replay converges on persistent canonical/destination identities;
- transient cache/circuit state can be rebuilt without becoming authority;
- broker-reported state remains authority for actual broker orders/positions;
- uncertain broker state is reconciled before any re-send.

#### Sustained measurement

Run the reviewed observation window and compare measured failure/latency/isolation behavior against the thresholds recorded for that acceptance. Missing mandatory metrics or unexplained regressions block Gate 9.

### Required evidence

Record in `AGENTS.md`:

- candidate SHA and staging Worker version;
- prior known-good rollback version;
- acceptance start/end window;
- reviewed threshold/window reference;
- security results;
- secret-free metrics summary;
- kill-control drill results;
- rollback drill result;
- recovery/replay result;
- unresolved issues/blockers;
- final state of the four master controls.

### Exit state

Unless a subsequent separately authorized phase immediately requires otherwise, return the four master controls to OFF and record that state.

---

## Gate 10 — tiny controlled live cutover

**Current status:** CLOSED / not started.

This readiness matrix does not authorize Gate 10.

Gate 10 may be considered only after all applicable mandatory prior gates are GREEN or a reviewed scope removal is explicitly recorded, and only after the user gives a separate explicit final tiny-live approval.

Before one reviewed live account can be enabled, the owner must explicitly approve and record:

- maximum per-trade risk;
- maximum volume;
- maximum concurrent positions/open risk;
- daily loss ceiling;
- allowed symbols;
- kill/rollback contacts and procedure.

No default, inferred, or invented live financial threshold is permitted.

---

## Operator evidence template

Use this secret-free structure when recording a completed acceptance milestone in `AGENTS.md`:

```text
Gate: <number/name>
Candidate SHA: <sha>
Environment: <non-secret environment name>
Authorization scope: <gate only>
Run/job or acceptance reference: <ids>
Window: <start/end if applicable>
Master fuse state: <booleans only, no secret values>
Checks passed: <short list>
Failures/blockers: <short list or none>
Rollback/cleanup: <result>
Final gate status: <GREEN / pending / blocked / deferred>
Next safe action: <one bounded action>
```

A gate is not GREEN merely because its implementation code is GREEN. Real acceptance gates become GREEN only after the required environment evidence is executed, reviewed, and recorded.
