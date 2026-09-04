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
4. The event fans out to independent destinations. Human delivery and broker execution are sibling paths; failure of one destination must not roll back a healthy sibling.
5. Durable event -> destination -> order/action idempotency prevents duplicate external effects across retries/restarts/provider failover.
6. Immediately before every broker action the runtime revalidates exact persisted event/source authority, Trading-owned workspace entitlement, exact trade account state, kill/safety policy, fresh risk/exposure authority, broker symbol/economics and final executable volume.
7. The validated canonical action is sent to the exact platform adapter. Caller hints, client-selected credentials or stale planning data are never final authority.
8. Successful broker result is persisted and bound to exact Trade State. A post-broker state-write failure is repaired from persisted successful broker truth through a separate repair plane without resending the successful broker action.

### Isolation / safety invariants
- isolation boundaries include product, Trading workspace, source connection/provider, destination, broker platform and trade account;
- one provider/source/account/destination/workspace failure must not poison siblings;
- optional subsystem failure degrades locally;
- safety/correctness uncertainty fails closed only for the affected money-moving path;
- uncertain broker outcomes are reconciled and never blindly retried;
- Telegram AI is presentation-only;
- persistent source/event/destination/order idempotency is mandatory;
- broker metadata is authoritative;
- final authority is revalidated immediately before money-moving send;
- risk-increasing live volume must never silently round/clamp upward;
- protective/risk-reducing management remains available under drawdown/open-risk locks unless kill switch forbids it;
- cTrader raw `ProtoOASymbol.lotSize` protocol-cent semantics stay unchanged;
- a state-binding repair obligation must never convert a terminal successful broker delivery into an automatically resendable broker action;
- execution snapshots and warm broker contexts are optimization only and may never replace per-action source/workspace/account/kill/risk authority.

## Repository / verification baseline
- Repository: `MketyDigital/Trading`
- Branch: `design/enterprise-trading-event-core`
- Draft PR: #2 -> `main`
- Trusted pre-audit tree: `89944d3b6aa4b03f6bb1a1107594e9acfa424fb3`
- Broad pre-remediation CI: run `33766769463` SUCCESS; Node/trading-core 649/649, MT5 14/14, Container MTProto 11/11, external MTProto 22/22; protected Cloudflare jobs skipped.
- Frozen audit-scope commit: `7b175a548c9134b0e88ba4fa5977de51142b6cd3`.
- Pre-remediation AGENTS sync: `a9eecb4b9f843dbdbfc36c81961c7efa76c255af`.
- Static remediation plan: `docs/superpowers/plans/2026-09-03-production-readiness-remediation.md`, original plan commit `567d8fe06c291eb393b5c23b3bd2d2dfbb65dbe4`.

## Current development stage
`STATIC PRODUCTION REMEDIATION IN PROGRESS — TASK 7 GREEN / TASK 8 INTEGRATED FAILURE-MATRIX ACCEPTANCE ACTIVE NEXT`

Verified Task 7 implementation head before documentation commits: `619fa842ee29addecc9cbbd3fad6bec6efe59f60`.
Exact ordinary PR run `33856378784`, job `100970541404` SUCCESS: Node/trading-core 685/685, MT5 14/14, Container MTProto 11/11, external MTProto 22/22; all protected Cloudflare inspect/probe/deploy/accept jobs skipped.

This PR is not at branch-finishing/merge stage. General production still requires applicable real Gates 4–9, shadow production, production-infrastructure demo, separate tiny-live approval, tiny-live acceptance, controlled beta, and no unresolved severity-1/2 safety issue.

## Development method
For every remaining remediation task:
1. trace latest approved requirement through the real runtime call graph;
2. write failing regression first when a real contract gap exists;
3. verify intended RED on exact ordinary PR CI;
4. implement the minimum production change;
5. debug failed GREEN attempts from root cause, never weaken the safety contract to satisfy a test;
6. require exact-head ordinary PR CI GREEN before calling a milestone GREEN;
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

Resolved: every production broker-capable execution/recovery path requires Trading access plus broker master fuse before broker-capable work.

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
- Node/trading-core 665 total, 659 pass, exactly six intended failures; protected jobs skipped;
- real production-composition guard `83ed3dcb6b739efff3077b9242d5f972af528f5f` prevented a unit-only GREEN from hiding a production bypass.

### Implementation / root-cause resolution
- `production_risk_authority.js` validates each final risk-increasing production action against current broker account/symbol economics.
- Risk-percent/fixed-risk OPEN blocks if current broker economics permit less volume than planned or if no reliable monetary loss-at-stop model is available.
- Strict MT5/cTrader risk-increasing OPEN translation rejects below-minimum, above-maximum, or off-step volume rather than rounding/clamping upward; cTrader protocol-cent semantics are preserved.
- Risk-reducing management retains separate protective semantics.
- Coordinator order is final durable authority -> broker/risk materialization -> canonical account policy -> broker dispatch.
- Canonical final policy fields are `totalLots`, `riskPercent`, `currentDailyPnlPercent`, `currentOpenRiskPercent` plus symbol/action kind.
- Configured daily/open-risk limits require authoritative exposure input; absent/incomplete current exposure fails closed.
- cTrader risk-percent/fixed-risk new OPEN remains fail closed until a verified broker-native monetary loss model exists; fixed-lot and risk-reducing actions retain applicable safety checks.

### Exact-head GREEN evidence
- final implementation head `a3a507b569499524d6de75ad8c519db5dd944efb`;
- PR run `33843616430`, job `100930741996` SUCCESS;
- Node/trading-core **669/669 PASS**;
- MT5 **14/14**, Container MTProto **11/11**, external MTProto **22/22**;
- protected Cloudflare jobs SKIPPED.

Resolved F7, F8 and F10. No deployment, protected probe, demo order, or live order occurred.

---

## Task 4 — successful broker truth -> durable Trade State repair without resend
**Finding:** F5. **Status: STATIC GREEN / RESOLVED.**

### Root cause
The dangerous pre-remediation sequence was broker success -> durable delivery success -> Trade State bind failure -> no retry eligibility and no independent repair path. The fix had to converge Trade State from durable broker truth without making the successful broker action resendable.

### RED evidence
- initial run `33846974860`, job `100940915628`: exactly two intended failures (missing repair module; missing repair recording after broker success + bind failure);
- scheduled-recovery RED head `5369575250a6952f1630ca678e6f1acc281f5687`, run `33848080972`, job `100944432703`;
- production-composition RED head `b694e51e09df53af63c0b07b3bfae842ac5ea992`, run `33850220984`, job `100951078369`.

### Implementation
- after broker success, Trade State bind failure records a repair obligation while delivery remains terminal `SUCCEEDED`;
- `failure_class='STATE_BINDING_PENDING'` marks repair work without reopening broker retry;
- repair scans only `SUCCEEDED + STATE_BINDING_PENDING` rows;
- repair reconstructs trusted account/group/action and broker IDs from persisted successful delivery truth;
- workspace/event/account/group/leg/destination disagreement fails closed;
- successful repair clears the marker;
- repair composition invokes `stateBinder`, never `dispatchAction`;
- one-minute recovery runs MTProto, destination retry, and binding repair independently.

### Exact-head GREEN evidence
- first GREEN candidate `febcbc35cc75905fdc2931d4341ce519d9bd4c97` failed from an invalid Supabase import; no false GREEN was claimed;
- final fix/head `30be3bddb586e6a9bf02dea4520c338e3510287c`;
- run `33850696335`, job `100952562634` SUCCESS;
- Node/trading-core **675/675**, MT5 **14/14**, Container MTProto **11/11**, external MTProto **22/22**;
- protected jobs SKIPPED.

Resolved F5: broker truth can converge to Trade State without resending solely because binding failed.

---

## Task 5 — Trading-owned trade-account tenancy migration contract
**Finding:** F6. **Status: STATIC GREEN / RESOLVED.**

The legacy `trade_accounts.workspace_id` FK targeted shared MKSaaS `public.workspaces(id)`. The replacement static migration:
- aborts if any account workspace is not already provisioned in Trading-owned `trading_workspace_access`;
- removes only the legacy single-column FK;
- repoints `trade_accounts.workspace_id` to Trading-owned workspace authority;
- preserves account rows/workspace UUIDs;
- never manufactures or mutates shared MKSaaS workspace rows.

RED head `6f479bb897566c4b16d61c0bf619db466d5d8ea9` required the absent `0012` migration.

GREEN:
- final implementation head `9a13bd2fa928d39cce826d05b005129fa10a68f3`;
- run `33851400665` SUCCESS;
- Node/trading-core **678/678**, MT5 **14/14**, Container MTProto **11/11**, external MTProto **22/22**;
- protected jobs SKIPPED.

No real database migration was applied. Any future apply requires separate authorization and read-only real-schema/prerequisite inspection first.

---

## Task 6 — runtime execution snapshot integration
**Finding:** I1. **Status: STATIC GREEN / RESOLVED.**

### Safety boundary
Snapshot use is advisory optimization only. It may retain only bounded non-secret/non-authoritative configuration. It must never replace fresh source status, Trading workspace entitlement, account active/execution/kill state, Worker fuses, dynamic risk/exposure, or broker-authoritative economics.

### TDD / implementation
- coordinator RED proved snapshot integration was absent while fresh authority/risk semantics remained intact;
- production-composition RED proved real production dependencies did not expose the snapshot loader;
- coordinator order is now **fresh durable authority -> advisory snapshot -> fresh broker-risk materialization -> final policy -> dispatch**;
- snapshot miss/failure is a cache miss only;
- production snapshot is positive-whitelisted to safe configuration such as platform/server name/sizing/entry policy;
- credentials, enabled state, execution state, kill/safety policy, dynamic risk/exposure and master fuses are excluded.

### Exact-head GREEN evidence
- final implementation head `400880cab6502c75ac487830bc3a90bb022f485c`;
- run `33853785408`, job `100962282286` SUCCESS;
- Node/trading-core **681/681**, MT5 **14/14**, Container MTProto **11/11**, external MTProto **22/22**;
- protected Cloudflare jobs SKIPPED.

Resolved I1 without moving any final authority into cache.

---

## Task 7 — authenticated MT5 metadata + bounded warm broker contexts
**Findings:** U1, I2. **Status: STATIC GREEN / RESOLVED.**

### Root causes
1. MT5 command POSTs were authenticated, while sensitive metadata GETs (`/v1/account`, `/v1/symbols`, `/v1/tick`) crossed the bridge boundary unsigned.
2. A risk-sized MT5 action loaded broker context once for risk validation and again for immediate dispatch.
3. cTrader sequential actions recreated/closed a runtime for every action instead of safely reusing one authenticated runtime inside an exact batch.

### RED contract
Task 7 RED required:
- default MT5 metadata requests to authenticate with server-owned bridge secret;
- exact same-action MT5 risk context to be reusable only from validation into that action dispatch;
- cTrader warm runtime reuse to remain exact account/group scoped and explicitly finalized;
- scope changes or failures to dispose/reject warm reuse rather than carry authority across actions.

### Implementation
- MT5 metadata uses timestamp-bound HMAC headers backed by the server-owned bridge secret; no secret is placed in URL/body;
- metadata verification is bounded by request timestamp freshness;
- MT5 risk materialization can hand the freshly loaded context to the exact action dispatch, where it is consumed; another action must not inherit it;
- cTrader sequential actions can reuse one authenticated runtime only inside the exact account/group batch;
- batch finalization closes the cTrader runtime once;
- account/group scope mismatch cannot reuse a warm runtime;
- cTrader execution failure disposes the warm runtime;
- all final durable source/workspace/account/kill/risk authority stays per-action and outside warm-context authority;
- cTrader protocol-cent semantics and fail-closed broker-native risk requirements remain unchanged.

### Exact-head GREEN evidence
- final implementation head `619fa842ee29addecc9cbbd3fad6bec6efe59f60` (`feat: finalize warm broker batch contexts`);
- exact ordinary PR run `33856378784`, job `100970541404` SUCCESS;
- Node/trading-core **685/685 PASS**;
- pure MT5 bridge **14/14 PASS**;
- Container MTProto **11/11 PASS**;
- external MTProto **22/22 PASS**;
- protected Cloudflare inspect/probe/deploy/accept jobs all SKIPPED.

Exact Task 7 passing contracts in that run include:
- `default MT5 metadata requests authenticate sensitive GETs with server-owned bridge secret`;
- `one MT5 risk-sized action reuses only its freshly loaded broker context between risk validation and dispatch`;
- `cTrader sequential actions reuse one exact batch runtime and batch finalization closes it once`;
- `cTrader warm runtime never crosses group or account scope and execution failure disposes it`.

No deployment, Cloudflare mutation, protected external probe, database mutation, demo broker order, or live broker order occurred.

---

# Frozen audit findings / current status
- **F1** Worker access fuse on non-HTTP broker paths — RESOLVED Task 1.
- **F2** workspace entitlement not final authority — RESOLVED Task 2.
- **F3** mutable account/safety authority loaded once — RESOLVED Task 2; dynamic final risk/exposure authority completed Task 3.
- **F4** source disablement not revalidated — RESOLVED Task 2.
- **F5** broker success can remain unbound from Trade State after state-write failure — RESOLVED Task 4.
- **F6** legacy `trade_accounts.workspace_id` FK couples Trading to MKSaaS workspace lifecycle — RESOLVED Task 5.
- **F7** broker-authoritative live risk sizing — RESOLVED Task 3.
- **F8** upward live OPEN volume normalization — RESOLVED Task 3.
- **F9** dropped production `tradingEventId` — RESOLVED Task 2.
- **F10** unreliable final policy/risk/exposure shape — RESOLVED Task 3.
- **I1** execution snapshot not production-integrated — RESOLVED Task 6.
- **I2** warm broker context/session reuse incomplete — RESOLVED Task 7.
- **U1** MT5 metadata GET authentication boundary — RESOLVED Task 7.

---

# Task 8 — static integrated failure-matrix acceptance
**Status: ACTIVE NEXT.**

The required matrix is:
1. Trading access false on execution/queue/retry broker-capable paths;
2. source disabled during event/retry;
3. workspace entitlement revoked;
4. account kill/execution revoked between legs/actions;
5. broker-min/off-step unsafe lots;
6. configured risk exposure absent/stale or broker economics changed;
7. exact persisted event linkage into execution/delivery/retry authority;
8. broker success + state-bind failure -> durable no-resend repair.

Task 8 should not add redundant tests merely to increase count. Re-read the exact current test bodies and map each matrix row to executable evidence. Add RED tests only for a genuine uncovered contract, verify intended RED in ordinary PR CI, then make the minimum production correction if needed.

Task 8 closes only when:
- every required matrix row has exact source/test evidence;
- a fresh exact-head ordinary PR CI is SUCCESS;
- Worker/trading-core, MT5 and both MTProto suites are all GREEN;
- protected Cloudflare/demo/live jobs remain skipped;
- both this file and `AGENTS.md` are synchronized with the exact evidence.

---

# Current gate interpretation
- Gate 1 historical GREEN.
- Gate 2 historical GREEN/exited; do not repeat without reason.
- Gate 3 deferred/fail-closed because genuine TradingView-originated acceptance capability remains unavailable.
- Gates 4–7 static foundations exist; real acceptance pending.
- Gates 8–9 require Task 8 static acceptance GREEN before real acceptance.
- Gate 10 CLOSED/not started.

After Task 8, return to separately authorized real acceptance in order: Gate 4 identity -> Gate 5 Telegram MTProto soak -> Gate 6 real demo source probes -> Gate 7 dedicated demo destination lifecycle -> Gate 8 E2E/failure soak -> Gate 9 operations/rollback/security -> Gate 10 A shadow -> B production-infrastructure demo -> C tiny controlled live only with separate explicit approval and explicit thresholds -> D beta -> E general production.

Gate 10 Phase C requires explicit max per-trade risk, max volume, max concurrent/open risk, daily loss ceiling, allowed symbols, and kill/rollback contacts/procedure. Never invent defaults.

## Exact pickup point for any future session
1. Read `AGENTS.md` and this document first; confirm current branch/PR head before writes.
2. Trust Task 7 GREEN only from implementation head `619fa842ee29addecc9cbbd3fad6bec6efe59f60`, run `33856378784`, job `100970541404`: 685/685 + 14/14 + 11/11 + 22/22 passing, protected jobs skipped.
3. Continue **Task 8** by inspecting the current production coordinator/integration/retry/repair tests and mapping each required failure row to exact executable evidence.
4. Pay special attention to exact between-action workspace revocation, kill/execution revocation, and persisted `tradingEventId` delivery/retry linkage.
5. Add RED tests only if a real matrix gap exists; verify intended RED through ordinary PR CI before production code.
6. If no gap exists, close Task 8 from source-level proof plus a fresh exact-head full ordinary PR CI run with protected jobs skipped.
7. Synchronize this file and `AGENTS.md` with Task 8 evidence.
8. Only after Task 8 exact-head static acceptance is GREEN return to separately authorized real Gates 4–9. Do not trigger protected workflows without explicit authorization.

## Safety state during static remediation
```text
TRADINGVIEW_DIRECT_INGRESS_ENABLED=false
TRADINGVIEW_CERT_PROBE_ENABLED=false
TRADING_ACCESS_ENABLED=false
BROKER_EXECUTION_ENABLED=false
```
Do not deploy, mutate Cloudflare, run protected external probes, place broker orders, merge `main`, or enable real-money execution without the exact later gate/approval contract.
