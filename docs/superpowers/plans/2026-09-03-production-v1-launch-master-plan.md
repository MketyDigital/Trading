# Production V1 Launch Master Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move Mkety Trading from its current CI-verified multi-source trading foundation to a controlled production launch without weakening tenant isolation, authentication, broker safety, idempotency, or the Cloudflare Free-compatible security baseline.

**Architecture:** Preserve the existing canonical Trading Event pipeline and prove it progressively in real environments: infrastructure first, then source identity, user identity, source runtimes, broker demo execution, end-to-end staging, operations, shadow production, and finally tiny controlled live execution. Every gate is fail-closed; later gates cannot compensate for an earlier failed acceptance gate.

**Tech Stack:** Cloudflare Workers, Workers Queues, Durable Objects, optional Workers Paid Containers + Telethon, mtcute, external MTProto adapter, Supabase/PostgreSQL, Zitadel, Node.js 22, Python 3.12, MT5 bridge/runtime, cTrader Open API, TradingView HTTPS webhooks, GitHub Actions.

**Spec:** `AGENTS.md`, `cloudflare-v2/docs/NON_LIVE_MULTI_SOURCE_ACCEPTANCE.md`, `cloudflare-v2/docs/STAGING_V1_RUNBOOK.md`, and the active source/security specs listed in `AGENTS.md`.

## Global Constraints

- Active branch remains `design/enterprise-trading-event-core`; draft PR #2 targets `main`.
- Never merge `main` without explicit user instruction.
- Real-money execution remains disabled until Gate 10 and a separate explicit live cutover decision.
- TDD is mandatory for production feature/bugfix code: exact RED before production modification, then full GREEN at the exact implementation head.
- After every meaningful implementation/testing/environment batch, update `AGENTS.md` with current head, completed gate/sub-gate, evidence, blockers, and exact next safe action.
- Never paste/log/commit broker, database, auth, source, Telegram-session, provider, transport, signing, destination, or AI secrets.
- Tenant isolation remains mandatory across workspace, user, source, provider runtime, Telegram session/chat, event, account, destination, AI, retry, queue, idempotency, Position Group, health, control state, and credentials.
- Cloudflare security/core functionality uses Free-plan-compatible primitives as the baseline. Workers Paid may add optional capacity/performance; no security boundary may require Enterprise-only BYOCA, Enterprise mTLS trust, or another Enterprise-only feature.
- `cloudflare-v2/wrangler.toml` is the Paid profile with optional Containers. `cloudflare-v2/wrangler.free.toml` is the isolated no-Container Free baseline.
- Container availability never implies provider selection; only an active exact `cloudflare_container_mtproto` source may touch `MTPROTO_CONTAINER_NAMESPACE`.
- TradingView direct ingress stays disabled until real certificate-presentation/fingerprint acceptance succeeds.
- `trading_access_enabled=false` stays in force until real Zitadel acceptance succeeds.
- Broker execution stays disabled through all source, identity, infrastructure, and staging acceptance work unless a task explicitly enters broker **demo** execution.
- Connected broker metadata is authoritative for symbols, precision, tick economics, volume, order semantics, and account mode.
- Persistent source/event/destination/order idempotency must remain enabled through every soak/retry/replay test.

---

## Gate 1 — Freeze Production V1 Scope and Launch Contract

**Purpose:** Stop open-ended architecture expansion and establish one launch definition that every later gate must satisfy.

**Files:**
- Create/maintain: `docs/superpowers/plans/2026-09-03-production-v1-launch-master-plan.md`
- Modify after each batch: `AGENTS.md`
- Reference: `cloudflare-v2/docs/NON_LIVE_MULTI_SOURCE_ACCEPTANCE.md`
- Reference: `cloudflare-v2/docs/STAGING_V1_RUNBOOK.md`

**V1 source scope:**
- Telegram: `cloudflare_container_mtproto`, `cloudflare_do_mtproto`, `external_mtproto`
- TradingView: `tradingview_webhook`
- MT5: `mt5_source_bridge`
- cTrader: `ctrader_source`
- Custom: `custom_signed_api`

**V1 destination scope:**
- MT5 destination/execution foundation
- cTrader destination/execution foundation
- Non-broker/simulation destinations used for staging and fan-out acceptance
- Deriv or additional destinations may ship only if already acceptance-ready; they must not delay the initial launch.

**V1 core engine scope:**
- authenticated/versioned Trading Event ingest
- persistent canonical event idempotency
- deterministic normalization/parser
- bounded AI ambiguity resolution behind deterministic validation
- correlation + durable Trade State
- fast-entry policies and reconciliation
- Position Groups with arbitrary TP legs
- account safety/risk/kill switches
- broker/platform translation from live metadata
- persistent destination/order idempotency
- isolated destination fan-out/retry

- [ ] **Step 1: Record scope freeze in `AGENTS.md`.**

Add a `Production V1 launch program` section that links this plan, names Gate 1 as the current gate, records the exact branch head, and states that unrelated feature expansion is blocked unless it is necessary to satisfy a production acceptance gate.

- [ ] **Step 2: Verify the plan/doc-only head with the mandatory CI workflow.**

Expected workflow gates:

```text
Run Worker and trading-core tests              SUCCESS
Run pure MT5 bridge tests                      SUCCESS
Run pure MTProto Python tests                  SUCCESS
Wrangler dry run (Paid + Free configs)         SUCCESS
```

- [ ] **Step 3: Mark Gate 1 complete only after exact-head CI success is recorded in `AGENTS.md`.**

**Gate 1 exit criteria:** one immutable V1 scope, launch plan committed, `AGENTS.md` synchronized, exact-head CI GREEN, no broker execution/live state changed.

---

## Gate 2 — Real Cloudflare Staging Infrastructure Acceptance

**Purpose:** Prove the already-GREEN Wrangler architecture on a real Cloudflare account without enabling TradingView ingress or broker execution.

**Files:**
- Reference: `cloudflare-v2/wrangler.toml`
- Reference: `cloudflare-v2/wrangler.free.toml`
- Modify if a real incompatibility is found: Wrangler config/tests only through TDD or config-specific failing dry-run evidence
- Modify after environment batch: `AGENTS.md`
- Update operational evidence: `cloudflare-v2/docs/STAGING_V1_RUNBOOK.md`

- [ ] **Step 1: Inspect account-side resource names/status before deployment.**

Record names/status only; do not expose secret values. Verify intended Worker, Queue, DLQ, Durable Object classes/namespaces, cron triggers, custom hostname/routes, and optional Container resources.

- [ ] **Step 2: Deploy the exact reviewed staging head with direct TradingView ingress disabled and broker execution disabled.**

Paid profile command from `cloudflare-v2/` when using Workers Paid:

```bash
npx wrangler deploy --config wrangler.toml
```

Free-baseline validation/deployment command when exercising no-Container profile:

```bash
npx wrangler deploy --config wrangler.free.toml
```

Do not deploy both profiles onto the same queue names; the configs intentionally use isolated queue/DLQ names.

- [ ] **Step 3: Verify environment bindings by capability, not secret value.**

Confirm the deployed Worker can see the required binding names, Queue producer/consumer, expected DO namespaces, and scheduled trigger set. The Paid profile may expose `MTPROTO_CONTAINER_NAMESPACE`; the Free profile must not.

- [ ] **Step 4: Prove Container non-selection.**

With only DO/external MTProto sources configured, exercise ordinary Worker/cron/queue traffic and confirm no Container source is started. Then, in a controlled non-live environment, explicitly configure one active `cloudflare_container_mtproto` source and verify only that source reaches Container bootstrap.

- [ ] **Step 5: Exercise one non-broker simulation event through the deployed source-event path.**

Expected outcome: authenticated event accepted once, persisted canonical identity reserved once, queue/consumer processing succeeds, simulation/non-broker destination receives exactly one action, and no broker executor is called.

- [ ] **Step 6: Test rollback.**

Record the exact prior known-good Worker version/deployment and prove the staging Worker can be rolled back without changing database schema or enabling execution.

**Gate 2 stop conditions:** missing required binding, unexpected shared queue consumption, Container startup for non-Container provider, Enterprise-only dependency, secret leakage, or any broker execution path reached.

**Gate 2 exit criteria:** real staging Worker and bindings accepted; Paid optional Container semantics proven; Free-baseline remains valid; one source-event simulation passes; rollback proven; `AGENTS.md` updated with evidence.

---

## Gate 3 — TradingView Real Certificate and Source Acceptance

**Purpose:** Prove direct TradingView HTTPS ingress on the actual non-Enterprise Cloudflare deployment without reusable webhook credentials and without broker execution.

**Files:**
- Reference: `cloudflare-v2/src/security/tradingview_transport.js`
- Reference: TradingView webhook handler in `cloudflare-v2/src/v1_entry.js`
- Reference: `cloudflare-v2/tests/tradingview_transport.test.mjs`
- Reference/update: `cloudflare-v2/docs/NON_LIVE_MULTI_SOURCE_ACCEPTANCE.md`
- Modify after environment batch: `AGENTS.md`

- [ ] **Step 1: Configure a dedicated TradingView hostname for client-certificate collection/pass-through.**

Do not use BYOCA. Do not add a WAF condition requiring `cf.tls_client_auth.cert_verified`. The request must reach the Worker so `request.cf.tlsClientAuth` can be observed.

- [ ] **Step 2: Keep direct ingress disabled and enable the fail-closed probe temporarily.**

Required state:

```text
TRADINGVIEW_DIRECT_INGRESS_ENABLED=false
TRADINGVIEW_CERT_PROBE_ENABLED=true
```

- [ ] **Step 3: Send a spoof-only request.**

Expected: HTTP 403; caller-supplied certificate headers cannot create `certPresented=true` or a Worker-observed fingerprint.

- [ ] **Step 4: Trigger a genuine TradingView webhook.**

Expected sanitized observation:

```text
certPresented=true
fingerprintAvailable=true
certFingerprintSHA256=<normalized 64-hex value>
```

No body/source/workspace/broker/credential data is allowed in the probe log.

- [ ] **Step 5: Repeat only enough genuine webhooks to establish fingerprint stability.**

If the fingerprint is absent, malformed, or unstable, stop. Do not weaken to IP-only, caller-header, subject/CN/SAN, URL-secret, or body-secret authentication.

- [ ] **Step 6: Disable probe immediately.**

Required state before any ingress acceptance:

```text
TRADINGVIEW_CERT_PROBE_ENABLED=false
```

- [ ] **Step 7: Configure the validated SHA-256 fingerprint through the environment/secret-management path and prove wrong/unpinned fingerprints still reject.**

- [ ] **Step 8: Create exactly one non-execution TradingView source row with a unique `public_source_handle`.**

Do not attach a broker destination and do not enable a trade account as part of source acceptance.

- [ ] **Step 9: Enable direct ingress only for controlled staging acceptance and send one genuine stable `event_id`.**

Expected: HTTP 202 and exactly one queue envelope for the server-resolved source.

- [ ] **Step 10: Replay the same native `event_id`.**

Expected: persistent duplicate handling prevents a second interpretation/orchestration.

- [ ] **Step 11: Send nested malicious authority/credential fields and prove stripping.**

Include test keys such as `workspace_id`, `source_id`, `destination`, `broker`, `execution`, `token`, `password`, `credential`, `api_key`, `private_key`; none may become authority or survive into the queued source event.

- [ ] **Step 12: Test a second source/workspace and failure isolation.**

Disable/fail source A and prove source B still resolves, queues, deduplicates, and reports health independently.

- [ ] **Step 13: Disable direct ingress again after the controlled acceptance window unless a later reviewed staging decision keeps it enabled.**

**Gate 3 exit criteria:** genuine TradingView certificate fingerprint proven on non-Enterprise deployment, spoof rejected, exact pin enforced, one non-execution source accepted, duplicate/authority/isolation tests pass, broker execution untouched.

---

## Gate 4 — Real Zitadel Identity and Workspace Authorization Acceptance

**Purpose:** Prove that authentication, product entitlement, workspace membership, roles, and broker execution permission remain separate controls in the real identity environment.

**Files:**
- Reference: existing Zitadel auth/membership implementation under `cloudflare-v2/src/`
- Reference: Zitadel specs listed in `AGENTS.md`
- Update acceptance evidence: `cloudflare-v2/docs/STAGING_V1_RUNBOOK.md`
- Modify after batch: `AGENTS.md`

- [ ] **Step 1: Configure/verify the actual Trading Zitadel project/application and expected organization/workspace mapping.**

Use immutable Zitadel `sub` as identity; never email.

- [ ] **Step 2: Keep `trading_access_enabled=false` and prove a successful login alone cannot access Trading.**

- [ ] **Step 3: Enable Trading entitlement only for the controlled staging workspace/user and prove exact membership.**

- [ ] **Step 4: Exercise roles `owner`, `admin`, `operator`, and `viewer` against the documented permissions.**

No workspace role may implicitly grant `broker.execute`.

- [ ] **Step 5: Negative tests.**

Prove rejection for wrong project, wrong organization/workspace, absent membership, revoked membership, unknown role, disabled entitlement, and a user from a second tenant.

- [ ] **Step 6: Prove second-tenant isolation.**

User/workspace A must not read or mutate source, account, destination, health, retry, idempotency, or control state belonging to B.

**Gate 4 exit criteria:** real identity environment positive/negative tests pass; product entitlement and workspace membership are authoritative; broker execution remains separately disabled; `AGENTS.md` records evidence.

---

## Gate 5 — Telegram MTProto Real Soak and Recovery Acceptance

**Purpose:** Convert the three Telegram provider implementations from CI-proven code to real long-running source runtimes with replay/recovery evidence.

**Files:**
- Reference: Container Telethon runtime under `cloudflare-v2/containers/mtproto-listener/`
- Reference: DO+mtcute source/runtime under `cloudflare-v2/src/sources/mtproto/`
- Reference: external adapter under `cloudflare-v2/external/mtproto-adapter/`
- Reference: soak command in `cloudflare-v2/package.json`
- Update runbook/evidence: `cloudflare-v2/docs/NON_LIVE_MULTI_SOURCE_ACCEPTANCE.md`
- Modify after batch: `AGENTS.md`

- [ ] **Step 1: Run static soak harness.**

From `cloudflare-v2/`:

```bash
npm run soak:mtproto:container
```

- [ ] **Step 2: Connect a dedicated test Telegram account/channel to one provider at a time.**

Start with the intended production-preferred provider on the current deployment profile, then exercise alternate providers.

- [ ] **Step 3: Send controlled new/edited signal-like messages and record canonical identity.**

Expected identity:

```text
telegram:<accountScope>:<chatId>:<messageId>
```

- [ ] **Step 4: Disconnect/restart each provider runtime and force catch-up/replay.**

Expected: replay of the same native message is terminal duplicate, not a second orchestration.

- [ ] **Step 5: Inject temporary downstream failure.**

Fail one provider/source's downstream delivery and prove another source/provider remains healthy and does not share retry/health state.

- [ ] **Step 6: Cross-provider redundancy test.**

Observe the same native message through two provider paths in the same workspace/account scope and prove they converge to one persistent canonical event.

- [ ] **Step 7: Container cost/startup guard.**

Confirm DO/external activity does not start Container runtime; only the exact active Container source may start it.

**Gate 5 exit criteria:** real Telegram receive/reconnect/restart/catch-up/replay passes, persistent duplicate collapse proven, providers isolated, no claim of zero-loss beyond the actual observed soak evidence.

---

## Gate 6 — MT5 and cTrader Real Source Acceptance

**Purpose:** Prove real demo-account source capture and signed delivery without coupling source credentials/lifecycle to broker execution credentials/lifecycle.

**Files:**
- MT5 source: `cloudflare-v2/bridges/mt5_source_capture.py`
- MT5 delivery: `cloudflare-v2/bridges/mt5_source_delivery.py`
- cTrader source capture implementation under `cloudflare-v2/src/`
- Update acceptance runbook/evidence
- Modify after batch: `AGENTS.md`

### MT5 source

- [ ] **Step 1: Connect a dedicated MT5 demo source account and verify exact login match before history access.**
- [ ] **Step 2: Produce market open/close and partial-close deal history and confirm stable native deal-ticket identity and `time_msc` ordering.**
- [ ] **Step 3: Exercise polling overlap; successfully delivered deals suppress local overlap duplicates while failed delivery remains retryable.**
- [ ] **Step 4: Restart the source runner and prove server-side persistent idempotency prevents duplicate orchestration.**
- [ ] **Step 5: Prove the source runtime does not use MT5 execution command secret, execution replay ledger, or `MT5Engine`.**

### cTrader source

- [ ] **Step 6: Connect a dedicated cTrader demo source account and verify exact `ctidTraderAccountId` filtering.**
- [ ] **Step 7: Produce real deal execution events with stable deal ID/timestamp and verify per-source serial ordering.**
- [ ] **Step 8: Prove `subscribeEvents()` observation does not consume/break request `waitForEvent()` behavior.**
- [ ] **Step 9: Restart/reconnect and prove source A failure/recovery does not alter source B health/retries/identity.**

**Gate 6 exit criteria:** MT5 and cTrader demo sources each produce authenticated canonical events once, replay safely, remain credential/lifecycle-isolated from execution, and pass second-source isolation.

---

## Gate 7 — MT5 and cTrader Broker Destination Demo Acceptance

**Purpose:** Prove broker-specific translation, sizing, trade management, idempotency, and safety controls on demo accounts before any live-money cutover.

**Files:**
- Reference/modify through TDD as needed: MT5 bridge/executor implementation under `cloudflare-v2/bridges/`
- Reference/modify through TDD as needed: cTrader adapter/session/translation under `cloudflare-v2/src/`
- Reference risk/Position Group modules and tests
- Update broker acceptance evidence in runbooks
- Modify after each broker batch: `AGENTS.md`

- [ ] **Step 1: Query live broker metadata for the demo account.**

Record non-secret symbol metadata needed for correctness: symbol mapping, digits/precision, tick size/value, min/step/max volume, supported order types, account hedged/netted semantics.

- [ ] **Step 2: Assert risk-to-volume translation against broker-reported metadata before sending orders.**

For each demo case, record:

```text
requested risk
entry / stop distance
computed volume
broker-valid normalized volume
broker-reported executed volume
```

The values must agree within the platform/broker's documented rounding semantics.

- [ ] **Step 3: MT5 demo matrix.**

Exercise buy, sell, market execution, supported pending order types, SL, TP, arbitrary TP-leg splitting, partial close, break-even, SL/TP modification, close, duplicate command, rejected volume, market closed, insufficient margin, temporary network failure, restart/reconnect, account kill switch, and global kill switch.

- [ ] **Step 4: cTrader demo matrix.**

Exercise equivalent cases with special assertion that raw `ProtoOASymbol.lotSize` protocol-cent semantics are preserved exactly and no additional x100 conversion occurs.

- [ ] **Step 5: Unknown-state/idempotency recovery.**

Simulate transport timeout after a broker request and prove retry/reconciliation cannot blindly create a duplicate order when broker state is uncertain.

- [ ] **Step 6: Hedged/netted behavior.**

Where demo accounts permit, prove Position Group management produces valid broker behavior for each supported account mode.

**Gate 7 stop conditions:** any unexplained sizing discrepancy, duplicate order, risk-limit bypass, kill-switch bypass, unsafe retry after unknown state, or broker-specific semantic ambiguity.

**Gate 7 exit criteria:** MT5 and cTrader demo execution matrices pass with broker-authoritative sizing/metadata, management/idempotency/safety controls proven, no real-money account used.

---

## Gate 8 — Full End-to-End Staging and Failure Soak

**Purpose:** Prove real sources, real auth, real queues/database, parser/state/risk, and broker demo destinations as one system under failure/replay conditions.

**Files:**
- Update/extend acceptance harnesses only where a real gap is found
- Update `cloudflare-v2/docs/STAGING_V1_RUNBOOK.md`
- Modify after batch: `AGENTS.md`

- [ ] **Step 1: Telegram → canonical engine → MT5 demo.**

One signal must create one persistent event, one Position Group, expected TP legs, and expected broker demo result.

- [ ] **Step 2: TradingView → Queue → canonical engine → cTrader demo.**

Use only the accepted certificate-pinned source path.

- [ ] **Step 3: MT5 source → signed V1 → canonical engine → separate demo destination.**

Prove source/execution credentials and account identities remain distinct.

- [ ] **Step 4: Custom signed API → engine → multi-destination fan-out.**

One destination succeeds, one fails; successful sibling must not roll back/re-dispatch when failed sibling retries.

- [ ] **Step 5: Failure injection matrix.**

Exercise webhook retry, Queue duplicate/redelivery, Telegram reconnect replay, Worker restart, database temporary failure, AI unavailable, one destination down, broker disconnect, source disable during event, revoked user, disabled entitlement, account execution disabled, account risk limit exceeded, workspace/account/global kill switches.

- [ ] **Step 6: Run a sustained staging soak.**

Collect evidence for event latency, duplicate rate, retry rate, source reconnects, destination failures, broker rejections, and any DLQ traffic. Every observed anomaly must either be explained/accepted or fixed through a new RED/GREEN batch before exit.

**Gate 8 exit criteria:** all representative end-to-end paths operate on real external staging/demo services; replay/failure cases remain isolated and idempotent; no unresolved duplicate, sizing, authorization, or cross-tenant issue remains.

---

## Gate 9 — Production Operations, Observability, Rollback, and Security Readiness

**Purpose:** Ensure operators can detect, stop, diagnose, and roll back failures safely before live money is introduced.

**Files:**
- Create/modify focused observability/health modules only if missing, through TDD
- Update `cloudflare-v2/docs/STAGING_V1_RUNBOOK.md`
- Create/maintain production cutover checklist/runbook as needed
- Modify after batch: `AGENTS.md`

- [ ] **Step 1: Monitoring coverage.**

Ensure operators can observe without secrets: Worker errors, Queue depth, DLQ depth, processing latency, source/provider health, Telegram reconnects, broker connectivity, rejected/failed orders, duplicate rate, destination retries, AI fallback/failure rate, database failures, Zitadel authorization failures, Container instances/usage, and risk-block events.

- [ ] **Step 2: Auditability.**

Verify each important action can be correlated through safe identifiers: actor/authorization decision, source native event, canonical event, interpretation/intent, risk decision, Position Group, destination attempt, broker result, management action, close/failure/retry. Never log credentials/session secrets.

- [ ] **Step 3: Kill-control drill.**

Prove global, workspace, account, source, and destination disables work. Prove a new-entry block can still permit explicitly reviewed protective management where the existing safety model allows it.

- [ ] **Step 4: Deployment/rollback drill.**

Record production candidate SHA, migration ledger, Worker deployment/version, previous known-good deployment, rollback command/process, and post-deploy smoke checks. Execute rollback in staging.

- [ ] **Step 5: Recovery drill.**

Exercise Supabase/DO/Queue/Telegram/broker reconnect assumptions and document which layer is authoritative after restart/replay.

- [ ] **Step 6: Security review.**

Re-check least-privilege database roles, source secret isolation, no caller authority injection, no Enterprise-only Cloudflare dependency, exact TradingView fingerprint pin, identity/tenant isolation, and broker execution controls.

**Gate 9 exit criteria:** operators can detect and stop unsafe behavior quickly, audit actions without secrets, rollback safely, recover persistent state, and verify production-candidate configuration from an exact SHA.

---

## Gate 10 — Controlled Production Cutover and Launch

**Purpose:** Introduce real-money risk gradually with explicit human approval and immediate rollback/kill capability.

**Files:**
- Production cutover runbook/checklist
- `AGENTS.md` after every cutover phase
- No feature development unless a cutover defect requires a RED/GREEN fix

### Phase A — Shadow production

- [ ] **Step 1: Deploy production infrastructure with real sources and production identity/database, but broker execution OFF.**
- [ ] **Step 2: Compare intended actions against expected manual/known trades and record discrepancies.**
- [ ] **Step 3: Require a clean shadow acceptance window before proceeding.**

### Phase B — Production infrastructure with demo broker

- [ ] **Step 4: Route production source traffic to dedicated broker demo account(s).**
- [ ] **Step 5: Repeat core trade/risk/management/idempotency cases under production infrastructure.**

### Phase C — Tiny controlled live

- [ ] **Step 6: Obtain separate explicit user approval for live cutover.**

Do not infer this approval from approval of this plan.

- [ ] **Step 7: Enable exactly one tightly restricted live account.**

Before enabling, configure owner-approved maximum per-trade risk, maximum volume, maximum concurrent positions/open risk, daily loss ceiling, allowed symbols, and kill-switch contacts/procedure. Do not invent financial thresholds.

- [ ] **Step 8: Execute a tiny controlled live matrix.**

Use a minimal set of normal-entry and protective-management cases. Monitor event identity, risk calculation, broker-reported volume, Position Group state, and duplicate safeguards in real time.

- [ ] **Step 9: Disable live execution immediately if any stop condition is triggered.**

Stop for sizing mismatch, duplicate order, unexplained broker state, authorization failure, cross-tenant leakage, kill-switch failure, persistent retry anomaly, or missing audit trail.

### Phase D — Controlled beta

- [ ] **Step 10: Add a very small reviewed user/account cohort only after tiny-live acceptance.**
- [ ] **Step 11: Monitor broker-specific errors, latency, duplicate/retry rates, source health, and support/operational burden.**

### Phase E — General production

- [ ] **Step 12: General launch only after beta evidence is recorded and no unresolved severity-1/2 trading-safety issue remains.**
- [ ] **Step 13: Update `AGENTS.md` with final production SHA, launch state, enabled providers/destinations, monitoring/rollback links, and outstanding post-launch backlog.**

**Gate 10 exit criteria:** controlled live and beta are accepted, monitoring/kill/rollback remain functional, exact production SHA and configuration are recorded, and general launch is explicitly declared.

---

## Production-Ready Definition

Do not call Mkety Trading production-ready until all applicable items below are evidenced:

- [ ] exact production candidate SHA known and mandatory CI fully GREEN
- [ ] real Cloudflare staging infrastructure accepted
- [ ] Paid optional Container semantics and Free no-Container baseline both preserved
- [ ] real TradingView certificate fingerprint accepted without Enterprise-only dependency
- [ ] TradingView spoof/unpinned/duplicate/authority/isolation tests pass
- [ ] real Zitadel entitlement/membership/role/negative/isolation acceptance passes
- [ ] real Telegram receive/reconnect/restart/catch-up/replay soak passes for production-enabled provider(s)
- [ ] MT5 source demo acceptance passes if enabled for launch
- [ ] cTrader source demo acceptance passes if enabled for launch
- [ ] MT5 destination demo matrix passes if enabled for launch
- [ ] cTrader destination demo matrix passes if enabled for launch
- [ ] broker-authoritative risk/volume assertions pass
- [ ] persistent source/event/destination/order idempotency is proven under replay/retry
- [ ] account/workspace/global kill controls are drilled
- [ ] sustained end-to-end staging soak has no unresolved safety/isolation issue
- [ ] monitoring/audit/DLQ/rollback/recovery controls exist and are exercised
- [ ] shadow production passes
- [ ] production-infrastructure demo passes
- [ ] separate explicit tiny-live approval is received
- [ ] tiny-live acceptance passes
- [ ] controlled beta passes before general launch

## Scope Guard Until General Launch

Do not delay V1 for unrelated additions such as more source families, more brokers, advanced dashboards, extra AI capabilities, community/social features, advanced analytics, mobile apps, billing automation, or exhaustive reporting unless a missing item is proven necessary to satisfy one of the ten production gates.

## Progress Recording Contract

After every meaningful batch, `AGENTS.md` must record all of:

```text
Production launch gate: <gate number/name>
Status: NOT STARTED | IN PROGRESS | BLOCKED | GREEN
Exact branch head: <sha>
CI/environment evidence: <run ids / non-secret acceptance evidence>
Safety state: trading_access_enabled / TradingView ingress / broker execution / live execution
Blockers: <specific unresolved items, or NONE>
Exact next safe action: <one concrete action>
```

Never advance a gate in `AGENTS.md` without the evidence required by that gate.
