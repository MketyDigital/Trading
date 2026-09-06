# Mkety Trading – Production Fast Path Handoff

**Current classification:** `GREEN CODE / STAGING CONFIGURATION BLOCKED`  
**Repository:** `MketyDigital/Trading`  
**Active staging feature branch:** `design/enterprise-trading-event-core`  
**Draft PR:** #2 -> `main`  

## Approved product model
- One enterprise customer -> one Trading workspace -> one owner -> full control.
- Trading remains an independent runtime/data plane inside the Mkety ecosystem.
- Trading consumes a signed Mkety Trading assertion and then verifies exact enabled workspace + membership in Trading Supabase.
- Canonical entry is `trade.mkety.com`; customer hostnames are routing context only and never authorization.
- Repository tests may inject production gates and fake broker/provider dependencies as enabled. This does not create external connectivity or authorize real orders.

## Completion status
The approved V1 production completion plan is implemented through the repository/runtime safety work. The remaining release blockers are external staging configuration and acceptance evidence, not known failing runtime tests.

### TradingView readiness
- Server-owned TradingView transport readiness is exposed by `tradingview_transport.js`.
- Source activation requires provider readiness; TradingView cannot be activated without source handle + direct-ingress/certificate configuration.
- Ingress still independently requires presented certificate + exact fingerprint match.

### Source/event pipeline
- Accepted non-duplicate V1 events proceed through orchestration even when `TRADING_V1_SIMULATION=false`.
- `TRADING_V1_SIMULATION` no longer acts as the master processing switch.
- Broker side effects remain controlled by production execution authority/gates.
- Source family paths reviewed: MTProto/Telegram, MT5, cTrader, TradingView and Custom Signed API.
- Recovery coverage exists around source queue/ingest/signed-V1 duplicate behavior.

### Broker destination lifecycle
- Explicit account activation lifecycle is present.
- Activation never enables execution automatically.
- Deactivation clears `execution_enabled`, so stale execution authority cannot revive on later activation.
- Production-shaped MT5/cTrader execution is covered with enabled gates + fake broker dependencies, including live-shaped cTrader provider gating.

### Retry/recovery/reconciliation
- Retry envelope is validated before claim.
- Expired `PENDING` leases can be safely recovered after worker failure.
- Reclaiming an expired lease renews it without consuming another logical attempt.
- Live leases cannot be stolen.
- Coordinator failures that leave a claim `PENDING` are durably reconciled/rescheduled.
- Existing broker-written `SUCCEEDED`, `RETRYABLE`, `UNCERTAIN`, or `FAILED` states remain authoritative.
- `BROKER_RISK_CONTEXT_UNAVAILABLE` is treated as transient/reschedulable.
- State-binding repair remains separate from broker retry and cannot resend a succeeded broker action.

### Admin / hostname lifecycle
- Local hostname listing does not depend on Cloudflare provider credentials.
- Create/verify still require provider configuration.
- Canonical hostname validation always runs.
- When custom hostname routing is disabled, a non-canonical Host fails closed.
- When enabled, only an active exact hostname mapping is accepted and its workspace must match the selected/signed workspace.
- The approved V1 design intentionally keeps hostname delete/rotation out of scope.

### Mkety access gateway
- Real verifier path has fake JWKS/fetch coverage.
- Valid RS256 assertion, issuer/audience, expiry, `nbf`, product, workspace and owner-access cases are represented.
- Admin authorization binds the selected workspace into bearer verification before querying the workspace row.
- Exact enabled Trading membership is still required after assertion + workspace entitlement validation.
- No direct-Zitadel fallback or Trading-only signer was introduced.

### Legacy execution surface
- `/api/webhook/process_signal` is intercepted by the V1 wrapper and returns `410 LEGACY_SIGNAL_WEBHOOK_RETIRED` before legacy database/broker code.
- Every legacy `/api/admin/*` route is retired at the wrapper before the unscoped legacy admin implementation.
- Remaining legacy fallthrough is dashboard/VIP behavior, not a broker-capable trading bypass.
- Existing first-party MTProto source paths use queue or authenticated internal handoff and do not require the retired signal endpoint.

## Fresh executable and security verification
Latest code-bearing security repair head:

- code SHA: `df4d6a067bd7084baddb3982ef0d4fb0e77eb01f`
- Trading V1 CI: **success**
- Worker/trading-core Node tests: **success**
- pure MT5 bridge tests: **success**
- pure MTProto Python tests: **success**
- CodeQL run `34035889265`: **success**
- prior CodeQL findings fixed: workflow token permissions, unsafe URL-substring test pattern, and HTTP information exposure through internal simulation errors.

The current branch head may include documentation-only staging trigger commits after this code SHA. A docs-only CodeQL check on head `dea1099ab67b63e11509fda4d8f86b386bca51bd` returned neutral because GitHub reported the JavaScript default scanning configuration was not found for that docs-only update; no new CodeQL annotations were reported. Treat `df4d6a...` as the latest full successful code-bearing CodeQL evidence unless runtime code changes again.

## Gate 2 staging acceptance — PASS
Final repaired Gate 2 run: `34035312771`.

Verified:
- ordinary Worker/trading-core + MT5 + MTProto regression suite passed;
- temporary simulation-enabled Worker deployment succeeded;
- newly deployed internal transport secret became active;
- real Queue ingress path accepted the test event;
- duplicate delivery collapsed correctly;
- external Trading access remained fail-closed;
- zero broker/destination delivery rows were created;
- zero new Container instance IDs were created;
- rollback to the known-good Paid staging version succeeded;
- final Container state remained unchanged.

The Gate 2 harness now tolerates only a bounded post-deploy HTTP 401 propagation window and still requires normal authenticated 202 queue acceptance. No runtime auth rule was weakened.

## Gate 4 identity acceptance — BLOCKED BY STAGING CONFIGURATION
Run `34036008305` passed the full regression suite but the real read-only identity matrix never started because required staging values are absent.

Present:
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE`

Missing/unset Gate 4/Zitadel inputs include:
- `GATE4_BASE_URL`
- `GATE4_WORKSPACE_ID`
- `GATE4_SECOND_WORKSPACE_ID`
- `GATE4_DISABLED_WORKSPACE_ID`
- `GATE4_EXISTING_MKETY_TOKEN`
- `GATE4_TRADING_ONLY_TOKEN`
- `GATE4_WRONG_PROJECT_TOKEN`
- `GATE4_WRONG_ORG_TOKEN`
- `GATE4_MISSING_MEMBERSHIP_TOKEN`
- `GATE4_DISABLED_MEMBERSHIP_TOKEN`
- `GATE4_SECOND_TENANT_TOKEN`
- `GATE4_OWNER_TOKEN`
- `GATE4_ADMIN_TOKEN`
- `GATE4_OPERATOR_TOKEN`
- `GATE4_VIEWER_TOKEN`
- `ZITADEL_ISSUER`
- `ZITADEL_AUDIENCE`
- `ZITADEL_JWKS_URL`
- `ZITADEL_PROJECT_ID`

Gate 4 keeps `TRADING_ACCESS_ENABLED=false` and `BROKER_EXECUTION_ENABLED=false` and is read-only.

## Gate 5 MTProto soak — BLOCKED BY STAGING CONFIGURATION
Run `34037617063` passed the full regression suite but the observation-only soak did not start because Gate 5 configuration is absent.

Missing/unset required inputs include:
- `GATE5_WORKSPACE_ID`
- `GATE5_BEARER_TOKEN`
- `GATE5_CONTAINER_SOURCE_ID`
- `GATE5_CONTAINER_HEALTH_URL`
- `GATE5_CONTAINER_EVENTS_URL`
- `GATE5_DO_SOURCE_ID`
- `GATE5_DO_HEALTH_URL`
- `GATE5_DO_EVENTS_URL`
- `GATE5_EXTERNAL_SOURCE_ID`
- `GATE5_EXTERNAL_HEALTH_URL`
- `GATE5_EXTERNAL_EVENTS_URL`

Optional soak timing variables are also unset. Gate 5 is observation-only and keeps Trading access and broker execution disabled.

## Gate 6 demo connectivity — BLOCKED BY STAGING CONFIGURATION
MT5 connectivity run `34037635830` passed regression tests but did not contact a broker because these staging values are absent:
- `MT5_BRIDGE_URL`
- `MT5_BRIDGE_SECRET`
- `MT5_ACCOUNT_ID`
- `MT5_EXPECTED_DEMO_SERVER`

cTrader connectivity run `34037695162` passed regression tests but did not contact cTrader because these staging values are absent:
- `CTRADER_CLIENT_ID`
- `CTRADER_CLIENT_SECRET`
- `CTRADER_ACCESS_TOKEN`
- `CTRADER_ACCOUNT_ID`

Both connectivity probes force their demo-order flag to `false` and keep `BROKER_EXECUTION_ENABLED=false`.

## Gate 6 source acceptance prerequisites
Before source-only acceptance can run, prepare the staging values referenced by `.github/workflows/gate6-source-acceptance.yml`.

MT5 source path requires the MT5 demo self-hosted runner plus:
- `GATE6_MT5_SOURCE_ENDPOINT`
- `GATE6_MT5_SOURCE_ID`
- `GATE6_MT5_SOURCE_SECRET`
- `GATE6_MT5_ACCOUNT_ID`

cTrader source path requires:
- `GATE6_CTRADER_CLIENT_ID`
- `GATE6_CTRADER_CLIENT_SECRET`
- `GATE6_CTRADER_ACCESS_TOKEN`
- `GATE6_CTRADER_ACCOUNT_ID`
- `GATE6_CTRADER_SOURCE_ENDPOINT`
- `GATE6_CTRADER_SOURCE_ID`
- `GATE6_CTRADER_SOURCE_SECRET`

These source gates keep `BROKER_EXECUTION_ENABLED=false`.

## Gate 7 demo destination prerequisites
Gate 7 deliberately exercises demo-order lifecycle behavior. Do not trigger it until the configured accounts have been independently verified as demo-only.

MT5 requires the Gate 6 MT5 demo credentials plus Supabase service role, `TRADING_WORKSPACE_ID`, and a deliberately bounded demo lot size.
cTrader requires the Gate 6 cTrader demo credentials plus Supabase service role, `TRADING_WORKSPACE_ID`, and a deliberately bounded demo lot size.

`BROKER_EXECUTION_ENABLED` remains false in the workflow, but the platform acceptance scripts intentionally set `*_DEMO_ORDER_TEST=true`; therefore this gate is demo-only and must never use a live broker account.

## Audit notes carried into staging
- Caller payload workspace is overwritten by authenticated source workspace during ingest.
- Duplicate recovery reconstructs canonical event content from persisted DB truth and requires `recoveryReady=true` before re-orchestration.
- Production execution reloads persisted event/source/workspace/account authority before each broker action.
- Workspace entitlement, source active state, account active state and account `execution_enabled` are rechecked from Supabase.
- Kill-switch and account policy are evaluated after fresh authority and broker-risk materialization.
- Broker credentials/configuration come from encrypted persisted account state and server environment, not caller execution hints.
- Event idempotency is workspace/source scoped; destination execution idempotency is protected by a workspace-scoped unique key.
- Retry claims use compare-and-set semantics and do not reclaim live leases or ambiguous first-attempt `PENDING` rows.
- Simulation-planning internal error detail is logged server-side but HTTP responses receive only opaque diagnostics.
- Trading V1 CI now defaults `GITHUB_TOKEN` to `contents: read`.

## Repository governance
- PR #2 remains draft and unmerged into `main`.
- No approving human PR review is currently recorded.
- Repository rulesets API currently returns no configured rulesets.
- The connected GitHub App cannot read classic branch-protection configuration (`403 Resource not accessible by integration`), so protection of `main` is not yet proven by this audit.

Production promotion remains blocked until main-branch protection/review policy is confirmed and the required staging acceptance gates are genuinely executed with prepared non-live configuration.

## External/deployment safety state
- Worker: `mkety-copier-engine`.
- completion runtime has not been promoted to production by this audit.
- no real broker/provider credentials were added to repository code or tests.
- no real-money orders were placed.
- no merge to `main` occurred.

Keep rollout fuses false until their corresponding acceptance/configuration gates are deliberately satisfied:
- `TRADINGVIEW_DIRECT_INGRESS_ENABLED=false`
- `TRADINGVIEW_CERT_PROBE_ENABLED=false`
- `TRADING_ACCESS_ENABLED=false`
- `BROKER_EXECUTION_ENABLED=false`
- `TRADING_CUSTOM_HOSTNAMES_ENABLED=false`

## Next pickup
1. Configure the protected GitHub `staging` environment for Gate 4, then rerun Gate 4 read-only identity acceptance.
2. Configure the Gate 5 dedicated non-production Telegram test sources/observers and rerun the observation-only soak.
3. Configure verified MT5 and cTrader demo connectivity credentials and rerun Gate 6 probes with order tests still false.
4. Configure and run source-only Gate 6 acceptance.
5. Verify the selected MT5/cTrader accounts are genuinely demo-only before any Gate 7 lifecycle run.
6. Run Gate 7 demo lifecycle only with small bounded demo lots and no live credentials.
7. Complete the TradingView/provider/custom-host staging checks required for the intended production scope.
8. Confirm `main` branch protection or equivalent required-review/status-check policy.
9. Refresh full CI + CodeQL after any runtime change.
10. Only after all required staging evidence is green should PR #2 be considered for review/merge. Real-money execution requires separate explicit owner approval and exact financial limits.

## Do not restart these debates
- Do not redesign Trading as a complex team SaaS.
- Do not make Trading authorize directly from Zitadel claim shapes.
- Do not create a Trading-only signer.
- Do not use hostname as authorization.
- Do not use caller-supplied broker/account/workspace hints as authority.
- Do not resurrect the corrected destination-retry master-fuse false positive.
- Do not merge runtime to `main` or enable real-money execution without explicit instruction.
