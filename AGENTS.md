# Trading V1 – Operational Source of Truth

## Mission
Launch Mkety Trading as a standalone enterprise Trading workspace product inside the Mkety ecosystem with an independent Trading runtime/data plane, strict workspace isolation, deterministic safety, durable idempotency and a controlled rollout.

The project is past broad architecture work. The controlling objective is now: **exercise the already-built production paths in staging/demo, fix only defects proved by evidence, then launch progressively.**

## Controlling product model — APPROVED 2026-09-05
**one enterprise customer -> one Trading workspace -> one owner -> full workspace control.**

Do not redesign V1 as a complex collaboration/team SaaS. Existing membership/role primitives may remain for compatibility/future use.

## Identity / Mkety access boundary
- Current Mkety development authority: `MketyDigital/mksaas`.
- Zitadel remains behind Mkety identity.
- Approved shared direction: one central Cloudflare-hosted Mkety Auth Gateway for Mkety products/enterprise apps.
- Trading consumes a short-lived signed Mkety Trading assertion; it does not directly authorize from Zitadel org/project-role claim shapes.
- Required assertion contract: trusted signature + issuer + audience + time validity + immutable subject + `product=trading` + exact workspace + `access=owner`.
- Trading then verifies the exact enabled workspace and exact enabled membership in Trading Supabase.
- Supabase is final Trading application authorization/revocation authority.
- `TRADING_ACCESS_ENABLED=false` remains valid while the central gateway is not yet configured.
- Before access can be enabled, `MKETY_ACCESS_ISSUER`, `MKETY_ACCESS_AUDIENCE`, and `MKETY_ACCESS_JWKS_URL` must exist and acceptance must pass.
- Do not create a temporary Trading-only signer or direct-Zitadel fallback.

## Workspace / hostname boundary
- A Trading workspace is the enterprise customer isolation boundary for sources, broker accounts, credentials, policies, events, Trade State, retries/recovery and logs.
- Canonical product entry: `trade.mkety.com`.
- Optional customer hostname may map to the same backend/workspace using Cloudflare for SaaS.
- Hostname is routing context only, never authorization.
- Do not create a separate backend, identity silo or workspace per hostname.

## Production execution authority
Caller-supplied workspace/account/provider/destination/broker/credential/execution hints are never authority.

Immediately before any broker action, the runtime must re-check persisted workspace/source/account state, global execution fuse, account active/execution/kill state, risk/exposure, server-owned broker configuration, symbol/economic/volume truth and persistent idempotency.

## Repository / branch
- Repository: `MketyDigital/Trading`
- Active branch: `design/enterprise-trading-event-core`
- Draft PR: #2 -> `main`
- Never merge Trading runtime to `main` without explicit user instruction.
- Never enable real-money execution without separate explicit final owner approval and exact financial limits.

## Detailed current checkpoint
The detailed restart/audit/progress record is:
- `cloudflare-v2/docs/PRODUCTION_AUDIT_PROGRESS_2026-09-05.md`
- checkpoint commit: `f7b665e30675350c496c278ce48c4f76db1ffd56`

Read that file before continuing implementation. It records the full audit chronology, exact implementation/test commits, corrected false positive, custom-hostname implementation, CI blocker, progress summary and restart procedure.

## Last fully verified GREEN implementation milestone
**All approved source-family self-service onboarding is GREEN.**

- TradingView + Custom Signed API implementation: `e36c04f37f8e0bf27c7db2362ebd91d161b6af9d`.
- Trading V1 CI run `33992264387` (#1495), test job `101376473506`: **success**.
- Documentation head `ee5c9f9d9836c5b99434ea8ebacabf5f9707f454` also passed run `33992567673` (#1497), test job `101377281313`.
- Self-service source creation covers Telegram/MTProto, MT5, cTrader, TradingView webhook and Custom Signed API.
- Source creation remains inactive by default and grants no broker execution authority.

Broker-account onboarding was separately verified GREEN at `d852de184c0b156dc360c4d242569b756acc2225`, CI run `33964408888`, test job `101301829090`.

Live Trading Supabase remains verified through migration 0014.

## Repository-wide audit continuation — IMPLEMENTED, CI CURRENTLY UNAVAILABLE
Implementation head before the documentation-only checkpoint commits:
- `3872be28457f3974261bfbb625c6be6d7be91ff8`

### Confirmed defect fixed — retry setup rescheduling
- Regression: `82624bb14b1b6a0bf75485069cb927c8fa5d41a0`.
- Fix: `a2b987d96639b59b648aadaab5829d7e4a5a155e`.
- Production retry setup/dependency failures now pass a valid explicit `nextAttemptAt` using the existing 15-second convention.

### Confirmed high-risk stale surface retired
- Regression: `f46091ec27f5ba54e5a44023280064e5f5849080`.
- Fix: `d572e59f1c0e4e9c7daa292b67bd92632a33606a`.
- `POST /api/webhook/process_signal` no longer reaches legacy broker-capable code; it returns `410 LEGACY_SIGNAL_WEBHOOK_RETIRED` at the V1 boundary.
- Current MTProto first-party transports use `SOURCE_EVENT_QUEUE` or authenticated `/api/v1/internal/source-event`, so the legacy route was not required by the supported path.

### Corrected false positive
- The scheduled destination-retry path does **not** bypass `BROKER_EXECUTION_ENABLED`.
- Full-chain tracing confirmed `createDestinationRetryRuntime()` checks the real Worker env before Supabase construction/scanning/claim.
- Redundant wrapper patch was reverted in `fdf1346430e51c7d34901798bbeb6586d427eefe`.
- Do not resurrect this as an outstanding finding.

### Audited boundaries with no demonstrated bypass
- Mkety signed assertion + exact workspace + enabled membership authorization.
- Custom Signed API HMAC ingress.
- Internal MTProto token-authenticated queue handoff.
- Active-source resolution in source queue.
- Durable event reservation/idempotency.
- Production persisted workspace/source/account authority, safety/risk/kill checks, persisted credentials and destination/order idempotency.
- TradingView direct-ingress/certificate fingerprint enforcement.

### TradingView lifecycle semantics gap — tracked separately
A TradingView source row can be activated independently of certificate readiness, while actual ingress still fails closed behind the direct-ingress and certificate requirements. This is a lifecycle/readiness semantics gap, not a demonstrated ingress bypass. Revisit only after the current post-audit branch is genuinely CI GREEN.

## Customer custom-hostname self-service — CODE IMPLEMENTED, CI PENDING
- Design: `docs/superpowers/specs/2026-09-05-custom-hostname-self-service-design.md`.
- Cloudflare SaaS client: `004711f4c6c1464a19ba7110ac597c15f46d8471`.
- Workspace hostname API: `7e101e130fed83376986d2f421b7a5728f6aead0`.
- Owner/admin permissions: `fda9cfaf3c190bb2e8fa1293b5ad114c653dcd3a`.
- Admin router wiring: `053d70a4b98394a891b637ee489737c2968b85b4`.
- Lifecycle tests: `9d9ba11b24559ebc5aa2dcc258bb50ae59a54bab`.
- Permission regression: `3872be28457f3974261bfbb625c6be6d7be91ff8`.

Admin routes:
- `GET /api/v1/admin/hostnames`
- `POST /api/v1/admin/hostnames`
- `POST /api/v1/admin/hostnames/:id/verify`

Only owner/admin roles may manage hostnames. Creation is exact-workspace scoped and pending by default. Verification activates local routing only when Cloudflare reports both hostname and SSL active. Hostname remains routing context only; normal Mkety assertion/workspace authorization still applies.

No schema change was required beyond existing migration 0013.

Required future provider configuration:
- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ZONE_ID`
- `TRADING_CUSTOM_HOSTNAME_CNAME_TARGET`

No Cloudflare API call, DNS/fallback-origin change, runtime binding change, deployment or custom-hostname routing enablement was performed.

## GitHub Actions blocker — PROBABLE MONTHLY ALLOCATION EXHAUSTION
Recent mandatory CI jobs are being marked failed before GitHub assigns a runner:
- `runner_id: 0`
- `steps: []`
- completion within seconds.

Representative run:
- Trading V1 CI `33993647691` (#1524)
- mandatory test job `101380170036`
- no runner and no executed test step.

The repository owner reports the GitHub account appears to have reached its approximately 3,000 Actions monthly allocation. That explanation is plausible and fits the runner-less pattern, but it has not been independently verified through a billing/usage endpoint in this session.

Classification until a real runner executes the suite:
**CI UNAVAILABLE / INFRASTRUCTURE-BLOCKED — NOT CODE-RED AND NOT CODE-GREEN.**

Do not burn additional Actions runs repeatedly while quota availability is uncertain.

## Current paid staging deployment
- Worker: `mkety-copier-engine`.
- Last recorded deployed Worker version: `68998f7f-74ce-4c37-8887-3751d3e17489`.
- Newer source-onboarding, audit-remediation and hostname-self-service heads have not been redeployed.

## Critical runtime safety defaults
Keep fail-closed until a separately authorized rollout step changes them:
- `TRADINGVIEW_DIRECT_INGRESS_ENABLED=false`
- `TRADINGVIEW_CERT_PROBE_ENABLED=false`
- `TRADING_ACCESS_ENABLED=false`
- `BROKER_EXECUTION_ENABLED=false`
- `TRADING_CUSTOM_HOSTNAMES_ENABLED=false`

No tenant/admin API may mutate Worker-wide master fuses.

## Production execution locks
Before a broker adapter may be reached, all applicable locks must pass:
1. `TRADING_ACCESS_ENABLED=true` for user/admin initiated execution paths where applicable;
2. `BROKER_EXECUTION_ENABLED=true`;
3. exact persisted source remains active/workspace-authoritative;
4. exact Trading workspace entitlement remains enabled;
5. exact trade account belongs to the workspace and remains active;
6. account `execution_enabled=true`;
7. kill/safety/risk/exposure policy allows the action;
8. server-owned platform/destination configuration is complete;
9. broker-authoritative symbol/risk/volume metadata validates final action;
10. persistent destination/order idempotency reservation succeeds;
11. TradingView additionally requires its accepted ingress/source/certificate path.

## Exact next pickup
### While GitHub Actions capacity is unavailable
1. Do not stack additional non-critical production features on the unverified audit/hostname head.
2. Continue static review/documentation only, or prepare exact acceptance checklists without invoking external systems.
3. If a critical security defect is proved by repository evidence, a narrow emergency fix is allowed, but record that it is unverified until CI returns.
4. Keep all five safety fuses false.
5. Do not deploy, call Cloudflare, mutate DNS, contact real brokers/providers, place orders, or merge `main`.

### First step when Actions capacity returns
1. Run ordinary full Trading V1 CI on the current branch.
2. Confirm the mandatory test job receives a real runner and executes steps.
3. Fix only reproduced RED assertions TDD-first.
4. Rerun until genuinely GREEN.
5. Update this file, `PRODUCTION_AUDIT_PROGRESS_2026-09-05.md`, and `PRODUCTION_FAST_PATH_HANDOFF.md` with exact final branch head/run/job/test evidence.

### After the current code is GREEN
The next bounded engineering decision is the TradingView lifecycle semantics gap. Decide whether certificate readiness must be required before a TradingView source row becomes active. Keep that work separate from hostname routing and source authentication.

### Later external acceptance — separately authorized
For custom hostnames, configure Cloudflare token/zone/CNAME target while `TRADING_CUSTOM_HOSTNAMES_ENABLED=false`, run controlled non-routing provisioning/verification acceptance, verify exact workspace authorization, and only then consider routing enablement as a separate rollout decision.

## Architecture/tooling freeze
No new production architecture, framework, gate, workflow or elaborate acceptance tooling unless it fixes a blocker proved by ordinary CI, staging, demo execution or safe live-readiness verification. Use the system already built.

## Safety authorization boundary
Generic `continue` authorizes safe repository development/static inspection only. It does not authorize Cloudflare/Zitadel deployment/config mutation, enabling master access/execution/custom-host fuses, real Telegram acceptance, demo/live broker orders, `main` runtime merge or real-money execution unless the user explicitly authorizes the corresponding step.

## Mandatory handoff discipline
After every meaningful verified milestone:
1. update this file if controlling state changed;
2. update `cloudflare-v2/docs/PRODUCTION_FAST_PATH_HANDOFF.md`;
3. update the detailed audit checkpoint while this audit/hostname milestone remains active;
4. record exact branch/code head and relevant CI/run/job/test evidence;
5. state achieved/remaining/safety state/exact next pickup;
6. never let stale historical blockers override a newer verified handoff;
7. preserve the approved simple owner-workspace/custom-hostname/Mkety-access-gate model;
8. preserve the architecture/tooling freeze.

Historical remediation evidence remains in `cloudflare-v2/docs/PRODUCTION_V1_DEVELOPMENT_AUDIT.md`; use it as history, not the current pickup source when it conflicts with this file or the rolling handoff.
