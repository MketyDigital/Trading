# Mkety Trading – Production Fast Path Handoff

**Current classification:** `GREEN THROUGH PR #6 TASK 7 / FINAL CODEQL + EXTERNAL STAGING ACCEPTANCE BLOCKED`  
**Repository:** `MketyDigital/Trading`  
**Active PR #6 branch:** `fix/v1-frontend-sync-simulation`  
**PR #6 base:** `design/enterprise-trading-event-core`  
**Draft PR:** #6 remains draft/open  

## Scope
This handoff is Trading-repo only. MkSaaS/Mkety is relevant only as the upstream auth/access assertion producer. Trading consumes the signed Mkety Trading assertion and then uses its own Supabase workspace/membership/application authority.

No MkSaaS repository changes are included here.

## Approved product model
- One enterprise customer -> one Trading workspace -> one owner -> full control.
- Trading remains an independent runtime/data plane inside the Mkety ecosystem.
- Trading consumes a signed Mkety Trading assertion and then verifies exact enabled workspace + exact enabled membership in Trading Supabase.
- Canonical entry is `trade.mkety.com`; customer hostnames are routing context only and never authorization.
- Repository tests may inject production gates and fake broker/provider dependencies as enabled. This does not create external connectivity or authorize real orders.

## PR #6 completion status
Approved plan:
- `docs/superpowers/plans/2026-09-06-v1-frontend-sync-simulation.md`

Audit matrix:
- `cloudflare-v2/docs/V1_FRONTEND_SYNC_AUDIT.md`

Current verified SHA before this handoff update:
- `bd72dbf67fd027a5f74611e8dc64bb0b8a593fbb`

Trading V1 CI evidence for that SHA:
- Run: `34057505132`
- Job: `101551972372`
- Workflow conclusion: success
- `Run Worker and trading-core tests`: success
- `Run pure MT5 bridge tests`: success
- `Run pure MTProto Python tests`: success
- `cloudflare-inspect`: skipped
- `cloudflare-inspect-gate3-zones`: skipped

Recent PR #6 continuation commits:
- `922f09d777fa68322a2b0148220d617a3e164ad5` — focused full-stack simulation acceptance coverage.
- `b63265ccd0bfbd9a5b94a0d39eb01804bca8d095` — duplicate/idempotency and audit-readback Task 6 coverage.
- `f38189dd6a23a9e663796650e85eb88ec62cb894` — frontend/API/schema audit matrix.
- `ae46753c0f33df05b4b6def61671a54ad41f47f1` — implementation plan progress update.
- `bd72dbf67fd027a5f74611e8dc64bb0b8a593fbb` — `AGENTS.md` operational source-of-truth refresh.

## Completed PR #6 tasks
1. Frontend contract guard.
2. V1 overview, members, sources, accounts and hostnames views.
3. Operations, event audit, risk/execution and truthful read-only settings.
4. Server-owned safe simulation adapter boundary.
5. Synthetic Mkety identity acceptance seam.
6. End-to-end synthetic source-to-destination acceptance.
7. Frontend/API/schema audit matrix.

## Final verification status
Trading V1 CI is green on the latest verified PR #6 SHA listed above.

CodeQL/status note:
- The current branch workflow list includes Trading V1 CI and staging/gate workflows. No CodeQL workflow file is present on this branch.
- The previously recorded full successful CodeQL evidence remains `34035889265` on code SHA `df4d6a067bd7084baddb3982ef0d4fb0e77eb01f`.
- PR #6 added test and documentation coverage after that earlier CodeQL evidence. No production-runtime code was changed in the latest Task 6/7/AGENTS documentation sequence, but a fresh CodeQL signal for the latest branch SHA is not available from the current branch workflow list.

Do not claim CodeQL has freshly passed on `bd72dbf...` unless a new code-scanning/check-run signal appears.

## Frontend/API/schema audit result
`cloudflare-v2/docs/V1_FRONTEND_SYNC_AUDIT.md` records the current dashboard mapping:

- Protected dashboard calls use `/api/v1/admin/*` only.
- Browser requests include Mkety bearer token and `X-Mkety-Workspace-Id`.
- Workspace, members, sources, accounts, hostnames, operations and event-audit surfaces map to concrete V1 handlers.
- Generic browser DB proxy, legacy bot authorize shortcut, bank decision route, legacy signal webhook, fake settings save and browser-selected simulation are removed or blocked.
- Event audit is workspace-scoped and sanitized.
- Source/account secrets remain server-side and are not exposed in public responses.

## Current safety state
No production promotion happened in this workstream.

No real broker/provider credentials were added.

No real-money execution was enabled.

No merge to `main` occurred.

Keep rollout fuses false until the applicable external acceptance gate explicitly requires a narrower non-broker probe:
- `TRADINGVIEW_DIRECT_INGRESS_ENABLED=false`
- `TRADINGVIEW_CERT_PROBE_ENABLED=false`
- `TRADING_ACCESS_ENABLED=false`
- `BROKER_EXECUTION_ENABLED=false`
- `TRADING_CUSTOM_HOSTNAMES_ENABLED=false`

## Production execution authority
Caller-supplied workspace/account/provider/destination/broker/credential/execution hints are never authority.

Before any broker adapter may be reached, all applicable locks must pass:
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

## Staging/external acceptance blockers
The repository code is green through PR #6 Task 7, but external staging acceptance is still blocked by missing/unfinished environment configuration and live-source/demo-source preparation.

### Gate 4 identity acceptance
Still requires prepared Mkety access-gateway/ZITADEL staging inputs and a real workers.dev/staging smoke path.

Required future Trading access-gateway configuration:
- `MKETY_ACCESS_ISSUER`
- `MKETY_ACCESS_AUDIENCE`
- `MKETY_ACCESS_JWKS_URL`

The older Gate 4 workflow names also reference `ZITADEL_*` values and may need alignment to the Mkety access assertion contract before the real staging smoke is considered canonical.

### Gate 5 MTProto soak
Requires dedicated non-production Telegram/MTProto source IDs, health URLs, event URLs and bearer access values. It remains observation-only.

### Gate 6 source acceptance
Requires verified MT5/cTrader demo-source endpoints, source IDs and signing secrets. Broker execution remains disabled.

### Gate 7 demo destination lifecycle
Must not run until selected MT5/cTrader accounts are independently confirmed as demo-only. Demo lifecycle must use small bounded lots and never live broker accounts.

## Existing carried-forward staging notes
- Caller payload workspace is overwritten by authenticated source workspace during ingest.
- Duplicate recovery reconstructs canonical event content from persisted DB truth and requires `recoveryReady=true` before re-orchestration.
- Production execution reloads persisted event/source/workspace/account authority before each broker action.
- Workspace entitlement, source active state, account active state and account `execution_enabled` are rechecked from Supabase.
- Kill-switch and account policy are evaluated after fresh authority and broker-risk materialization.
- Broker credentials/configuration come from encrypted persisted account state and server environment, not caller execution hints.
- Event idempotency is workspace/source scoped; destination execution idempotency is protected by a workspace-scoped unique key.
- Retry claims use compare-and-set semantics and do not reclaim live leases or ambiguous first-attempt `PENDING` rows.
- Simulation-planning internal error detail is logged server-side but HTTP responses receive only opaque diagnostics.
- Trading V1 CI defaults `GITHUB_TOKEN` to `contents: read`.

## Repository governance
- PR #6 remains draft and unmerged.
- PR #6 targets `design/enterprise-trading-event-core`, not `main`.
- PR #2 to `main` remains the larger staging feature branch boundary.
- No approving human PR review is recorded here.
- Repository rulesets previously returned no configured rulesets, and classic branch-protection visibility was not available to the connected GitHub App.

Production promotion remains blocked until main-branch protection/review policy is confirmed and the required staging acceptance gates are executed with prepared non-live configuration.

## Exact next pickup
1. Wait for CI on this handoff-update SHA and record the resulting run.
2. If available, verify a fresh CodeQL/code-scanning check on the latest branch SHA; otherwise carry forward the explicit CodeQL limitation above.
3. Decide whether PR #6 can leave draft and merge into `design/enterprise-trading-event-core` for staging acceptance.
4. Do not merge `main`.
5. Do not enable live broker execution.
6. Prepare Gate 4 Mkety access assertion staging configuration and align any stale `ZITADEL_*` naming in gate docs/workflows before real auth smoke.
7. Prepare Gate 5/6/7 non-live/demo source and destination credentials.
8. Run external staging gates with exact evidence and keep `BROKER_EXECUTION_ENABLED=false` unless a later owner-approved live-execution plan explicitly changes it.

## Do not restart these debates
- Do not redesign Trading as a complex team SaaS.
- Do not make Trading authorize directly from Zitadel claim shapes.
- Do not create a Trading-only signer.
- Do not use hostname as authorization.
- Do not use caller-supplied broker/account/workspace hints as authority.
- Do not resurrect the corrected destination-retry master-fuse false positive.
- Do not merge runtime to `main` or enable real-money execution without explicit instruction.