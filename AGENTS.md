# Trading V1 – Operational Source of Truth

## Mission
Launch Mkety Trading as a standalone enterprise Trading workspace product inside the Mkety ecosystem with an independent Trading runtime/data plane, strict workspace isolation, deterministic safety, durable idempotency and controlled rollout.

The current repository objective is: **finish the Trading repo V1 completion branch, verify safe source-to-destination simulation, then proceed to controlled staging/external acceptance with all real-execution fuses disabled before any production promotion.**

This repo is the focus. MkSaaS/Mkety matters only as the upstream auth/access assertion contract that Trading consumes.

## Current PR #6 status
- PR: #6 `fix: synchronize Trading V1 frontend and safe simulation`
- Branch: `fix/v1-frontend-sync-simulation`
- Base: `design/enterprise-trading-event-core`
- State: draft/open, not merged
- Classification: `REPO GREEN / CODEQL SETTINGS BLOCKED / EXTERNAL STAGING ACCEPTANCE BLOCKED`

Repo-controlled tasks 1-8 are recorded in:
- `docs/superpowers/plans/2026-09-06-v1-frontend-sync-simulation.md`

Canonical handoff is recorded in:
- `cloudflare-v2/docs/PRODUCTION_FAST_PATH_HANDOFF.md`

Frontend/API/schema audit is recorded in:
- `cloudflare-v2/docs/V1_FRONTEND_SYNC_AUDIT.md`

Latest verified CI evidence before this AGENTS update:
- SHA: `6da2232f666ae8129f9909f7604128a5e86e823d`
- Trading V1 CI run: `34058536767`
- Test job: `101554777002`
- Worker/trading-core tests: success
- pure MT5 bridge tests: success
- pure MTProto Python tests: success

Latest CodeQL evidence:
- Default CodeQL run: `34058536874`
- Python job: failed during SARIF processing/configuration
- JavaScript/TypeScript job: failed during SARIF processing/configuration
- Root cause from logs: GitHub Code Security rejected CodeQL analyses because advanced configurations cannot be processed when default setup is enabled.
- Treat this as a repository Code Security settings blocker, not a confirmed runtime code vulnerability.

Required external/admin action:
1. In GitHub Code Security settings, choose exactly one CodeQL mode: default setup or advanced setup.
2. Clear the default-vs-advanced conflict.
3. Rerun CodeQL on PR #6.

## Controlling product model — APPROVED
**One enterprise customer -> one Trading workspace -> one owner -> full workspace control.**

Do not redesign V1 as a complex collaboration/team SaaS. Existing membership/role primitives may remain for compatibility/future use.

## Identity / Mkety access boundary
- Zitadel remains behind Mkety identity.
- Trading consumes a short-lived signed Mkety Trading assertion; it does not directly authorize from Zitadel org/project-role claim shapes.
- Required assertion contract: trusted RS256 signature + issuer + audience + time validity + immutable subject + `product=trading` + exact workspace + `access=owner`.
- The selected workspace ID is bound into bearer verification before the workspace record is read.
- Trading then verifies the exact enabled workspace and exact enabled membership in Trading Supabase.
- Supabase remains final Trading application authorization/revocation authority.
- Required deployment config before access rollout: `MKETY_ACCESS_ISSUER`, `MKETY_ACCESS_AUDIENCE`, `MKETY_ACCESS_JWKS_URL`.
- Do not create a Trading-only signer or direct-Zitadel authorization fallback.

## Workspace / hostname boundary
- A Trading workspace is the enterprise isolation boundary for sources, broker accounts, credentials, policies, events, Trade State, retries/recovery and logs.
- Canonical product entry: `trade.mkety.com`.
- Customer hostnames are optional routing context only; they never grant authorization.
- Canonical hostname enforcement always runs. If custom-hostname routing is disabled, non-canonical hosts fail closed.
- If custom-hostname routing is enabled, only an exact active persisted hostname -> workspace mapping is accepted, and it must match the signed/selected workspace.
- Do not create a separate backend, identity silo or workspace per hostname.

## Production execution authority
Caller-supplied workspace/account/provider/destination/broker/credential/execution hints are never authority.

Immediately before broker action, the runtime re-checks persisted workspace/source/account state, global execution fuse, account active/execution/kill state, risk/exposure, server-owned broker configuration, broker-authoritative symbol/economic/volume truth and persistent destination/order idempotency.

Repository tests may inject production gates as enabled and fake broker/provider dependencies to exercise the complete path. That is not authorization to connect real accounts or place real orders.

## Repository / branches
- Repository: `MketyDigital/Trading`
- Base staging feature branch for this PR: `design/enterprise-trading-event-core`
- Active completion PR: PR #6, `fix/v1-frontend-sync-simulation`
- PR #6 remains draft/open until CodeQL settings are resolved and external staging acceptance preparation is deliberately advanced.
- Never merge Trading runtime to `main` without explicit user instruction.
- Never enable real-money execution without separate explicit final owner approval and exact financial limits.

## Current external/deployment safety state
Keep fail-closed through staging acceptance unless the applicable gate explicitly and temporarily requires a narrower non-broker probe:
- `TRADINGVIEW_DIRECT_INGRESS_ENABLED=false`
- `TRADINGVIEW_CERT_PROBE_ENABLED=false`
- `TRADING_ACCESS_ENABLED=false`
- `BROKER_EXECUTION_ENABLED=false`
- `TRADING_CUSTOM_HOSTNAMES_ENABLED=false`

Required future custom-host provider configuration:
- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ZONE_ID`
- `TRADING_CUSTOM_HOSTNAME_CNAME_TARGET`

Required future Mkety access-gateway configuration:
- `MKETY_ACCESS_ISSUER`
- `MKETY_ACCESS_AUDIENCE`
- `MKETY_ACCESS_JWKS_URL`

Provider/broker credentials remain external deployment secrets; do not commit them.

## Production execution locks
Before a broker adapter may be reached, all applicable locks must pass:
1. Worker/user access gate where applicable;
2. `BROKER_EXECUTION_ENABLED=true`;
3. exact persisted source remains active/workspace-authoritative;
4. exact Trading workspace entitlement remains enabled;
5. exact account belongs to the workspace and is active;
6. account `execution_enabled=true`;
7. kill/safety/risk/exposure policy allows the action;
8. server-owned platform/destination configuration is complete;
9. broker-authoritative symbol/risk/volume metadata validates the final action;
10. persistent destination/order idempotency reservation succeeds;
11. provider-specific production safety requirements also pass.

## Corrected historical false positive
The scheduled destination-retry path does **not** bypass `BROKER_EXECUTION_ENABLED`. `createDestinationRetryRuntime()` checks real Worker env before database construction/scanning/claim. Do not resurrect this as an outstanding finding.

## Exact next pickup
1. Do not change code simply to satisfy CodeQL until repository Code Security settings are fixed.
2. Resolve GitHub CodeQL default-vs-advanced setup conflict and rerun CodeQL.
3. Configure staging gates deliberately with non-live/test values.
4. Run controlled staging acceptance gates while real-money execution remains disabled.
5. Do not merge `main`.
6. Do not enable live broker execution.

## Architecture/tooling freeze
No new framework, identity system, execution architecture or acceptance framework unless a concrete reproduced blocker requires it. Use the V1 system already built.

## Safety authorization boundary
Repository completion and safe staging/simulation acceptance may use production-shaped code with non-real/ephemeral credentials while all broker execution fuses remain disabled. Never enable real-money execution, connect real broker credentials, merge to `main`, or change customer DNS/custom-host production state without the separate explicit authorization required for that action.
