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

## Current verified stage — 2026-09-05
**ALL APPROVED SOURCE FAMILIES SELF-SERVICE ONBOARDING CODE GREEN -> LIVE DATABASE GREEN THROUGH 0014 -> CURRENT PAID STAGING FUSES REMAIN OFF.**

### Production source onboarding — GREEN
- Exact code head for TradingView + Custom Signed API onboarding: `e36c04f37f8e0bf27c7db2362ebd91d161b6af9d`.
- Trading V1 CI run `33992264387`, test job `101376473506`: **success**.
- Self-service admin source creation covers Telegram/MTProto, MT5, cTrader, TradingView webhook and Custom Signed API.
- Credential-based provider/session secrets remain encrypted in `source_connections.provider_secret_ciphertext`.
- Custom Signed API ingress signing secrets remain separately encrypted in `source_connections.secret_ciphertext`, with plaintext returned only once at creation/rotation.
- TradingView source creation generates a server-owned public handle, starts disabled and exposes only the safe webhook path.
- All new sources remain inactive by default and source onboarding grants no broker execution authority.

### Production broker onboarding — GREEN
- Broker-account onboarding code head: `d852de184c0b156dc360c4d242569b756acc2225`.
- Trading V1 CI run `33964408888`, test job `101301829090`: **success**.
- Credentials remain encrypted in `trade_accounts.credential_ciphertext`; new accounts are safe/inactive with execution disabled.

### Supabase — GREEN THROUGH 0014
- Project: `Mkety Digital` (`vdblajgxrfndjesoyayy`).
- Migration `20260905115452 trading_0014_connection_credentials` applied successfully.
- Trading service-role-only/RLS posture remains as previously verified.

### Current paid staging deployment
- Worker: `mkety-copier-engine`.
- Last recorded deployed Worker version: `68998f7f-74ce-4c37-8887-3751d3e17489`.
- Newer source-onboarding and audit/hostname heads have not been redeployed.

## Repository-wide audit continuation — IMPLEMENTED, CI BLOCKED BY RUNNER INFRASTRUCTURE
Current branch head at handoff update: `3872be28457f3974261bfbb625c6be6d7be91ff8` before this documentation commit.

### Confirmed audit findings and remediation
1. **Destination retry setup-failure rescheduling defect**
   - Production `markRetryable()` requires a valid `nextAttemptAt`, but the production retry wrapper omitted it when dependency/setup recovery failed.
   - Fix commit: `a2b987d96639b59b648aadaab5829d7e4a5a155e`.
   - Recovery now uses the existing 15-second adapter convention, based on the deterministic scheduler `now` value, and persists an explicit due timestamp.
2. **Stale unauthenticated legacy broker-capable webhook**
   - `/api/webhook/process_signal` was still delegated to the legacy worker and could reach legacy Deriv/cTrader/MT5 execution without the V1 ingress/authorization model.
   - Current first-party MTProto DO/container paths no longer depend on it: they use `SOURCE_EVENT_QUEUE` or authenticated `/api/v1/internal/source-event` handoff.
   - Route retired at the V1 entry boundary in commit `d572e59f1c0e4e9c7daa292b67bd92632a33606a`; it now returns `410 LEGACY_SIGNAL_WEBHOOK_RETIRED` before legacy code/shadow/database/broker behavior.
3. **Initial broker-retry fuse concern was a false positive and was corrected**
   - Full-chain review confirmed lower-level `createDestinationRetryRuntime()` already checks `BROKER_EXECUTION_ENABLED` before Supabase construction or due scanning.
   - A redundant wrapper-level fuse patch was reverted; do not resurrect that false finding.

### Audited boundaries with no demonstrated bypass
- Mkety signed assertion + exact workspace + membership authorization.
- Custom-hostname resolver as routing context only.
- Custom Signed API HMAC ingress: server-side source resolution, active-source check, timestamp window and constant-time signature comparison.
- Internal MTProto source handoff: POST-only shared-token authentication, strict native Telegram identity normalization and queue-only side effect.
- Source queue: active persisted source resolution before signed V1 dispatch.
- Durable event reservation/idempotency before processing.
- Production execution authority: Trading access/master broker fuse, persisted source/workspace/account reload, account safety/kill/risk checks, persisted credentials and destination idempotency before adapter dispatch.
- TradingView ingress remains fail-closed on the direct-ingress flag and certificate fingerprint verification.

### TradingView lifecycle semantics gap — NOT AN INGRESS BYPASS
- The generic source enable route can mark a TradingView row active independently of certificate transport readiness.
- Actual TradingView ingress still requires the existing direct-ingress + certificate fingerprint checks and an active source, so this is a lifecycle/readiness semantics gap rather than a demonstrated security bypass.
- Keep it separate from hostname/source-onboarding security systems; tighten enable semantics later if product behavior requires “certificate-ready before active row.”

## Customer custom-hostname self-service — CODE IMPLEMENTED, NOT YET CI VERIFIED
- Design: `docs/superpowers/specs/2026-09-05-custom-hostname-self-service-design.md`.
- Cloudflare for SaaS client: server-side token/zone only; customer receives safe CNAME/ownership/certificate validation instructions, never provider credentials.
- Authorized routes implemented:
  - `GET /api/v1/admin/hostnames`
  - `POST /api/v1/admin/hostnames`
  - `POST /api/v1/admin/hostnames/:id/verify`
- Only owner/admin roles receive `hostnames.read` / `hostnames.write`.
- Creation validates exact non-wildcard DNS hostname, rejects canonical/target/IP/URL-style inputs, provisions Cloudflare then persists local `pending`; local persistence failure attempts provider cleanup.
- Verification resolves the exact persisted `(workspace,id)` hostname and marks local routing active only when Cloudflare reports hostname `active` AND SSL `active`.
- No schema change was required; existing migration 0013 already provides globally unique hostname, pending/active state and verified timestamp.
- Required future runtime bindings: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ZONE_ID`, `TRADING_CUSTOM_HOSTNAME_CNAME_TARGET`.
- This repository work did **not** configure those bindings, call Cloudflare, alter DNS/fallback origin, enable `TRADING_CUSTOM_HOSTNAMES_ENABLED`, or deploy anything.

### CI infrastructure blocker
- Recent PR test runs fail before receiving a GitHub runner: `runner_id: 0`, empty `steps`, completion within seconds.
- Latest recorded example: Trading V1 CI run `33993647691` (#1524), mandatory test job `101380170036` — marked failure but **no test step executed**.
- Therefore branch head after the audit/hostname work must NOT be described as GREEN until a real runner executes the full mandatory test job successfully.

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
1. **First priority:** recover a functioning GitHub Actions runner and execute the full mandatory Trading V1 CI on the current branch. Do not claim GREEN from runner-less failures or static inspection.
2. If CI exposes code/test defects, fix only reproduced failures TDD-first and rerun until a real full test job is GREEN.
3. Once GREEN, update both handoffs with the exact final code head/run/job/test counts.
4. Do not configure or call Cloudflare for SaaS until separate external-mutation authorization. When authorized later, configure the API token/zone/CNAME target first while keeping `TRADING_CUSTOM_HOSTNAMES_ENABLED=false`, run non-routing provisioning/verification acceptance, then separately decide whether to enable routing.
5. Keep offline readiness separate from external provider acceptance.
6. Do not enable `TRADING_ACCESS_ENABLED` until central Mkety Auth Gateway issuer/audience/JWKS configuration exists and signed-access acceptance passes.
7. Do not enable `BROKER_EXECUTION_ENABLED` for real-money paths without separate explicit final approval including limits/kill/rollback.
8. Merge runtime to `main` only on explicit owner instruction.

## Architecture/tooling freeze
No new production architecture, framework, gate, workflow or elaborate acceptance tooling unless it fixes a blocker proved by ordinary CI, staging, demo execution or safe live-readiness verification. Use the system already built.

## Safety authorization boundary
Generic `continue` authorizes safe repository development/static inspection only. It does not authorize Cloudflare/Zitadel deployment/config mutation, enabling master access/execution/custom-host fuses, real Telegram acceptance, demo/live broker orders, `main` runtime merge or real-money execution unless the user explicitly authorizes the corresponding step.

## Mandatory handoff discipline
After every meaningful verified milestone:
1. update this file if controlling state changed;
2. update `cloudflare-v2/docs/PRODUCTION_FAST_PATH_HANDOFF.md`;
3. record exact branch/code head and relevant CI/run/job/test evidence;
4. state achieved/remaining/safety state/exact next pickup;
5. never let stale historical blockers override a newer verified handoff;
6. preserve the approved simple owner-workspace/custom-hostname/Mkety-access-gate model;
7. preserve the architecture/tooling freeze.

Historical remediation evidence remains in `cloudflare-v2/docs/PRODUCTION_V1_DEVELOPMENT_AUDIT.md`; use it as history, not the current pickup source when it conflicts with this file or the rolling handoff.
