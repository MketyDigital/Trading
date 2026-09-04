# Trading V1 Production Development Audit

## Purpose
This is the detailed continuation/evidence record for development-to-production remediation of draft PR #2 on `design/enterprise-trading-event-core`. It is the technical companion to `AGENTS.md` and must make a future startup possible without reconstructing intent from chat history.

It does **not** authorize Cloudflare mutation, deployment, protected external probes, broker demo/live orders, `main` merge, real-money execution, or Gate 10.

## Authority order
When documents conflict, use this precedence:
1. current `AGENTS.md` + `docs/superpowers/plans/2026-09-03-production-v1-launch-master-plan.md`;
2. latest approved Sept 3 technical specs/plans, especially execution bridge, hot-path resilience, destination retry and production-readiness remediation;
3. current acceptance/cutover runbooks;
4. Sept 2 identity/source/TradingView documents where still referenced by Sept 3;
5. Sept 1 foundation documents as historical context only.

Later Sept 3 resilience/cutover contracts control where they tighten earlier component plans.

## Enterprise product intent / production topology
Mkety Trading is intended to be an enterprise multi-tenant automation SaaS, not a single-channel copier.

### Canonical event path
1. Source providers ingest from Telegram MTProto, TradingView, MT5 source, cTrader source, or custom API.
2. Every accepted source payload becomes one durable canonical Trading Event with source/workspace identity.
3. Clear machine-readable instructions use deterministic parsing/planning. AI may assist ambiguity or human presentation but may never override canonical execution semantics. Ambiguous AI failure or circuit-open becomes `NEEDS_REVIEW`.
4. The event fans out to independent destinations. Telegram is both a source family and a first-class human-delivery destination. Human delivery and broker execution are sibling paths; failure of one destination must not roll back a healthy sibling.
5. Durable event -> destination -> order/action idempotency prevents duplicate external effects across retries/restarts/provider failover.
6. Immediately before every broker action the runtime revalidates exact persisted event/source authority, Trading-owned workspace entitlement, exact trade account state, kill/safety policy, fresh risk/exposure authority, broker symbol/economics and final executable volume.
7. The validated canonical action is sent to the exact platform adapter. Caller hints, client-selected credentials or stale planning data are never final authority.
8. Successful broker result is persisted and bound to exact Trade State. A post-broker state-write failure must be repaired from persisted successful broker truth without ever resending the broker action solely to repair state.

### Isolation model
- isolation boundaries include product, Trading workspace, source connection/provider, destination, broker platform and trade account;
- one provider/source/account/destination/workspace failure must not poison siblings;
- optional subsystem failure degrades locally;
- safety/correctness uncertainty fails closed only for the affected money-moving path;
- uncertain broker outcomes are reconciled and never blindly retried.

### Identity/tenancy model
Mkety Trading may share Zitadel identity with the broader Mkety ecosystem, but Trading authorization/runtime/data/workspace authority is Trading-owned. Legacy MKSaaS workspace rows must not remain authoritative for Trading broker-account tenancy.

### Invariants retained throughout remediation
- Telegram AI is presentation-only;
- persistent source/event/destination/order idempotency is mandatory;
- broker metadata is authoritative;
- final authority is revalidated immediately before money-moving send;
- risk-increasing live volume must never silently round/clamp upward;
- protective/risk-reducing management remains available under drawdown/open-risk locks unless kill switch forbids it;
- cTrader raw `ProtoOASymbol.lotSize` protocol-cent semantics stay unchanged.

## Repository / verification baseline
- Repository: `MketyDigital/Trading`
- Branch: `design/enterprise-trading-event-core`
- Draft PR: #2 -> `main`
- Trusted pre-audit tree: `89944d3b6aa4b03f6bb1a1107594e9acfa424fb3`
- Broad pre-remediation CI: run `33766769463` SUCCESS; Node/trading-core 649/649, MT5 14/14, Container MTProto 11/11, external MTProto 22/22; protected Cloudflare jobs skipped.
- Frozen audit-scope commit: `7b175a548c9134b0e88ba4fa5977de51142b6cd3`.
- Pre-remediation AGENTS sync: `a9eecb4b9f843dbdbfc36c81961c7efa76c255af`.
- Static remediation plan: `docs/superpowers/plans/2026-09-03-production-readiness-remediation.md`, commit `567d8fe06c291eb393b5c23b3bd2d2dfbb65dbe4`.

## Current development stage
`STATIC PRODUCTION REMEDIATION IN PROGRESS — TASK 3 GREEN / TASK 4 ACTIVE NEXT`

Verified Task 3 implementation head before documentation commits: `a3a507b569499524d6de75ad8c519db5dd944efb`; PR merge ref `acae950fa02f509ecf69fb5c8d9ba5949da6513b`.

This PR is not at branch-finishing/merge stage. General production still requires applicable real Gates 4–9, shadow production, production-infrastructure demo, separate tiny-live approval, tiny-live acceptance, controlled beta, and no unresolved severity-1/2 safety issue.

## Development method
For every remaining remediation task:
1. trace latest approved requirement through the real runtime call graph;
2. write failing regression first;
3. verify intended RED on exact ordinary PR CI;
4. implement the minimum production change;
5. debug failed GREEN attempts from root cause, never weaken the safety contract to satisfy a test;
6. require exact-head ordinary PR CI GREEN before calling milestone GREEN;
7. keep protected Cloudflare/demo/live jobs skipped unless separately authorized;
8. reconcile branch head/current blob before every write because concurrent commits have occurred;
9. synchronize this file and `AGENTS.md` after each meaningful verified milestone;
10. continue to the next static task without waiting for a new confirmation when safe.

---

# Remediation milestone evidence

## Task 1 — both Worker master fuses on every broker-capable path
**Finding:** F1. **Status: STATIC GREEN / RESOLVED.**

RED:
- test commits `3bc54e60b85c065dfade8039fe0c9e0303aabacd`, `7961849db8355c67801db5f68c3d5357f0768f99`;
- run `33782879644`, job `100740562007`;
- intended missing-access-fuse regressions only; protected jobs skipped.

Implementation/GREEN:
- execution-stage guard `fc69dafa78803429c49028a31457a75746faf187`;
- retry guard `11a143abc7c71e55beb5b2505048a1e3963d16f0`;
- final GREEN head `1632889c6b26e88451ece25ba13c649b43357c5a`;
- run `33783267187`, job `100741828652` SUCCESS.

Resolved: every production broker-capable entry/recovery path requires Trading access plus broker master fuse before broker-capable work.

---

## Task 2 — final durable execution authority and exact persisted event linkage
**Findings:** F2, F3, F4, F9. **Status: STATIC GREEN / RESOLVED.**

RED:
- authority contract `85ba2c9352bc81b209227bd98d8d5e97a06dda84`;
- event propagation `d94e98a1fa79bb0f557e8561676985146b41225b`;
- per-action revocation `903e53e6db4a22b9fbe40ee7b98d775595898644`;
- final retry/source-authority RED head `71be214f260adf9800bee362ede92ebe62888d5e`;
- run `33783879937`, job `100743853586`.

Implementation:
- final authority loader `543830329988630d7aef1e63cd292a93b568a76c`;
- persisted event propagation `2b3bcba4a6cc8b84830f471eecd783ece7be1b2f`;
- production dependency/delivery composition `de30aec9263d4000a204abe83952018294de9f0a`;
- per-action reload final head `9ba95eea33748aea1ab641e2aab4e0aec67068dc`.

GREEN:
- PR run `33784508546`, job `100745907350` SUCCESS;
- ordinary Worker/trading-core, MT5 and both MTProto suites SUCCESS;
- protected jobs skipped.

Resolved runtime authority chain: exact persisted event -> originating source -> Trading workspace entitlement -> exact trade account. Authority reload occurs inside every action loop; durable retry recovers authority from delivery/event identity rather than caller source/workspace hints.

---

## Task 3 — broker-authoritative risk sizing, strict execution volume, canonical final policy
**Findings:** F7, F8, F10. **Status: STATIC GREEN / RESOLVED.**

### RED evidence
Initial broker-risk module contract:
- commit `825f8839b2ac53265547af547bc790e753f3f0da`;
- `cloudflare-v2/tests/production_risk_authority.test.mjs`;
- run `33785080713`, job `100747771938`;
- intended failure: production broker-risk authority module absent.

Strict execution-volume regressions:
- commit `e9a4729699b7617ea44d12f9b15708264fe573b5`;
- `platform_translation.test.mjs` requires MT5 and cTrader risk-increasing OPENs below broker minimum or off broker step to throw rather than clamp/round upward.

Canonical final-policy integration:
- head `fc1496e7b62b4e11c385d0a8fed3ca8a783b8c24`;
- run `33785495528`, job `100749133738`;
- Node/trading-core 665 total, 659 pass, exactly six intended Task 3 failures: missing broker-risk authority, four unsafe-volume cases, and missing `riskMaterializer` coordinator integration;
- no unrelated regression; protected jobs skipped.

A further production-composition guard was added after the first GREEN slice:
- commit `83ed3dcb6b739efff3077b9242d5f972af528f5f`;
- `production_execution_risk_composition.test.mjs` requires `createProductionExecutionDependencies()` itself to expose/use broker-authoritative materialization. This prevents a false GREEN where tests call a materializer that real production composition never wires.

### Implementation / root-cause resolution
1. `production_risk_authority.js`
   - validates one final production action against current broker account and instrument economics;
   - risk-percent/fixed-risk OPEN derives current loss-at-stop allowance using broker equity/balance and broker economics;
   - planned lots greater than current broker-authoritative allowed lots block;
   - missing reliable entry/stop/economic loss model fails closed;
   - fixed-lot OPEN remains subject to strict broker volume/account policy but does not invent a monetary risk percentage;
   - risk-reducing actions do not acquire artificial risk-increase constraints.

2. Strict live volume translation
   - added strict MT5/cTrader execution validators;
   - risk-increasing OPEN below min, above max or off-step is rejected rather than increased to a broker-valid quantity;
   - cTrader protocol-cent lot semantics are preserved;
   - permissive normalization remains only for simulation/display and specifically risk-reducing management such as partial close, preventing safety tightening from accidentally blocking protective actions.

3. Coordinator final-policy order
   - final durable authority reload occurs inside the action loop;
   - `riskMaterializer` runs after authority reload and before account policy/dispatch;
   - materializer can replace the executable action only with its validated canonical result;
   - canonical final policy fields are `totalLots`, `riskPercent`, `currentDailyPnlPercent`, `currentOpenRiskPercent` plus symbol/action kind;
   - materializer/policy block produces zero broker dispatch.

4. Real production dependency composition
   - MT5 context loads bridge health/account/catalog and verifies configured broker account/server;
   - MT5 catalog now retains broker loss-side tick value (`trade_tick_value_loss`, fallback broker generic tick value), contract/tick/min/max/step metadata;
   - exact symbol is resolved from broker catalog;
   - current broker account equity/balance and broker symbol economics feed final risk authority;
   - market price is loaded only when canonical action does not already contain reliable entry price;
   - stale simulation risk/economic values do not become final authority.

5. Dynamic daily/open-risk authority
   - if account safety policy actually configures `maxDailyLossPercent` or `maxOpenRiskPercent`, an authoritative exposure loader is mandatory;
   - absent/incomplete authoritative exposure fails closed;
   - zeros are neutral context only when those dynamic limits are not configured; they are not a claim that live exposure is zero.

6. cTrader safety boundary
   - current cTrader repository runtime has authoritative account/catalog/market surfaces but does not expose a verified monetary loss-at-stop model equivalent to the required broker-native economics;
   - therefore risk-percent/fixed-risk cTrader **new OPEN** fails closed rather than using guessed generic P&L math;
   - fixed-lot OPEN and risk-reducing actions still receive their applicable strict broker-volume/account-policy checks;
   - later optimization/hardening may add a genuinely broker-native cTrader monetary risk model, but current fail-closed behavior is the correct production-safety contract.

### Exact-head GREEN evidence
- final implementation head: `a3a507b569499524d6de75ad8c519db5dd944efb`;
- PR merge ref containing that head: `acae950fa02f509ecf69fb5c8d9ba5949da6513b`;
- ordinary PR run: `33843616430`;
- mandatory test job: `100930741996` SUCCESS;
- Node/trading-core: **669/669 PASS**;
- pure MT5 bridge: **14/14 PASS**;
- Container MTProto: **11/11 PASS**;
- external MTProto: **22/22 PASS**;
- protected Cloudflare inspect/probe/deploy/accept jobs all SKIPPED.

No Cloudflare mutation, deployment, protected probe, demo broker order or live broker order occurred.

Resolved:
- **F7** final risk-increasing production sizing/validation is broker-authoritative where a reliable broker loss model exists, otherwise fail closed;
- **F8** risk-increasing MT5/cTrader live volume translation cannot silently increase approved volume;
- **F10** final dispatch policy consumes canonical materialized fields and requires authoritative dynamic exposure when configured.

---

# Frozen audit findings / current status
- **F1** Worker access fuse on non-HTTP broker paths — RESOLVED Task 1.
- **F2** workspace entitlement not final authority — RESOLVED Task 2.
- **F3** mutable account/safety authority loaded once — RESOLVED Task 2; dynamic final risk/exposure authority completed Task 3.
- **F4** source disablement not revalidated — RESOLVED Task 2.
- **F5** broker success can remain unbound from Trade State after state-write failure — **OPEN / Task 4 ACTIVE NEXT**.
- **F6** legacy `trade_accounts.workspace_id` FK couples Trading to MKSaaS workspace lifecycle — OPEN / Task 5.
- **F7** broker-authoritative live risk sizing — RESOLVED Task 3.
- **F8** upward live OPEN volume normalization — RESOLVED Task 3.
- **F9** dropped production `tradingEventId` — RESOLVED Task 2.
- **F10** unreliable final policy/risk/exposure shape — RESOLVED Task 3.
- **I1** execution snapshot not production-integrated — OPEN / Task 6.
- **I2** warm broker context/session reuse incomplete — OPEN / Task 7.
- **U1** MT5 metadata GET authentication boundary — OPEN / Task 7.

---

# Task 4 / F5 exact root cause and required recovery contract

## Existing failure shape
The dangerous sequence is:
1. destination/order idempotency reserves the broker action;
2. broker action succeeds;
3. successful delivery persists broker position/order/deal identifiers;
4. coordinator attempts Trade State binding;
5. Trade State write fails;
6. successful broker delivery remains terminal `SUCCEEDED` while Trade State lacks the broker binding;
7. normal retry scanner scans `RETRYABLE`, not successful deliveries;
8. replay/duplicate execution intentionally does not resend a terminal broker action;
9. therefore broker truth can remain durably disconnected from Trade State.

This is not permission to make `SUCCEEDED` broker deliveries resendable. The repair plane must be separate from the broker-send retry plane.

## Task 4 RED contract
Before production repair code, tests must prove:
- broker dispatch succeeds exactly once;
- exact broker IDs are durably persisted before/independent of Trade State repair;
- first Trade State bind failure leaves discoverable durable repair work;
- repair consumes persisted successful delivery/broker truth, not caller-supplied broker IDs;
- repair performs **zero additional broker dispatches**;
- repair binds exact workspace/event/account/group/leg and persisted broker IDs;
- retrying the repair is idempotent;
- already-bound state converges without duplicate broker action;
- cross-workspace/event/account/group/leg mismatch fails closed;
- ordinary broker retry scanner cannot treat the state-repair item as a broker resend request.

## Task 4 implementation boundary
Trace before choosing schema:
- `production_execution_coordinator.js` state-bind failure handling;
- `supabase_delivery_store.js` successful delivery persistence and broker-result fields;
- destination retry composition/scanner and its status query;
- current Trade State binding endpoint/DO contract and `production_state_binder` tests;
- existing migrations/columns capable of representing a separate state-binding repair obligation.

Use an additive dedicated repair state/table/columns only if current durable delivery representation cannot cleanly express this without reopening broker delivery. Whatever shape is chosen, broker `SUCCEEDED` truth remains terminal for broker dispatch.

---

# Remaining remediation boundaries

## Task 5 / F6 — Trading-owned trade-account tenancy
Create a static additive migration contract so Trading broker accounts no longer require/cascade from MKSaaS workspace rows. Do not apply to real environment until separately authorized read-only schema/ledger inspection confirms actual constraint/data prerequisites.

## Task 6 / I1 — bounded runtime snapshot
Integrate only non-secret/non-authoritative performance configuration. Never cache away source status, workspace entitlement, account execution state, kill switch, broker fuse or dynamic risk/exposure authority.

## Task 7 / I2 + U1 — broker context hardening
Authenticate MT5 metadata requests and add bounded MT5/cTrader warm context/session reuse where safe. Performance reuse must never override final fresh authority. A cTrader monetary risk model must be based on verified broker-native semantics, never guessed generic math.

## Task 8 — static integrated acceptance
Failure matrix must include at least:
- Trading access false on queue/retry;
- source disabled during event;
- workspace entitlement revoked;
- account kill/execution revoked between legs;
- broker-min/off-step unsafe lots;
- configured risk exposure absent/stale;
- persisted event linkage;
- broker success + state-bind failure + no-resend repair.

Then require all ordinary Worker/trading-core, MT5 and both MTProto suites exact-head GREEN with protected jobs skipped.

---

# Current gate interpretation
- Gate 1 historical GREEN.
- Gate 2 historical GREEN/exited; do not repeat without reason.
- Gate 3 deferred/fail-closed.
- Gates 4–7 static foundations exist; real acceptance pending.
- Gates 8–9 require static remediation GREEN before real acceptance.
- Gate 10 CLOSED/not started.

Gate 10 Phase C later requires separate explicit owner approval and explicit max per-trade risk, max volume, max concurrent/open risk, daily loss ceiling, allowed symbols, and kill/rollback contacts/procedure. Never invent defaults.

## Exact pickup point for any future session
1. Read `AGENTS.md` and this document first; confirm current branch/PR head before writes.
2. Task 3 trusted GREEN evidence is implementation head `a3a507b...`, PR run `33843616430`, job `100930741996`, counts 669/669 + 14/14 + 11/11 + 22/22, protected jobs skipped.
3. Begin **Task 4/F5** by tracing delivery-success persistence, state binder and retry scanner. Do not start with schema guessing.
4. Add RED tests for broker success -> state bind failure -> durable repair discoverability -> repair from persisted broker truth -> zero broker resend -> idempotent convergence -> mismatch fail-closed.
5. Verify intended RED through ordinary PR CI before production repair code.
6. Implement minimum durable repair plane separate from broker resend retry.
7. Require exact-head full ordinary CI GREEN; protected jobs must remain skipped.
8. Synchronize this file plus `AGENTS.md`, then proceed immediately through Tasks 5–8 under the same RED/minimal-GREEN/exact-head-CI discipline.
9. Only after all static remediation is exact-head GREEN return to separately authorized real Gates 4–9.

## Safety state during static remediation
```text
TRADINGVIEW_DIRECT_INGRESS_ENABLED=false
TRADINGVIEW_CERT_PROBE_ENABLED=false
TRADING_ACCESS_ENABLED=false
BROKER_EXECUTION_ENABLED=false
```
Do not deploy, mutate Cloudflare, run protected external probes, place broker orders, merge `main`, or enable real-money execution without the exact later gate/approval contract.