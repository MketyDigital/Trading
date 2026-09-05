# Mkety Trading — Production Audit, Progress and Continuation Checkpoint

**Checkpoint date:** 2026-09-05  
**Repository:** `MketyDigital/Trading`  
**Branch:** `design/enterprise-trading-event-core`  
**Draft PR:** #2 -> `main`  
**Implementation head before documentation-only checkpoint commits:** `3872be28457f3974261bfbb625c6be6d7be91ff8`  
**Last fully CI-verified implementation milestone:** `e36c04f37f8e0bf27c7db2362ebd91d161b6af9d`

This file is the detailed restart checkpoint for the repository-wide audit and the customer custom-hostname continuation. Read it together with repository-root `AGENTS.md` and `cloudflare-v2/docs/PRODUCTION_FAST_PATH_HANDOFF.md`.

## 1. Controlling product and safety model

The approved V1 model remains:

**one enterprise customer -> one Trading workspace -> one owner -> full workspace control.**

Trading is an independent runtime/data plane inside the Mkety ecosystem. `trade.mkety.com` is the canonical entry. Optional customer hostnames are routing context only and never authorization.

Trading authorization remains layered:
1. trusted Mkety-signed Trading assertion;
2. exact Trading workspace selection;
3. exact enabled Trading membership in Trading Supabase;
4. route-specific role permission;
5. persisted source/account/workspace authority at execution time.

Do not create a Trading-only identity fallback, separate backend per hostname, or caller-controlled execution authority.

The five Worker-wide safety fuses remain intentionally false unless a later, separately authorized rollout changes them:
- `TRADINGVIEW_DIRECT_INGRESS_ENABLED=false`
- `TRADINGVIEW_CERT_PROBE_ENABLED=false`
- `TRADING_ACCESS_ENABLED=false`
- `BROKER_EXECUTION_ENABLED=false`
- `TRADING_CUSTOM_HOSTNAMES_ENABLED=false`

No real-money execution is authorized. No merge to `main` is authorized.

## 2. Previously verified GREEN baseline

### Source onboarding
TradingView + Custom Signed API onboarding implementation:
- `e36c04f37f8e0bf27c7db2362ebd91d161b6af9d`
- Trading V1 CI run `33992264387` (#1495)
- mandatory test job `101376473506`: **success**

Documentation head `ee5c9f9d9836c5b99434ea8ebacabf5f9707f454` also passed Trading V1 CI run `33992567673` (#1497), job `101377281313`.

Verified self-service source families:
- Telegram/MTProto
- MT5
- cTrader
- TradingView webhook
- Custom Signed API

All new sources remain inactive by default. Source onboarding itself grants no broker execution authority.

### Broker onboarding
Broker-account onboarding code head:
- `d852de184c0b156dc360c4d242569b756acc2225`
- Trading V1 CI run `33964408888`
- mandatory test job `101301829090`: **success**

Broker credentials remain encrypted in `trade_accounts.credential_ciphertext`. New accounts are safe/inactive with execution disabled.

### Supabase
Live Mkety Digital Supabase is verified through Trading migration 0014.

Migration ledger entry:
- `20260905115452 trading_0014_connection_credentials`

Trading tables keep the previously reviewed service-role-only/RLS posture. Existing unrelated project-wide Supabase warnings are not treated as Trading regressions.

### Paid staging
Paid Worker:
- `mkety-copier-engine`
- last recorded deployed Worker version: `68998f7f-74ce-4c37-8887-3751d3e17489`

The newer source-onboarding/audit/hostname work described below has **not** been deployed.

## 3. Repository-wide audit performed after the GREEN source-onboarding milestone

The audit traced the following boundaries end-to-end rather than inspecting isolated helpers:
- externally reachable HTTP ingress;
- Mkety assertion/workspace authorization;
- admin source/account routes;
- Custom Signed API HMAC ingress;
- TradingView mTLS/fingerprint ingress;
- internal MTProto source handoff;
- source-event queue;
- persistent event reservation/idempotency;
- production execution coordinator;
- persisted workspace/source/account revalidation;
- risk/kill/exposure gates;
- encrypted broker credential resolution;
- broker adapter dispatch;
- destination/order idempotency;
- scheduled destination retry/recovery;
- legacy compatibility routes;
- custom hostname resolution and workspace matching.

## 4. Confirmed audit finding #1 — retry setup-failure rescheduling defect

### Problem
The production delivery store requires `markRetryable()` to receive a valid `nextAttemptAt`. The production retry wrapper's setup/dependency failure path attempted to call `markRetryable()` without that required due timestamp.

This could cause the recovery operation itself to fail when trying to return a claimed retry to a future retryable state.

### TDD evidence and remediation
Regression-test commit:
- `82624bb14b1b6a0bf75485069cb927c8fa5d41a0`
- message: `test: require due timestamp when rescheduling retry setup failures`

Production fix:
- `a2b987d96639b59b648aadaab5829d7e4a5a155e`
- message: `fix: reschedule retry setup failures with due timestamp`

The fix uses the existing 15-second retry convention and derives the due time from the deterministic scheduler `now` value rather than inventing a new retry policy.

## 5. Corrected audit false positive — destination retry master fuse

An initial audit pass suspected that scheduled production retries bypassed `BROKER_EXECUTION_ENABLED` because a wrapper eventually passed `brokerExecutionEnabled: true` into the production coordinator.

Full call-chain tracing proved that concern was incorrect:
- `createDestinationRetryRuntime()` receives the real Worker `env`;
- it checks `BROKER_EXECUTION_ENABLED` before constructing Supabase;
- when the fuse is false it performs no due scan, claim or dispatch.

A redundant wrapper-level patch was therefore removed:
- `fdf1346430e51c7d34901798bbeb6586d427eefe`
- message: `revert: remove redundant retry master-fuse wrapper`

**Do not resurrect the old bypass claim. It was explicitly corrected after full-chain review.**

## 6. Confirmed audit finding #2 — stale unauthenticated legacy broker-capable webhook

### Problem
`POST /api/webhook/process_signal` still fell through the V1 entry wrapper into the legacy Worker. The legacy processing path could load active accounts and reach Deriv/cTrader/MT5 execution behavior without the newer V1 ingress/authorization contract.

### Caller trace
The current first-party MTProto implementations no longer require this public legacy webhook:
- Durable Object MTProto ingestion emits to `SOURCE_EVENT_QUEUE`;
- container MTProto handoff uses the authenticated `POST /api/v1/internal/source-event` path.

The old public route was therefore a stale compatibility execution surface rather than a required first-party transport.

### TDD evidence and remediation
Regression-test commit:
- `f46091ec27f5ba54e5a44023280064e5f5849080`
- message: `test: retire unauthenticated legacy signal execution webhook`

Production fix:
- `d572e59f1c0e4e9c7daa292b67bd92632a33606a`
- message: `fix: retire legacy unauthenticated signal execution ingress`

The V1 entrypoint now returns `410 LEGACY_SIGNAL_WEBHOOK_RETIRED` before legacy code, shadow processing, database access or broker dispatch.

## 7. Audited boundaries with no demonstrated bypass

The audit did not find a demonstrated bypass in the following current V1 paths:

### Mkety access + workspace membership
Authorized admin routes require:
- explicit workspace selector;
- persisted workspace existence and Trading entitlement;
- production Mkety assertion verifier configuration when using the real verifier;
- valid bearer assertion;
- exact enabled workspace membership;
- route-specific role permissions.

### Custom Signed API ingress
The signed ingress:
- resolves the source from server-owned persisted state;
- requires an active source;
- decrypts that source's own ingress secret;
- enforces a bounded timestamp window;
- compares HMAC signatures in constant-time style;
- derives workspace authority from persisted source state, not request payload hints.

### Internal MTProto handoff
`POST /api/v1/internal/source-event`:
- is POST-only;
- requires the configured internal source transport token;
- compares token digests rather than raw early-return string equality;
- validates native Telegram `chat_id` + `message_id` identity against `external_event_id`;
- only enqueues to the source-event queue;
- does not directly execute broker actions.

### Source-event queue
Queue processing resolves an active persisted source before constructing the signed V1 event dispatch.

### Event idempotency
Persistent event reservation occurs before downstream processing. Duplicate event identity is not allowed to become a second independent execution lifecycle.

### Production execution authority
Before broker-capable dispatch, applicable production paths re-check persisted authority including:
- Worker-wide access/execution fuses;
- exact persisted source/workspace/account relationship;
- account active/execution state;
- kill/safety/risk/exposure policy;
- server-owned broker destination configuration;
- persisted encrypted broker credentials;
- broker/symbol/economic/volume validation;
- persistent destination/order idempotency.

### TradingView ingress
Actual TradingView ingress remains fail-closed behind:
- `TRADING_ACCESS_ENABLED` at the external V1 entry layer;
- `TRADINGVIEW_DIRECT_INGRESS_ENABLED`;
- configured certificate fingerprint allowlist;
- a presented client certificate;
- exact fingerprint match;
- active persisted TradingView source handle resolution.

## 8. TradingView lifecycle semantics gap — tracked, not classified as ingress bypass

The generic source lifecycle API can mark a TradingView source row active independently of certificate transport readiness.

Actual TradingView ingress still fails closed unless the direct-ingress and certificate requirements pass. Therefore the current issue is a product/readiness semantics mismatch rather than a demonstrated ingress or broker-execution bypass.

Potential later tightening, only after the present branch is CI-verified:
- make TradingView source activation require a persisted certificate-readiness state; or
- distinguish configuration-enabled from ingress-ready state instead of overloading `is_active`.

Do not mix this lifecycle refinement with the source-authentication or custom-hostname systems.

## 9. Customer custom-hostname self-service — implementation completed, verification pending

### Design
Design checkpoint:
- `696ab45557a780130be04da0d3af61b26658f08f`
- `docs/superpowers/specs/2026-09-05-custom-hostname-self-service-design.md`

The design preserves the rule that a hostname is routing context only. It does not grant workspace authorization.

### Cloudflare for SaaS client
Implementation:
- `004711f4c6c1464a19ba7110ac597c15f46d8471`
- `cloudflare-v2/src/security/cloudflare_custom_hostnames.js`

Provider credentials remain server-side. Customer-facing responses may expose only DNS/ownership/certificate validation instructions required to complete provisioning.

### Workspace admin API
Implementation:
- `7e101e130fed83376986d2f421b7a5728f6aead0`
- `cloudflare-v2/src/http/v1_admin_hostnames.js`

Routes:
- `GET /api/v1/admin/hostnames`
- `POST /api/v1/admin/hostnames`
- `POST /api/v1/admin/hostnames/:id/verify`

### Authorization
Hostname permissions are intentionally limited to owner/admin roles:
- implementation: `fda9cfaf3c190bb2e8fa1293b5ad114c653dcd3a`
- regression: `3872be28457f3974261bfbb625c6be6d7be91ff8`

Operators/viewers do not receive hostname write authority.

### Admin router wiring
- `053d70a4b98394a891b637ee489737c2968b85b4`

### Lifecycle regression coverage
- `9d9ba11b24559ebc5aa2dcc258bb50ae59a54bab`

### Hostname safety behavior
Creation:
- normalizes customer hostname;
- rejects wildcard values;
- rejects malformed DNS labels;
- rejects URLs, ports and paths;
- rejects IP literals;
- rejects canonical Trading hosts;
- rejects the configured SaaS CNAME target as a customer hostname;
- provisions Cloudflare server-side;
- then persists exact-workspace local state as `pending`;
- if local persistence fails after provider creation, attempts best-effort provider cleanup.

Verification:
- resolves the exact persisted `(workspace_id, id)` local hostname;
- does not use caller-supplied provider identifiers as authority;
- queries Cloudflare using the persisted hostname;
- only changes local routing state to `active` when **both** Cloudflare hostname status and SSL status are `active`.

Schema:
- no new migration required;
- migration 0013 already supplies globally unique hostname, `pending|active|disabled`, and `verified_at` constraints.

Future runtime configuration required for real provider acceptance:
- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ZONE_ID`
- `TRADING_CUSTOM_HOSTNAME_CNAME_TARGET`

None of those bindings were configured by this repository-only continuation. No Cloudflare API call, DNS change, fallback-origin change, deployment, or routing enablement was performed.

## 10. GitHub Actions verification blocker

The audit and hostname implementation are **not yet verified GREEN**.

Recent Trading V1 CI runs are being marked failed before a runner is assigned:
- `runner_id: 0`
- `steps: []`
- completion within only a few seconds
- deploy/external jobs skipped.

Representative run:
- Trading V1 CI `33993647691` (#1524)
- mandatory test job `101380170036`
- no runner and no executed test step.

The same pattern occurred on several immediately preceding attempts.

### Likely explanation
The repository owner reports that the GitHub account appears to have reached its approximately 3,000 Actions monthly allocation. That explanation is plausible and consistent with jobs failing before runner assignment, but it has **not been independently verified through a GitHub billing/usage endpoint in this session**.

Treat the current state as:

**CI UNAVAILABLE / INFRASTRUCTURE-BLOCKED — NOT CODE-RED AND NOT CODE-GREEN.**

Do not spend additional Actions runs repeatedly while quota availability is uncertain.

## 11. Current code-verification classification

### Fully verified GREEN
- source onboarding through `e36c04f37f8e0bf27c7db2362ebd91d161b6af9d`;
- broker onboarding at its recorded GREEN head;
- Supabase through migration 0014;
- previously deployed paid staging version and health checkpoint.

### Implemented but awaiting a real full CI run
- retry setup rescheduling fix;
- legacy signal webhook retirement;
- custom hostname SaaS client;
- custom hostname admin routes;
- owner/admin hostname permissions;
- hostname lifecycle tests and permission regression.

Do not describe these newer changes as GREEN until a runner executes the mandatory suite successfully.

## 12. Progress summary

Completed:
1. verified all approved source-family self-service onboarding;
2. verified broker credential/account onboarding;
3. applied and verified Trading DB migrations through 0014;
4. verified paid-staging health on the previously deployed build;
5. performed a broad security/product audit;
6. corrected one false-positive audit conclusion;
7. fixed the retry setup-failure rescheduling defect;
8. retired the stale public unauthenticated legacy signal execution webhook;
9. designed and implemented customer custom-hostname self-service provisioning/verification code;
10. added authorization and lifecycle regression coverage;
11. preserved all production safety fuses and deployment boundaries.

Not yet completed:
1. full mandatory CI verification of the post-source-onboarding audit/hostname changes;
2. deployment of the newer code;
3. Cloudflare for SaaS provider acceptance;
4. customer DNS/SSL provisioning acceptance;
5. actual external Telegram/MT5/cTrader/TradingView acceptance where still pending;
6. central Mkety Auth Gateway positive/negative acceptance;
7. TradingView activation/readiness semantics refinement if still desired after current code is GREEN;
8. any live/real-money execution rollout;
9. merge to `main`.

## 13. Exact continuation procedure

### Immediate next step — while GitHub Actions quota is unavailable
Do **not** stack additional production feature changes on top of the unverified hostname/audit implementation unless a newly discovered critical security defect requires an emergency repository fix.

Safe work while CI is unavailable:
1. static review only;
2. documentation/handoff maintenance;
3. inspect the current PR diff for obvious contract mistakes;
4. prepare exact acceptance commands/checklists without invoking external providers;
5. keep all five master fuses false;
6. avoid deployments and provider/DNS mutations.

### First step when Actions capacity returns
1. run the ordinary full mandatory Trading V1 CI against the then-current branch;
2. confirm the test job has a real non-zero runner and executed steps;
3. if tests fail, treat only those real assertions as RED and fix TDD-first;
4. rerun until the mandatory test job is genuinely GREEN;
5. update `AGENTS.md`, this checkpoint and `PRODUCTION_FAST_PATH_HANDOFF.md` with exact final code head, workflow run, job ID and suite/test counts.

### After current code is genuinely GREEN
The next bounded engineering decision is the TradingView lifecycle semantics gap:
- decide whether a TradingView source must be certificate-ready before its row can be `active`;
- if yes, design the smallest persistence/lifecycle change and add RED tests first;
- keep this separate from custom-hostname routing and source authentication.

### After separately authorized external mutation
Custom hostname acceptance should happen in phases:
1. configure Cloudflare token/zone/CNAME target while `TRADING_CUSTOM_HOSTNAMES_ENABLED=false`;
2. perform non-routing creation + ownership/SSL verification acceptance on a controlled test hostname;
3. verify exact-workspace persistence and provider cleanup behavior;
4. verify hostname remains routing-only and Mkety assertion/membership still authorizes the workspace;
5. only then consider enabling `TRADING_CUSTOM_HOSTNAMES_ENABLED` as a separate rollout decision.

Deployment of the newer build is also a separate external mutation and requires explicit authorization.

## 14. Non-negotiable restart rules

When resuming from this checkpoint:
- do not repeat the corrected retry-fuse false positive;
- do not claim runner-less Actions failures prove code RED;
- do not claim the new branch GREEN without a real executed mandatory test job;
- do not call Cloudflare, change DNS, deploy, enable access/routing/execution fuses, connect live brokers, place orders, or merge `main` from a generic `continue` instruction;
- do not use hostname as authorization;
- do not introduce a temporary Trading-specific identity signer;
- do not enable real-money execution without separate explicit final owner approval with exact limits, kill conditions and rollback.
