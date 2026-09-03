# Trading Project Agent Handoff

Operational source of truth for `MketyDigital/Trading`.

## Hard rules
- Active work: `cloudflare-v2/` on `design/enterprise-trading-event-core`, draft PR #2 -> `main`.
- **Never merge `main` without explicit user instruction.**
- **Never enable real-money execution without a separate explicit final cutover approval.**
- Never expose broker/database/auth/Telegram/provider/Cloudflare/Zitadel/AI/signing/destination/transport secrets.
- TDD for production/config behavior: exact RED first, then exact-head GREEN.
- Update this file after every meaningful implementation/testing/environment batch.
- Batch work and minimize CI/Cloudflare consumption.
- Trading hostname: **`trade.mkety.com`** under `mkety.com`.
- `mkety.app` is reserved for customer-owned apps/builds under Mkety/MKSaaS.
- Cloudflare core/security must remain Free-plan-compatible; Containers are optional Paid MTProto capacity only.
- External systems such as Zitadel, broker credentials, TradingView certificate/domain, Telegram sessions, and environment secrets are **integration/configuration boundaries**. Build Trading against stable contracts so real service setup later is configuration plus acceptance evidence, not a product-logic rewrite unless a real-environment incompatibility is discovered.

## Product / tenancy contract
Mkety Trading is multi-tenant. Isolation is mandatory across workspace, user, source, provider runtime, Telegram session/chat, event, trade account, destination, AI provider, retry, queue, idempotency, Position Group, health/control state, and credentials.

Canonical pipeline:
`source -> authenticated Trading Event -> persistent canonical idempotency -> deterministic normalization/bounded AI -> durable trade state -> validated intent -> account safety/risk -> Position Group -> platform translation -> persistent destination idempotency -> destination adapter`.

Providers:
- Telegram: `cloudflare_container_mtproto`, `cloudflare_do_mtproto`, `external_mtproto`
- TradingView: `tradingview_webhook`
- MT5: `mt5_source_bridge`
- cTrader: `ctrader_source`
- custom: `custom_signed_api`

Safety invariants:
- clear signals remain deterministic; AI is ambiguity-only and post-validated;
- connected broker metadata is authoritative;
- persistent event/destination/order idempotency is mandatory;
- Position Groups support arbitrary TP legs;
- global kill switch blocks everything;
- preserve raw cTrader `ProtoOASymbol.lotSize` protocol-cent semantics; never add another x100;
- identity/admin/database/source/infrastructure work never grants broker execution.

## Identity / database boundary
- Managed Mkety Zitadel is the global identity authority; Trading and MKSaaS remain separate projects/apps/product DBs.
- Immutable Zitadel `sub` is identity, never email.
- Login alone never grants Trading access.
- `trading_workspace_access` is entitlement; membership is exact `(workspace_id, zitadel_subject)`.
- roles: owner/admin/operator/viewer; unknown fails closed; no role grants broker execution.
- Real Zitadel integration is expected to be config + acceptance once the main Mkety/MKSaaS identity upgrade provides the real project/app/org values.
- Trading Supabase migrations through `trading_0010_tradingview_public_source_handle` are applied/verified; ledger `20260902184215`.
- Additive destination retry migration `0011_destination_delivery_retry_state.sql` is code/test GREEN; real-environment application remains a deployment/acceptance step.

## Default runtime safety
```text
TRADINGVIEW_DIRECT_INGRESS_ENABLED=false
TRADINGVIEW_CERT_PROBE_ENABLED=false
TRADING_ACCESS_ENABLED=false
BROKER_EXECUTION_ENABLED=false
```

No identity role, admin API, source enablement, account enablement, database migration, infrastructure action, or retry runtime may implicitly change `BROKER_EXECUTION_ENABLED`.

## CI / deployment discipline
- Ordinary `.github/workflows/trading-v1-ci.yml` runs Node Worker/trading-core, pure MT5 bridge, and both MTProto Python suites.
- Ordinary feature-branch source/config work uses the PR run as regression authority; duplicate push regression is suppressed.
- Cloudflare work is exact-marker-only. Ordinary development must not invoke Wrangler/deploy/Container/probe jobs.
- Paid profile: `cloudflare-v2/wrangler.toml`.
- Free no-Container profile: `cloudflare-v2/wrangler.free.toml`.
- Paid/Free queue names remain isolated.

## Production launch gates
1. Scope freeze — **GREEN**
2. Real Cloudflare staging infrastructure — **GREEN**
3. TradingView certificate/direct ingress — **DEFERRED / FAIL-CLOSED; STATIC PRODUCTION PATH GREEN**
4. Zitadel real non-live identity — **STATIC GREEN / REAL ACCEPTANCE PENDING**
5. Telegram runtime soak — **STATIC GREEN / REAL SOAK PENDING**
6. MT5/cTrader source acceptance — **PROBE BRIDGE GREEN / REAL DEMO PROBES PENDING**
7. Broker demo destinations — **LIFECYCLE BRIDGE GREEN / REAL DEMO LIFECYCLES PENDING**
8. End-to-end staging — **STATIC EXECUTION + DURABLE RETRY BRIDGE GREEN / REAL ACCEPTANCE PENDING**
9. Production operations — **STATIC OBSERVABILITY + EVENT CORRELATION + ACCOUNT CONTROL + FAIL-CLOSED EXECUTION/RECOVERY GREEN; FURTHER OPS READINESS PENDING**
10. Tiny controlled cutover — **NOT STARTED**

Independent gates may proceed out of number order. Production still requires every mandatory in-scope gate GREEN or an explicit reviewed V1 scope change. Real-money cutover additionally requires separate explicit user approval.

## Gate 1 — scope freeze
**GREEN.** Run `33695618717` @ `aebec4adf71a7f7299b3279d1b4c8b03803e25be`.

## Gate 2 — real Cloudflare staging
**GREEN / EXITED 2026-09-03.**
- first Paid deployment run `33720102208` @ `bbba25091eb88778fa7243760b704b0b85ab5c6a`
- known-good Worker version `c25e85d5-bfe2-4d17-9ab4-5133d88ecec8`
- final acceptance run `33725547513`, job `100553745522`, head `e2e93aaa131ec2149966e8ca2f480d4fdccc300a`
- Queue duplicate source event -> exactly one persistent Trading Event; event `READY`; simulation `SIMULATED`; 3 simulated actions; broker execution false
- concrete Container instance records 0 before/after/final; rollback to known-good succeeded; temporary Supabase fixtures cleaned to zero.

Do not redo Gate 2.

## Gate 3 — TradingView
**DEFERRED / FAIL-CLOSED; STATIC PATH GREEN.**
- exact SHA-256 cert fingerprint trust uses only Cloudflare `request.cf.tlsClientAuth`; caller-header spoofing cannot supply authority.
- dedicated production hostname contract is `trade.mkety.com`.
- probe run `33728657084`, job `100563529178`: temporary probe deployed, spoof curl rejected 403, no genuine TradingView fingerprint observed, safe rollback succeeded.
- genuine TradingView webhook acceptance is deferred until the required TradingView subscription/source is available.
- Do not fall back to IP allowlists, headers, CN/SAN-only trust, URL secrets, or body secrets.

## Gate 4 — Zitadel
**STATIC GREEN / REAL ACCEPTANCE PENDING.**
Static coverage includes signed JWT verification, issuer/audience/exp/nbf, exact project role claim, organization/workspace binding, membership, role permissions, disabled entitlement/member, second-workspace isolation, and no MKSaaS DB dependency.

Real managed-Zitadel acceptance later must plug in the actual Mkety project/app/org configuration and prove positive/negative/isolation behavior. Do not rewrite Trading authorization merely to wire real identifiers/secrets.

## Gate 5 — Telegram MTProto
**STATIC GREEN / REAL SOAK PENDING.**
- Container soak harness covers explicit opt-in, reconnect health, catch-up/replay, canonical duplicate identity, latency, secret-free summaries, and no broker execution commands.
- Existing suites prove cross-provider canonical convergence and provider/source isolation.
- Real receive/restart/catch-up soak awaits dedicated Telegram test credentials.

## Gates 6–7 — MT5/cTrader source probes + demo destinations
**STATIC/BRIDGE GREEN; REAL DEMO ACCEPTANCE PENDING.**
- Gate 6 dedicated workflow: `.github/workflows/gate6-demo-probes.yml`
- Gate 7 dedicated workflow: `.github/workflows/gate7-demo-destinations.yml`
- MT5 probes require exact demo login/server and broker-authoritative symbol/tick metadata.
- cTrader remains pinned to demo for acceptance and preserves raw protocol `lotSize` semantics.
- Probe mode cannot construct execution-capable delivery behavior; lifecycle mode requires persistent Supabase idempotency and explicit demo-order opt-in.
- Worker-wide `BROKER_EXECUTION_ENABLED=false` remains pinned in protected demo acceptance workflows.

Key GREEN evidence:
- probe persistence decoupling: run `33731004622` @ `705e628eba02d6fb7c5925d4b8a2a0b6ca04c1dd`
- cTrader probe deny-store integration: run `33731624548` @ `f02ebe449cc13157dadd0c7663e2fc1bee095ec3`
- Gate 6 bridge: runs `33732167256` / `33732167285`
- MT5 runtime mapping regression GREEN: run `33733468585` @ `3a082b6da1ae255a2c2aa497eddd192606b947fa`
- Gate 7 bridge: runs `33733929722` / `33733933644`

Never paste protected demo credentials in chat or commits.

## Production admin execution controls — GREEN
Existing durable account fields are reused; no schema migration required.
- `GET /api/v1/admin/accounts` — owner/admin only, exact workspace, credential-free.
- `POST /api/v1/admin/accounts/:id/execution` — owner/admin only; exact account/workspace `execution_enabled`.
- `POST /api/v1/admin/accounts/:id/kill-switch` — owner/admin only; preserves other safety-policy fields.
- operator/viewer receive no account-control permission.
- no role has `broker.master.enable`; no admin API route can mutate `BROKER_EXECUTION_ENABLED`.

GREEN run `33734775292` @ `76ff17ff00584b6d01deb033917daa4b6526a86f`: Node 534/534, MT5 14/14, Container MTProto 11/11, external MTProto 22/22; Cloudflare/deploy/probe jobs skipped.

## Gate 8 — production execution bridge
**STATIC GREEN THROUGH DURABLE DESTINATION RECOVERY; REAL END-TO-END ACCEPTANCE PENDING.**

### Worker-wide access and execution fuses
- External V1 application/admin/TradingView routes require exact server-side `TRADING_ACCESS_ENABLED=true`.
- `BROKER_EXECUTION_ENABLED` is checked before account lookup, destination idempotency, state access, or adapter dispatch.
- exact workspace/account, active state, account `execution_enabled`, safety policy and kill switch are revalidated server-side.

### Broker dependency authority
- `trade_accounts` is broker destination authority; caller credentials are never authoritative.
- MT5 uses server bridge URL/secret plus exact DB account identity and broker symbol metadata.
- cTrader decrypts exact DB account token server-side; live mode additionally requires its separate live gate.

### Production execution stage / Trade State binding
- only successful, non-duplicate trusted plans with per-account READY actions can reach production execution.
- trusted workspace comes from authenticated server authority, not caller payload.
- normalized broker position/order/deal IDs and fill price are the only broker execution values bound to exact workspace/Position Group/leg Trade State.
- credentials/raw broker responses never enter Trade State.

Key GREEN evidence:
- production coordinator: run `33736812704`
- broker dependencies: run `33738168500` @ `62ef4d92e6dd02e50a2fb1e71746579373139586`
- production execution stage: run `33739118996` @ `9fa41086a035bf2171c50608ced3b386a6c22a1e`
- exact Trade State binding: run `33739693026` @ `541ee14e06339bc23f4d5bc710c178342d3fc983`

### Persistent destination retry/recovery — GREEN
Durable destination retry is independent from source replay/dedupe.
- trusted `accountId`, `groupId`, and canonical action are persisted with the destination delivery.
- retry scanner claims the exact existing durable delivery through the Supabase delivery store; it does not reserve a second idempotency key.
- before broker redispatch, recovery reloads and revalidates the exact workspace/account/active/execution/safety state.
- an account disabled or kill-switched after retry scheduling is terminated safely without broker dispatch.
- one-minute scheduled recovery composes destination retry with MTProto recovery independently.
- with `BROKER_EXECUTION_ENABLED=false`, destination recovery returns before constructing Supabase or touching a broker.

TDD evidence:
- retry composition primitives GREEN: run `33744427820` @ `fd10fa7cd354c9f8589907421ee2c8c76e0d9b02`
- recovery RED: run associated with `63f89eda1d4e5a250d7bcb02c5470d59c0ee0dec`, exactly four new recovery contracts failed
- recovery GREEN: run `33745498467` @ `ea498097e865a7bb911906acfddbe888a0e2b956`; full Node/MT5/MTProto suites passed; every Cloudflare/deploy/probe/acceptance job skipped.

## Gate 9 — production operations/readiness

### Secret-free operations observability — STATIC GREEN
Read-only endpoint: `GET /api/v1/admin/operations`.

Contract:
- owner/admin only; operator/viewer denied;
- exact authenticated workspace scope;
- read-only; cannot mutate account state or `BROKER_EXECUTION_ENABLED`;
- exact durable delivery counts for `PENDING`, `SUCCEEDED`, `RETRYABLE`, `UNCERTAIN`, `FAILED`;
- overdue retryable count using durable `next_attempt_at`;
- recent persisted failures expose only safe correlation/status fields: delivery ID, trading event ID, destination type/ref, status, bounded error code/failure class, attempt count and retry/attempt/update timestamps;
- DB projections deliberately exclude credentials, broker account/login IDs, idempotency keys, request payloads and response payloads;
- current account safety blocks expose only internal trade-account ID, label, platform and reason codes (`ACCOUNT_INACTIVE`, `ACCOUNT_EXECUTION_DISABLED`, `ACCOUNT_POLICY_DISABLED`, `KILL_SWITCH`);
- no historical risk events are fabricated: this slice reports current durable safety controls plus persisted destination failure/retry state.

TDD evidence:
- RED `1935819eff628482a01d7af72923a0b687af6be0`, run `33746468499`: Node 586/587; only missing operations implementation failed; Cloudflare skipped.
- first GREEN candidate `07296de6bb996279c770c818b5e7d803f4785619`, run `33746788084`: one semantic mismatch exposed—future RETRYABLE row without persisted failure metadata was incorrectly classified as a recent failure.
- root-cause fix `d7db5f6fa7bbe6707c6d24deeeda4c8e801c3558`, run `33747023882`: **Node 589/589, MT5 14/14, Container MTProto 11/11, external MTProto 22/22**; all Cloudflare deploy/probe/inspection/acceptance jobs skipped.

### Event audit/correlation — STATIC GREEN
Read-only endpoint: `GET /api/v1/admin/events/:eventId/audit`.

Contract:
- owner/admin only via existing `operations.read`; operator/viewer denied;
- exact authenticated workspace scope on Trading Event, source, Position Groups, legs, and destination deliveries;
- correlates both the originating `source_event_id` and later `source_event_ids` membership so follow-up/management events resolve the same durable trade group;
- returns selected safe source/event/group/leg/delivery identifiers and state, including broker position/order IDs only as non-secret correlation identifiers;
- canonical intent is recursively stripped of secret/token/password/credential/authorization/API-key/private-key/cipher keys before return;
- DB projections never read raw event text, structured payload/metadata, source ciphertext/config, delivery idempotency keys, delivery request payloads, or delivery response/raw broker payloads;
- missing exact-workspace event returns 404; non-GET methods are rejected;
- existing persistence does not record complete historical operator actors for this chain, so the endpoint explicitly reports `historyCoverage.actorHistoryRecorded=false` rather than inventing attribution;
- no migration and no execution-state mutation.

TDD evidence:
- RED `487bce9f69e54412f5f06ad752f1b64c93e277f9`, run `33747958370`: **589/591 Node passed**; exactly the two new absent-route contracts failed with 404; Cloudflare jobs skipped.
- GREEN `d7ce1dcc2af970d87df295222b8f2c688a07760d`, run `33748401905`, job `100626110498`: **Node 591/591, MT5 14/14, Container MTProto 11/11, external MTProto 22/22**; every Cloudflare deploy/probe/inspection/acceptance job skipped.

Safety state after this batch:
```text
TRADINGVIEW_DIRECT_INGRESS_ENABLED=false
TRADINGVIEW_CERT_PROBE_ENABLED=false
TRADING_ACCESS_ENABLED=false
BROKER_EXECUTION_ENABLED=false
```
No Cloudflare deployment, broker/demo action, Zitadel mutation, Telegram external action, or real-money execution was performed.

## Current production blockers / deferred real acceptance
These are integration/environment acceptance items, not reasons to rewrite proven core contracts:
- TradingView genuine certificate webhook requires suitable TradingView source/subscription.
- Zitadel real acceptance requires the final managed Mkety identity project/app/org setup.
- Telegram real soak requires dedicated test account/channel credentials.
- MT5/cTrader real source/demo-destination acceptance requires controlled demo credentials/services.
- Gate 8 sustained end-to-end soak requires the above real staging dependencies.
- Gate 10 real-money cutover remains forbidden without separate explicit user approval.

## Exact next safe action
Continue **Gate 9 static operations/readiness** by first inspecting whether any existing Trading-owned table already records historical admin/operator mutations with actor subject, workspace, action, target, and timestamp. If no adequate durable actor audit exists, the next likely production slice is an append-only admin action audit trail for sensitive control-plane mutations (membership, source control/defaults, account execution toggle, account kill switch). That change would add persistence/migration behavior and must receive a separate bounded design approval before implementation; do not infer historical actors retroactively.

Keep all four runtime safety flags OFF, do not deploy or call real broker services for the static batch, and do not merge `main` without explicit user instruction.
