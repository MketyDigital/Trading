# Mkety Trading – Production Fast Path Handoff

**Current classification:** `GREEN / STAGING ACCEPTANCE PENDING`  
**Repository:** `MketyDigital/Trading`  
**Active branch:** `design/enterprise-trading-event-core-completion`  
**Preserved feature branch:** `design/enterprise-trading-event-core`  
**Draft PR:** #3 -> `design/enterprise-trading-event-core`  

## Approved product model
- One enterprise customer -> one Trading workspace -> one owner -> full control.
- Trading remains an independent runtime/data plane inside the Mkety ecosystem.
- Trading consumes a signed Mkety Trading assertion and then verifies exact enabled workspace + membership in Trading Supabase.
- Canonical entry is `trade.mkety.com`; customer hostnames are routing context only and never authorization.
- Repository tests may inject production gates and fake broker/provider dependencies as enabled. This does not create external connectivity or authorize real orders.

## Completion branch status
The approved V1 production completion plan has been implemented through Tasks 1-7 and the repository/documentation portion of Task 8.

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

## Fresh executable verification
The completion branch received a fresh executable full-suite pass on the exact code SHA below:

- code SHA: `20f46dce609cfb0d368557035c2fe33b019a5865`
- Trading V1 CI run: `34031424441` (#1585)
- mandatory test job: `101481528392` — **success**
- Worker/trading-core Node tests — **success**
- pure MT5 bridge tests — **success**
- pure MTProto Python tests — **success**

The immediately preceding RED was traced to a stale `v1_admin_sources.test.mjs` call-sequence assertion after source activation gained a required persisted-source readiness lookup. The safety lookup was preserved. The test now explicitly asserts `getSource` occurs before the enable mutation.

Classification:

**GREEN / STAGING ACCEPTANCE PENDING.**

This verifies repository behavior at the code SHA above. Documentation commits after that SHA do not alter runtime code.

## Audit notes carried into staging
- Caller payload workspace is overwritten by authenticated source workspace during ingest.
- Duplicate recovery reconstructs canonical event content from persisted DB truth and requires `recoveryReady=true` before re-orchestration.
- Production execution reloads persisted event/source/workspace/account authority before each broker action.
- Workspace entitlement, source active state, account active state and account `execution_enabled` are rechecked from Supabase.
- Kill-switch and account policy are evaluated after fresh authority and broker-risk materialization.
- Broker credentials/configuration come from encrypted persisted account state and server environment, not caller execution hints.
- Event idempotency is workspace/source scoped; destination execution idempotency is protected by a workspace-scoped unique key.
- Retry claims use compare-and-set semantics and do not reclaim live leases or ambiguous first-attempt `PENDING` rows.

## External/deployment state before staging acceptance
- Worker: `mkety-copier-engine`
- last recorded deployed version before this rollout sequence: `68998f7f-74ce-4c37-8887-3751d3e17489`
- completion runtime has not yet been promoted to production.
- no customer DNS/custom-host mutation was performed during repository completion.
- no real broker/provider credentials were connected.
- no real orders were placed.
- no merge to `main` occurred.

Keep rollout fuses false through fail-closed staging acceptance:
- `TRADINGVIEW_DIRECT_INGRESS_ENABLED=false`
- `TRADINGVIEW_CERT_PROBE_ENABLED=false`
- `TRADING_ACCESS_ENABLED=false`
- `BROKER_EXECUTION_ENABLED=false`
- `TRADING_CUSTOM_HOSTNAMES_ENABLED=false`

Required Mkety access config before external admin rollout:
- `MKETY_ACCESS_ISSUER`
- `MKETY_ACCESS_AUDIENCE`
- `MKETY_ACCESS_JWKS_URL`

Required custom-host config before customer-host rollout:
- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ZONE_ID`
- `TRADING_CUSTOM_HOSTNAME_CNAME_TARGET`

Broker/provider credentials are deployment secrets and remain intentionally absent from repository development.

## Next pickup
1. Advance only the reviewed staging feature branch as needed; do not merge `main`.
2. Run the existing Paid staging deploy/acceptance gates with the fail-closed Worker vars and ephemeral/non-real acceptance secrets.
3. Verify rollback and no unintended Container/broker side effects.
4. Run remaining non-real external acceptance gates required for Mkety access/TradingView/provider readiness.
5. Record exact staging evidence here.
6. Production promotion remains blocked until all required acceptance/configuration checks pass. Real-money execution requires separate explicit owner approval and exact financial limits.

## Do not restart these debates
- Do not redesign Trading as a complex team SaaS.
- Do not make Trading authorize directly from Zitadel claim shapes.
- Do not create a Trading-only signer.
- Do not use hostname as authorization.
- Do not use caller-supplied broker/account/workspace hints as authority.
- Do not resurrect the corrected destination-retry master-fuse false positive.
- Do not merge runtime to `main` or enable real-money execution without explicit instruction.