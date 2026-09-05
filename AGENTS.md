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
**PRODUCTION BROKER + SOURCE CREDENTIAL ONBOARDING CODE GREEN -> LIVE DATABASE GREEN THROUGH 0014 -> CURRENT PAID STAGING STILL FUSES OFF -> NEXT EXTERNAL STEP REQUIRES SEPARATE AUTHORIZATION.**

### Production source onboarding — GREEN
- Exact code head: `f6ee4a8e819418615d7a981cd2274bec2d193329`.
- Trading V1 CI run `33975276085`, test job `101330765890`: **success**.
- Worker/trading core: **742/742 passed**.
- Pure MT5 bridge: **30/30 passed**.
- Pure MTProto/container/external Python: **34/34 passed**.
- Workspace-scoped source creation and credential rotation support:
  - Telegram/MTProto -> typed `mtproto` encrypted credential envelope;
  - MT5 source bridge -> typed `mt5` encrypted credential envelope;
  - cTrader source -> typed `ctrader` encrypted credential envelope.
- Source creation remains inactive by default and grants no broker execution authority.
- Credential rotation resolves the exact persisted source first and derives credential type from its stored provider. Caller-supplied provider hints are never credential authority.
- Provider credentials remain encrypted with `TRADING_MASTER_KEY` in `source_connections.provider_secret_ciphertext`; admin responses expose neither plaintext nor ciphertext.
- TradingView/custom signed API are intentionally outside this provider-credential onboarding path because they use different transport/authentication models.
- The pre-fix RED checkpoint had exactly four failures: MT5/cTrader create + MT5/cTrader rotate. The provider-aware fix resolved those without schema, execution-fuse, deployment or external-provider changes.

### Production broker onboarding — GREEN
- Broker-account onboarding code head: `d852de184c0b156dc360c4d242569b756acc2225`.
- Trading V1 CI run `33964408888`, test job `101301829090`: **success**.
- Admin surface supports production account creation and exact-workspace credential rotation.
- MT5/cTrader credentials use provider-specific validation.
- Credentials are encrypted server-side using `TRADING_MASTER_KEY` and persisted only as `trade_accounts.credential_ciphertext`.
- Plaintext/ciphertext credentials are not returned through admin account responses.
- New production account creation is forcibly safe: inactive, execution disabled, kill switch enabled.
- Credential rotation changes only the encrypted credential envelope and cannot enable execution.

### Supabase — GREEN THROUGH 0014
- Project: `Mkety Digital` (`vdblajgxrfndjesoyayy`).
- Migration `20260905115452 trading_0014_connection_credentials` applied successfully.
- Live `public.trade_accounts.credential_ciphertext` verified as nullable `text` with the intended server-only encrypted-credential comment.
- `trade_accounts` RLS remains enabled.
- `anon`/`authenticated` have no inspected table privileges; `service_role` retains server-side privileges.
- Post-migration security advisor shows no new Trading-specific WARN blocker.
- Expected INFO `rls_enabled_no_policy` remains for service-role-only Trading internal tables.
- Existing project-wide WARNs remain unrelated: `vector` extension in `public` and shared `public.rls_auto_enable()` SECURITY DEFINER callable by anon/authenticated.
- Performance advisor shows no new `0014`-specific blocker.

### Current paid staging deployment
- Worker: `mkety-copier-engine`.
- Last recorded deployed Worker version: `42e450f3-d801-45bb-a1af-5544233bded5` from head `ecb28b0e28709a6ac2bc778e78aa1fa77db0b41f`.
- Newer broker/source onboarding heads are code/CI verified but have not yet been redeployed.
- Runtime already has hidden `SUPABASE_URL`, normalized `SUPABASE_SERVICE_ROLE`, and `TRADING_MASTER_KEY` bindings from the reviewed staging setup.

### Other verified foundations
- Mkety signed-access verifier is implemented and fail-closed; access remains disabled.
- Custom hostname resolver is implemented; migration `0013` is live; custom-host routing remains disabled.
- MT5/cTrader demo acceptance workflows accept supported service-role aliases and keep global broker execution false.
- No real external Telegram, MT5 or cTrader acceptance is claimed yet for this milestone.

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
1. Do not redesign broker/source credential onboarding; both are code-green and broker credential storage is live through migration 0014.
2. Keep offline readiness separate from external connectivity acceptance. Offline checks may validate persisted provider/family configuration, encrypted credential presence/decryptability and safe inactive state; they must not pretend to prove network/provider connectivity.
3. Paid-staging redeploy of the current GREEN build is an external mutation and requires explicit deployment authorization. If authorized, redeploy with all five safety flags still false.
4. After redeploy, capture a real `/api/v1/health` response through an approved path.
5. When actual credentials/accounts are available and external contact is authorized, run one production-path acceptance per integration: MTProto/source observation, MT5 connectivity, cTrader connectivity; then one complete non-live E2E lifecycle and recovery/soak.
6. Do not enable `TRADING_ACCESS_ENABLED` until central Mkety Auth Gateway issuer/audience/JWKS configuration exists and signed-access acceptance passes.
7. Do not enable `BROKER_EXECUTION_ENABLED` for real-money paths without separate explicit final approval including exact limits, kill conditions and rollback.
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
