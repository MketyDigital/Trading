# Trading V1 – Operational Source of Truth

## Mission
Launch Mkety Trading as a standalone enterprise Trading workspace product inside the Mkety ecosystem with an independent Trading runtime/data plane, strict workspace isolation, deterministic safety, durable idempotency and a controlled rollout.

The project is past broad architecture/static-remediation work. The controlling objective is now: **run the already-built system in real staging/demo, fix only defects proved by evidence, then launch progressively.**

## Controlling product model — APPROVED 2026-09-05
**one enterprise customer -> one Trading workspace -> one owner -> full workspace control.**

Trading is not a generic collaboration/team SaaS. Do not build departments, nested teams, complex role hierarchies, seat management or broker-style organization structures for V1 unless a real customer requirement later proves them necessary. Existing membership/role primitives may remain for compatibility/future use.

### Identity / Mkety access-gate boundary — APPROVED AND IMPLEMENTED IN TRADING
- Current Mkety development authority is `MketyDigital/mksaas`; do not implement new identity work in the legacy `MketyDigital/Mkety` repository.
- Mkety uses Zitadel as the mother identity provider. Zitadel remains behind Mkety's identity/product-access layer.
- The approved future shared identity boundary is one central Cloudflare-hosted Mkety Auth Gateway for Mkety Platform, Trading, Academy and future enterprise applications.
- The central recommendation is recorded in `MketyDigital/mksaas/docs/CENTRAL_MKETY_AUTH_GATEWAY_RECOMMENDATION.md` at commit `152d9125a0d9c4c7c5a39e8360108e679c4185ab`.
- Trading core/runtime is independently deployable and operable while external user access is disabled.
- Trading V1 does **not** directly authorize from Zitadel organization/project-role claims.
- Mkety grants Trading entry using a cryptographically signed, short-lived access assertion. A reusable plain code is not authorization.
- The Trading assertion contract is: trusted Mkety signature + issuer + audience + time validity + immutable `sub` + `product=trading` + exact `workspace_id` + `access=owner`.
- Trading then independently verifies server-owned Supabase authority: requested workspace exists/enabled and the exact subject has an enabled membership for that exact workspace.
- A valid signed assertion alone is never enough; Supabase is final application authorization/revocation authority.
- Legacy `zitadel_*` workspace fields and the historical membership column name `zitadel_subject` may remain for compatibility but are not V1 admin authorization authority.
- Trading-only users do not require MKSaaS application access or an MKSaaS database profile.
- Authentication/access remains independent from broker execution.
- While `TRADING_ACCESS_ENABLED=false`, no access-gate configuration is required for Trading core readiness.
- Before `TRADING_ACCESS_ENABLED=true`, the Worker requires `MKETY_ACCESS_ISSUER`, `MKETY_ACCESS_AUDIENCE` and `MKETY_ACCESS_JWKS_URL` and must fail closed if any are absent.
- Do not create a temporary Trading-only issuer/direct-Zitadel fallback merely because the central Mkety Auth Gateway is not built yet.

Detailed identity boundary: `cloudflare-v2/docs/SHARED_ZITADEL_ENTERPRISE_IDENTITY.md`.

### Workspace boundary
A Trading workspace is the isolation boundary for one enterprise customer. Trading-owned sources, destinations, broker accounts, credentials, policies, events, Trade State, retries/recovery, logs and runtime data remain scoped to that workspace.

### Default and custom-domain access
- Canonical product entry point: `trade.mkety.com`.
- An enterprise customer may optionally attach a hostname it controls, e.g. `trade.starpipsforex.com`, using existing Cloudflare for SaaS capability.
- Default and custom hostnames resolve to the same internal Trading workspace/backend.
- A hostname is routing context only and never authorization.
- Do not create a separate backend, workspace or identity silo per custom hostname.

Controlling design spec: `docs/superpowers/specs/2026-09-05-trading-enterprise-workspace-product-model-design.md`

Minimal production plan: `docs/superpowers/plans/2026-09-05-production-fast-path.md`

Rolling pickup/handoff: `cloudflare-v2/docs/PRODUCTION_FAST_PATH_HANDOFF.md`

## Mkety product isolation
- MKSaaS runtime/database failure must not stop Trading.
- Trading runtime/database failure must not affect MKSaaS.
- Trading authorization must not query the MKSaaS database/shared workspace tables.
- A user entitled to multiple Mkety products may reuse the same immutable identity subject.

## Architecture/tooling freeze
No new production architecture, framework, gate, workflow or elaborate acceptance tooling unless it fixes a blocker proved by ordinary CI, real staging, demo execution or safe live-readiness verification. Use the system already built. Fix only actual defects.

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

## Repository / branch
- Repository: `MketyDigital/Trading`
- Active branch: `design/enterprise-trading-event-core`
- Draft PR: #2 -> `main`
- Never merge Trading runtime to `main` without explicit user instruction.
- Never enable real-money execution without separate explicit final owner approval and exact financial limits.

## Current verified stage — 2026-09-05
**CODE GREEN -> DATABASE GREEN THROUGH 0012 -> PAID STAGING DEPLOYED WITH FUSES OFF -> MKETY SIGNED ACCESS VERIFIER GREEN -> REDEPLOY CURRENT GREEN TRADING BUILD WITH ACCESS/EXECUTION OFF NEXT.**

### Paid staging deployment — SUCCESS
- `Cloudflare Staging Gate` deploy-paid run `33951878273`, job `101268094904`: **success**.
- Deployed `mkety-copier-engine` using the reviewed paid staging profile.
- `SUPABASE_URL`, one supported Supabase service-role secret and `TRADING_MASTER_KEY` were injected through an ephemeral secrets file and not intentionally printed/committed.
- Ephemeral secret file cleanup succeeded.
- Free deployment was skipped.
- All four master safety flags remained false.
- This deployment is the safe core staging build; later Mkety-access code changes below have not yet been redeployed.

### Mkety signed-access boundary — GREEN
- New verifier: `cloudflare-v2/src/security/mkety_access_assertion.js`.
- V1 admin now uses the Mkety verifier rather than direct Zitadel org/project-role authorization.
- Assertion verification fails closed for invalid signature/issuer/audience/time, wrong product, wrong workspace or non-owner assertion.
- Exact enabled Trading workspace membership is checked after assertion verification.
- A demonstrated compatibility failure at head `9ae56e57abcee77166570005ce4c28ada6da7c0a`, CI run `33952893071`, correctly blocked progress before redeployment.
- The stale direct-Zitadel acceptance assumptions were replaced with the approved Mkety access-gate contract.
- Runtime/test head `04cb56247e7275d42c67b283ad16ff756c72a9cb`, CI run `33953020087`: **success**.
- Identity-doc head `5a184fde3faccce9d9157a31d13a37f8fcf4e7cc`, CI run `33953060199`: **success**.
- Branch head before the latest handoff correction: `bb986a4e09af40af3334f94ed59f2798c6739efe`, CI run `33953325178`: **success**.
- `staging_readiness.js` now uses `MKETY_ACCESS_ISSUER`, `MKETY_ACCESS_AUDIENCE`, `MKETY_ACCESS_JWKS_URL` only when `TRADING_ACCESS_ENABLED=true`.

### Central Mkety Auth Gateway — RECOMMENDATION RECORDED
- `MketyDigital/mksaas` is the current Mkety development source of truth.
- The future shared Mkety Auth Gateway will be Cloudflare-hosted and reusable across Mkety products/enterprise applications.
- Zitadel remains the initial identity provider behind Mkety; Trading consumes only the stable Mkety signed assertion contract.
- This gateway is not required to keep Trading core staging work moving while `TRADING_ACCESS_ENABLED=false`.

### Supabase
- Project: `Mkety Digital` (`vdblajgxrfndjesoyayy`), healthy.
- Trading migrations applied/verified through `0012`.
- `trade_accounts.workspace_id` references `trading_workspace_access(id)` with `ON DELETE RESTRICT`.

### Cloudflare target
- Inspect run `33950342398`, job `101263798521`: **success**.
- Paid/free dry-runs passed and the intended Mkety Cloudflare account was authenticated.
- Existing `mkety-copier-engine` history is pre-production acceptance/test activity; treat it as the current staging/test target, not automatically final general-production target.

### Health verification caveat
The paid staging deployment itself succeeded, but an HTTP response from `/api/v1/health` has not yet been independently captured in this session because direct Workers.dev probing from the available web client was blocked by URL-access policy. Do not interpret that tooling limitation as a Worker failure. Verify health through a safe Cloudflare/GitHub curl path before access enablement.

## Exact next pickup
1. Redeploy the current GREEN Trading branch to the paid staging Worker with all four safety fuses false.
2. Verify `/api/v1/health` through a safe Cloudflare/GitHub path; missing future Mkety access-gate values are acceptable because `TRADING_ACCESS_ENABLED=false`.
3. Continue non-auth Trading readiness that does not require external user access: default-domain/runtime verification, real Telegram source/destination acceptance, MT5 demo and cTrader demo connectivity, then one real E2E demo lifecycle.
4. When the central Mkety Auth Gateway is available, configure `MKETY_ACCESS_ISSUER`, `MKETY_ACCESS_AUDIENCE`, `MKETY_ACCESS_JWKS_URL` while access remains false and run positive/negative signed-access acceptance plus Supabase workspace/membership revocation.
5. Only after non-live access acceptance may `TRADING_ACCESS_ENABLED` be considered for explicit staging enablement. `BROKER_EXECUTION_ENABLED` stays false.
6. Verify `trade.mkety.com` and one optional Cloudflare-for-SaaS customer hostname.
7. Run material recovery checks, shadow production and dedicated demo soak.
8. Tiny real-money live remains a separate explicit approval step with exact financial limits and kill/rollback procedure.

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
A. exact-head GREEN — DONE
B. Cloudflare target inspection — DONE
C. secure core staging deploy, fuses off — DONE
D. redeploy current GREEN Mkety-assertion Trading build, fuses off — NEXT
E. health/default-domain verification
F. Telegram + MT5 demo + cTrader demo connectivity
G. one real E2E demo lifecycle
H. central Mkety Auth Gateway integration + non-money-moving access acceptance when available
I. custom hostname acceptance
J. material recovery checks
K. shadow production
L. dedicated demo soak
M. separately approved tiny controlled live
N. controlled beta -> general production

TradingView direct-ingress/certificate acceptance remains deferred/fail-closed and does not block an approved launch scope that does not require genuine TradingView-originated ingress.

## Safety authorization boundary
Generic `continue` authorizes safe repository development/static inspection only. It does not authorize Cloudflare/Zitadel deployment/config mutation, enabling master access/execution fuses, real Telegram acceptance, demo/live broker orders, `main` runtime merge or real-money execution unless the user explicitly authorizes the corresponding step.

## Mandatory handoff discipline
After every meaningful verified milestone:
1. update this file if controlling state changed;
2. update `cloudflare-v2/docs/PRODUCTION_FAST_PATH_HANDOFF.md`;
3. record exact branch head and relevant CI/run/job/test evidence;
4. state achieved/remaining/safety state/exact next pickup;
5. never let stale historical blockers override a newer verified handoff;
6. preserve the approved simple owner-workspace/custom-hostname/Mkety-access-gate model;
7. preserve the architecture/tooling freeze.

Historical remediation evidence remains in `cloudflare-v2/docs/PRODUCTION_V1_DEVELOPMENT_AUDIT.md`; use it as historical evidence, not the current pickup source when it conflicts with this file or the rolling handoff.
