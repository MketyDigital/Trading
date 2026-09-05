# Trading V1 – Operational Source of Truth

## Mission
Launch Mkety Trading as a standalone enterprise Trading workspace product inside the Mkety ecosystem, using shared Mkety identity with an independent Trading runtime/data plane, strict workspace isolation, deterministic safety, durable idempotency and a controlled production rollout.

The project is past broad architecture/static-remediation work. The controlling objective is now: **run the already-built system in real staging/demo, fix only defects proved by real evidence, then launch progressively.**

## Controlling product model — APPROVED 2026-09-05
The customer boundary is intentionally simple:

**one enterprise customer -> one Trading workspace -> one owner -> full workspace control.**

Trading is not a generic collaboration/team SaaS. Do not build departments, nested teams, complex role hierarchies, seat management or broker-style organization structures for V1 unless a real customer requirement later proves them necessary.

Existing membership primitives may remain for compatibility/future use, but they are not a reason to build a complex team product now.

### Identity / access-gate boundary — APPROVED 2026-09-05
- Mkety uses Zitadel as the mother identity authority. Trading will use one Mkety Trading Zitadel sub-project/application boundary, not one project per enterprise customer.
- Trading core/runtime must remain independently deployable and operable when external user access is disabled.
- Zitadel is an identity adapter behind the Mkety product-access gate; it is not a runtime dependency for event processing, Supabase persistence, Telegram, TradingView, MT5, cTrader or other Trading-core operation.
- Mkety grants Trading access using a cryptographically signed, time-bounded access assertion/entitlement derived from authenticated identity/product access. Do not use a reusable plain access code as the authorization mechanism.
- The signed access assertion identifies the authenticated subject and Trading product entitlement; server-owned Trading data remains authoritative for the workspace/owner relationship.
- Supabase Trading workspace ownership is the final application authorization check. Never authorize a workspace solely from hostname, caller-supplied workspace ID or an unverified token claim.
- Trading-only users may authenticate through the same Mkety/Zitadel identity without requiring MKSaaS application access or an MKSaaS database profile.
- Authentication/access is independent from broker execution.
- `TRADING_ACCESS_ENABLED=false` means Zitadel adapter configuration is optional for core readiness.
- `TRADING_ACCESS_ENABLED=true` means `ZITADEL_ISSUER`, `ZITADEL_AUDIENCE` and `ZITADEL_JWKS_URL` are mandatory and readiness must fail closed if any are absent.

### Workspace boundary
A Trading workspace is the isolation boundary for one enterprise customer. Trading-owned sources, destinations, broker accounts, credentials, policies, events, Trade State, retries/recovery, logs and runtime data remain scoped to that workspace.

The owner has full workspace control. Mkety does not need to model the customer's internal company hierarchy for V1.

### Default and custom-domain access
- Canonical product entry point: `trade.mkety.com`.
- An enterprise customer may optionally attach a hostname they control, e.g. `trade.starpipsforex.com`, using the existing Cloudflare for SaaS capability.
- Default and custom hostnames resolve to the same internal Trading workspace/backend.
- A custom hostname never grants authorization by itself.
- Hostname resolution identifies the requested workspace; the Mkety/Zitadel access gate identifies/entitles the user; server-owned Trading data confirms that the owner may access that workspace.
- Do not create a separate backend, workspace or identity silo per custom hostname.

Controlling design spec: `docs/superpowers/specs/2026-09-05-trading-enterprise-workspace-product-model-design.md`

Minimal production plan: `docs/superpowers/plans/2026-09-05-production-fast-path.md`

Rolling pickup/handoff: `cloudflare-v2/docs/PRODUCTION_FAST_PATH_HANDOFF.md`

## Mkety product isolation
- MKSaaS runtime/database failure must not stop Trading.
- Trading runtime/database failure must not affect MKSaaS.
- Trading-only customers do not need MKSaaS application access.
- A user entitled to multiple Mkety products may reuse the same identity.

## Architecture/tooling freeze
No new production architecture, framework, gate, workflow or elaborate acceptance tooling is added unless it fixes a blocker proved by ordinary CI, real staging, demo execution or safe live-readiness verification. Use the system already built. Fix only actual defects.

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
- identity isolation: Trading core availability does not depend on Zitadel while external access is disabled;
- AI isolation: deterministic clear execution does not depend on AI availability;
- safety uncertainty: inability to prove source/workspace/account/risk/idempotency/broker outcome fails closed only on the affected money-moving path.

## Repository / branch
- Repository: `MketyDigital/Trading`
- Active branch: `design/enterprise-trading-event-core`
- Draft PR: #2 -> `main`
- Never merge Trading runtime to `main` without explicit user instruction.
- Never enable real-money execution without separate explicit final owner approval and exact financial limits.

## Current verified stage — 2026-09-05
**CODE GREEN -> DATABASE GREEN THROUGH 0012 -> CLOUDFLARE INSPECT GREEN -> CORE AUTH-ADAPTER READINESS GREEN -> STAGING RUNTIME CONFIG/DEPLOY NEXT.**

### Latest auth-readiness TDD evidence
- RED test-only head: `0760480263dfdcbdc8deec9ef80adfab63f24ce7` proved the old behavior incorrectly required Zitadel while access was disabled.
- Minimal production fix head: `b9bb16a789a0765a47fe768dd761a64ce1d5f12d`.
- Trading V1 CI run `33951294621`: **success**.
- Test job `101266508504`: **success**.
- Worker/trading-core, pure MT5 bridge and pure MTProto Python tests all passed.
- Protected Cloudflare jobs remained skipped as intended.
- `cloudflare-v2/src/config/staging_readiness.js` now requires only Supabase URL, one supported Supabase service-role secret and `TRADING_MASTER_KEY` for core readiness while `TRADING_ACCESS_ENABLED=false`.
- Zitadel issuer/audience/JWKS are required only when `TRADING_ACCESS_ENABLED=true` and then fail closed if missing.

### Supabase
- Project: `Mkety Digital` (`vdblajgxrfndjesoyayy`), healthy.
- Trading migrations applied/verified through `0012`.
- `trade_accounts.workspace_id` references `trading_workspace_access(id)` with `ON DELETE RESTRICT`; orphan prerequisite count was `0`.

### Cloudflare staging inspect
- Workflow run `33950342398`, job `101263798521`: **success**.
- Authenticated to the intended Mkety Cloudflare account.
- Paid/free Wrangler dry-runs passed.
- Existing `mkety-copier-engine` history showed only prior Gate 2/Gate 3 acceptance uploads/rollbacks, with no evidence of customer production use; treat it as the current staging/test Worker for this launch path, not automatically the eventual general-production target.
- No deployment occurred in the inspect run.

### Staging config reported present in GitHub environment `staging`
- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`
- `SUPABASE_URL`
- a Supabase service-role key
- `TRADING_MASTER_KEY`

Important: GitHub environment presence does not by itself make `SUPABASE_URL`, service-role or `TRADING_MASTER_KEY` available inside the deployed Cloudflare Worker. The staging deployment path must inject these runtime values securely without logging/committing them.

### Zitadel
- Mkety Zitadel account/instance exists.
- Mkety Trading sub-project/application not created yet.
- This no longer blocks core staging deployment while `TRADING_ACCESS_ENABLED=false`.
- Do not invent issuer/audience/JWKS/project values.

## Exact next pickup
1. Securely wire GitHub `staging` values into the paid Cloudflare Worker runtime: `SUPABASE_URL`, canonical supported Supabase service-role secret and `TRADING_MASTER_KEY`; never print/commit values.
2. Verify the workflow/config change through ordinary CI/dry-run.
3. Deploy the paid staging Worker only with all four master fuses false.
4. Verify `/api/v1/health` reports core readiness without leaking values; Zitadel may remain absent because access is off.
5. Create the single Mkety Trading Zitadel sub-project/application and configure the signed Mkety access-gate adapter.
6. Set issuer/audience/JWKS/project config and perform non-money-moving owner/workspace access acceptance before enabling external Trading access.
7. Verify `trade.mkety.com` and one optional Cloudflare-for-SaaS customer hostname resolve to the same workspace with authorization enforced.
8. Connect real Telegram + MT5 demo + cTrader demo, run one real E2E demo lifecycle, material recovery checks, shadow and demo soak.
9. Tiny real-money live remains a separate explicit approval step with exact financial limits and kill/rollback procedure.

## Critical runtime safety defaults
Keep fail closed until the relevant explicitly authorized rollout step changes them:
- `TRADINGVIEW_DIRECT_INGRESS_ENABLED=false`
- `TRADINGVIEW_CERT_PROBE_ENABLED=false`
- `TRADING_ACCESS_ENABLED=false`
- `BROKER_EXECUTION_ENABLED=false`

No tenant/admin API may mutate Worker-wide master fuses.

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
B. Cloudflare target inspection — DONE
C. secure runtime config injection + staging deploy, fuses off
D. Mkety/Zitadel Trading access-gate setup + non-money-moving access acceptance
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

## Mandatory handoff discipline
After every meaningful verified milestone:
1. update this file if the controlling state changed;
2. update `cloudflare-v2/docs/PRODUCTION_FAST_PATH_HANDOFF.md`;
3. record exact branch head and relevant CI/run/job/test evidence;
4. state what was achieved, what remains, safety state and exact next pickup;
5. never let stale historical blockers override a newer verified handoff;
6. preserve the approved simple owner-workspace/custom-hostname/access-gate product model;
7. preserve the architecture/tooling freeze so a new session does not restart speculative design work.

Historical remediation/gate evidence remains in `cloudflare-v2/docs/PRODUCTION_V1_DEVELOPMENT_AUDIT.md`; use it as historical evidence, not as the current pickup source when it conflicts with this file or the rolling fast-path handoff.
