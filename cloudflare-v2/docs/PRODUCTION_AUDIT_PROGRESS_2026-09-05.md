# Mkety Trading — Production Audit, Progress and Completion Checkpoint

**Original checkpoint date:** 2026-09-05  
**Completion update:** 2026-09-06  
**Repository:** `MketyDigital/Trading`  
**Active completion branch:** `design/enterprise-trading-event-core-completion`  
**Preserved feature branch:** `design/enterprise-trading-event-core`  
**Draft PR:** #2 -> `main` (still points at preserved feature branch)  
**Current classification:** `IMPLEMENTED / EXECUTABLE VERIFICATION PENDING`

This is the detailed current restart record. Read it with repository-root `AGENTS.md` and `cloudflare-v2/docs/PRODUCTION_FAST_PATH_HANDOFF.md`.

## 1. Approved product and authority model

**one enterprise customer -> one Trading workspace -> one owner -> full workspace control.**

Trading is an independent runtime/data plane inside Mkety. `trade.mkety.com` is the canonical product entry. Optional customer hostnames are routing context only and never authorization.

Admin authorization is layered:
1. canonical/custom hostname routing boundary;
2. selected exact Trading workspace ID;
3. trusted Mkety-signed Trading bearer assertion bound to that workspace;
4. exact persisted Trading workspace entitlement;
5. exact enabled Trading membership in Trading Supabase;
6. route-specific permission.

Production execution authority is separately reloaded from persisted state before broker dispatch. Caller-supplied workspace/account/provider/destination/broker/credential/execution hints are never authoritative.

## 2. Historical verified baseline

These are the last known GREEN milestones and are retained only as historical regression evidence:

### Source onboarding
- implementation: `e36c04f37f8e0bf27c7db2362ebd91d161b6af9d`
- CI run `33992264387` (#1495)
- mandatory test job `101376473506`: success

Documentation head `ee5c9f9d9836c5b99434ea8ebacabf5f9707f454` also passed run `33992567673`, job `101377281313`.

Verified source families at that milestone:
- Telegram/MTProto
- MT5
- cTrader
- TradingView
- Custom Signed API

### Broker onboarding
- implementation: `d852de184c0b156dc360c4d242569b756acc2225`
- CI run `33964408888`
- mandatory job `101301829090`: success

### Supabase
Trading Supabase was previously verified through migration 0014 (`20260905115452 trading_0014_connection_credentials`).

The completion branch described below is newer than these GREEN milestones and therefore needs its own fresh executable verification.

## 3. Completion branch scope

At the final static branch comparison before documentation commits, `design/enterprise-trading-event-core-completion` was **55 commits ahead and 0 behind** `design/enterprise-trading-event-core`.

The completion work is concentrated in:
- source ingest/recovery;
- event orchestration;
- TradingView readiness;
- broker account lifecycle;
- MT5/cTrader enabled-path coverage;
- destination retry/recovery/reconciliation;
- admin/Mkety access/hostname authorization;
- legacy execution-route containment;
- associated regression/acceptance tests.

No external deployment/configuration was enabled to create real provider connectivity.

## 4. Task 1 — TradingView source readiness

### Defect/gap
A persisted TradingView source could previously be marked active independently of whether the server-owned direct-ingress/certificate configuration was ready. Actual ingress still failed closed, but lifecycle state could falsely imply readiness.

### Completion
- `tradingview_transport.js` exposes deterministic server-owned readiness.
- readiness distinguishes direct-ingress disabled vs certificate fingerprint configuration missing.
- source activation reloads the exact persisted source before enabling.
- credential-backed sources cannot enable without server-owned credentials.
- TradingView cannot enable without its server-generated public source handle and ready transport configuration.
- actual webhook transport still independently requires presented client certificate + exact configured fingerprint match.

Tests were added for readiness states and enable behavior with production-shaped gates injected as true.

## 5. Task 2 — source ingestion and event-pipeline parity

### Confirmed defect
`TRADING_V1_SIMULATION` was incorrectly acting as the master orchestration switch in `v1_events.js`. A valid accepted event with simulation false could be reserved/persisted but skip orchestration and production execution planning entirely.

### Completion
- accepted non-duplicate events now proceed through normalization/planning/orchestration regardless of `TRADING_V1_SIMULATION`.
- duplicate identity remains idempotent.
- broker side effects remain controlled by the production execution stage and execution authority.
- enabled-path tests inject production gates and fake dependencies rather than real broker connections.

Source-family parity was traced for:
- MTProto/Telegram queue/handoff;
- MT5 source bridge;
- cTrader source;
- TradingView direct authenticated webhook;
- Custom Signed API HMAC ingress.

Recovery/duplicate handling coverage was also added around source queue, signed V1 dispatch and durable ingest.

## 6. Task 3 — broker destination/account lifecycle and execution wiring

### Confirmed lifecycle defect
New broker accounts were created inactive, but the V1 admin lifecycle had no supported control capable of moving them to active. Production authority therefore rejected all newly onboarded accounts permanently.

### Completion
- added exact-workspace account activation control.
- activation changes only active state; it does not enable execution.
- deactivation clears `execution_enabled` so later reactivation cannot silently restore stale trading authority.
- unsupported/incomplete provider configuration still fails before broker dispatch.
- enabled production-shaped MT5/cTrader paths are covered with fake broker dependencies.
- cTrader live-shaped coverage injects its provider-specific live gate as true without using a real broker account.

The production authority chain still requires persisted workspace/source/account relationship, active account, execution enabled, kill/risk/exposure checks, server-owned credentials/configuration, broker-authoritative validation and destination idempotency.

## 7. Task 4 — retry, recovery and reconciliation

### Historical retry setup defect
The production store requires `markRetryable()` to receive `nextAttemptAt`; the setup-failure path previously omitted it. Earlier remediation established deterministic future rescheduling.

### Additional completion findings and fixes
1. **Malformed claimed work orphaning:** retry envelope validation used to occur after atomic claim; malformed work could become permanently `PENDING`. Validation now occurs before claim.
2. **Worker-crash lease orphaning:** due scans used to select only `RETRYABLE`, while claim changed work to `PENDING`; a worker death after claim could make the row invisible forever. Due scan/claim now supports expired leased `PENDING` crash recovery.
3. **Attempt accounting:** recovering an expired in-flight lease renews the lease without consuming another logical retry attempt. Ordinary retryable claims still increment attempts.
4. **Lease safety:** live `PENDING` leases are not reclaimable by competing workers.
5. **Coordinator pre-adapter failure:** if production composition/authority/context failed before an adapter persisted an outcome, the wrapper could return failure while leaving the claimed delivery `PENDING`. Post-coordinator durable reconciliation now reschedules/terminalizes only a still-`PENDING` row.
6. **Broker truth preservation:** if an adapter already persisted `SUCCEEDED`, `RETRYABLE`, `UNCERTAIN`, or terminal `FAILED`, that durable result remains authoritative.
7. **Transient risk availability:** `BROKER_RISK_CONTEXT_UNAVAILABLE` is rescheduled as transient instead of being incorrectly treated as permanent authority revocation.
8. **State-binding repair:** remains a separate repair path over already-succeeded broker deliveries and contains no broker executor dependency, preventing accidental re-send after a binding-only failure.

Corrected historical false positive remains corrected: scheduled destination retry already checks `BROKER_EXECUTION_ENABLED` before database scan/claim. Do not resurrect the old bypass concern.

## 8. Task 5 — workspace/admin/customer hostname lifecycle

### Existing self-service model
Admin routes remain:
- `GET /api/v1/admin/hostnames`
- `POST /api/v1/admin/hostnames`
- `POST /api/v1/admin/hostnames/:id/verify`

Owner/admin roles manage hostnames. Creation/verification are exact-workspace scoped. Provider credentials are server-side. Local activation occurs only when provider hostname and SSL states are both active.

### Completion fixes
- local `GET` listing no longer requires Cloudflare provider configuration because it is a local exact-workspace read.
- create/verify still require provider configuration.
- canonical hostname enforcement now always runs.
- `TRADING_CUSTOM_HOSTNAMES_ENABLED=false` means non-canonical hosts fail closed; it no longer means hostname checking is bypassed.
- when enabled, custom hostname resolution requires an exact persisted active hostname mapping.
- custom hostname workspace must match the selected/signed workspace.

The approved V1 design intentionally leaves hostname delete/rotation outside this slice; no new lifecycle was invented.

## 9. Task 6 — Mkety access-gateway consumption

Production authorization uses `mkety_access_assertion.js`; no direct-Zitadel authorization fallback or Trading-only signer was added.

Verifier checks include:
- RS256 signature key selected by `kid`;
- issuer;
- audience;
- expiration;
- optional not-before;
- subject;
- `product=trading`;
- exact `workspace_id`;
- `access=owner`.

Completion coverage adds a fake JWKS HTTP retrieval fixture and explicit `nbf` rejection.

### Authorization ordering improvement
Previously the caller-selected workspace row was read before the signed bearer assertion was verified. The selected workspace ID is now supplied to Mkety assertion verification first. Only after a valid assertion confirms the exact workspace does Trading query `trading_workspace_access`, then exact membership.

This removes the remaining caller-trust/enumeration ambiguity while preserving Supabase as application entitlement/revocation authority.

## 10. Task 7 — legacy broker-capable route retirement

The current Cloudflare entrypoint is `src/v1_entry.js`.

Route inventory and classification:
- `/api/v1/health` — intentionally public status/readiness.
- `/api/v1/internal/source-event` — authenticated internal first-party source handoff.
- `/api/v1/events` — supported external V1 event ingress behind Trading access + source authentication.
- `/api/v1/admin/*` — supported V1 admin behind Trading access + Mkety assertion/workspace/membership authorization.
- `/api/v1/webhooks/tradingview/*` — supported TradingView ingress behind Trading access + transport/source authentication.
- unknown internal/webhook V1 paths — fail closed.
- `/api/webhook/process_signal` — retired with HTTP 410 before legacy code/database/broker dispatch.
- `/api/admin/*` — retired with HTTP 410 before legacy unscoped admin code.
- legacy dashboard/VIP fallthrough — retained because it is not the stale broker-capable execution route targeted by this completion task.

The current supported MTProto implementations use source queue or authenticated internal handoff and do not require the retired public signal processor.

## 11. Regression/compatibility sweep

The stricter unconditional hostname boundary invalidated old admin unit-test fixtures that used `https://trade.test/...` only because hostname enforcement used to be optional.

Affected authorization-level fixtures were normalized to `https://trade.mkety.com/...`, and the old membership fixture was aligned with the Mkety-gateway contract rather than direct Zitadel configuration.

A dedicated test verifies invalid signed access is rejected before a caller-selected workspace record is read.

## 12. Verification status — evidence boundary

Fresh executable full-suite evidence is not available for the current completion branch in this session.

Observed infrastructure constraints:
- recent GitHub Actions mandatory jobs failed before runner assignment (`runner_id: 0`, no steps), consistent with unavailable Actions capacity;
- the development container could not clone GitHub because `github.com` DNS resolution failed.

Therefore:

**IMPLEMENTED / EXECUTABLE VERIFICATION PENDING — CI INFRASTRUCTURE UNAVAILABLE.**

This status is intentionally neither RED nor GREEN. Static inspection and committed regression tests are not substitutes for a fresh test run.

## 13. Consolidated verification command

When an executable environment is available:

```bash
git checkout design/enterprise-trading-event-core-completion
git pull
cd cloudflare-v2
npm install
npm test
```

If failures are reproduced, fix them as one batch, rerun the complete suite and record exact failure/pass counts. Only a fresh zero-failure execution may change the branch classification to GREEN.

## 14. External/deployment configuration contract

### Existing Trading database/runtime
Deployment requires the existing Supabase service configuration and Trading master-key/runtime bindings already documented by the Worker.

### Mkety access
Required before external admin access rollout:
- `MKETY_ACCESS_ISSUER`
- `MKETY_ACCESS_AUDIENCE`
- `MKETY_ACCESS_JWKS_URL`

### TradingView direct ingress
Keep server-owned direct-ingress/certificate configuration fail-closed until separately authorized staging acceptance. Production readiness requires a configured allowed certificate fingerprint and the appropriate direct-ingress gate.

### Customer custom hostnames
Required future provider configuration:
- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ZONE_ID`
- `TRADING_CUSTOM_HOSTNAME_CNAME_TARGET`

### Broker providers
Real broker/provider credentials are deployment secrets and were intentionally not added or connected during repository completion. Existing provider-specific gates/configuration remain deployment controls.

## 15. External state and safety controls

No completion-branch deployment was performed.

Last recorded paid staging Worker:
- `mkety-copier-engine`
- version `68998f7f-74ce-4c37-8887-3751d3e17489`

Keep rollout fuses false until separately authorized acceptance:
- `TRADINGVIEW_DIRECT_INGRESS_ENABLED=false`
- `TRADINGVIEW_CERT_PROBE_ENABLED=false`
- `TRADING_ACCESS_ENABLED=false`
- `BROKER_EXECUTION_ENABLED=false`
- `TRADING_CUSTOM_HOSTNAMES_ENABLED=false`

No Cloudflare custom-host API call, DNS change, real Telegram/provider acceptance, demo/live broker order, real-money execution or `main` merge was performed.

## 16. Exact next pickup

1. Run the one consolidated suite when a real executable environment is available.
2. Batch-fix only reproduced failures.
3. Rerun until zero failures and update all handoffs with exact head/test evidence.
4. Only after GREEN, perform separately authorized staging deployment/configuration and existing external acceptance scripts.
5. Real-money execution remains a separate owner decision requiring explicit approval and exact financial limits.
