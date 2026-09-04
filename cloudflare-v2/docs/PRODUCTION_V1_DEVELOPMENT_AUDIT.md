# Trading V1 Production Development Audit

## Purpose
Detailed continuation/evidence record for development-to-production work on draft PR #2, branch `design/enterprise-trading-event-core`. This is the technical companion to `AGENTS.md` and must allow a future session to resume without reconstructing intent from chat history.

This document does **not** authorize Cloudflare/Zitadel/Supabase mutation, protected external probes, real Telegram acceptance, demo/live broker orders, `main` merge, real-money execution, or Gate 10.

## Authority order
1. current `AGENTS.md` + `docs/superpowers/plans/2026-09-03-production-v1-launch-master-plan.md`;
2. latest approved Sept 3 technical specs/plans, especially execution bridge, hot-path resilience, destination retry and production-readiness remediation;
3. current acceptance/cutover runbooks;
4. Sept 2 identity/source/TradingView documents where still referenced by Sept 3;
5. Sept 1 foundation documents as historical context only.

Later Sept 3 resilience/cutover contracts control where stricter.

## Enterprise product / identity model
Mkety Trading is an enterprise product of the Mkety/MKSaaS ecosystem. It shares the managed Mkety Zitadel identity authority but does **not** depend on the MKSaaS application/database as its operational authorization or runtime data plane.
- Existing Mkety identities may use Trading when a Trading-owned entitlement/membership exists.
- Trading-only identities may authenticate through the same Mkety Zitadel without requiring an MKSaaS DB row.
- Trading owns its workspace entitlement, membership, sources, destinations, broker accounts, credentials, risk state, Trade State, idempotency, retry/recovery and runtime data.
- MKSaaS outage must not stop Trading; Trading outage must not affect MKSaaS.

## Enterprise production invariants / intended flow
1. Telegram MTProto, TradingView, MT5, cTrader and custom API sources enter one durable canonical Trading Event pipeline.
2. Clear machine-readable instructions are deterministic. AI may resolve bounded ambiguity or presentation only; unresolved ambiguity becomes `NEEDS_REVIEW`.
3. Persistent canonical event identity prevents duplicate interpretation/orchestration.
4. Correlation + durable Trade State resolve new entries and management instructions against Position Groups/legs.
5. Deterministic planning determines intended actions, but simulation/planning is never final live authority.
6. Immediately before each broker action, reload exact persisted event/source, Trading workspace entitlement, account active/execution/kill state, fresh risk/exposure and broker-authoritative symbol/economic/volume truth.
7. Persistent destination/order idempotency is reserved before broker send.
8. Broker results are persisted and bound to Trade State. Successful broker truth is repaired into state without broker resend if state binding fails.
9. Uncertain broker outcomes are reconciled and never blindly retried.
10. Telegram channels/groups are first-class destinations as well as possible sources. Human Telegram delivery and machine broker execution are sibling fan-out paths.
11. One destination/provider/account/workspace failure must not suppress or roll back unrelated successful siblings.
12. Caller-selected workspace/account/provider/destination/broker/credential/execution hints are never authority.
13. Execution snapshots and warm broker contexts are optimization only and never replace fresh authority.
14. cTrader raw `ProtoOASymbol.lotSize` protocol-cent semantics remain unchanged.

## No-unrelated-impact / fault-domain contract
- Product isolation: MKSaaS failure != Trading failure.
- Workspace isolation: tenant A failure != tenant B failure.
- Provider/source isolation: one Telegram/source provider failure != sibling provider/source failure.
- Broker/account isolation: one account/provider failure != unrelated account/provider failure.
- Destination isolation: Telegram delivery failure != broker execution failure and vice versa.
- AI isolation: clear deterministic execution remains possible when optional AI is unavailable.
- Control-plane isolation: dashboard/admin/reporting/analytics/notifications must not become hot-path execution dependencies.
- Safety uncertainty is handled separately: inability to prove source/workspace/account/risk/idempotency/broker outcome fails closed only on the affected money-moving path.

## Repository / baseline
- Repository: `MketyDigital/Trading`
- Branch: `design/enterprise-trading-event-core`
- Draft PR: #2 -> `main`
- Trusted pre-audit tree: `89944d3b6aa4b03f6bb1a1107594e9acfa424fb3`
- Pre-remediation broad CI: run `33766769463` SUCCESS; Node 649/649, MT5 14/14, Container MTProto 11/11, external MTProto 22/22.
- Frozen audit-scope commit: `7b175a548c9134b0e88ba4fa5977de51142b6cd3`.
- Static remediation plan: `docs/superpowers/plans/2026-09-03-production-readiness-remediation.md`, commit `567d8fe06c291eb393b5c23b3bd2d2dfbb65dbe4`.
- Controlling launch master blob: `48983550b3c33a7c3517c236370ffbc3d1d1788d`.

## Current development stage
**STATIC PRODUCTION REMEDIATION COMPLETE — GATES 4, 5 AND 6 PROTECTED TOOLING STATIC GREEN/READY — REAL GATE 4 ACCEPTANCE REMAINS NEXT IN LAUNCH ORDER.**

Latest verified code/tooling suite used for Gate 5 implementation and Gate 6 existing-capability audit:
- head `5514d0fbff1d599580f042fbb77b34a3c927f8a5`;
- ordinary PR run `33898184523` SUCCESS;
- test job `101105739815` SUCCESS;
- Node/trading-core **690/690 PASS**;
- MT5 **14/14 PASS**;
- Container MTProto **11/11 PASS**;
- external MTProto **22/22 PASS**;
- protected Cloudflare jobs skipped.

Gate 5 dedicated workflow run `33898179333` completed its regression prerequisite successfully and skipped the real protected soak job because its exact marker was not used.

No real Gate 4, Gate 5 or Gate 6 acceptance has been run. This PR is not at branch-finishing/merge stage. General production still requires applicable real Gates 4–9, shadow production, production-infrastructure demo, separate tiny-live approval, tiny-live acceptance, controlled beta and no unresolved severity-1/2 trading-safety issue.

## Development method
For remaining implementation work:
1. trace the latest approved requirement through the real runtime call graph;
2. write failing regression first only when a real contract gap exists;
3. verify intended RED on ordinary PR CI;
4. implement the minimum production change;
5. never weaken a safety contract just to satisfy a test;
6. require exact-head ordinary PR CI GREEN before calling implementation/tooling GREEN;
7. keep protected real-environment/demo/live jobs skipped unless separately authorized;
8. reconcile current branch head/blob before every write;
9. synchronize this file and `AGENTS.md` after every meaningful verified milestone.

---

# Static remediation milestone evidence

## Task 1 — both Worker master fuses on every broker-capable path
**F1 STATIC GREEN / RESOLVED.**
- RED: `7961849db8355c67801db5f68c3d5357f0768f99`, run `33782879644`, job `100740562007`.
- GREEN: `1632889c6b26e88451ece25ba13c649b43357c5a`, run `33783267187`, job `100741828652`.
- Production execution and scheduled retry both require `TRADING_ACCESS_ENABLED=true` and `BROKER_EXECUTION_ENABLED=true`.

## Task 2 — final durable execution authority and persisted event linkage
**F2/F3/F4/F9 STATIC GREEN / RESOLVED.**
- Final RED: `71be214f260adf9800bee362ede92ebe62888d5e`, run `33783879937`, job `100743853586`.
- Final implementation `9ba95eea33748aea1ab641e2aab4e0aec67068dc`; GREEN run `33784508546`, job `100745907350`.
- Runtime authority is exact persisted event -> originating source -> Trading workspace entitlement -> exact trade account; reload occurs per action and retry.

## Task 3 — broker-authoritative risk, strict execution volume, canonical final policy
**F7/F8/F10 STATIC GREEN / RESOLVED.**
- Broker-risk RED `825f8839b2ac53265547af547bc790e753f3f0da`, run `33785080713`, job `100747771938`.
- Strict-volume RED `e9a4729699b7617ea44d12f9b15708264fe573b5`.
- Final-policy RED `fc1496e7b62b4e11c385d0a8fed3ca8a783b8c24`, run `33785495528`, job `100749133738`.
- Implementation `a3a507b569499524d6de75ad8c519db5dd944efb`; GREEN run `33843616430`, job `100930741996`: Node 669/669 + 14/14 + 11/11 + 22/22.
- Final risk-increasing action is checked against current broker economics. MT5/cTrader OPEN never clamp/round upward into increased risk.

## Task 4 — successful broker truth -> Trade State repair without resend
**F5 STATIC GREEN / RESOLVED.**
- Implementation `30be3bddb586e6a9bf02dea4520c338e3510287c`; GREEN run `33850696335`, job `100952562634`: Node 675/675 + 14/14 + 11/11 + 22/22.
- Delivery stays terminal `SUCCEEDED`; `STATE_BINDING_PENDING` is a separate repair obligation. Repair consumes persisted broker truth and never dispatches a replacement broker order.

## Task 5 — Trading-owned trade-account tenancy migration contract
**F6 STATIC GREEN / RESOLVED.**
- Implementation `9a13bd2fa928d39cce826d05b005129fa10a68f3`; GREEN run `33851400665`: Node 678/678 + 14/14 + 11/11 + 22/22.
- Static migration repoints `trade_accounts.workspace_id` to Trading-owned workspace authority and fails closed on orphan Trading workspace ids. No real DB migration was applied by this remediation task.

## Task 6 — runtime execution snapshots
**I1 STATIC GREEN / RESOLVED.**
- Implementation `400880cab6502c75ac487830bc3a90bb022f485c`; GREEN run `33853785408`, job `100962282286`: Node 681/681 + 14/14 + 11/11 + 22/22.
- Order remains fresh durable authority -> advisory snapshot -> fresh broker-risk materialization -> final policy -> dispatch.

## Task 7 — authenticated MT5 metadata + bounded warm contexts
**U1/I2 STATIC GREEN / RESOLVED.**
- Implementation `619fa842ee29addecc9cbbd3fad6bec6efe59f60`; GREEN run `33856378784`, job `100970541404`: Node 685/685 + 14/14 + 11/11 + 22/22.
- MT5 metadata is HMAC/timestamp authenticated. MT5 same-action context and cTrader same-account/group runtime reuse are bounded and cannot replace fresh per-action authority/risk checks.

## Task 8 — integrated static failure matrix
**STATIC GREEN / RESOLVED.**
- Acceptance head `a7da981a5daec426b5aad840739555edfbc68819`; run `33865341673`, job `100998803951`: Node 685/685 + 14/14 + 11/11 + 22/22.
- Proved access fuse blocking, source/workspace/account revocation, account kill between actions, broker-min/off-step rejection, fresh risk/economic authority, durable event linkage and no-resend state repair.
- No runtime production correction was necessary beyond an explicit durable-event-linkage assertion.

## Frozen finding status
F1–F10, I1, I2 and U1 are all **STATIC RESOLVED**. This is not equivalent to real environment acceptance.

---

# Gate 4 readiness — real Zitadel identity/workspace authorization

## Controlling contract
Real Gate 4 must prove:
1. actual Trading Zitadel project/application and expected organization/workspace mapping;
2. immutable Zitadel `sub`, never email;
3. successful login alone does not bypass Trading entitlement;
4. exact workspace/sub membership;
5. owner/admin/operator/viewer permissions;
6. no workspace role grants broker execution;
7. wrong project/org/workspace, absent/revoked membership, unknown role and disabled entitlement fail closed;
8. second-tenant isolation;
9. broker execution remains separately disabled.

## Tooling evidence
- RED contract `a0759701…`: 687 total, 685 pass, exactly two intended missing-tooling failures.
- Protected exact-marker/staging workflow and read-only runner were implemented with both master fuses false.
- A first-GREEN test false-positive caused by matching the harmless `cloudflare-v2` path was narrowed without changing workflow safety.
- Verified head `e018ce79d2c7cc9018775b71281be033691f58b8`; run `33869550721`, job `101012027592`: **687/687 + 14/14 + 11/11 + 22/22**.
- Protected identity acceptance was not invoked.

**Interpretation:** Gate 4 tooling is STATIC GREEN/READY; Gate 4 real acceptance is pending.

---

# Gate 5 readiness — real Telegram MTProto soak/recovery

## Controlling contract
Real Gate 5 must prove all three providers independently and together:
- `cloudflare_container_mtproto`;
- `cloudflare_do_mtproto`;
- `external_mtproto`.

Required real evidence: test Telegram new/edited messages, disconnect/restart/reconnect, catch-up/replay, persistent duplicate collapse, downstream failure isolation, cross-provider convergence on one canonical native identity and Container non-selection for DO/external sources.

## Protected tooling TDD evidence
### RED
- `df9bd1b0f6804df4366dec0a091848ffd84ba796` (`test: define Gate 5 MTProto protected soak contract`).
- PR run `33897870408`, job `101104697579`: Worker/trading-core failed on the missing tooling contract; later suites did not run; protected jobs skipped.

### Implementation / GREEN
- `.github/workflows/gate5-mtproto-soak.yml`.
- `scripts/gate5_mtproto_soak.mjs` / `npm run accept:mtproto:gate5`.
- `docs/GATE5_MTPROTO_SOAK_TRIGGER.md`.
- Sanitized SHA-256 canonical-id digest comparison; no raw Telegram canonical id/session/API hash/phone/message body output.
- Exact marker: `source: accept mtproto gate 5`.
- Both `TRADING_ACCESS_ENABLED=false` and `BROKER_EXECUTION_ENABLED=false`.
- Implementation head `5514d0fbff1d599580f042fbb77b34a3c927f8a5`; ordinary run `33898184523`, job `101105739815`: **690/690 + 14/14 + 11/11 + 22/22**.
- Dedicated workflow run `33898179333`: regression prerequisite job `101105722547` SUCCESS; protected real soak `101105937826` SKIPPED.

**Interpretation:** Gate 5 tooling is STATIC GREEN/READY; no real Telegram soak/recovery evidence exists yet.

---

# Gate 6 readiness — real MT5/cTrader source/connectivity probes

## Controlling contract
Gate 6 is a **source/connectivity/metadata acceptance gate**, not the broker destination lifecycle gate. Real Gate 6 must prove the intended dedicated demo MT5/cTrader connectivity and broker metadata surfaces without creating or mutating a trade.

### MT5 source probe must prove
- bridge health;
- exact expected demo account identity;
- exact expected demo server;
- broker symbol list/details and dynamic canonical-symbol resolution;
- live tick/market status;
- fail closed on account/server mismatch;
- authenticated metadata boundary;
- zero order/lifecycle mutation.

### cTrader source probe must prove
- demo application/account authentication;
- exact expected account authorization;
- account/trader state;
- symbol list/details and live spot quote/status;
- forced demo environment and `allowLiveTrading=false`;
- zero order/lifecycle mutation.

## Existing protected tooling audited on 2026-09-04
No new runtime/tooling implementation was needed. Existing repository capability already contains:
- `.github/workflows/gate6-demo-probes.yml`;
- `cloudflare-v2/docs/GATE6_DEMO_PROBE_TRIGGER.md`;
- `npm run accept:mt5:demo`;
- `npm run accept:ctrader:demo`;
- production-shaped probe runners and CLI mode separation;
- `gate6_demo_probe_workflow.test.mjs`, MT5/cTrader acceptance tests and CLI tests.

### Workflow safety contract
- MT5 exact marker: `demo: probe mt5 gate 6`.
- cTrader exact marker: `demo: probe ctrader gate 6`.
- Both protected jobs require branch `design/enterprise-trading-event-core`, `environment: staging`, and ordinary regression prerequisite.
- `BROKER_EXECUTION_ENABLED=false` in both jobs.
- `MT5_DEMO_ACCEPTANCE_MODE='probe'` + `MT5_DEMO_ORDER_TEST='false'`.
- `CTRADER_DEMO_ACCEPTANCE_MODE='probe'` + `CTRADER_DEMO_ORDER_TEST='false'`.
- Gate 6 workflow has no Supabase/workspace lifecycle wiring, Wrangler/Cloudflare deployment, or lifecycle mode in the probe jobs.

### Runtime/test safety evidence
MT5:
- probe validates health/account/server before symbol/tick discovery;
- account/server mismatch stops before deeper discovery;
- broker symbol is resolved dynamically and live tick is captured;
- order action construction is separately gated and rejects unsafe below-min volume;
- CLI defaults to probe and never invokes lifecycle even when order-test env is accidentally present;
- unsupported `live` CLI mode is rejected;
- secret-looking output fields are sanitized.

cTrader:
- environment validation ignores a caller request for live and forces demo;
- runtime receives `environment='demo'` and `allowLiveTrading=false`;
- exact account/catalog/live spot quote are observed;
- probe uses a fail-closed execution store so reserve/complete/fail cannot become trade execution during probe;
- lifecycle remains separately gated;
- CLI probe mode never invokes lifecycle even when order-test env is accidentally present;
- unsupported `live` mode is rejected and secret-looking fields are sanitized.

### Verification anchor
These Gate 6 tests are part of the Node `tests/*.test.mjs` suite that passed on exact code/tooling head `5514d0fbff1d599580f042fbb77b34a3c927f8a5`, ordinary PR run `33898184523`, test job `101105739815`: Node **690/690**, MT5 **14/14**, Container MTProto **11/11**, external MTProto **22/22**. No Gate 6 protected probe was triggered during that run.

**Interpretation:** Gate 6 tooling is **STATIC GREEN / READY TO RUN**. Gate 6 real MT5/cTrader demo source probes are **NOT REAL-ACCEPTED**.

---

# Current gate interpretation
- Gate 1 historical GREEN.
- Gate 2 historical GREEN/exited.
- Gate 3 deferred/fail-closed.
- **Gate 4: tooling STATIC GREEN; real identity acceptance pending.**
- **Gate 5: tooling STATIC GREEN; real MTProto soak/recovery pending.**
- **Gate 6: existing tooling STATIC GREEN; real MT5/cTrader source probes pending.**
- Gate 7 static demo-destination tooling exists; real lifecycle pending and should be audited next while waiting for real-gate authorization.
- Gates 8–9 static remediation prerequisite is satisfied; real E2E/ops acceptance still pending.
- Gate 10 CLOSED/not started.

Launch order remains: Gate 4 real identity -> Gate 5 real Telegram soak -> Gate 6 real demo source probes -> Gate 7 dedicated demo destination lifecycle -> Gate 8 E2E/failure soak -> Gate 9 operations/rollback/security -> Gate 10A shadow -> 10B production-infrastructure demo -> 10C tiny controlled live only with separate explicit approval and owner-set thresholds -> beta -> general production.

Gate 10C requires explicit max per-trade risk, max volume, max concurrent/open risk, daily loss ceiling, allowed symbols and kill/rollback contacts/procedure. Never invent defaults.

## Exact pickup point
1. Read `AGENTS.md` and this audit first; reconcile current branch/PR head before writes.
2. Static remediation closure: `a7da981a5daec426b5aad840739555edfbc68819`, run `33865341673`, job `100998803951`.
3. Gate 4 tooling: `e018ce79d2c7cc9018775b71281be033691f58b8`, run `33869550721`, job `101012027592`.
4. Gate 5 tooling: `5514d0fbff1d599580f042fbb77b34a3c927f8a5`, run `33898184523`, job `101105739815`; dedicated run `33898179333`, protected soak skipped.
5. Gate 6 tooling is existing capability verified within the same `5514d0fb…` / `33898184523` GREEN suite; protected MT5/cTrader probe jobs remain unrun.
6. Current next **launch-order** action is real Gate 4. Generic `continue` does not authorize protected real-environment execution.
7. Current next **static-readiness** action while waiting for real authorization is Gate 7 demo-destination tooling audit. If it is already complete, record it without unnecessary code churn; if a genuine gap exists, use RED -> GREEN.
8. Do not trigger Gate 4/5/6/7 protected jobs, mutate Zitadel/Cloudflare/Supabase, start real Telegram acceptance, or place demo/live broker orders without the exact separate authorization required for that gate.
9. After any real gate, write exact workflow/run/job/case evidence into both handoff files before advancing launch order.

## Safety state
```text
TRADINGVIEW_DIRECT_INGRESS_ENABLED=false
TRADINGVIEW_CERT_PROBE_ENABLED=false
TRADING_ACCESS_ENABLED=false
BROKER_EXECUTION_ENABLED=false
```
Do not deploy, mutate Cloudflare/Zitadel/Supabase, run protected external probes, start real Telegram acceptance, place broker orders, merge `main`, or enable real-money execution without the exact later gate/approval contract.