# Trading V1 Production Development Audit

## Purpose
Detailed continuation/evidence record for development-to-production work on draft PR #2, branch `design/enterprise-trading-event-core`. This is the technical companion to `AGENTS.md` and must let a future session reconstruct the product intent, safety state, verified milestones and exact next action without relying on chat history.

This file does **not** authorize Cloudflare/Zitadel/Supabase mutation, protected external probes, real Telegram acceptance, demo/live broker orders, master-fuse changes, `main` merge or real-money execution.

---

# 2026-09-04 controlling launch decision — Production Fast Path

The branch has accumulated enough architecture, remediation and acceptance tooling. Continuing to design increasingly elaborate pre-production harnesses now has diminishing value and risks delaying real validation.

**Controlling rule from this point forward:**

> From this point forward, no new production architecture or elaborate acceptance tooling is added unless it fixes a proven blocker discovered by ordinary CI, real staging, demo execution, or safe live-readiness verification.

Existing protected gate tooling may be used. Existing safety contracts remain mandatory. The change is about development focus: **the product now needs to run in real staging/demo instead of continuing speculative architecture/tooling expansion.**

## Direct route from current branch to production
1. Return the current branch to exact-head ordinary CI GREEN.
2. Freeze speculative architecture/tooling changes.
3. Prepare and deploy the existing system to real staging with safe defaults/fuses off.
4. Connect actual non-live integrations: Mkety Zitadel, Trading-owned DB/workspaces, Telegram, MT5 demo and cTrader demo.
5. Exercise the real end-to-end product flow.
6. Fix only defects demonstrated by ordinary CI or real staging/demo evidence.
7. Exercise material failure/recovery paths in real staging.
8. Run shadow production with real inputs/decisions but no real-money execution.
9. Run a controlled dedicated demo soak on production-like infrastructure.
10. Enter tiny controlled live only after separate explicit approval and exact financial/kill limits.
11. Expand to controlled beta/general production only from clean live evidence.

The old numbered launch gates remain useful evidence categories. They are **not** a requirement to keep creating new workflows or harnesses before staging.

---

# Product architecture that is already built

## Mkety enterprise identity/product model
Mkety Trading is an enterprise product of the Mkety/MKSaaS ecosystem, not a standalone identity silo.
- One managed Mkety Zitadel identity authority may authenticate MKSaaS users, Trading users or users entitled to both.
- Trading owns its own operational DB, workspaces, memberships, sources, destinations, broker accounts, credentials, risk state, Trade State, idempotency, retries/recovery and runtime state.
- Existing Mkety users can enter Trading when a Trading-owned entitlement/membership exists.
- Trading-only users can authenticate through the same Mkety Zitadel without any MKSaaS DB row.
- MKSaaS runtime/database failure must not stop Trading.
- Trading runtime/database failure must not affect MKSaaS.

## Source-to-destination production flow
The intended product flow is:

`source -> authenticated canonical Trading Event -> deterministic parse/normalization -> bounded AI only for ambiguity -> correlation/Trade State -> deterministic planning -> independent destination fanout -> fresh execution authority/risk -> broker-authoritative validation -> persistent idempotency -> Telegram/broker/custom dispatch -> durable result/state binding -> reconciliation/recovery/observability`

Sources already represented in the product architecture:
- Telegram MTProto via Cloudflare Container;
- Telegram MTProto via Cloudflare Durable Object/mtcute;
- external MTProto;
- TradingView webhook foundation;
- MT5 source bridge/capture;
- cTrader source capture;
- custom signed API.

Destinations already represented:
- Telegram groups/channels as first-class human destinations;
- MT5 accounts;
- cTrader accounts;
- generic/custom authenticated destinations;
- extensible future broker/customer adapters.

One canonical event may fan out independently to Telegram and multiple broker/custom destinations. One destination/provider/account failure cannot cancel or redispatch unrelated successful siblings.

## Determinism / AI boundary
- Clear machine-readable signals do not depend on AI.
- AI is bounded to ambiguity resolution and/or destination presentation.
- Ambiguity that cannot be resolved safely becomes `NEEDS_REVIEW`.
- Telegram AI/presentation failure falls back without becoming broker execution authority.

## Money-moving authority
Immediately before every broker action the runtime must use server-owned/fresh authority for:
1. persisted event/source identity;
2. source active/workspace ownership;
3. Trading workspace entitlement;
4. exact account ownership/active/execution state;
5. kill/safety policy;
6. fresh risk/exposure;
7. broker-authoritative symbol/economic/volume metadata;
8. persistent destination/order idempotency.

Planning/simulation, browser hints, caches, snapshots and warm sessions never override these checks.

## Recovery/idempotency
- Persistent canonical event identity prevents duplicate interpretation/orchestration.
- Persistent destination/order identity prevents duplicate broker sends.
- Broker uncertainty is reconciled, never blindly retried.
- Broker success remains durable truth even if downstream Trade State binding fails.
- State repair consumes persisted successful broker truth and never resends solely to repair state.
- Destination failures retry independently; successful siblings stay successful.

## Fault-isolation / no-unrelated-impact contract
The engineering target is fault isolation and graceful degradation, not an impossible 100% external-uptime claim.
- product: MKSaaS failure != Trading failure;
- workspace: tenant A failure != tenant B failure;
- source/provider: one source/provider failure != sibling source/provider failure;
- account/broker: one account/provider failure != unrelated account/provider failure;
- destination: Telegram failure != broker failure and vice versa;
- AI: clear deterministic execution remains independent of optional AI;
- control plane: admin/dashboard/reporting/analytics/notification failure does not become hot-path authority;
- configuration: one role/source/destination/account change must not mutate unrelated runtime state;
- safety uncertainty: fail closed only on the affected money-moving path when correctness cannot be proved.

---

# Repository / safety baseline
- Repository: `MketyDigital/Trading`
- Branch: `design/enterprise-trading-event-core`
- Draft PR: #2 -> `main`
- Trusted pre-audit tree: `89944d3b6aa4b03f6bb1a1107594e9acfa424fb3`
- Frozen audit-scope commit: `7b175a548c9134b0e88ba4fa5977de51142b6cd3`
- Static remediation plan: `docs/superpowers/plans/2026-09-03-production-readiness-remediation.md`, commit `567d8fe06c291eb393b5c23b3bd2d2dfbb65dbe4`
- Sept 3 launch master blob: `48983550b3c33a7c3517c236370ffbc3d1d1788d`

Current fail-closed defaults remain:
- `TRADINGVIEW_DIRECT_INGRESS_ENABLED=false`
- `TRADINGVIEW_CERT_PROBE_ENABLED=false`
- `TRADING_ACCESS_ENABLED=false`
- `BROKER_EXECUTION_ENABLED=false`

No tenant/admin API may mutate the Worker-wide master fuses.

---

# Static remediation — COMPLETE

F1–F10, I1, I2 and U1 are STATIC RESOLVED. This is the safety foundation for staging; it is not a reason to add more speculative static work.

## Task 1 — both Worker master fuses
**F1 RESOLVED.**
- GREEN head `1632889c6b26e88451ece25ba13c649b43357c5a`
- run `33783267187`, job `100741828652`
- production execution and scheduled retry require both access and broker execution fuses.

## Task 2 — durable execution authority / event linkage
**F2/F3/F4/F9 RESOLVED.**
- GREEN head `9ba95eea33748aea1ab641e2aab4e0aec67068dc`
- run `33784508546`, job `100745907350`
- exact persisted event -> source -> workspace entitlement -> account authority reloaded per action/retry.

## Task 3 — broker-authoritative risk / strict volume / final policy
**F7/F8/F10 RESOLVED.**
- GREEN head `a3a507b569499524d6de75ad8c519db5dd944efb`
- run `33843616430`, job `100930741996`
- Node 669/669 + MT5 14/14 + Container MTProto 11/11 + external MTProto 22/22.
- risk-increasing OPEN cannot be silently rounded/clamped upward.
- broker economics are authoritative; unreliable monetary loss-at-stop fails closed for affected risk-sized execution.

## Task 4 — broker-success state repair without resend
**F5 RESOLVED.**
- GREEN head `30be3bddb586e6a9bf02dea4520c338e3510287c`
- run `33850696335`, job `100952562634`
- Node 675/675 + 14/14 + 11/11 + 22/22.
- `SUCCEEDED + STATE_BINDING_PENDING` is a state-repair obligation, never broker retry.

## Task 5 — Trading-owned account tenancy
**F6 RESOLVED.**
- GREEN head `9a13bd2fa928d39cce826d05b005129fa10a68f3`
- run `33851400665`
- Node 678/678 + 14/14 + 11/11 + 22/22.
- static migration contract moves `trade_accounts.workspace_id` authority to Trading-owned workspace access and aborts on orphan prerequisites; no real DB migration was applied during development.

## Task 6 — advisory execution snapshots
**I1 RESOLVED.**
- GREEN head `400880cab6502c75ac487830bc3a90bb022f485c`
- run `33853785408`, job `100962282286`
- Node 681/681 + 14/14 + 11/11 + 22/22.
- positive-whitelist snapshots are non-secret/non-authoritative; fresh durable authority precedes them and fresh broker-risk materialization follows them.

## Task 7 — authenticated MT5 metadata / bounded warm contexts
**I2/U1 RESOLVED.**
- GREEN head `619fa842ee29addecc9cbbd3fad6bec6efe59f60`
- run `33856378784`, job `100970541404`
- Node 683/683 + 14/14 + 11/11 + 22/22.
- MT5 metadata calls use bounded timestamp/HMAC authentication.
- same-action/batch context reuse is bounded and cannot replace fresh execution authority.

## Task 8 — integrated static failure matrix
**RESOLVED.**
- acceptance head `a7da981a5daec426b5aad840739555edfbc68819`
- run `33865341673`, job `100998803951`
- **685/685 Node + 14/14 MT5 + 11/11 Container MTProto + 22/22 external MTProto**
- protected external jobs skipped.

Task 8 explicitly proves:
1. access false blocks broker-capable execution/retry;
2. source revocation blocks dispatch from durable authority;
3. workspace revocation beats stale snapshots;
4. account/kill authority reload between actions blocks later action after revocation;
5. unsafe below-min/off-step OPEN volumes fail closed;
6. stale/unsafe risk sizing fails closed;
7. durable `tradingEventId` reaches delivery persistence/retry authority;
8. broker success + state-bind failure repairs without broker resend;
9. AI/optional subsystem failures remain isolated where applicable;
10. destination/provider/workspace failure isolation remains intact.

---

# Existing acceptance tooling — use it, do not keep expanding it

## Gate 4 identity tooling — STATIC GREEN
- final tooling head `e018ce79d2c7cc9018775b71281be033691f58b8`
- run `33869550721`, job `101012027592`
- Node **687/687**, MT5 14/14, Container MTProto 11/11, external MTProto 22/22
- real protected identity acceptance was skipped/not run.

It covers real Zitadel JWT/project/org/subject + Trading-owned membership logic, existing-Mkety and Trading-only users, negative identity/membership cases, roles and second-tenant isolation while broker execution remains off.

## Gate 5 Telegram tooling — STATIC GREEN
- GREEN head `5514d0fbff1d599580f042fbb77b34a3c927f8a5`
- ordinary run `33898184523`, job `101105739815`
- **690/690 + 14/14 + 11/11 + 22/22**
- dedicated Gate 5 run `33898179333`: regression prerequisite passed; protected real soak job skipped.

It can observe Container/DO/external MTProto health, reconnect/catch-up/edited-message/duplicate evidence, cross-provider canonical convergence, downstream isolation and Container isolation without exposing raw Telegram identities/secrets.

## Existing MT5/cTrader connectivity probes
The existing demo-probe workflows/runners remain useful for verifying broker connectivity, account/server identity, symbol catalog/quote discovery and secret-free probe behavior with broker execution off.

These are **prerequisites/supporting diagnostics**, not the entire product validation. Do not build more connectivity tooling unless staging shows a real gap.

---

# Gate 6 source-capture wrapper — current immediate CI issue

During review of the Sept 3 launch master, the branch added a bounded source-only wrapper so real staging can prove actual source events rather than only connectivity metadata:
- MT5: bounded `MT5SourceCapture` deal-history capture/replay into signed canonical source delivery;
- cTrader: real `CTraderSourceCapture` deal-event capture/replay/reconnect into signed canonical source delivery;
- `BROKER_EXECUTION_ENABLED=false`;
- no order-generation/lifecycle logic in the source runner.

### TDD RED
- contract head `b75c1b580321d40d7c3ad9ec434e3c172374dfd1`
- run `33900318453`
- job `101112598062`
- intended missing-source-wrapper RED; protected jobs skipped.

### First GREEN candidate
- head `052aa1d3b0b6a03b5c62a735fd4184791e83dd90`
- run `33900898768`
- job `101114473595`
- Node: **692 total / 691 pass / 1 fail**
- MT5/MTProto later suites skipped because Node failed first
- protected jobs skipped
- no real source/broker/environment operation ran.

### Exact failure/root cause
Failing test:
`Gate 6 source runners exercise capture-to-canonical replay without creating broker orders`

The only failed assertion expects:
`/MT5.*deal history/i`

The actual runbook already documents the correct source semantics using an `MT5 source` section, `MT5SourceCapture`, `history_deals_get`, and later `broker deal history`. The regex requires `MT5` to precede `deal history` within one match span and therefore misses the valid wording.

**Classification:** documentation/test wording mismatch; **not a Trading runtime, MT5 capture, canonical delivery or safety defect.**

### Required fix
Change only the test assertion to verify the actual semantic evidence (for example MT5 source/history API and broker deal-history wording separately). Do not change source/runtime behavior to satisfy this cosmetic assertion.

After this exact-head CI is GREEN, **stop Gate 6 tooling work** unless real staging demonstrates a source defect.

---

# Production Fast Path — remaining work

## Phase A — exact-head GREEN
Immediate work:
1. fix the single Gate 6 wording/assertion mismatch;
2. run ordinary PR CI;
3. require Node + MT5 + Container MTProto + external MTProto GREEN;
4. keep protected external jobs skipped;
5. record exact head/run/job/counts here and in `AGENTS.md`.

Then leave static-tooling mode.

## Phase B — staging readiness/preparation
Static inspection may proceed without real-environment authorization:
- inventory existing deployment/runbook/config surfaces;
- identify required staging bindings/secrets by **name only**, never expose secret values;
- verify migration order/prerequisites;
- verify safe defaults/fuses remain off;
- verify rollback/redeploy path;
- identify exact existing staging deployment action.

Do not create new infrastructure abstractions unless the actual staging path is missing/broken.

## Phase C — real staging deployment/configuration
Requires explicit authorization because it mutates/uses the real environment.
Deploy/configure the existing system with access/broker execution still fail-closed except where a separately authorized non-live acceptance requires a bounded change.

## Phase D — real identity + sources + destinations
Use the existing system/tooling to validate:
- real Mkety Zitadel -> Trading membership/workspace;
- Telegram source and Telegram destination;
- MT5 real demo source events;
- cTrader real demo source events;
- MT5/cTrader demo destination connectivity/execution;
- tenant/source/account/destination isolation.

Prefer actual product flows over adding new acceptance frameworks.

## Phase E — actual E2E demo flow
At minimum prove a real sequence equivalent to:

`Telegram/MT5/cTrader source -> canonical event -> parser -> Position Group/Trade State -> planning -> Telegram destination + MT5/cTrader demo destination -> broker result -> BE/modify/partial-close/full-close -> durable final state`

Verify exact once semantics, not merely HTTP success.

## Phase F — real staging failure/recovery
Exercise material failures only:
- source/provider reconnect/restart/catch-up;
- duplicate/replay;
- source/workspace/account revocation;
- kill switch;
- one destination unavailable while siblings continue;
- broker outage/uncertain outcome reconciliation;
- state-binding failure/repair;
- rollback/recovery.

Fix only real failures found.

## Phase G — shadow production
Run real incoming signals and real decision/risk logic on production-like infrastructure while preventing real-money broker sends. Compare intended actions with expected/operator-reviewed results.

## Phase H — dedicated demo soak
Run dedicated demo broker execution long enough to expose real platform/network behavior, including reconnect, idempotency, entry/management/close semantics and cleanup.

## Phase I — tiny controlled live
CLOSED until separate explicit user approval.

Before any real-money action the owner must explicitly set:
- max per-trade risk;
- max volume;
- max concurrent/open risk;
- daily loss ceiling;
- allowed symbols;
- kill/rollback contacts/procedure.

Never infer or invent those thresholds.

## Phase J — controlled beta/general production
Expand only after tiny-live evidence is clean, recovery/kill controls are proven and no unresolved severity-1/2 trading-safety issue remains.

---

# TradingView
Genuine TradingView-originated direct-ingress/certificate acceptance remains DEFERRED/FAIL-CLOSED. It should not block launch of the approved non-TradingView source scope unless launch scope explicitly requires TradingView.

---

# Development method from this point forward
For repository changes:
1. trace the real runtime path;
2. do not create work merely because a theoretical improvement is possible;
3. when ordinary CI or staging/demo exposes a real defect, write/retain the smallest regression that proves it;
4. implement the minimum safe fix;
5. do not weaken safety contracts to make tests pass;
6. require exact-head ordinary CI GREEN for repository changes;
7. keep protected/live jobs off unless explicitly authorized;
8. reconcile branch head before every write;
9. update this audit and `AGENTS.md` after every meaningful verified milestone.

For real-environment work:
- use the existing approved deployment/integration path first;
- observe actual behavior;
- collect sanitized evidence;
- fix only demonstrated blockers;
- do not redesign a subsystem before proving the existing one fails its requirement.

---

# Exact startup / pickup for any future session
1. Read `AGENTS.md` first, then this file.
2. Re-fetch PR #2 and reconcile branch head before writes.
3. Remember the controlling decision: **Production Fast Path; no speculative new architecture/tooling.**
4. Current pre-fast-path failing code head: `052aa1d3b0b6a03b5c62a735fd4184791e83dd90`.
5. Current failing run/job: `33900898768` / `101114473595`.
6. Current defect: one Gate 6 test regex/wording mismatch; runtime is not implicated.
7. Make the minimal assertion fix only.
8. Run ordinary PR CI to exact-head GREEN.
9. Update both handoff files with exact GREEN evidence.
10. **Next after GREEN = staging readiness/deployment preparation, not Gate 7/8/9 tooling construction.**
11. Static config/runbook inspection is safe to continue. Actual deployment, Cloudflare/Zitadel/Supabase mutation, protected probes, real Telegram acceptance or demo broker actions require the applicable explicit real-environment authorization.
12. Real-money work remains separately prohibited until tiny-live approval + exact owner thresholds.

## Current safety state
No real Gate 4/5/6 acceptance has been invoked during this development checkpoint. No staging mutation, Cloudflare/Zitadel/Supabase mutation, real Telegram soak, demo broker order, live broker order, master-fuse enablement or `main` merge is authorized by a generic `continue`.