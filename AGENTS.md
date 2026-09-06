# Trading V1 – Operational Source of Truth

## Mission
Launch Mkety Trading as a standalone enterprise Trading workspace product inside the Mkety ecosystem with an independent Trading runtime/data plane, strict workspace isolation, deterministic safety, durable idempotency and controlled rollout.

The current repository objective is: **finish the Trading repo V1 completion branch, verify safe source-to-destination simulation, then proceed to controlled staging/external acceptance with all real-execution fuses disabled before any production promotion.**

## Active promotion path

- Repository: `MketyDigital/Trading`
- Production PR: #2 `feat: build enterprise trading event core foundation`
- PR #2 base: `main`
- PR #2 head branch: `design/enterprise-trading-event-core`
- Latest status-only AGENTS commit at time of documentation: `96058307105f06159155b29a063def27b0376381`.
- PR #2 is open, ready for review, and not merged to `main`.
- PR #6 `fix: synchronize Trading V1 frontend and safe simulation` is merged into the staging feature branch, not `main`.
- PR #6 merge commit: `7adbe62cb6dd0f721f3dd20933c131cbe20dfd41`.

## Completed repo/staging evidence

- Trading V1 CI passed on PR #6 final head before the PR #6 staging merge.
- Production PR #2 CodeQL succeeded on checked head `2323354dd4d0951d33d903c334e0902a5bb9c15f` with no new alerts in changed code. Re-check current-head CodeQL after status-only commits settle.
- Gate 2 read-only Cloudflare staging inspection passed: run `34060610896`.
- Gate 2 paid staging deployment passed with fail-closed runtime gates: run `34060662482`.
- Gate 2 post-deploy acceptance passed: run `34060780169`.
- Gate 3 read-only `trade.mkety.com` zone/hostname inspection passed: run `34060858192`.

## Gate 2 acceptance evidence

Gate 2 acceptance verified all of the following without enabling real execution:

- staging credentials were present without printing values;
- known-good rollback version existed;
- temporary simulation Worker deployed with `--containers-rollout none`;
- internal transport secret became active;
- real Queue path, deduplication, and non-broker simulation succeeded;
- no new Container instances were created;
- rollback succeeded to known-safe Paid staging version `c25e85d5-bfe2-4d17-9ab4-5133d88ecec8`;
- final Container state verification succeeded.

## Current blockers before production launch

1. Gate 3 TradingView certificate probe is blocked by Cloudflare custom-domain readiness/routing: `trade.mkety.com` returned HTTP 503 during the spoof-rejection readiness poll even after a 90-second retry window. Probe deploy and rollback both succeeded. Runs: `34060883851`, retry `34061086731`.
2. Gate 4 identity acceptance is blocked before the read-only matrix by missing staging configuration. First missing value observed: `GATE4_BASE_URL`. Run: `34061213068`.
3. Gate 5 MTProto soak is blocked before the observation runner by missing staging configuration. First missing value observed: `GATE5_WORKSPACE_ID`. Run: `34061298173`.
4. Gate 6 MT5 demo connectivity probe is blocked before probe execution by missing staging configuration. First missing value observed: `MT5_BRIDGE_URL`. Run: `34061366745`.
5. Gate 6 cTrader demo connectivity probe is blocked before probe execution by missing staging configuration. First missing value observed: `CTRADER_CLIENT_ID`. Run: `34061418950`.
6. Gate 6 source acceptance requires additional prepared source endpoints/secrets. MT5 source acceptance also requires a self-hosted Windows runner labeled `mt5-demo`.
7. Gate 7 demo lifecycle requires demo broker credentials plus `TRADING_WORKSPACE_ID`; do not run until Gate 6 demo probes are green.
8. `main` currently appears unprotected through the branch API. Configure required reviews/status checks before final production merge.

## Controlling product model — approved

**One enterprise customer -> one Trading workspace -> one owner -> full workspace control.**

Do not redesign V1 as a complex collaboration/team SaaS. Existing membership/role primitives may remain for compatibility/future use.

## Identity / Mkety access boundary

- Zitadel remains behind Mkety identity.
- Trading consumes a short-lived signed Mkety Trading assertion; it does not directly authorize from caller-provided workspace/account/provider hints.
- Required assertion contract: trusted RS256 signature + issuer + audience + time validity + immutable subject + `product=trading` + exact workspace + `access=owner` or valid role contract.
- The selected workspace ID is bound into bearer verification before the workspace record is read.
- Trading verifies the exact enabled workspace and exact enabled membership in Trading Supabase.
- Supabase remains final Trading application authorization/revocation authority.
- Do not create a Trading-only signer or direct-Zitadel authorization fallback.

## Workspace / hostname boundary

- A Trading workspace is the enterprise isolation boundary for sources, broker accounts, credentials, policies, events, Trade State, retries/recovery and logs.
- Canonical product entry: `trade.mkety.com`.
- Customer hostnames are optional routing context only; they never grant authorization.
- Canonical hostname enforcement always runs.
- If custom-hostname routing is enabled, only an exact active persisted hostname -> workspace mapping is accepted, and it must match the signed/selected workspace.
- Do not create a separate backend, identity silo or workspace per hostname.

## Production execution authority

Caller-supplied workspace/account/provider/destination/broker/credential/execution hints are never authority.

Immediately before broker action, the runtime re-checks persisted workspace/source/account state, global execution fuse, account active/execution/kill state, risk/exposure, server-owned broker configuration, broker-authoritative symbol/economic/volume truth and persistent destination/order idempotency.

Repository tests may inject production gates as enabled and fake broker/provider dependencies to exercise the complete path. That is not authorization to connect real accounts or place real orders.

## Current external/deployment safety state

Keep fail-closed through staging acceptance unless the applicable gate explicitly and temporarily requires a narrower non-broker probe:

- `TRADINGVIEW_DIRECT_INGRESS_ENABLED=false`
- `TRADINGVIEW_CERT_PROBE_ENABLED=false`
- `TRADING_ACCESS_ENABLED=false`
- `BROKER_EXECUTION_ENABLED=false`
- `TRADING_CUSTOM_HOSTNAMES_ENABLED=false`

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

## Exact next pickup

1. Fix Gate 3 custom-domain 503 on `trade.mkety.com`, then rerun the Gate 3 certificate probe and fire one genuine TradingView webhook during the bounded probe window.
2. Add Gate 4 staging identity secrets/test tokens, then rerun `identity: accept zitadel gate 4`.
3. Add Gate 5 staging MTProto workspace/source/health/event secrets, then rerun `source: accept mtproto gate 5`.
4. Add Gate 6 demo connectivity credentials for MT5 and cTrader, then rerun the MT5/cTrader demo probes.
5. Prepare Gate 6 source endpoints and self-hosted Windows `mt5-demo` runner where required.
6. Run Gate 7 demo lifecycle only after Gate 6 demo probes are green.
7. Re-check current-head CI/CodeQL after all blocker-fix commits settle.
8. Configure `main` protection before final production merge.
9. Do not merge `main` or enable live broker execution without explicit final authorization.

## Safety authorization boundary

Repository completion and safe staging/simulation acceptance may use production-shaped code with non-real/ephemeral credentials while all broker execution fuses remain disabled. Never enable real-money execution, connect real broker credentials, merge to `main`, or change customer DNS/custom-host production state without the separate explicit authorization required for that action.
