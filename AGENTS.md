# Trading V1 – Operational Source of Truth

## Mission
Build and launch an enterprise, multi-tenant trading automation SaaS with strict tenant/provider/account/destination isolation, deterministic safety, durable idempotency, provider redundancy, admin controls, and explicit production cutover gates.

## Production-flow intent
1. Telegram MTProto, TradingView, MT5 source, cTrader source, and custom API normalize into one canonical Trading Event.
2. Clear instructions are deterministic; AI is ambiguity/presentation assistance only. Ambiguous AI failure becomes `NEEDS_REVIEW`, never guessed execution.
3. Source/event/destination/order identity is durable and workspace-scoped.
4. Human delivery and broker destinations are isolated sibling fan-out paths.
5. Immediately before every broker action, reload exact persisted event/source, Trading workspace entitlement, exact account state, kill/safety policy, fresh risk/exposure, broker economics, and final executable volume.
6. Dispatch only the canonical validated action through exact platform authority with persistent idempotency.
7. Broker success must converge to durable delivery truth and Trade State. State repair uses persisted successful broker truth and never resends solely to repair state.
8. Zitadel identity may be shared across Mkety products, but Trading tenancy/authorization/data authority is Trading-owned.
9. Optional subsystem failures degrade locally; money-moving uncertainty fails closed only on the affected path. Uncertain broker outcomes are reconciled, never blindly retried.

Caller-supplied workspace/account/provider/destination/broker/credential/execution hints are never authority. cTrader raw `ProtoOASymbol.lotSize` protocol-cent semantics remain unchanged.

## Repository / branch
- Repository: `MketyDigital/Trading`
- Active branch: `design/enterprise-trading-event-core`
- Draft PR: #2 targeting `main`
- Current verified implementation/tooling head before this documentation sync: `5514d0fbff1d599580f042fbb77b34a3c927f8a5`
- Verified ordinary PR run: `33898184523`; test job `101105739815` SUCCESS.
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
- Current stage: **STATIC PRODUCTION REMEDIATION COMPLETE — GATE 4 AND GATE 5 PROTECTED TOOLING STATIC GREEN — REAL GATE 4 ACCEPTANCE REMAINS NEXT**.
- Gate 4 and Gate 5 real environment acceptance have **not** been invoked. Do not mutate Zitadel/Cloudflare/Supabase, enable Trading access, start real Telegram soak sessions, or run protected acceptance workflows merely from this status.

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
6. MT5/cTrader source acceptance — real demo source probes pending.
7. MT5/cTrader broker demo destinations — real demo lifecycle pending.
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
7. Normal production delivery now explicitly asserts durable `tradingEventId` linkage at the persistent delivery-store boundary; retry authority reconstructs from durable event linkage.
8. Broker success + state-bind failure records repair work; repair binds persisted successful broker truth and dispatch remains exactly-once/no-resend.

No production code change was required for Task 8 beyond the explicit durable-event-linkage regression assertion. No deployment, Cloudflare mutation, protected external probe, database mutation, demo broker order, or live broker order occurred.

## Frozen finding status
F1–F10, I1, I2, and U1 are all **STATIC RESOLVED** by Tasks 1–8. This does not substitute for real environment acceptance.

## Gate 4 controlling contract
Use immutable Zitadel `sub`, never email. Successful login proves identity only. Real Gate 4 must prove:
- intended managed Mkety Zitadel issuer;
- Trading-specific application/audience and exact Trading project claim;
- exact workspace-bound Zitadel organization;
- exact enabled `(workspace_id, zitadel_subject)` Trading membership;
- documented owner/admin/operator/viewer permissions;
- no workspace role implicitly grants broker execution;
- wrong project, wrong organization/workspace, absent/revoked membership, unknown role, disabled entitlement, and second-tenant access all fail closed;
- second-tenant source/account/destination/health/retry/idempotency/control isolation;
- broker execution remains separately disabled.

## Gate 4 protected tooling — STATIC GREEN
- TDD RED contract head: `a0759701` (full SHA available from Git history); ordinary CI proved exactly the two intended missing-tooling failures while the existing suite remained green.
- Protected acceptance workflow and thin read-only identity runner were then implemented. The runner uses the production Zitadel JWT + Trading membership authorization composition, but the protected real-identity job is exact-marker/staging-protected and was **not invoked** during tooling implementation.
- First GREEN attempt exposed only a test false positive: the contract banned the bare word `cloudflare`, unintentionally matching `working-directory: cloudflare-v2`. No workflow/production safety behavior was implicated.
- False-positive assertion fix head: `e018ce79d2c7cc9018775b71281be033691f58b8` (`test: narrow Gate 4 mutation assertion`).
- Exact-head ordinary PR run `33869550721`, test job `101012027592` SUCCESS:
  - Node/trading-core **687/687 PASS**;
  - MT5 **14/14 PASS**;
  - Container MTProto **11/11 PASS**;
  - external MTProto **22/22 PASS**;
  - protected Cloudflare inspect/probe/deploy/accept jobs **SKIPPED**.
- Static Gate 4 tests explicitly prove the workflow is exact-marker, `staging`-protected, non-broker, and the runner is secret-free with positive, negative, role, membership, project/org, and tenant-isolation case coverage.
- The protected runner asserts both `TRADING_ACCESS_ENABLED=false` and `BROKER_EXECUTION_ENABLED=false`; it performs identity/membership acceptance read-only and does not use normal Trading application routes to bypass the closed access fuse.
- No real Zitadel token/JWKS/database acceptance evidence has been produced yet. Static tooling GREEN is readiness only, not Gate 4 real acceptance.

## Gate 5 protected tooling — STATIC GREEN
- TDD RED contract head: `df9bd1b0f6804df4366dec0a091848ffd84ba796` (`test: define Gate 5 MTProto protected soak contract`).
- RED ordinary PR run `33897870408`, job `101104697579`: Worker/trading-core step failed on the newly added missing-tooling contract; later Python stages did not run; protected jobs remained skipped.
- GREEN implementation added:
  - `.github/workflows/gate5-mtproto-soak.yml` with exact marker `source: accept mtproto gate 5`, protected `staging` environment, ordinary regression prerequisite, and both master fuses false;
  - `scripts/gate5_mtproto_soak.mjs` covering all three provider types, recovery/catch-up/duplicate evidence, cross-provider convergence, downstream isolation and Container guard;
  - `npm run accept:mtproto:gate5`;
  - `docs/GATE5_MTPROTO_SOAK_TRIGGER.md`;
  - sanitized SHA-256 canonical-event digests in the existing observation-only soak helper so cross-provider identity can be compared without outputting raw Telegram canonical IDs.
- Exact GREEN implementation head: `5514d0fbff1d599580f042fbb77b34a3c927f8a5`.
- Ordinary PR run `33898184523`, job `101105739815` SUCCESS: Node/trading-core **690/690 PASS**, MT5 **14/14 PASS**, Container MTProto **11/11 PASS**, external MTProto **22/22 PASS**; protected Cloudflare jobs skipped.
- Dedicated Gate 5 workflow run `33898179333`: regression job `101105722547` SUCCESS; protected real soak job `101105937826` SKIPPED because the exact authorization marker was not used.
- The runner is fail-closed and observation-only. It requires final healthy state, reconnect, catch-up, duplicate replay, edited-message evidence, downstream isolation, cross-provider duplicate convergence, and Container isolation. It never authorizes broker execution.
- No real Telegram account/session/channel acceptance, reconnect/restart, downstream-failure injection, Container startup, Cloudflare mutation, broker action, or protected external probe occurred in this tooling batch. Static tooling GREEN is readiness only, not Gate 5 real acceptance.

## External acceptance blockers / later gates
- managed Zitadel real non-live acceptance (Gate 4);
- real Telegram account/channel soak using the protected Gate 5 tooling (Gate 5);
- MT5/cTrader real demo source probes with exact Gate 6 markers;
- MT5/cTrader dedicated demo lifecycle with exact Gate 7 markers;
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
3. Static remediation closure remains anchored at Task 8 head `a7da981a5daec426b5aad840739555edfbc68819`, run `33865341673`, job `100998803951`.
4. Gate 4 protected tooling readiness is anchored at `e018ce79d2c7cc9018775b71281be033691f58b8`, run `33869550721`, job `101012027592`.
5. Gate 5 protected tooling readiness is anchored at `5514d0fbff1d599580f042fbb77b34a3c927f8a5`, ordinary run `33898184523`, job `101105739815`, plus dedicated Gate 5 run `33898179333` with protected soak job skipped.
6. Current next launch-order work remains **Gate 4 real non-live Zitadel identity/workspace authorization acceptance**. Gate 5 tooling is ready but must not be used to leapfrog Gate 4 unless the launch plan is explicitly revised.
7. Before any real Gate 4 invocation, re-read `cloudflare-v2/docs/GATE4_ZITADEL_ACCEPTANCE_TRIGGER.md` and verify its exact marker, protected `staging` environment, required configuration, read-only scope, secret-free output, and both master fuses false.
8. Do **not** trigger Gate 4 or Gate 5 protected workflows, mutate Zitadel/Cloudflare/Supabase, enable `TRADING_ACCESS_ENABLED`, or start real Telegram soak actions without the separate exact real-environment authorization for that gate.
9. After any separately authorized Gate 4 run, record exact workflow/run/job/case evidence in both handoff files before proceeding to real Gate 5.

## Safety state
Do not deploy, mutate Cloudflare/Zitadel/Supabase, run protected external probes, place demo/live broker orders, merge `main`, or enable real-money execution unless the exact later gate/approval explicitly authorizes that action.
