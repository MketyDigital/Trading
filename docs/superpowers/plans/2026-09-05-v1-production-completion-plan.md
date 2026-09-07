# Mkety Trading V1 Production Completion Implementation Plan

**Goal:** Finish the Mkety Trading V1 repository so all approved production source, routing, execution, retry, destination, workspace/admin, hostname and access paths are wired and testable as enabled flows, while real external credentials/connections remain absent until separately authorized deployment/acceptance.

**Architecture:** Preserve the existing Trading V1 architecture and authority model. Development/tests may exercise production-capable paths with gates injected as enabled, but authorization, workspace isolation, risk, kill-switch, broker-authoritative validation and durable idempotency remain mandatory.

**Repository:** `MketyDigital/Trading`  
**Active completion branch:** `design/enterprise-trading-event-core-completion`  
**Preserved branch:** `design/enterprise-trading-event-core`  
**Current status:** `IMPLEMENTED / EXECUTABLE VERIFICATION PENDING`

## Global constraints
- [x] Do not merge runtime to `main` without explicit owner instruction.
- [x] Build production-capable paths so tests can exercise them with gates injected enabled.
- [x] Do not add real external broker/provider credentials or connectivity during repository-only implementation.
- [x] Preserve exact workspace authorization, persisted source/account authority, risk controls, kill switches, broker-authoritative validation and destination idempotency.
- [x] Keep deployment fuses as deployment controls rather than using simulation mode as the core processing switch.
- [x] Do not introduce a parallel architecture/framework.
- [x] Accumulate implementation/tests and use one consolidated executable verification instead of per-commit micro-testing while CI capacity is unavailable.

---

## Task 1 — TradingView source readiness
- [x] Add regression coverage for server-owned TradingView transport readiness.
- [x] Expose deterministic direct-ingress/certificate readiness.
- [x] Require persisted source readiness before activation.
- [x] Preserve actual webhook certificate/fingerprint enforcement independently of lifecycle state.

## Task 2 — source ingestion and event-pipeline parity
- [x] Trace Telegram/MTProto, MT5, cTrader, TradingView and Custom Signed API paths.
- [x] Ensure accepted non-duplicate events reach orchestration regardless of `TRADING_V1_SIMULATION`.
- [x] Preserve durable event reservation/idempotency before downstream processing.
- [x] Add recovery/parity coverage where repository evidence exposed gaps.

## Task 3 — destination/broker account lifecycle and execution wiring
- [x] Trace account onboarding through persisted credentials and broker adapter dispatch.
- [x] Add missing explicit account activation lifecycle.
- [x] Keep activation separate from execution enablement.
- [x] Clear `execution_enabled` on account deactivation to prevent stale authority revival.
- [x] Exercise production-shaped MT5/cTrader paths with enabled gates and fake broker dependencies only.

## Task 4 — retry, recovery and reconciliation
- [x] Validate retry envelope before claim.
- [x] Recover expired `PENDING` leases after worker failure without stealing live leases.
- [x] Renew crash-recovered leases without consuming another logical retry attempt.
- [x] Reconcile still-`PENDING` rows after pre-adapter coordinator failures.
- [x] Preserve broker-written durable success/retry/uncertain/failure outcomes.
- [x] Reschedule transient broker risk-context unavailability.
- [x] Keep state-binding repair separate from broker retry so succeeded broker actions are never resent for binding-only failure.

## Task 5 — workspace/admin/customer-hostname lifecycle
- [x] Keep create/list/verify exact-workspace scoped.
- [x] Allow local hostname listing without Cloudflare provider credentials.
- [x] Keep provider config mandatory for create/verify.
- [x] Always enforce canonical hostname boundary.
- [x] Fail non-canonical hosts closed when custom hostname routing is disabled.
- [x] Require active exact hostname mapping and workspace match when custom routing is enabled.
- [x] Preserve hostname as routing context only, never authorization.

## Task 6 — Mkety access-gateway consumption
- [x] Exercise the real verifier path with local fake JWKS/fetch fixtures.
- [x] Cover signature, issuer, audience, expiry, not-before, product, workspace and owner-access conditions.
- [x] Bind selected workspace into signed bearer verification before workspace database lookup.
- [x] Require exact enabled Trading workspace and membership after assertion verification.
- [x] Do not add direct-Zitadel fallback or Trading-only signing authority.

## Task 7 — stale legacy broker-capable surface retirement
- [x] Inventory externally reachable Worker routes.
- [x] Confirm supported V1/admin/internal/TradingView/health routes are intercepted by the V1 wrapper.
- [x] Retire `/api/webhook/process_signal` before legacy DB/broker-capable code.
- [x] Retire legacy `/api/admin/*` before unscoped legacy admin code.
- [x] Preserve unrelated dashboard/VIP fallthrough that is not the stale broker-capable execution path.
- [x] Preserve first-party MTProto queue/authenticated internal handoff.

## Task 8 — consolidated audit, documentation and verification handoff
- [x] Compare completion branch with preserved feature branch: final pre-doc static comparison recorded **55 commits ahead, 0 behind**.
- [x] Review changed production boundaries for authorization, workspace isolation, credential handling, risk, idempotency, retry and legacy-route behavior.
- [x] Record Mkety access, TradingView, custom-hostname and broker/provider deployment configuration boundaries.
- [x] Update `AGENTS.md`.
- [x] Update `cloudflare-v2/docs/PRODUCTION_FAST_PATH_HANDOFF.md`.
- [x] Update `cloudflare-v2/docs/PRODUCTION_AUDIT_PROGRESS_2026-09-05.md`.
- [x] Prepare the one consolidated local verification command.
- [ ] Execute the complete suite in a real executable environment and record a fresh zero-failure result.

The final checkbox intentionally remains open until actual execution evidence exists. Static review, committed tests and historical CI are not substitutes for a fresh run.

## Consolidated verification command

```bash
git checkout design/enterprise-trading-event-core-completion
git pull
cd cloudflare-v2
npm install
npm test
```

If the run is RED, fix reproduced failures as a batch and rerun the complete suite. Only a fresh zero-failure run may change the current classification from `IMPLEMENTED / EXECUTABLE VERIFICATION PENDING` to `GREEN`.

## External rollout remains separate
After GREEN and only with separate explicit authorization:
1. configure/deploy Mkety access gateway values;
2. configure controlled TradingView/custom-host provider settings;
3. deploy to staging;
4. run existing external acceptance scripts with safe test/provider accounts;
5. keep real-money execution disabled until separate explicit owner approval and exact financial limits.
