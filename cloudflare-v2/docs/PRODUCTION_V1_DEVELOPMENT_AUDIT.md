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
8. Successful broker result is persisted and bound to exact Trade State. A post-broker state-write failure is repaired from persisted successful broker truth through a separate repair plane without resending the successful broker action.

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
- cTrader raw `ProtoOASymbol.lotSize` protocol-cent semantics stay unchanged;
- a state-binding repair obligation must never convert a terminal successful broker delivery into an automatically resendable broker action.

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
`STATIC PRODUCTION REMEDIATION IN PROGRESS — TASK 5 GREEN / TASK 6 I1 ACTIVE NEXT`

Verified Task 5 implementation head before documentation commits: `9a13bd2fa928d39cce826d05b005129fa10a68f3`.
Exact ordinary PR run `33851400665` SUCCESS: Node 678/678, MT5 14/14, Container MTProto 11/11, external MTProto 22/22; protected Cloudflare jobs skipped.

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
- broker-risk contract commit `825f8839b2ac53265547af547bc790e753f3f0da`, run `33785080713`, job `100747771938`;
- strict execution-volume regressions commit `e9a4729699b7617ea44d12f9b15708264fe573b5`;
- canonical final-policy RED head `fc1496e7b62b4e11c385d0a8fed3ca8a783b8c24`, run `33785495528`, job `100749133738`;
- Node/trading-core 665 total, 659 pass, exactly six intended failures; no unrelated regression; protected jobs skipped;
- real production-composition guard commit `83ed3dcb6b739efff3077b9242d5f972af528f5f` prevents unit-only materializer GREEN from hiding a production runtime bypass.

### Implementation / root-cause resolution
- `production_risk_authority.js` validates each final risk-increasing production action against current broker account/symbol economics.
- Risk-percent/fixed-risk OPEN blocks if current broker economics permit less volume than planned or if no reliable monetary loss-at-stop model is available.
- Strict MT5/cTrader risk-increasing OPEN translation rejects below-minimum, above-maximum, or off-step volume rather than rounding/clamping upward; cTrader protocol-cent semantics are preserved.
- Risk-reducing management retains separate protective semantics.
- Coordinator order is final durable authority -> broker/risk materialization -> canonical account policy -> broker dispatch.
- Canonical final policy fields are `totalLots`, `riskPercent`, `currentDailyPnlPercent`, `currentOpenRiskPercent` plus symbol/action kind.
- MT5 final materialization uses current broker account/catalog/tick economics.
- Configured daily/open-risk limits require authoritative exposure input; absent/incomplete current exposure fails closed.
- cTrader risk-percent/fixed-risk new OPEN remains fail closed until a verified broker-native monetary loss model exists; fixed-lot and risk-reducing actions retain applicable safety checks.

### Exact-head GREEN evidence
- final implementation head `a3a507b569499524d6de75ad8c519db5dd944efb`;
- PR run `33843616430`, job `100930741996` SUCCESS;
- Node/trading-core **669/669 PASS**;
- pure MT5 bridge **14/14 PASS**;
- Container MTProto **11/11 PASS**;
- external MTProto **22/22 PASS**;
- protected Cloudflare inspect/probe/deploy/accept jobs all SKIPPED.

Resolved F7, F8 and F10. No Cloudflare mutation, deployment, protected probe, demo broker order or live broker order occurred.

---

## Task 4 — successful broker truth -> durable Trade State repair without resend
**Finding:** F5. **Status: STATIC GREEN / RESOLVED.**

### Root cause
Before remediation, the dangerous sequence was:
1. destination/order idempotency reserved a broker action;
2. broker action succeeded;
3. successful delivery persisted broker position/order/deal identifiers;
4. coordinator attempted Trade State binding;
5. Trade State write failed;
6. delivery correctly remained terminal `SUCCEEDED`, but Trade State lacked the broker binding;
7. ordinary retry scanned only `RETRYABLE` and duplicate replay correctly refused a second broker send;
8. therefore broker truth could remain durably disconnected from Trade State.

The fix had to create a separate state-convergence plane without making a successful broker delivery resendable.

### RED evidence
Initial RED:
- run `33846974860`, job `100940915628`;
- Node 671 total, 669 pass, exactly two intended failures:
  - missing execution binding repair module;
  - coordinator did not record repair work after broker success + bind failure;
- protected Cloudflare jobs skipped.

Concurrent implementation then added the recorder/marker while branch work was reconciled:
- `6af86fd142ee2ec65fb58cbcb66c6a24278dae36` — record state-binding repair after broker success;
- `6c7d8e12ec6a3c86aaca85167b1e4ba3bc26e0a8` — compose durable production binding repair marker;
- `65d4a2fcc2f7c0ba53152baae37f79b3a20fef5b` — wire production binding repair recorder.

Scheduled-recovery RED:
- head `5369575250a6952f1630ca678e6f1acc281f5687`;
- run `33848080972`, job `100944432703`;
- Node 674 total, 671 pass, exactly three intended failures in scheduler composition;
- repair engine/recorder tests already GREEN; protected jobs skipped.

Production-composition RED:
- head `b694e51e09df53af63c0b07b3bfae842ac5ea992`;
- run `33850220984`, job `100951078369`;
- Node 675 total, 671 pass, exactly four intended failures: the scheduler failures plus missing `production_binding_repair.js` composition;
- protected jobs skipped.

### Implementation
- after broker success, Trade State bind failure records a binding-repair obligation while delivery remains terminal `SUCCEEDED`;
- `failure_class='STATE_BINDING_PENDING'` marks repair work without reopening broker retry;
- binding repair scans only persisted `SUCCEEDED + STATE_BINDING_PENDING` rows;
- repair reconstructs trusted account/group/action and broker identifiers from persisted successful delivery truth;
- workspace/event/account/group/leg/destination disagreement fails closed;
- successful repair clears the binding marker;
- production repair composition invokes only `stateBinder`, never `dispatchAction`;
- one-minute recovery runs MTProto, destination retry, and binding repair independently; legacy 15-minute scheduling remains unchanged.

### Failed first GREEN attempt and root-cause correction
- first GREEN candidate head `febcbc35cc75905fdc2931d4341ce519d9bd4c97`, run `33850486547`, job `100951911601` FAILED from one invalid Supabase import;
- no false GREEN was claimed;
- fix `30be3bddb586e6a9bf02dea4520c338e3510287c` reused the proven production Supabase factory.

### Exact-head GREEN evidence
- final implementation head `30be3bddb586e6a9bf02dea4520c338e3510287c`;
- ordinary PR run `33850696335`, job `100952562634` SUCCESS;
- Node/trading-core **675/675 PASS**;
- pure MT5 bridge **14/14 PASS**;
- Container MTProto **11/11 PASS**;
- external MTProto **22/22 PASS**;
- protected Cloudflare jobs all SKIPPED.

Resolved: **F5** successful broker truth has a durable idempotent state-convergence path that cannot become a broker resend solely because Trade State binding failed.

---

## Task 5 — Trading-owned trade-account tenancy migration contract
**Finding:** F6. **Status: STATIC GREEN / RESOLVED.**

### Root cause
The legacy `trade_accounts.workspace_id` foreign key pointed to shared MKSaaS `public.workspaces(id)` with cascade lifecycle coupling. That contradicted the approved architecture where Trading may share Zitadel identity but Trading owns its workspace/authorization/data authority.

### Controlling schema decision
Current Trading-owned tenancy authority is `trading_workspace_access(id)`. The migration must not manufacture Trading workspaces, rewrite account workspace UUIDs, or mutate shared MKSaaS workspace rows merely to satisfy a foreign key.

### RED evidence
- RED head `6f479bb897566c4b16d61c0bf619db466d5d8ea9`.
- Static migration tests required a new `0012` migration and failed because that migration did not yet exist.
- Existing preceding regression contracts remained healthy; no database or environment was touched.

The RED contract required that the migration:
- abort if any current Trading account workspace is not already provisioned in `trading_workspace_access`;
- remove only the legacy single-column `trade_accounts.workspace_id -> public.workspaces(id)` foreign key;
- repoint account tenancy to Trading-owned authority;
- preserve all existing `trade_accounts` rows and workspace UUID values;
- never insert/update/delete/truncate shared `public.workspaces` data;
- avoid shared-workspace `ON DELETE CASCADE` as Trading broker-account lifecycle authority.

### Implementation
- final implementation head `9a13bd2fa928d39cce826d05b005129fa10a68f3` (`fix: move trade account tenancy to Trading workspace authority`).
- migration `0012` performs a fail-closed orphan precheck against `trading_workspace_access` before any constraint replacement;
- it discovers/drops only the exact legacy single-column workspace foreign key targeting shared `public.workspaces`;
- it creates the replacement `trade_accounts.workspace_id -> trading_workspace_access(id)` tenancy constraint;
- account rows/workspace UUIDs remain unchanged;
- no shared MKSaaS workspace row is created, rewritten, deleted, or used to manufacture Trading tenancy.

### Exact-head GREEN evidence
- implementation head `9a13bd2fa928d39cce826d05b005129fa10a68f3`;
- ordinary PR run `33851400665` SUCCESS;
- Node/trading-core **678/678 PASS**;
- MT5 bridge **14/14 PASS**;
- Container MTProto **11/11 PASS**;
- external MTProto **22/22 PASS**;
- protected Cloudflare inspect/probe/deploy/accept jobs SKIPPED.

No real database migration, Cloudflare mutation, protected probe, demo broker order, or live broker order occurred. Any future real apply requires separate authorization and first a read-only real-schema/constraint/data-prerequisite inspection.

Resolved: **F6** is statically remediated. Checked-in account tenancy now targets Trading-owned workspace authority instead of shared MKSaaS workspace lifecycle authority.

---

# Frozen audit findings / current status
- **F1** Worker access fuse on non-HTTP broker paths — RESOLVED Task 1.
- **F2** workspace entitlement not final authority — RESOLVED Task 2.
- **F3** mutable account/safety authority loaded once — RESOLVED Task 2; dynamic final risk/exposure authority completed Task 3.
- **F4** source disablement not revalidated — RESOLVED Task 2.
- **F5** broker success can remain unbound from Trade State after state-write failure — RESOLVED Task 4.
- **F6** legacy `trade_accounts.workspace_id` FK couples Trading to MKSaaS workspace lifecycle — **RESOLVED Task 5**.
- **F7** broker-authoritative live risk sizing — RESOLVED Task 3.
- **F8** upward live OPEN volume normalization — RESOLVED Task 3.
- **F9** dropped production `tradingEventId` — RESOLVED Task 2.
- **F10** unreliable final policy/risk/exposure shape — RESOLVED Task 3.
- **I1** execution snapshot not production-integrated — **OPEN / Task 6 ACTIVE NEXT**.
- **I2** warm broker context/session reuse incomplete — OPEN / Task 7.
- **U1** MT5 metadata GET authentication boundary — OPEN / Task 7.

---

# Task 6 / I1 exact boundary and next TDD contract

## Finding
A bounded execution snapshot helper already exists and has tests for exact workspace/source/account keying, TTL/version misses, bounded entry eviction, non-secret filtering, and immutable returned values. It is not yet proven as part of real production execution composition.

## Safety boundary
Snapshot integration is an optimization only. It may cache bounded non-secret/non-authoritative configuration, but it must never become final execution authority.

The following must always remain fresh/revalidated outside snapshot authority immediately before money-moving send:
- source active/status and originating-event authority;
- Trading workspace entitlement;
- exact account active/execution state;
- account kill switch / mutable safety policy where applicable;
- Worker broker/access master fuses;
- dynamic daily PnL/open-risk/exposure values;
- broker-authoritative account/symbol/economic/volume truth required by final risk validation.

Snapshot miss, expiry, version mismatch, or invalidation must fall back safely to authoritative loading; stale snapshot must never authorize execution.

## Task 6 RED contract
Trace the exact snapshot helper and real production dependency call graph, then add minimal tests proving:
1. production composition can consume an eligible safe snapshot for non-authoritative configuration;
2. fresh durable authority loader still runs per action even if snapshot says the account/source/workspace is enabled;
3. fresh broker risk/economic materialization still runs per risk-increasing action;
4. snapshot cannot carry or override secret credentials, kill/execution state, dynamic risk/exposure, or master-fuse values;
5. miss/TTL/version mismatch falls back to authoritative load without fail-open behavior.

Verify intended RED through ordinary PR CI before production integration.

---

# Remaining remediation boundaries

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
2. Trust Task 5 GREEN only from implementation head `9a13bd2fa928d39cce826d05b005129fa10a68f3`, PR run `33851400665`, counts 678/678 + 14/14 + 11/11 + 22/22, protected jobs skipped.
3. Continue **Task 6/I1 RED first** by tracing the existing execution snapshot helper and real production dependency composition.
4. Add production-integration tests proving snapshot use is optimization-only and cannot replace fresh source/workspace/account/fuse/risk/exposure/broker-economic authority.
5. Verify intended RED through ordinary PR CI before production implementation.
6. Implement only the minimum safe snapshot integration; miss/expiry/version mismatch must fall back to authoritative loading.
7. Require exact-head full ordinary CI GREEN; protected jobs must remain skipped.
8. Synchronize this file plus `AGENTS.md`, then proceed immediately through Tasks 7–8 under the same RED/minimal-GREEN/exact-head-CI discipline.
9. Only after all static remediation is exact-head GREEN return to separately authorized real Gates 4–9.

## Safety state during static remediation
```text
TRADINGVIEW_DIRECT_INGRESS_ENABLED=false
TRADINGVIEW_CERT_PROBE_ENABLED=false
TRADING_ACCESS_ENABLED=false
BROKER_EXECUTION_ENABLED=false
```
Do not deploy, mutate Cloudflare, run protected external probes, place broker orders, merge `main`, or enable real-money execution without the exact later gate/approval contract.