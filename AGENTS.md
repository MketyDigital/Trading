# Trading V1 – Operational Source of Truth

## Mission
Build and launch Mkety Trading as an enterprise, multi-tenant trading automation SaaS with strict tenant/provider/account/destination isolation, deterministic safety, durable idempotency, provider redundancy, admin controls and a controlled production rollout.

The system is now past broad architecture/static-remediation development. The controlling objective is **run the already-built system in real staging/demo, fix defects proved by real evidence, then launch progressively**.

## Controlling production-fast-path decision — 2026-09-04
From this point forward, **no new production architecture or elaborate acceptance tooling is added unless it fixes a proven blocker discovered by ordinary CI, real staging, demo execution, or safe live-readiness verification.**

Do not keep expanding gates, harnesses, abstractions, workflows or speculative enterprise hardening merely because they could be useful. Existing protected tooling may be used where it already exists, but tooling construction is no longer the project goal.

### Direct path to production
1. **Return the current branch to exact-head ordinary CI GREEN.** Fix only the current Gate 6 wording/assertion mismatch; do not change runtime behavior for it.
2. **Freeze architecture/tooling.** No new framework/gate/workflow unless an actual test or staging/demo defect proves it is required.
3. **Prepare and deploy the existing system to real staging** using the existing infrastructure and safe defaults.
4. **Connect real integrations in staging:** shared Mkety Zitadel identity, Trading-owned database/workspaces, Telegram source/destination, MT5 demo source/destination and cTrader demo source/destination.
5. **Run the actual end-to-end product flow:** real source event -> canonical Trading Event -> deterministic parse/normalization -> correlation/Trade State -> planning -> Telegram/broker fanout -> fresh execution authority/risk -> demo broker action -> durable result -> management/close -> recovery/idempotency.
6. **Fix only defects demonstrated by staging/demo evidence.** Every money-moving defect still follows RED -> minimal fix -> exact-head GREEN.
7. **Run failure/recovery checks in the real staging system** for the material risks: duplicate/replay, reconnect, source/account revocation, destination isolation, broker uncertainty, state-binding repair and kill/rollback behavior.
8. **Run shadow production:** real incoming signals and real calculations/decisions, but no real-money broker execution.
9. **Run controlled dedicated demo execution** long enough to prove broker behavior, reconnect/recovery, idempotency and position-management correctness under real conditions.
10. **Tiny controlled live** only after separate explicit owner approval and explicit financial limits, followed by controlled beta and general production rollout.

### What is already built — do not rebuild it
- enterprise multi-tenant Trading runtime;
- shared Mkety Zitadel identity model with an independent Trading runtime/data plane;
- Trading-owned workspaces, memberships and trade-account tenancy;
- universal source registry;
- canonical Trading Event pipeline;
- deterministic parser/normalizer with bounded AI only for ambiguity;
- Telegram MTProto source providers: Cloudflare Container, Cloudflare DO/mtcute and external MTProto;
- TradingView/custom signed source foundations;
- MT5 source capture and cTrader source capture;
- Telegram channels/groups as first-class destinations;
- MT5 and cTrader broker destinations;
- parallel human-delivery and machine-execution fanout;
- durable Trade State / Position Groups / multi-leg management;
- risk, safety and kill-switch controls;
- broker-authoritative symbol/economic/volume validation;
- persistent event/destination/order idempotency;
- isolated destination retry and recovery;
- uncertain broker-outcome reconciliation;
- successful broker-result -> Trade State repair without broker resend;
- advisory execution snapshots and bounded broker/session reuse;
- authenticated MT5 metadata boundary;
- tenant/provider/source/destination/account fault isolation;
- admin/operations/observability foundations;
- full static remediation Tasks 1–8.

### What actually remains before production
This is now mostly **real-environment validation and rollout**, not architecture development:
- current branch exact-head GREEN;
- staging deployment/configuration of the already-built system;
- real non-live Zitadel identity/workspace acceptance;
- real Telegram source/destination soak;
- real MT5/cTrader source events;
- real MT5/cTrader dedicated demo execution E2E;
- real staging failure/recovery drills;
- shadow production;
- controlled demo soak on production-like infrastructure;
- tiny live only with explicit owner limits/approval;
- controlled beta/general rollout.

## Product / SaaS identity
- Mkety Trading is an enterprise product of the Mkety/MKSaaS ecosystem, not an isolated identity silo.
- Mkety products share the managed Mkety Zitadel identity authority, while Trading owns its operational database, workspaces, memberships, sources, destinations, broker accounts, credentials, risk policy, Trade State, idempotency, retry/recovery and runtime state.
- Existing Mkety users may enter Trading through the same Zitadel identity when they have Trading entitlement/membership.
- Trading-only users may authenticate through the same Mkety Zitadel without requiring an MKSaaS database profile or MKSaaS application runtime.
- MKSaaS runtime/database failure must not stop Trading. Trading runtime/database failure must not affect MKSaaS.

## Intended production flow
1. Telegram MTProto, TradingView, MT5 source, cTrader source and custom API enter one authenticated canonical Trading Event pipeline.
2. Clear machine-readable instructions are deterministic. AI is bounded ambiguity/presentation assistance only; unresolved ambiguity becomes `NEEDS_REVIEW`.
3. Canonical source/event identity is persistent and workspace scoped.
4. Correlation + durable Trade State resolve entries and management against Position Groups/legs.
5. Planning determines intended actions but is never final live authority.
6. One canonical event may fan out independently to Telegram channels/groups, MT5, cTrader and approved custom destinations.
7. Human Telegram delivery and broker execution are sibling paths; one destination failure must not cancel, roll back or resend unrelated successful siblings.
8. Immediately before every broker action, reload exact persisted event/source, Trading workspace entitlement, account active/execution/kill state, fresh risk/exposure and broker-authoritative symbol/economic/volume truth.
9. Reserve persistent destination/order idempotency before broker send.
10. Persist broker/destination result truth and bind exact Position Group/leg.
11. If state binding fails after broker success, repair from persisted successful broker truth without resending the broker action.
12. If broker outcome is uncertain, reconcile; never blindly retry.

Caller-supplied workspace/account/provider/destination/broker/credential/execution hints are never authority. cTrader `ProtoOASymbol.lotSize` protocol-cent semantics remain unchanged.

## Failure-isolation / no-unrelated-impact invariant
The target is fault isolation, graceful degradation and safe recovery—not the impossible claim that external systems never fail.
- product isolation: MKSaaS failure != Trading failure;
- workspace isolation: tenant A failure != tenant B failure;
- source/provider isolation: one source/provider failure != sibling source/provider failure;
- account/broker isolation: one broker/account failure != unrelated account/provider failure;
- destination isolation: Telegram delivery failure != broker execution failure and vice versa;
- AI isolation: deterministic clear execution does not depend on AI availability;
- control-plane isolation: admin/dashboard/reporting/analytics/notification failures do not become execution authority;
- configuration isolation: changing one role/source/destination/provider/account must not mutate or stop unrelated functionality;
- safety uncertainty: inability to prove source/workspace/account/risk/idempotency/broker outcome fails closed only on the affected money-moving path.

## Repository / branch
- Repository: `MketyDigital/Trading`
- Active branch: `design/enterprise-trading-event-core`
- Draft PR: #2 -> `main`
- Current pre-fast-path head when this decision was adopted: `052aa1d3b0b6a03b5c62a735fd4184791e83dd90`.
- Do not merge/finish the branch until staging/demo launch readiness is actually proved.
- Never merge `main` without explicit user instruction.
- Never enable real-money execution without separate explicit final approval.

## Current stage / exact handoff
**STATIC REMEDIATION COMPLETE. PRODUCTION FAST PATH ACTIVE. CURRENT IMMEDIATE BLOCKER = ONE GATE 6 TEST WORDING/ASSERTION MISMATCH, NOT A RUNTIME DEFECT. AFTER EXACT-HEAD GREEN, NEXT WORK IS STAGING READINESS/DEPLOYMENT PREPARATION — NOT MORE TOOLING.**

Current failing candidate:
- head `052aa1d3b0b6a03b5c62a735fd4184791e83dd90`;
- ordinary PR run `33900898768`;
- job `101114473595`;
- Node/trading-core: **692 total, 691 pass, 1 fail**;
- failing test: `Gate 6 source runners exercise capture-to-canonical replay without creating broker orders`;
- failure is documentation wording: assertion `/MT5.*deal history/i` does not span the existing correct wording (`MT5SourceCapture` / `history_deals_get` / `broker deal history`);
- this is **not** evidence of a trading runtime/source-capture defect;
- MT5/MTProto later suites did not run because Node failed first;
- protected external jobs remained skipped;
- no real source/broker/environment action occurred.

### Immediate pickup
1. Re-fetch PR #2/head before every write because the branch may advance concurrently.
2. Fix only the Gate 6 wording/assertion mismatch. Prefer asserting the actual semantic evidence (`history_deals_get` or MT5 source section + broker deal history) rather than modifying runtime code.
3. Run ordinary PR CI on the exact head.
4. Require Node + MT5 + Container MTProto + external MTProto GREEN; protected real-environment jobs stay skipped.
5. Record exact GREEN head/run/job/counts here and in `cloudflare-v2/docs/PRODUCTION_V1_DEVELOPMENT_AUDIT.md`.
6. Then stop adding gate/tooling architecture and move to **staging deployment/readiness inspection**.
7. Static staging inspection may continue without authorization. Any actual deployment, external identity/Telegram probe, database mutation or demo broker action requires the corresponding explicit real-environment authorization.

## Critical runtime safety defaults
Keep fail closed until an explicitly authorized later rollout step changes the corresponding control:
- `TRADINGVIEW_DIRECT_INGRESS_ENABLED=false`
- `TRADINGVIEW_CERT_PROBE_ENABLED=false`
- `TRADING_ACCESS_ENABLED=false`
- `BROKER_EXECUTION_ENABLED=false`

No tenant/admin API may mutate Worker-wide master fuses.

## Core execution/safety contract
- deterministic parsing/planning is primary; AI never authorizes clear execution;
- persistent event/destination/order idempotency is mandatory;
- broker metadata is authoritative for symbol, precision, tick economics, volume, account mode and execution semantics;
- final source/workspace/account/safety/risk authority is revalidated immediately before every broker action;
- critical source/workspace/account/kill/execution revocation wins immediately;
- risk-increasing live volume normalization never silently increases intended risk;
- risk-reducing protective actions remain possible unless the kill switch explicitly blocks them;
- successful broker truth is repairable into Trade State without resend;
- `SUCCEEDED + STATE_BINDING_PENDING` belongs to state-binding repair, never broker retry;
- snapshots are advisory/non-secret/non-authoritative only;
- warm broker/session reuse is bounded and never replaces fresh authority/risk.

## Production execution locks
Before a broker adapter may be reached, all applicable locks must pass:
1. `TRADING_ACCESS_ENABLED=true`;
2. `BROKER_EXECUTION_ENABLED=true`;
3. exact persisted originating source remains active/workspace-authoritative;
4. exact Trading workspace entitlement remains enabled;
5. exact trade account belongs to the workspace and remains active;
6. account `execution_enabled=true`;
7. latest kill/safety/risk/exposure policy allows the action;
8. server-owned platform/destination configuration is complete;
9. broker-authoritative symbol/risk/volume metadata validates final executable action;
10. persistent destination/order idempotency reservation succeeds;
11. TradingView additionally requires its accepted ingress/source/certificate path.

## Static remediation closure
F1–F10, I1, I2 and U1 are STATIC RESOLVED. This remains important safety evidence but must not become an excuse for more speculative static work.

- Task 1/F1 dual Worker fuses — GREEN `1632889c6b26e88451ece25ba13c649b43357c5a`, run `33783267187`, job `100741828652`.
- Task 2/F2/F3/F4/F9 durable per-action authority/event linkage — GREEN `9ba95eea33748aea1ab641e2aab4e0aec67068dc`, run `33784508546`, job `100745907350`.
- Task 3/F7/F8/F10 broker-authoritative risk/no-upward volume/final policy — GREEN `a3a507b569499524d6de75ad8c519db5dd944efb`, run `33843616430`, job `100930741996`.
- Task 4/F5 broker-success state repair/no resend — GREEN `30be3bddb586e6a9bf02dea4520c338e3510287c`, run `33850696335`, job `100952562634`.
- Task 5/F6 Trading-owned workspace FK contract — GREEN `9a13bd2fa928d39cce826d05b005129fa10a68f3`, run `33851400665`.
- Task 6/I1 advisory execution snapshots — GREEN `400880cab6502c75ac487830bc3a90bb022f485c`, run `33853785408`, job `100962282286`.
- Task 7/I2/U1 authenticated MT5 metadata + bounded warm contexts — GREEN `619fa842ee29addecc9cbbd3fad6bec6efe59f60`, run `33856378784`, job `100970541404`.
- Task 8 integrated failure matrix/event linkage — GREEN `a7da981a5daec426b5aad840739555edfbc68819`, run `33865341673`, job `100998803951`: **685/685 Node + 14/14 MT5 + 11/11 Container MTProto + 22/22 external MTProto**; protected jobs skipped.

## Existing protected tooling — use, do not keep expanding
- Gate 4 Zitadel acceptance tooling: STATIC GREEN; real acceptance not run.
  - head `e018ce79d2c7cc9018775b71281be033691f58b8`, run `33869550721`, job `101012027592`; **687/687 + 14/14 + 11/11 + 22/22**.
- Gate 5 MTProto soak tooling: STATIC GREEN; real soak not run.
  - head `5514d0fbff1d599580f042fbb77b34a3c927f8a5`, run `33898184523`, job `101105739815`; **690/690 + 14/14 + 11/11 + 22/22**.
- Existing MT5/cTrader connectivity/metadata demo probes remain useful prerequisites.
- Gate 6 source-capture wrapper was added to prove the launch-master source requirement. Its current only failure is the wording assertion described above. **Do not expand Gate 6 further once this test is GREEN unless real staging finds a source defect.**
- Gate 7 demo lifecycle tooling already exists. Do not build more Gate 7 tooling pre-emptively; use real demo E2E to find actual defects.

## Simplified real-environment rollout sequence
The old numbered gates remain useful as evidence categories, but they are not a mandate to build more tooling. The operational sequence is now:

### Phase A — Branch GREEN
Current task. Finish the one test mismatch and get full ordinary CI GREEN.

### Phase B — Real staging
Deploy/configure the existing system safely with master execution fuses off. Verify infrastructure, DB migrations/prerequisites, bindings/secrets presence without exposing secrets, and rollback path.

### Phase C — Real integrations / non-live acceptance
Use existing tooling or direct product flows to verify:
- Zitadel identity + Trading-owned memberships/workspaces;
- Telegram source and destination;
- MT5 source/demo destination;
- cTrader source/demo destination;
- exact tenant/source/account isolation.

### Phase D — Actual E2E demo
Prove a real signal through the whole product:
`source -> canonical event -> parser -> Trade State -> planning -> Telegram delivery + broker demo execution -> broker result -> management/close -> durable state/recovery`.

### Phase E — Failure/recovery in staging
Exercise only material launch risks: duplicate/replay, reconnect/restart, revocation/kill, one-destination failure isolation, uncertain broker outcome/reconciliation, state-bind repair and rollback.

### Phase F — Shadow production
Real inputs and real decisions on production-like infrastructure, but no real-money orders.

### Phase G — Dedicated demo soak
Continuous demo execution long enough to expose actual broker/platform/network behavior.

### Phase H — Tiny controlled live
Requires separate explicit user approval and exact owner-set limits:
- max per-trade risk;
- max volume;
- max concurrent/open risk;
- daily loss ceiling;
- allowed symbols;
- kill/rollback contacts/procedure.
Never invent these defaults.

### Phase I — Controlled beta -> general production
Expand only after tiny-live evidence is clean and no unresolved severity-1/2 trading-safety issue remains.

## TradingView status
Genuine TradingView-originated direct-ingress/certificate acceptance remains deferred/fail-closed. It must not block launch of the approved non-TradingView source scope unless the product launch scope explicitly requires it.

## Safety state
Generic `continue` authorizes safe repository development/static inspection only. It does **not** authorize deployment, Cloudflare/Zitadel/Supabase mutation, protected external probes, real Telegram acceptance, demo/live broker orders, enabling master execution/access fuses, `main` merge or real-money execution.

## Mandatory handoff discipline
After every meaningful verified milestone:
1. update this file;
2. update `cloudflare-v2/docs/PRODUCTION_V1_DEVELOPMENT_AUDIT.md`;
3. record exact branch head, CI run/job and test counts;
4. state what was achieved, what remains, safety state and exact next pickup;
5. preserve the full product architecture and Production Fast Path so a new session does not restart speculative architecture/tooling work.