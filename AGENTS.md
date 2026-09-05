# Trading V1 – Operational Source of Truth

## Mission
Launch Mkety Trading as a standalone enterprise Trading workspace product inside the Mkety ecosystem, using shared Mkety identity with an independent Trading runtime/data plane, strict workspace isolation, deterministic safety, durable idempotency and a controlled production rollout.

The project is past architecture/static-remediation work. The controlling objective is now: **run the already-built system in real staging/demo, fix only defects proved by real evidence, then launch progressively.**

## Controlling product model — APPROVED 2026-09-05
The customer boundary is intentionally simple:

**one enterprise customer -> one Trading workspace -> one owner -> full workspace control.**

Trading is not a generic collaboration/team SaaS. Do not build departments, nested teams, complex role hierarchies, seat management or broker-style organization structures for V1 unless a real customer requirement later proves them necessary.

Existing membership primitives may remain for compatibility/future use, but they are not a reason to build a complex team product now.

### Identity boundary
- Mkety Trading shares the mother Mkety Zitadel identity authority.
- Trading-only users may authenticate through that same Zitadel without requiring MKSaaS application access or an MKSaaS database profile.
- Zitadel answers who the user is and whether the user is entitled to Trading.
- Trading/Supabase data answers which Trading workspace that authenticated owner controls.
- Authentication is independent from broker execution.

### Workspace boundary
A Trading workspace is the isolation boundary for one enterprise customer. Trading-owned sources, destinations, broker accounts, credentials, policies, events, Trade State, retries/recovery, logs and runtime data remain scoped to that workspace.

The owner has full workspace control. Mkety does not need to model the customer's internal company hierarchy for V1.

### Default and custom-domain access
- Canonical product entry point: `trade.mkety.com`.
- An enterprise customer may optionally attach a hostname they control, e.g. `trade.starpipsforex.com`, using the existing Cloudflare for SaaS capability.
- Default and custom hostnames resolve to the same internal Trading workspace/backend.
- A custom hostname never grants authorization by itself.
- Hostname resolution identifies the requested workspace; Zitadel identifies the user; server-owned Trading data confirms that the owner may access that workspace.
- Do not create a separate backend, workspace or identity silo per custom hostname.

Controlling design spec:
`docs/superpowers/specs/2026-09-05-trading-enterprise-workspace-product-model-design.md`

Minimal production plan:
`docs/superpowers/plans/2026-09-05-production-fast-path.md`

Rolling pickup/handoff:
`cloudflare-v2/docs/PRODUCTION_FAST_PATH_HANDOFF.md`

## Mkety product isolation
- MKSaaS runtime/database failure must not stop Trading.
- Trading runtime/database failure must not affect MKSaaS.
- Trading-only customers do not need MKSaaS application access.
- A user entitled to multiple Mkety products may reuse the same identity.

## Architecture/tooling freeze
No new production architecture, framework, gate, workflow or elaborate acceptance tooling is added unless it fixes a blocker proved by ordinary CI, real staging, demo execution or safe live-readiness verification.

Use the system already built. Fix only actual defects.

## Intended production flow
1. Telegram MTProto, TradingView, MT5 source, cTrader source and approved custom API enter one authenticated canonical Trading Event pipeline.
2. Clear machine-readable instructions are deterministic; AI is bounded to ambiguity/presentation support only.
3. Canonical source/event identity is persistent and workspace-scoped.
4. Correlation + durable Trade State resolve entries and management against Position Groups/legs.
5. Planning determines intended actions but is never final live authority.
6. One canonical event may fan out independently to Telegram, MT5, cTrader and approved custom destinations.
7. Human Telegram delivery and broker execution are sibling paths; one destination failure must not cancel or resend unrelated successful siblings.
8. Immediately before every broker action, reload exact persisted source/event, workspace authority, account active/execution/kill state, fresh risk/exposure and broker-authoritative symbol/economic/volume truth.
9. Reserve persistent destination/order idempotency before broker send.
10. Persist broker/destination result truth and bind exact Position Group/leg.
11. If state binding fails after broker success, repair from persisted successful broker truth without broker resend.
12. If broker outcome is uncertain, reconcile; never blindly retry.

Caller-supplied workspace/account/provider/destination/broker/credential/execution hints are never authority.

## Failure isolation
- product isolation: MKSaaS failure != Trading failure;
- workspace isolation: customer A failure != customer B failure;
- source/provider isolation: one source/provider failure != sibling source/provider failure;
- account/broker isolation: one broker/account failure != unrelated account/provider failure;
- destination isolation: Telegram delivery failure != broker execution failure and vice versa;
- AI isolation: deterministic clear execution does not depend on AI availability;
- safety uncertainty: inability to prove source/workspace/account/risk/idempotency/broker outcome fails closed only on the affected money-moving path.

## Repository / branch
- Repository: `MketyDigital/Trading`
- Active branch: `design/enterprise-trading-event-core`
- Draft PR: #2 -> `main`
- Never merge `main` without explicit user instruction.
- Never enable real-money execution without separate explicit final owner approval and exact financial limits.

## Current verified stage — 2026-09-05
**CODE GREEN -> DATABASE GREEN THROUGH 0012 -> STAGING READINESS / CLOUDFLARE TARGET INSPECTION NEXT.**

Verified before the 2026-09-05 documentation lock-in:
- exact GREEN code head: `86c3991617bbe2a381106e8c3a62a6ecf135110b`;
- ordinary CI run `33902795369` succeeded;
- test job `101120562074` succeeded;
- protected Cloudflare jobs were skipped;
- Gate 6 fix changed test semantics only, not runtime/source/execution behavior.

Supabase project `Mkety Digital`:
- healthy and connected;
- Trading migrations through `0010` were already applied;
- `0011_destination_delivery_retry_state` applied successfully on 2026-09-05;
- `0012_trade_accounts_trading_workspace_fk` applied successfully on 2026-09-05;
- migration ledger now records through Trading `0012`;
- orphan `trade_accounts.workspace_id` prerequisite count was `0`;
- `trade_accounts.workspace_id` now references `trading_workspace_access(id)` with `ON DELETE RESTRICT`;
- the `0011` retry columns and retry-due index were verified.

Current external configuration known:
- GitHub `staging` environment reportedly contains `CLOUDFLARE_API_TOKEN`;
- GitHub `staging` environment reportedly contains `CLOUDFLARE_ACCOUNT_ID`;
- GitHub `staging` environment reportedly contains a Supabase service-role key;
- Supabase itself is connected here;
- Mkety Zitadel account exists, but no Trading project/application has been created yet;
- Cloudflare for SaaS already exists for Mkety and is the intended custom-hostname mechanism.

Documentation lock-in commits may advance the branch beyond the last runtime GREEN head. Documentation-only advancement does not change runtime behavior; ordinary CI should still be verified on the resulting exact head before deployment.

## Exact next pickup
1. Re-fetch the branch exact head.
2. Verify ordinary CI remains GREEN after documentation-only commits.
3. Use the existing Cloudflare staging workflow in **`inspect` mode only** to prove account/worker target identity and dry-run both Wrangler profiles.
4. Do **not** use `deploy-paid` or `deploy-free` until the target is proven to be an isolated staging target.
5. Complete minimum staging runtime config by name only: `SUPABASE_URL`, accepted Supabase service-role secret name, `TRADING_MASTER_KEY`.
6. Do not fake Zitadel values. Create the single shared-identity `Mkety Trading` Zitadel project/application when ready, then set issuer/audience/JWKS/project configuration.
7. Deploy staging with all master fuses off.
8. Verify `/api/v1/health` without exposing secret values.
9. Then connect real Telegram + MT5 demo + cTrader demo, run one real E2E demo lifecycle, material recovery checks, shadow, demo soak.
10. Tiny real-money live remains a separate explicit approval step.

## Critical runtime safety defaults
Keep fail closed until the relevant explicitly authorized rollout step changes them:
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

## Simplified production sequence
A. exact-head GREEN
B. Cloudflare staging target inspection
C. minimum runtime config + staging deploy, fuses off
D. shared Mkety Zitadel Trading identity setup + non-money-moving access acceptance
E. default `trade.mkety.com` + optional one custom hostname acceptance
F. Telegram + MT5 demo + cTrader demo connectivity
G. one real E2E demo lifecycle
H. material recovery checks only
I. shadow production
J. dedicated demo soak
K. separately approved tiny controlled live
L. controlled beta -> general production

TradingView direct-ingress/certificate acceptance remains deferred/fail-closed and does not block an approved launch scope that does not require genuine TradingView-originated ingress.

## Safety authorization boundary
Generic `continue` authorizes safe repository development/static inspection only. It does not authorize Cloudflare/Zitadel deployment/config mutation, protected external probes, real Telegram acceptance, demo/live broker orders, enabling master access/execution fuses, `main` merge or real-money execution unless the user explicitly authorizes the corresponding step.

The 2026-09-05 user instruction explicitly authorized locking the approved product model into repository documentation and mapping the production path. It did not authorize real-money execution.

## Mandatory handoff discipline
After every meaningful verified milestone:
1. update this file if the controlling state changed;
2. update `cloudflare-v2/docs/PRODUCTION_FAST_PATH_HANDOFF.md`;
3. record exact branch head and relevant CI/run/job/test evidence;
4. state what was achieved, what remains, safety state and exact next pickup;
5. never let stale historical blockers override a newer verified handoff;
6. preserve the approved simple owner-workspace/custom-hostname product model;
7. preserve the architecture/tooling freeze so a new session does not restart speculative design work.

Historical remediation/gate evidence remains in `cloudflare-v2/docs/PRODUCTION_V1_DEVELOPMENT_AUDIT.md`; use it as historical evidence, not as the current pickup source when it conflicts with this file or the rolling fast-path handoff.