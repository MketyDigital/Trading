# Mkety Trading – Production Fast Path Handoff

**Current classification:** `IMPLEMENTED / EXECUTABLE VERIFICATION PENDING`  
**Repository:** `MketyDigital/Trading`  
**Active branch:** `design/enterprise-trading-event-core-completion`  
**Preserved feature branch:** `design/enterprise-trading-event-core`  
**Draft PR:** #2 -> `main` (still points at the preserved feature branch)

## Approved product model
- One enterprise customer -> one Trading workspace -> one owner -> full control.
- Trading remains an independent runtime/data plane inside the Mkety ecosystem.
- Trading consumes a signed Mkety Trading assertion and then verifies exact enabled workspace + membership in Trading Supabase.
- Canonical entry is `trade.mkety.com`; customer hostnames are routing context only and never authorization.
- Repository tests may inject production gates and fake broker/provider dependencies as enabled. This does not create external connectivity or authorize real orders.

## Completion branch status
The approved V1 production completion plan has been implemented through Tasks 1-7 and the repository/documentation portion of Task 8.

At the final static comparison, the completion branch is **55 commits ahead and 0 behind** `design/enterprise-trading-event-core`.

### Task 1 — TradingView readiness
- Server-owned TradingView transport readiness is exposed by `tradingview_transport.js`.
- Source activation requires provider readiness; TradingView cannot be activated without source handle + direct-ingress/certificate configuration.
- Ingress still independently requires presented certificate + exact fingerprint match.

### Task 2 — source/event pipeline
- Accepted non-duplicate V1 events proceed through orchestration even when `TRADING_V1_SIMULATION=false`.
- `TRADING_V1_SIMULATION` no longer acts as the master processing switch.
- Broker side effects remain controlled by production execution authority/gates.
- Source family paths reviewed: MTProto/Telegram, MT5, cTrader, TradingView and Custom Signed API.
- Recovery coverage was added around source queue/ingest/signed-V1 duplicate behavior.

### Task 3 — broker destination lifecycle
- Added explicit account activation lifecycle.
- Activation never enables execution automatically.
- Deactivation clears `execution_enabled`, so stale execution authority cannot revive on later activation.
- Production-shaped MT5/cTrader execution is covered with enabled gates + fake broker dependencies, including live-shaped cTrader provider gating.

### Task 4 — retry/recovery/reconciliation
- Retry envelope is validated before claim.
- Expired `PENDING` leases can be safely recovered after worker failure.
- Reclaiming an expired lease renews it without consuming another logical attempt.
- Live leases cannot be stolen.
- Coordinator failures that leave a claim `PENDING` are durably reconciled/rescheduled.
- Existing broker-written `SUCCEEDED`, `RETRYABLE`, `UNCERTAIN`, or `FAILED` states remain authoritative.
- `BROKER_RISK_CONTEXT_UNAVAILABLE` is treated as transient/reschedulable.
- State-binding repair remains separate from broker retry and cannot resend a succeeded broker action.

### Task 5 — admin / hostname lifecycle
- Local hostname listing does not depend on Cloudflare provider credentials.
- Create/verify still require provider configuration.
- Canonical hostname validation now always runs.
- When custom hostname routing is disabled, a non-canonical Host fails closed.
- When enabled, only an active exact hostname mapping is accepted and its workspace must match the selected/signed workspace.
- The approved V1 design intentionally keeps hostname delete/rotation out of scope.

### Task 6 — Mkety access gateway
- Real verifier path has fake JWKS/fetch coverage.
- Valid RS256 assertion, issuer/audience, expiry, `nbf`, product, workspace and owner-access cases are represented.
- Admin authorization binds the selected workspace into bearer verification **before** querying the workspace row.
- Exact enabled Trading membership is still required after assertion + workspace entitlement validation.
- No direct-Zitadel fallback or Trading-only signer was introduced.

### Task 7 — legacy execution surface
- `/api/webhook/process_signal` is intercepted by the V1 wrapper and returns `410 LEGACY_SIGNAL_WEBHOOK_RETIRED` before legacy database/broker code.
- Every legacy `/api/admin/*` route is retired at the wrapper before the unscoped legacy admin implementation.
- Remaining legacy fallthrough is dashboard/VIP behavior, not a broker-capable trading bypass.
- Existing first-party MTProto source paths use queue or authenticated internal handoff and do not require the retired signal endpoint.

## Current verification truth
The completion branch has **not received a fresh executable full-suite pass** in this completion session.

GitHub Actions capacity has recently failed before runner assignment (`runner_id: 0`, no steps). The development container also could not clone from GitHub because DNS resolution failed. Historical GREEN runs therefore cannot be used as proof for the current branch.

Classification:

**IMPLEMENTED / EXECUTABLE VERIFICATION PENDING — CI INFRASTRUCTURE UNAVAILABLE.**

Do not call this branch GREEN until a fresh complete test run exits successfully.

## One consolidated verification
When an executable environment is available:

```bash
git checkout design/enterprise-trading-event-core-completion
git pull
cd cloudflare-v2
npm install
npm test
```

If failures occur, fix them as one batch and rerun the complete suite. Do not resume per-commit micro-testing unless isolating a reproduced failure requires it.

## Historical verified baseline
These remain useful regression baselines but do not verify the completion branch:
- source onboarding `e36c04f37f8e0bf27c7db2362ebd91d161b6af9d` — CI `33992264387`, job `101376473506`: success.
- docs head `ee5c9f9d9836c5b99434ea8ebacabf5f9707f454` — CI `33992567673`, job `101377281313`: success.
- broker onboarding `d852de184c0b156dc360c4d242569b756acc2225` — CI `33964408888`, job `101301829090`: success.
- Trading Supabase previously verified through migration 0014.

## External/deployment state — unchanged
- Worker: `mkety-copier-engine`
- last recorded deployed version: `68998f7f-74ce-4c37-8887-3751d3e17489`
- completion branch is not deployed.
- no Cloudflare custom-host API calls or DNS changes were performed.
- no real broker/provider credentials were connected.
- no real orders were placed.
- no merge to `main` occurred.

Keep rollout fuses false until separately authorized acceptance:
- `TRADINGVIEW_DIRECT_INGRESS_ENABLED=false`
- `TRADINGVIEW_CERT_PROBE_ENABLED=false`
- `TRADING_ACCESS_ENABLED=false`
- `BROKER_EXECUTION_ENABLED=false`
- `TRADING_CUSTOM_HOSTNAMES_ENABLED=false`

Required future Mkety access config:
- `MKETY_ACCESS_ISSUER`
- `MKETY_ACCESS_AUDIENCE`
- `MKETY_ACCESS_JWKS_URL`

Required future custom-host config:
- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ZONE_ID`
- `TRADING_CUSTOM_HOSTNAME_CNAME_TARGET`

Broker/provider credentials are deployment secrets and remain intentionally absent from repository development.

## Next pickup
1. Obtain a real executable environment and run the consolidated suite above.
2. Batch-fix reproduced failures only.
3. Rerun until zero failures, then record exact test count/head/run/job evidence.
4. After GREEN, separately authorize and perform staging deployment/configuration plus existing external acceptance scripts.
5. Real-money execution stays disabled until separate explicit owner approval and exact financial limits.

## Do not restart these debates
- Do not redesign Trading as a complex team SaaS.
- Do not make Trading authorize directly from Zitadel claim shapes.
- Do not create a Trading-only signer.
- Do not use hostname as authorization.
- Do not use caller-supplied broker/account/workspace hints as authority.
- Do not resurrect the corrected destination-retry master-fuse false positive.
- Do not classify runner-less CI as code failure or code success.
- Do not merge runtime to `main` or enable real-money execution without explicit instruction.
