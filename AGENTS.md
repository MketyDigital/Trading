# Trading V1 – Operational Source of Truth

## Mission
Build and launch an enterprise, multi-tenant trading automation SaaS with strict tenant/provider/account/destination isolation, deterministic safety, durable idempotency, provider redundancy, admin controls, and explicit production cutover gates.

## Product / SaaS identity
- Mkety Trading is an enterprise product of the Mkety/MKSaaS ecosystem, not an isolated identity silo.
- Mkety products share the managed Mkety Zitadel identity authority, but Trading owns its own operational database, workspaces, memberships, sources, destinations, broker accounts, credentials, risk policy, Trade State, idempotency, retry/recovery and runtime state.
- Existing Mkety users may enter Trading through the same Zitadel identity when they have Trading entitlement/membership.
- Trading-only users may authenticate through the same Mkety Zitadel without requiring an MKSaaS database profile or routing through the MKSaaS application.
- MKSaaS runtime/database failure must not stop Trading. Trading runtime/database failure must not affect MKSaaS.

## Production-flow intent
1. Telegram MTProto, TradingView, MT5 source, cTrader source, and custom API normalize into one canonical Trading Event.
2. Clear instructions are deterministic; AI is ambiguity/presentation assistance only. Ambiguous AI failure becomes `NEEDS_REVIEW`, never guessed execution.
3. Source/event/destination/order identity is durable and workspace-scoped.
4. Telegram channels/groups are first-class destinations as well as possible sources. Human Telegram delivery and broker destinations are isolated sibling fan-out paths.
5. One event may fan out independently to Telegram channels/groups, MT5, cTrader and other approved destinations. One sibling failure must not roll back, suppress or redispatch unrelated successful siblings.
6. Immediately before every broker action, reload exact persisted event/source, Trading workspace entitlement, exact account state, kill/safety policy, fresh risk/exposure, broker economics, and final executable volume.
7. Dispatch only the canonical validated action through exact platform authority with persistent idempotency.
8. Broker success must converge to durable delivery truth and Trade State. State repair uses persisted successful broker truth and never resends solely to repair state.
9. Zitadel identity may be shared across Mkety products, but Trading tenancy/authorization/data authority is Trading-owned.
10. Optional subsystem failures degrade locally; money-moving uncertainty fails closed only on the affected path. Uncertain broker outcomes are reconciled, never blindly retried.

Caller-supplied workspace/account/provider/destination/broker/credential/execution hints are never authority. cTrader raw `ProtoOASymbol.lotSize` protocol-cent semantics remain unchanged.

## Failure-isolation / no-unrelated-impact invariant
The production target is not the impossible claim that external systems never fail. The contract is that avoidable single failures do not collapse unrelated functionality and failures remain inside the smallest safe fault domain.
- product isolation: MKSaaS failure != Trading failure;
- workspace isolation: tenant A failure != tenant B failure;
- source/provider isolation: one Telegram/provider/source failure != sibling source/provider failure;
- account/broker isolation: one MT5/cTrader account/provider failure != unrelated account/provider failure;
- destination isolation: Telegram destination failure != broker execution failure and vice versa;
- AI isolation: deterministic clear execution does not depend on AI availability;
- control-plane isolation: dashboard/admin/reporting/analytics/notification failures do not become execution authority or stop otherwise valid hot-path work;
- safety uncertainty is different: inability to prove source/workspace/account/risk/idempotency/broker outcome fails closed only on the affected money-moving path.

## Repository / branch
- Repository: `MketyDigital/Trading`
- Active branch: `design/enterprise-trading-event-core`
- Draft PR: #2 targeting `main`
- Latest verified code/tooling acceptance head before documentation-only Gate 6 classification: `5514d0fbff1d599580f042fbb77b34a3c927f8a5`.
- Ordinary PR run: `33898184523`; test job `101105739815` SUCCESS.
- Node/trading-core **690/690 PASS**; MT5 **14/14 PASS**; Container MTProto **11/11 PASS**; external MTProto **22/22 PASS**.
- Dedicated Gate 5 workflow run `33898179333`: regression job `101105722547` SUCCESS; protected `mtproto-soak-gate5` job `101105937826` **SKIPPED** because the real-acceptance marker was not used.
- Protected Cloudflare inspect/probe/deploy/accept jobs all **SKIPPED**.
- This remains development-to-real-production work. Do not merge/finish the branch yet.
- Never merge `main` without explicit user instruction.
- Never enable real-money execution without separate explicit final approval.

## Current stage / handoff
- Trusted pre-audit runtime/content tree: `89944d3b6aa4b03f6bb1a1107594e9acfa424fb3`.
- Frozen audit-scope commit: `7b175a548c9134b0e88ba4fa5977de51142b6cd3`.
- Static remediation plan: `docs/superpowers/plans/2026-09-03-production-readiness-remediation.md` at `567d8fe06c291eb393b5c23b3bd2d2dfbb65dbe4`.
- Launch master plan: `docs/superpowers/plans/2026-09-03-production-v1-launch-master-plan.md` at blob `48983550b3c33a7c3517c236370ffbc3d1d1788d`.
- Detailed evidence record: `cloudflare-v2/docs/PRODUCTION_V1_DEVELOPMENT_AUDIT.md`.
- Current stage: **STATIC PRODUCTION REMEDIATION COMPLETE — GATES 4, 5 AND 6 PROTECTED TOOLING STATIC GREEN/READY — REAL GATE 4 ACCEPTANCE REMAINS NEXT IN LAUNCH ORDER**.
- Gate 4/5/6 real environment acceptance has **not** been invoked. Do not mutate Zitadel/Cloudflare/Supabase, enable Trading access, start real Telegram soak sessions, or run protected demo/source probes merely from this status.

## Critical runtime safety defaults
Keep fail closed until an exact later gate explicitly changes the corresponding control:
- `TRADINGVIEW_DIRECT_INGRESS_ENABLED=false`
- `TRADINGVIEW_CERT_PROBE_ENABLED=false`
- `TRADING_ACCESS_ENABLED=false`
- `BROKER_EXECUTION_ENABLED=false`

No tenant/admin API may mutate Worker-wide master fuses.

## Core execution/safety contract
- Deterministic parsing/planning is primary; AI never authorizes clear machine-readable execution.
- Persistent event/destination/order idempotency is mandatory.
- Broker metadata is authoritative for symbol, precision, tick economics, volume, account mode, and execution semantics.
- Final source/workspace/account/safety/risk authority is revalidated immediately before every broker action.
- Critical source/workspace/account/kill/execution revocation wins immediately.
- Risk-increasing live volume normalization never silently increases intended risk.
- Risk-reducing protective actions remain permitted under drawdown/open-risk locks unless the kill switch blocks them.
- Successful broker truth remains repairable into Trade State without resending solely to repair state.
- `SUCCEEDED + STATE_BINDING_PENDING` belongs to the separate binding-repair plane, not broker retry.
- Runtime execution snapshots are advisory, non-secret, non-authoritative optimization only.
- Warm broker/session reuse is bounded to exact safe action/batch scope and never replaces fresh per-action authority/risk checks.

## Production execution locks
Before a broker adapter may be reached, all applicable locks must pass:
1. `TRADING_ACCESS_ENABLED=true`.
2. `BROKER_EXECUTION_ENABLED=true`.
3. exact persisted originating source remains active/workspace-authoritative.
4. exact Trading workspace entitlement remains enabled.
5. exact trade account belongs to that Trading workspace and remains active.
6. account `execution_enabled=true`.
7. latest kill/safety/risk/exposure policy allows the action.
8. server-owned platform/destination configuration is complete.
9. broker-authoritative symbol/risk/volume metadata validates the final executable action.
10. persistent destination/order idempotency reservation succeeds.
11. TradingView additionally requires its accepted ingress/source/certificate path.

## Production V1 launch gates
1. Scope freeze — historical GREEN.
2. Real Cloudflare staging — historical GREEN / exited; do not repeat without reason.
3. TradingView direct ingress — DEFERRED / FAIL-CLOSED.
4. Zitadel real non-live identity/workspace authorization — **protected tooling STATIC GREEN; real acceptance pending and not yet invoked**.
5. Telegram MTProto soak/recovery — **protected tooling STATIC GREEN; real soak/recovery acceptance pending and not yet invoked**.
6. MT5/cTrader source acceptance — **existing protected tooling STATIC GREEN; real demo source probes pending and not yet invoked**.
7. MT5/cTrader broker demo destinations — static tooling exists; real demo lifecycle pending.
8. End-to-end staging/failure soak — real acceptance pending.
9. Production operations/readiness — monitoring/kill/rollback/recovery/security drills and sustained measurements pending.
10. Controlled production cutover — CLOSED / not started: A shadow, B production infrastructure + dedicated demo, C tiny controlled live only after separate explicit approval and explicit owner thresholds, D controlled beta, E general production.

Production-ready/general launch still requires applicable real gate evidence and no unresolved severity-1/2 trading-safety issue.

## Static remediation status
- **Task 1 / F1 — STATIC GREEN / RESOLVED.** Dual Worker master fuses. Final GREEN head `1632889c6b26e88451ece25ba13c649b43357c5a`, run `33783267187`, job `100741828652`.
- **Task 2 / F2/F3/F4/F9 — STATIC GREEN / RESOLVED.** Durable per-action event/source/workspace/account authority. Final implementation head `9ba95eea33748aea1ab641e2aab4e0aec67068dc`, run `33784508546`, job `100745907350`.
- **Task 3 / F7/F8/F10 — STATIC GREEN / RESOLVED.** Broker-authoritative risk, strict no-upward OPEN volume, canonical final policy. Head `a3a507b569499524d6de75ad8c519db5dd944efb`, run `33843616430`, job `100930741996`.
- **Task 4 / F5 — STATIC GREEN / RESOLVED.** Broker-success Trade State repair without resend. Head `30be3bddb586e6a9bf02dea4520c338e3510287c`, run `33850696335`, job `100952562634`.
- **Task 5 / F6 — STATIC GREEN / RESOLVED.** Trading-owned trade-account workspace FK migration contract. Head `9a13bd2fa928d39cce826d05b005129fa10a68f3`, run `33851400665`.
- **Task 6 / I1 — STATIC GREEN / RESOLVED.** Advisory production execution snapshots. Head `400880cab6502c75ac487830bc3a90bb022f485c`, run `33853785408`, job `100962282286`.
- **Task 7 / I2/U1 — STATIC GREEN / RESOLVED.** Authenticated MT5 metadata + bounded warm MT5/cTrader contexts. Head `619fa842ee29addecc9cbbd3fad6bec6efe59f60`, run `33856378784`, job `100970541404`.
- **Task 8 — STATIC GREEN / RESOLVED.** Integrated failure matrix and durable production event-linkage assertion. Acceptance head `a7da981a5daec426b5aad840739555edfbc68819`, run `33865341673`, job `100998803951` SUCCESS: **685/685 + 14/14 + 11/11 + 22/22**, protected jobs skipped.

### Task 8 exact matrix evidence
1. Trading access false blocks execution and retry broker-capable paths.
2. Source revocation is re-resolved from durable event/retry authority and blocks dispatch.
3. Workspace entitlement is part of exact fresh authority and stale snapshots cannot override revocation.
4. Account active/execution/kill authority is reloaded per action; revocation after action one blocks action two.
5. MT5/cTrader risk-increasing OPEN refuses below-minimum and off-step volume rather than increasing risk.
6. Fresh broker economics/risk authority blocks stale/unsafe sizing and fails closed when reliable loss-at-stop economics are unavailable.
7. Normal production delivery explicitly asserts durable `tradingEventId` linkage at the persistent delivery-store boundary; retry authority reconstructs from durable event linkage.
8. Broker success + state-bind failure records repair work; repair binds persisted successful broker truth and dispatch remains exactly-once/no-resend.

No production code change was required for Task 8 beyond the explicit durable-event-linkage regression assertion. No deployment, Cloudflare mutation, protected external probe, database mutation, demo broker order, or live broker order occurred.

## Frozen finding status
F1–F10, I1, I2, and U1 are all **STATIC RESOLVED** by Tasks 1–8. This does not substitute for real environment acceptance.

## Gate 4 protected tooling — STATIC GREEN
- TDD RED contract head: `a0759701…`; ordinary CI proved exactly the two intended missing-tooling failures.
- Protected exact-marker/staging workflow and read-only identity runner use production Zitadel JWT + Trading membership authorization composition with both master fuses false.
- False-positive test correction head: `e018ce79d2c7cc9018775b71281be033691f58b8`.
- Ordinary PR run `33869550721`, job `101012027592` SUCCESS: Node **687/687**, MT5 **14/14**, Container MTProto **11/11**, external MTProto **22/22**; protected jobs skipped.
- Positive/negative coverage includes existing-Mkety user, Trading-only user, wrong project/org, missing/disabled membership, entitlement, roles and second-tenant isolation.
- No real Zitadel token/JWKS/database acceptance evidence yet. Static tooling GREEN is readiness only.

## Gate 5 protected tooling — STATIC GREEN
- RED head `df9bd1b0f6804df4366dec0a091848ffd84ba796`; run `33897870408`, job `101104697579` failed on the intentionally missing tooling contract.
- GREEN head `5514d0fbff1d599580f042fbb77b34a3c927f8a5` added exact-marker protected workflow, all-three-provider passive evidence runner, trigger runbook and sanitized canonical SHA-256 identity comparison.
- Ordinary run `33898184523`, job `101105739815` SUCCESS: **690/690 + 14/14 + 11/11 + 22/22**.
- Dedicated run `33898179333`: prerequisite `101105722547` SUCCESS; protected real soak `101105937826` SKIPPED.
- Requires final health, reconnect, catch-up, duplicate replay, edited-message evidence, downstream isolation, cross-provider convergence and Container isolation.
- No real Telegram acceptance occurred. Static tooling GREEN is readiness only.

## Gate 6 protected source-probe tooling — STATIC GREEN / EXISTING CAPABILITY VERIFIED
No new Gate 6 implementation was necessary during this checkpoint. Audit of the existing tooling found the required fail-closed source-probe surface already present and covered by the same verified 690/690 suite at `5514d0fbff1d599580f042fbb77b34a3c927f8a5`.
- Workflow: `.github/workflows/gate6-demo-probes.yml`.
- Trigger/runbook: `cloudflare-v2/docs/GATE6_DEMO_PROBE_TRIGGER.md`.
- Commands: `npm run accept:mt5:demo` and `npm run accept:ctrader:demo`.
- MT5 exact marker: `demo: probe mt5 gate 6`.
- cTrader exact marker: `demo: probe ctrader gate 6`.
- Both protected jobs require `environment: staging`, ordinary regression prerequisite, `BROKER_EXECUTION_ENABLED=false`, probe acceptance mode, and demo order test false.
- Gate 6 workflow tests prove no Supabase/workspace lifecycle/deploy wiring belongs to these source probes.
- MT5 probe tests prove health -> exact account/server -> dynamic broker symbol -> live tick, and fail closed on account/server mismatch before deeper discovery.
- cTrader probe tests force `environment='demo'`, `allowLiveTrading=false`, exact account authorization/catalog/quote discovery, and a fail-closed execution store.
- CLI tests prove probe mode never invokes lifecycle even if an order flag is accidentally present, unsupported `live` mode is rejected, and secret-looking result fields are sanitized/redacted.
- Real Gate 6 MT5/cTrader probes have **not** been invoked; this is static readiness only.

## External acceptance blockers / later gates
- managed Zitadel real non-live acceptance (Gate 4);
- real Telegram account/channel soak using protected Gate 5 tooling;
- real MT5/cTrader demo source probes using protected Gate 6 tooling;
- MT5/cTrader dedicated demo lifecycle (Gate 7);
- real E2E staging and sustained latency/failure/isolation measurements (Gate 8);
- Gate 9 monitoring/kill/rollback/recovery/security drills;
- genuine TradingView-originated Gate 3 acceptance remains deferred;
- Gate 10 shadow/demo/live/beta phases remain unstarted.

## Gate 10 safety
CLOSED / not started.
- Shadow production and production-infrastructure demo precede live money.
- Live cutover requires applicable prior gates GREEN or explicitly reviewed scope removal plus separate explicit tiny-live approval.
- Owner must explicitly set max per-trade risk, max volume, max concurrent/open risk, daily loss ceiling, allowed symbols, and kill/rollback contacts/procedure.
- Never invent/default live financial thresholds.

## Exact startup / pickup point for any future session
1. Read this file first, then `cloudflare-v2/docs/PRODUCTION_V1_DEVELOPMENT_AUDIT.md`, then the Sept 3 launch master plan and current acceptance runbooks.
2. Confirm PR #2 still targets `main`, branch is `design/enterprise-trading-event-core`, and reconcile current branch head before any write.
3. Static remediation closure: Task 8 head `a7da981a5daec426b5aad840739555edfbc68819`, run `33865341673`, job `100998803951`.
4. Gate 4 tooling readiness: `e018ce79d2c7cc9018775b71281be033691f58b8`, run `33869550721`, job `101012027592`.
5. Gate 5 tooling readiness: `5514d0fbff1d599580f042fbb77b34a3c927f8a5`, run `33898184523`, job `101105739815`; dedicated run `33898179333`, protected soak skipped.
6. Gate 6 tooling is an already-existing capability verified inside the same `5514d0fb…` / `33898184523` GREEN suite. Real MT5/cTrader probe jobs remain unrun.
7. Current next **launch-order** action remains real Gate 4 non-live Zitadel identity/workspace acceptance. Generic `continue` is not authorization to invoke a protected real-environment gate.
8. While waiting for explicit Gate 4 real-environment authorization, static readiness work may continue to Gate 7/8/9 so later gates are not blocked by missing tooling.
9. Before real Gate 4 invocation, re-read `cloudflare-v2/docs/GATE4_ZITADEL_ACCEPTANCE_TRIGGER.md` and verify exact marker, protected `staging` environment, required configuration, read-only scope, secret-free output and both master fuses false.
10. Do not trigger Gate 4/5/6 protected workflows, mutate Zitadel/Cloudflare/Supabase, enable `TRADING_ACCESS_ENABLED`, start real Telegram soak actions or run demo probes/orders without the separate exact authorization required for that gate.
11. After every separately authorized real gate, record exact workflow/run/job/case evidence in this file and `cloudflare-v2/docs/PRODUCTION_V1_DEVELOPMENT_AUDIT.md` before advancing launch order.

## Safety state
Do not deploy, mutate Cloudflare/Zitadel/Supabase, run protected external probes, start real Telegram acceptance, place demo/live broker orders, merge `main`, or enable real-money execution unless the exact later gate/approval explicitly authorizes that action.