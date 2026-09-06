# Trading V1 – Operational Source of Truth

## Mission
Launch Mkety Trading as a standalone enterprise Trading workspace product inside the Mkety ecosystem with an independent Trading runtime/data plane, strict workspace isolation, deterministic safety, durable idempotency and controlled rollout.

The controlling repository objective is now: **the V1 completion build is implemented on the isolated completion branch; perform one consolidated executable verification, batch-fix any reproduced failures, then proceed to separately authorized staging/external acceptance.**

## Controlling product model — APPROVED 2026-09-05
**one enterprise customer -> one Trading workspace -> one owner -> full workspace control.**

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
- Preserved feature branch / draft PR #2 head: `design/enterprise-trading-event-core`
- Active completion branch: `design/enterprise-trading-event-core-completion`
- Draft PR #2 targets `main` but still points at the preserved original branch.
- Completion branch comparison at final static audit: **55 commits ahead, 0 behind** the preserved feature branch.
- Never merge Trading runtime to `main` without explicit user instruction.
- Never enable real-money execution without separate explicit final owner approval and exact financial limits.

## V1 completion build — IMPLEMENTED / EXECUTABLE VERIFICATION PENDING
The approved completion plan is:
- `docs/superpowers/plans/2026-09-05-v1-production-completion-plan.md`

Repository implementation covers:
1. TradingView source readiness and ready-before-enable semantics.
2. Source-family ingestion/event pipeline parity and orchestration independent of the legacy `TRADING_V1_SIMULATION` response mode.
3. Broker account activation/deactivation lifecycle and enabled production-shaped MT5/cTrader execution tests using fake broker dependencies.
4. Retry/recovery durability: pre-claim validation, expired-lease crash recovery, CAS renewal, durable post-coordinator reconciliation, transient risk rescheduling and separate no-resend state-binding repair.
5. Workspace/admin/customer-hostname lifecycle, including provider-independent local list and unconditional canonical hostname enforcement.
6. Mkety access-gateway verification with fake JWKS fetch fixtures, `nbf` coverage, exact workspace binding before workspace lookup and exact enabled membership.
7. Legacy execution-surface audit: `/api/webhook/process_signal` is retired at the V1 wrapper and all legacy `/api/admin/*` routes are intercepted before legacy database/broker-capable code. Remaining legacy fallthrough is non-trading dashboard/VIP behavior.

No real broker/provider connection, Cloudflare custom-host API call, DNS mutation, deployment or `main` merge was performed as part of this repository build.

## Last fully verified GREEN historical milestones
These are historical verified baselines, not evidence that the current completion branch is green:
- Source onboarding implementation `e36c04f37f8e0bf27c7db2362ebd91d161b6af9d` — CI run `33992264387`, test job `101376473506`: success.
- Documentation head `ee5c9f9d9836c5b99434ea8ebacabf5f9707f454` — CI run `33992567673`, test job `101377281313`: success.
- Broker onboarding `d852de184c0b156dc360c4d242569b756acc2225` — CI run `33964408888`, test job `101301829090`: success.
- Live Trading Supabase previously verified through migration 0014.

## Current verification classification
GitHub Actions recently failed before assigning a runner (`runner_id: 0`, no executed steps), consistent with unavailable Actions capacity. The container used in this development session also could not clone GitHub because DNS resolution to github.com failed.

Therefore the current completion branch is classified:

**IMPLEMENTED / EXECUTABLE VERIFICATION PENDING — CI INFRASTRUCTURE UNAVAILABLE.**

It is neither code-RED nor code-GREEN until a fresh full test command actually executes.

Do not claim current tests pass based on commits, static inspection or historical green runs.

## Consolidated verification
When an executable environment is available, run one full local verification instead of per-commit micro-runs:

```bash
git checkout design/enterprise-trading-event-core-completion
git pull
cd cloudflare-v2
npm install
npm test
```

Treat reproduced failures as one batch. Fix those failures, rerun the complete suite, and only call the completion branch GREEN after a fresh zero-failure result.

## Current external/deployment safety state
Repository completion does not change deployed environment state. Keep fail-closed until separately authorized rollout:
- `TRADINGVIEW_DIRECT_INGRESS_ENABLED=false`
- `TRADINGVIEW_CERT_PROBE_ENABLED=false`
- `TRADING_ACCESS_ENABLED=false`
- `BROKER_EXECUTION_ENABLED=false`
- `TRADING_CUSTOM_HOSTNAMES_ENABLED=false`

Last recorded paid staging Worker:
- Worker: `mkety-copier-engine`
- deployed version: `68998f7f-74ce-4c37-8887-3751d3e17489`
- completion-branch code has not been deployed.

Required future custom-host provider configuration:
- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ZONE_ID`
- `TRADING_CUSTOM_HOSTNAME_CNAME_TARGET`

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
The scheduled destination-retry path does **not** bypass `BROKER_EXECUTION_ENABLED`. `createDestinationRetryRuntime()` checks real Worker env before database construction/scanning/claim. The redundant wrapper patch was reverted in `fdf1346430e51c7d34901798bbeb6586d427eefe`. Do not resurrect this as an outstanding finding.

## Exact next pickup
1. Run the consolidated test command above when an executable environment is available.
2. Batch-fix only reproduced failures and rerun the complete suite.
3. Update this file and both production handoffs with exact test counts/head/run evidence.
4. Only after GREEN, perform separately authorized staging deployment/configuration and external acceptance using existing scripts.
5. Keep real-money execution disabled until separate explicit approval and limits.

## Architecture/tooling freeze
No new framework, identity system, execution architecture or acceptance framework unless a concrete reproduced blocker requires it. Use the V1 system already built.

## Safety authorization boundary
Generic `continue` authorizes safe repository development/static inspection only. It does not authorize Cloudflare deployment/config mutation, enabling access/execution/custom-host fuses, real Telegram/provider acceptance, demo/live broker orders, `main` merge or real-money execution unless the user explicitly authorizes the corresponding step.
