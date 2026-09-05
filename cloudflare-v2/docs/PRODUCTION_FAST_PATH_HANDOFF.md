# Mkety Trading – Production Fast Path Handoff

**Purpose:** rolling continuation record. Read this together with repository-root `AGENTS.md`.

## Approved product model
- One enterprise customer -> one Trading workspace -> one owner -> full control.
- Trading remains an independent runtime/data plane inside the Mkety ecosystem.
- Zitadel stays behind Mkety identity; Trading consumes a short-lived signed Mkety Trading assertion and then verifies exact enabled workspace membership in Trading Supabase.
- Canonical entry is `trade.mkety.com`; customer hostnames are routing context only and never authorization.
- Never merge runtime to `main`, enable external access/execution/custom-host routing, deploy newer code, or make real broker/provider mutations without the separately required authorization.

## Last fully verified code milestone — source onboarding GREEN
- TradingView + Custom Signed API onboarding implementation: `e36c04f37f8e0bf27c7db2362ebd91d161b6af9d`.
- Trading V1 CI run `33992264387` (#1495), mandatory test job `101376473506`: **success**.
- Documentation head `ee5c9f9d9836c5b99434ea8ebacabf5f9707f454` also passed Trading V1 CI run `33992567673` (#1497), test job `101377281313`.
- Self-service source creation therefore remains verified GREEN for Telegram/MTProto, MT5, cTrader, TradingView webhook and Custom Signed API.
- Source creation remains inactive by default and grants no broker execution authority.

## Repository-wide security/product audit continuation — IMPLEMENTED, NOT YET CI VERIFIED
The audit traced externally reachable ingress, internal source handoff, source queue, signed ingress, event idempotency, hostname resolution, production execution authority, broker adapters, retry/recovery and legacy compatibility paths.

### Confirmed defect fixed — retry setup rescheduling
- Test commit: `82624bb14b1b6a0bf75485069cb927c8fa5d41a0`.
- Production fix: `a2b987d96639b59b648aadaab5829d7e4a5a155e` (`fix: reschedule retry setup failures with due timestamp`).
- `SupabaseDeliveryStore.markRetryable()` requires an explicit `nextAttemptAt`; production retry setup/dependency failures previously omitted it.
- Recovery now persists a deterministic due time using the existing 15-second adapter convention, with bounded configurable delay.

### Confirmed high-risk legacy surface retired
- Test commit: `f46091ec27f5ba54e5a44023280064e5f5849080`.
- Production fix: `d572e59f1c0e4e9c7daa292b67bd92632a33606a`.
- `/api/webhook/process_signal` previously fell through the V1 wrapper into legacy broker-capable processing without the current V1 ingress/authorization model.
- Current first-party MTProto transports do not require it: the DO path uses `SOURCE_EVENT_QUEUE`; the container path uses authenticated `/api/v1/internal/source-event`.
- The V1 entrypoint now returns `410 LEGACY_SIGNAL_WEBHOOK_RETIRED` before legacy code, database access, shadowing or broker dispatch.

### Corrected false positive
- An initial concern claimed the scheduled destination-retry wrapper bypassed `BROKER_EXECUTION_ENABLED` because it passed `brokerExecutionEnabled:true` to the coordinator.
- Full-chain tracing proved `createDestinationRetryRuntime()` already checks `BROKER_EXECUTION_ENABLED` before Supabase construction, due scanning or claim, and receives the real Worker env.
- The redundant wrapper patch was reverted in `fdf1346430e51c7d34901798bbeb6586d427eefe`.
- Do not treat this as an outstanding defect.

### Audited boundaries with no demonstrated bypass
- Mkety signed assertion + exact workspace + exact enabled membership authorization.
- Custom hostname resolver: active hostname is routing context only; it does not replace assertion/workspace authorization.
- Custom Signed API HMAC ingress: persisted active source lookup, source-owned encrypted secret, timestamp window and constant-time signature comparison.
- Internal MTProto source handoff: POST-only shared-token authentication, strict native Telegram identity validation and queue-only side effect.
- Source queue: active persisted source resolution before signed V1 event dispatch.
- Durable event reservation/idempotency before processing.
- Production execution chain: Worker access/execution fuses, persisted source/workspace/account reload, account active/execution/kill/risk checks, persisted encrypted credentials, broker-authoritative validation and destination idempotency before adapter dispatch.
- TradingView ingress: direct-ingress fuse + presented certificate/fingerprint allowlist + active persisted source.

### TradingView lifecycle semantics gap — not an ingress bypass
- Generic source enable can mark a TradingView source row active independently of certificate transport readiness.
- Actual ingress still requires the direct-ingress flag and accepted certificate fingerprint before the active source is resolved.
- Treat this as a lifecycle/readiness semantics gap to tighten separately if the product requires “certificate-ready before source active”; it is not a demonstrated ingress/execution bypass.

## Customer custom-hostname self-service — CODE IMPLEMENTED, CI PENDING
### Design and implementation
- Design: `docs/superpowers/specs/2026-09-05-custom-hostname-self-service-design.md`, commit `696ab45557a780130be04da0d3af61b26658f08f`.
- Cloudflare for SaaS client: `cloudflare-v2/src/security/cloudflare_custom_hostnames.js`, commit `004711f4c6c1464a19ba7110ac597c15f46d8471`.
- Workspace admin API: `cloudflare-v2/src/http/v1_admin_hostnames.js`, commit `7e101e130fed83376986d2f421b7a5728f6aead0`.
- Owner/admin hostname permissions: `fda9cfaf3c190bb2e8fa1293b5ad114c653dcd3a`.
- Admin router wiring: `053d70a4b98394a891b637ee489737c2968b85b4`.
- Lifecycle tests: `9d9ba11b24559ebc5aa2dcc258bb50ae59a54bab`.
- Permission regression: `3872be28457f3974261bfbb625c6be6d7be91ff8`.

### Admin surface
- `GET /api/v1/admin/hostnames`
- `POST /api/v1/admin/hostnames`
- `POST /api/v1/admin/hostnames/:id/verify`

### Safety/authority behavior
- Only owner/admin receive hostname read/write authority.
- Requested hostnames are normalized and reject wildcards, malformed DNS labels, URLs/ports/paths, IP literals, canonical Trading hosts and the configured CNAME target itself.
- Creation calls Cloudflare server-side, then persists an exact-workspace local `pending` row; local persistence failure triggers best-effort provider cleanup.
- Verification resolves the exact persisted `(workspace_id,id)` row and queries Cloudflare using that persisted hostname; caller-supplied hostname/provider identifiers are not authority.
- Local routing becomes `active` only when Cloudflare reports both hostname status `active` and SSL status `active`.
- Customer-facing output contains only safe CNAME/ownership/certificate-validation instructions, never Cloudflare credentials.
- Existing migration 0013 already provides the unique hostname, pending/active state and verification timestamp; no schema change was needed.
- Required future runtime config: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ZONE_ID`, `TRADING_CUSTOM_HOSTNAME_CNAME_TARGET`.
- No Cloudflare API request, DNS/fallback-origin change, runtime-secret configuration, deployment, or custom-hostname fuse enablement was performed in this repository-only work.

## CI infrastructure blocker
The audit/hostname branch state is **not GREEN yet** because recent mandatory jobs are failing before any GitHub runner is assigned, not because repository tests are executing and failing.

Latest recorded example before handoff update:
- Trading V1 CI run `33993647691` (#1524)
- mandatory `test` job `101380170036`
- `runner_id: 0`
- `steps: []`
- completed within seconds
- deploy/inspection/external jobs were skipped.

Several immediately preceding runs show the same runner-less pattern. Do not interpret those as test failures and do not claim this newer branch head verified until a real runner executes the complete mandatory test job.

## Database and paid staging state — unchanged by this continuation
- Live Supabase remains verified through migration 0014.
- Paid Worker remains `mkety-copier-engine`.
- Last recorded deployed Worker version remains `68998f7f-74ce-4c37-8887-3751d3e17489`.
- The newer source-onboarding, audit-remediation and hostname-self-service code has not been deployed in this continuation.

## Safety state
Keep false unless a separately authorized rollout step changes them:
- `TRADINGVIEW_DIRECT_INGRESS_ENABLED=false`
- `TRADINGVIEW_CERT_PROBE_ENABLED=false`
- `TRADING_ACCESS_ENABLED=false`
- `BROKER_EXECUTION_ENABLED=false`
- `TRADING_CUSTOM_HOSTNAMES_ENABLED=false`

No real-money execution is authorized.

## Exact next pickup
1. Get a functioning GitHub Actions runner and execute the full mandatory Trading V1 CI against the current audit/hostname branch head. A runner-less `failure` is not acceptance evidence.
2. If a real test job exposes failures, fix only reproduced defects TDD-first and rerun until GREEN.
3. Once a real full CI job is GREEN, update this handoff and `AGENTS.md` with exact final branch head, run/job IDs and suite counts.
4. Do not configure/call Cloudflare for SaaS yet. A later separately authorized acceptance step may configure the token/zone/CNAME target while keeping `TRADING_CUSTOM_HOSTNAMES_ENABLED=false`, test non-routing provisioning/verification, and only then consider enabling routing separately.
5. Keep provider connectivity acceptance separate from offline/code readiness.
6. Do not enable `TRADING_ACCESS_ENABLED` until the central Mkety Auth Gateway issuer/audience/JWKS configuration exists and signed-access acceptance passes.
7. Do not enable `BROKER_EXECUTION_ENABLED` for real-money paths without separate explicit final financial limits, kill conditions and rollback approval.
8. Merge runtime to `main` only on explicit owner instruction.
