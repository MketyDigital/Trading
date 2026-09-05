# Mkety Trading – Production Fast Path Handoff

**Purpose:** rolling continuation record. Read this together with repository-root `AGENTS.md` and `cloudflare-v2/docs/PRODUCTION_AUDIT_PROGRESS_2026-09-05.md`.

## Approved product model
- One enterprise customer -> one Trading workspace -> one owner -> full control.
- Trading remains an independent runtime/data plane inside the Mkety ecosystem.
- Zitadel stays behind Mkety identity; Trading consumes a short-lived signed Mkety Trading assertion and then verifies exact enabled workspace membership in Trading Supabase.
- Canonical entry is `trade.mkety.com`; customer hostnames are routing context only and never authorization.
- Never merge runtime to `main`, enable external access/execution/custom-host routing, deploy newer code, or make real broker/provider mutations without the separately required authorization.

## Detailed restart checkpoint
The detailed audit/progress chronology is now preserved in:
- `cloudflare-v2/docs/PRODUCTION_AUDIT_PROGRESS_2026-09-05.md`
- checkpoint commit: `f7b665e30675350c496c278ce48c4f76db1ffd56`

That file is the authoritative detailed restart record for this audit/hostname milestone. This fast-path handoff stays concise and action-oriented.

## Last fully verified code milestone — source onboarding GREEN
- TradingView + Custom Signed API onboarding implementation: `e36c04f37f8e0bf27c7db2362ebd91d161b6af9d`.
- Trading V1 CI run `33992264387` (#1495), mandatory test job `101376473506`: **success**.
- Documentation head `ee5c9f9d9836c5b99434ea8ebacabf5f9707f454` also passed Trading V1 CI run `33992567673` (#1497), test job `101377281313`.
- Self-service source creation is therefore verified GREEN for Telegram/MTProto, MT5, cTrader, TradingView webhook and Custom Signed API.
- Source creation remains inactive by default and grants no broker execution authority.

Broker-account onboarding was separately verified GREEN at `d852de184c0b156dc360c4d242569b756acc2225`, run `33964408888`, test job `101301829090`.

Live Trading Supabase remains verified through migration 0014.

## Repository-wide security/product audit — IMPLEMENTED, AWAITING REAL CI
Implementation head before the documentation-only checkpoint commits:
- `3872be28457f3974261bfbb625c6be6d7be91ff8`

### Confirmed defect fixed — retry setup rescheduling
- Regression commit: `82624bb14b1b6a0bf75485069cb927c8fa5d41a0`.
- Production fix: `a2b987d96639b59b648aadaab5829d7e4a5a155e`.
- Production retry setup/dependency failures now persist an explicit future `nextAttemptAt` using the existing 15-second convention.

### Confirmed high-risk stale legacy surface retired
- Regression commit: `f46091ec27f5ba54e5a44023280064e5f5849080`.
- Production fix: `d572e59f1c0e4e9c7daa292b67bd92632a33606a`.
- `POST /api/webhook/process_signal` now returns `410 LEGACY_SIGNAL_WEBHOOK_RETIRED` at the V1 boundary and cannot fall through to legacy broker-capable processing.
- Supported current MTProto paths use `SOURCE_EVENT_QUEUE` or authenticated `/api/v1/internal/source-event`.

### Corrected false positive
- The destination-retry runtime already enforced `BROKER_EXECUTION_ENABLED` before database construction/scanning/claim.
- Redundant wrapper-level patch was reverted in `fdf1346430e51c7d34901798bbeb6586d427eefe`.
- Do not treat the old retry-fuse concern as an unresolved vulnerability.

### Audited with no demonstrated bypass
- Mkety assertion + exact workspace + enabled membership authorization.
- Custom Signed API HMAC ingress.
- Internal MTProto shared-token source handoff.
- Active-source queue resolution.
- Durable event idempotency/reservation.
- Production execution authority, risk/kill controls, persisted credentials and destination/order idempotency.
- TradingView direct-ingress + certificate fingerprint gate.

### Tracked semantics gap
TradingView source activation is not currently tied to certificate-readiness state. Actual ingress remains fail-closed behind the direct-ingress and certificate checks, so this is tracked as a lifecycle/readiness semantics gap rather than an ingress bypass. Revisit only after the present unverified branch becomes genuinely CI GREEN.

## Customer custom-hostname self-service — CODE IMPLEMENTED, CI PENDING
### Implementation commits
- Design: `696ab45557a780130be04da0d3af61b26658f08f`.
- Cloudflare SaaS client: `004711f4c6c1464a19ba7110ac597c15f46d8471`.
- Admin API: `7e101e130fed83376986d2f421b7a5728f6aead0`.
- Owner/admin permissions: `fda9cfaf3c190bb2e8fa1293b5ad114c653dcd3a`.
- Router wiring: `053d70a4b98394a891b637ee489737c2968b85b4`.
- Lifecycle tests: `9d9ba11b24559ebc5aa2dcc258bb50ae59a54bab`.
- Permission regression: `3872be28457f3974261bfbb625c6be6d7be91ff8`.

### Admin routes
- `GET /api/v1/admin/hostnames`
- `POST /api/v1/admin/hostnames`
- `POST /api/v1/admin/hostnames/:id/verify`

### Safety behavior
- Only owner/admin roles can manage hostnames.
- Creation rejects wildcards, malformed DNS labels, URLs/ports/paths, IP literals, canonical Trading hosts and the configured CNAME target itself.
- Creation provisions provider-side first, then persists an exact-workspace local `pending` row; persistence failure attempts provider cleanup.
- Verification uses the persisted exact-workspace hostname and activates local routing only when Cloudflare reports hostname `active` **and** SSL `active`.
- Hostname remains routing only and does not replace Mkety assertion/workspace authorization.
- Existing migration 0013 already supports the required pending/active/verified model; no new migration was needed.

Future provider configuration, not yet performed:
- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ZONE_ID`
- `TRADING_CUSTOM_HOSTNAME_CNAME_TARGET`

No Cloudflare API request, DNS change, fallback-origin change, runtime-secret configuration, deployment, or hostname-routing enablement occurred in this repository-only continuation.

## GitHub Actions blocker — likely monthly allocation reached
Recent mandatory test jobs are not executing at all. They are marked failed with:
- `runner_id: 0`
- `steps: []`
- completion within seconds.

Representative example:
- Trading V1 CI `33993647691` (#1524)
- mandatory test job `101380170036`
- no assigned runner and no executed test step.

The repository owner reports the GitHub account appears to have reached its approximately 3,000 Actions monthly allocation. That is a plausible explanation for the runner-less pattern, but this session has not independently verified GitHub billing/usage data.

Current classification:
**CI UNAVAILABLE / INFRASTRUCTURE-BLOCKED — NOT CODE-RED AND NOT CODE-GREEN.**

Do not spend more Actions runs repeatedly while quota availability is uncertain.

## Database and paid staging state — unchanged
- Live Supabase remains verified through migration 0014.
- Paid Worker remains `mkety-copier-engine`.
- Last recorded deployed Worker version remains `68998f7f-74ce-4c37-8887-3751d3e17489`.
- Newer source-onboarding, audit-remediation and hostname-self-service code has not been deployed.

## Safety state
Keep false unless a separately authorized rollout step changes them:
- `TRADINGVIEW_DIRECT_INGRESS_ENABLED=false`
- `TRADINGVIEW_CERT_PROBE_ENABLED=false`
- `TRADING_ACCESS_ENABLED=false`
- `BROKER_EXECUTION_ENABLED=false`
- `TRADING_CUSTOM_HOSTNAMES_ENABLED=false`

No real-money execution is authorized.

## Exact next pickup
### While Actions capacity is unavailable
1. Do **not** stack additional non-critical production features on the current unverified audit/hostname head.
2. Safe continuation is static review, documentation, PR-diff inspection and preparation of exact acceptance checklists without contacting external systems.
3. Only a newly proved critical security defect justifies another narrow production-code change before CI returns; record any such change as unverified.
4. Keep all five master fuses false.
5. Do not deploy, call Cloudflare, change DNS, run real external provider acceptance, place broker orders or merge `main`.

### First action when Actions capacity returns
1. Run ordinary full Trading V1 CI on the then-current branch.
2. Confirm the mandatory test job receives a real runner and executes steps.
3. Treat only real failed assertions as RED; fix those TDD-first.
4. Rerun until genuinely GREEN.
5. Update this handoff, `AGENTS.md`, and `PRODUCTION_AUDIT_PROGRESS_2026-09-05.md` with exact final head, run/job IDs and test counts.

### After current branch becomes genuinely GREEN
The next bounded engineering decision is the TradingView activation/readiness semantics gap. If certificate readiness must precede source activation, design the smallest lifecycle change and write RED tests first. Keep it separate from custom-hostname routing and source authentication.

### Later external acceptance — separately authorized
Custom hostname acceptance should proceed with the routing fuse still false: configure provider token/zone/CNAME target, create/verify a controlled test hostname, validate exact-workspace persistence and authorization, then separately decide whether to enable custom-host routing.

## Do not restart these debates
- Do not redesign Trading as a complex team SaaS.
- Do not make Trading core depend directly on Zitadel.
- Do not create a temporary Trading-only signer.
- Do not create separate backend/workspace/identity per custom hostname.
- Do not use caller-supplied workspace/account/provider/credential/execution hints as authority.
- Do not resurrect the corrected retry-fuse false positive.
- Do not call runner-less Actions failures code failures.
- Do not merge runtime to `main` without explicit instruction.
- Do not enable real-money execution without separate explicit approval and exact limits.

## Continuation discipline
After every meaningful verified milestone, record exact branch/code head, real CI/run/job evidence, live environment changes actually performed, safety state, demonstrated defects/fixes and exact next pickup here, in `AGENTS.md`, and in the detailed audit checkpoint while this milestone remains active.
