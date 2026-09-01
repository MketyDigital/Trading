# Trading Project Agent Handoff

This file is the current operational source of truth for `MketyDigital/Trading`. Read it before changing the project.

## Repository boundaries

- Root-level `server.js`, root `wrangler.toml`, `patch_admin_api.js`, and the old root package are legacy/reference material.
- **All active next-generation work stays in `cloudflare-v2/`** unless a deliberate migration plan says otherwise.
- `trade.mkety.com` / this repository is the standalone Trading runtime.
- `app.mkety.com` / Mkety is the broader identity, billing, entitlement, provisioning, and revocation control plane.
- Trading must remain independently deployable. Do not create hidden cross-repo coupling.
- `cloudflare-v2/src/index.js` is the legacy runtime and must not be broad-refactored while the V1 compatibility wrapper is being hardened.

## Approved architecture

Mkety Trading is an enterprise/custom multi-tenant trading automation platform, not a Telegram-only copier.

Authoritative flow:

```text
Source Adapter
  -> authenticated/versioned Trading Event
  -> persistent event idempotency
  -> deterministic normalization / bounded AI ambiguity resolution
  -> correlation + Trade State
  -> canonical intent / management event
  -> deterministic validation
  -> account safety + risk
  -> Position Group / child legs
  -> platform translation
  -> persistent destination idempotency
  -> destination / broker adapter
```

Telegram HTML is presentation output only. It must never become machine-execution authority.

### Source contract

The same V1 event contract must support Telegram MTProto, Telethon/Python listeners, TradingView, MT5/bridges, REST/custom enterprise webhooks, and future adapters without rewriting the core.

### Destination contract

Canonical events/intents may fan out to Telegram/manual-trader destinations, MT5, cTrader, product-specific Deriv adapters, signed webhooks/APIs, other Workers/services, and enterprise custom destinations.

### Latency model

Human forwarding and machine planning are parallel concerns.

- Straightforward machine signals should be deterministic and may bypass AI.
- AI may resolve ambiguous language only inside a bounded latency budget.
- AI-derived structure must pass deterministic semantic/risk validation.
- Telegram formatting may use bounded AI with deterministic fallback, but formatting output is never execution input.

## Mandatory trading safety rules

1. Never test production order execution with meaningful real capital.
2. Real-money execution remains disabled until demo acceptance is complete.
3. Every signal-to-order and destination delivery requires persistent idempotency; warm-isolate memory is not authoritative.
4. Separate formatting/forwarding from trade authorization/execution.
5. Every account requires explicit execution enablement, allowed symbols, max lot/risk, daily-loss/exposure limits, and kill-switch semantics before live copy.
6. Fail closed on malformed/ambiguous AI output, missing prices, unsupported instruments, missing broker metadata, provider outage, ambiguous trade correlation, or missing credentials.
7. Broker/API/source secrets must never be returned to browsers, logged, or committed.
8. Use actual connected-account symbol catalogs/metadata; static aliases are seed hints only.
9. Preserve hedged vs netted platform semantics.
10. Management that reduces risk may remain allowed under drawdown locks unless a global kill switch blocks all actions.
11. Apply database migrations deliberately to staging before production.
12. Do not replace the legacy Telegram path until V1 shadow/staging comparison is satisfactory.

## Active branch / PR

- Active branch: `design/enterprise-trading-event-core`.
- Draft PR: **#2 — `feat: build enterprise trading event core foundation`**.
- `main` remains unchanged by this development batch.
- `cloudflare-v2/wrangler.toml` enters through `src/v1_entry.js`.
- `src/v1_entry.js` delegates existing runtime routes to legacy `src/index.js` except explicitly new V1 routes and explicitly enabled shadow behavior.
- Real-money execution is not enabled.

## Verified implementation state — 2026-09-01

### 1. Worker compatibility wrapper and legacy preservation

- `src/v1_entry.js` is the Cloudflare entrypoint on the design branch.
- Existing `/api/webhook/process_signal` delegates to legacy behavior by default.
- `TRADING_V1_SHADOW=true` adds side-effect-free canonical diagnostics to the legacy JSON trace.
- Legacy shadow always has `executionEnabled=false` and `actions=[]`; shadow failure cannot interrupt the legacy response.
- `src/index.js` remains intact.

### 2. Universal V1 event ingress

`POST /api/v1/events` bypasses the Telegram-specific legacy Worker and uses the universal pipeline.

Implemented/tested:

- exact raw-body HMAC verification using `X-Mkety-Source-Id`, `X-Mkety-Timestamp`, and `X-Mkety-Signature`;
- server-side source registry lookup;
- workspace/source authority comes from the authenticated `source_connections` row, not client-controlled workspace fields;
- persistent `trading_events` reservation before AI/interpretation;
- duplicate ingress stops before interpretation/orchestration;
- normalized reply/thread/edit metadata;
- deterministic interpretation first;
- bounded tenant AI only after authenticated workspace resolution;
- structured interpretation persistence.

### 3. Tenant secret handling

- `src/security/secret_box.js` provides versioned AES-256-GCM envelopes with random 96-bit IVs.
- `TRADING_MASTER_KEY` must be a 32-byte base64url Worker secret.
- Source HMAC secrets are decrypted only server-side.
- Workspace AI credential loading prefers encrypted credential fields and retains plaintext `api_key` only as transitional migration compatibility.
- Do not introduce new plaintext tenant-secret storage.

### 4. Admin authorization cutover

Unsafe legacy admin exposure is no longer the V1 admin authority.

- `/api/v1/admin/*` uses `src/http/v1_admin.js`.
- legacy `/api/admin/*` is retired by the wrapper with `410 LEGACY_ADMIN_API_RETIRED` instead of reaching the old generic proxy.
- workspace selector is resolved server-side.
- workspace must have `trading_access_enabled=true` and a bound `zitadel_org_id`.
- real Zitadel verification validates RS256 signature, JWKS key, issuer, audience, exp, nbf, required Trading role, and exact organization binding.
- V1 workspace output is sanitized and does not expose bot/broker/provider secrets.
- production verifier fails closed when issuer/audience/JWKS configuration is missing.

### 5. Parser / AI / normalization

Implemented/tested:

- market and pending orders;
- LONG/SHORT aliases;
- concise symbol-before-side and side-before-symbol formats;
- entry ranges, SL, arbitrary TP lists;
- fast-entry messages;
- BE, close, partial-close, cancel-pending management;
- conversational filler/prose routes to bounded AI rather than inventing symbols;
- impossible AI price/SL/TP geometry fails closed;
- broker catalog resolution fails closed on ambiguous/not-found symbols;
- MT5, cTrader, and Deriv catalog normalization;
- entry-zone materialization policies;
- caller-defined AI latency budgets.

Static aliases never define complete market coverage.

### 6. Risk, safety, and Position Groups

Implemented/tested:

- fixed-lot and metadata-driven risk sizing;
- adapter-supplied loss-per-lot for non-simple instruments;
- volume flooring so normalization cannot silently increase intended risk;
- broker-minimum rejection when safe volume is too small;
- Position Groups with arbitrary TP count;
- deterministic split across legs;
- fast-entry promotion to TP1 with only missing legs created;
- BE/close/partial-close management generation;
- account safety policy including enabled state, kill switch, symbol allowlist, max lots/risk, daily loss, and open-risk/exposure locks;
- deterministic action idempotency keys.

### 7. Correlation and Trade State Durable Object

Implemented/tested:

- reply ID and thread ID priority correlation;
- recent incomplete fast-entry completion by source + symbol + side + time window;
- ambiguous unthreaded management fails closed;
- `TradeStateNode` persistent Position Group/source-event/broker-ID state;
- internal service-token protection on Trade State routes;
- active-group listing excludes closed groups while retaining audit state;
- source events append idempotently;
- broker execution IDs bind to legs without losing canonical state.

Cloudflare binding:

```text
TRADE_STATE_NAMESPACE -> TradeStateNode
```

Wrangler migration `v2` adds `TradeStateNode` as a SQLite Durable Object class.

### 8. V1 simulation-only orchestration

`src/pipeline/v1_orchestrator.js` composes interpretation -> correlation -> account policy -> risk/execution plan -> Position Group -> **simulation actions only**.

Safety properties:

- the orchestrator imports no broker executor and has no broker-dispatch dependency;
- top-level `executionEnabled=false` and `actions=[]` always remain authoritative for the simulation service;
- `execution_enabled=false` accounts are skipped;
- kill switch / safety rejection emits no actions and persists no new Position Group;
- `wait_for_complete_signal` fast-entry policy emits no action;
- matched/ambiguous correlation cannot create a duplicate Position Group.

`POST /api/v1/events` can attach this simulation only when `TRADING_V1_SIMULATION=true`.

Default remains **off**. When enabled:

- successful non-duplicate ingress enters simulation planning;
- workspace-scoped active trade accounts are loaded from Supabase;
- Trade State uses the workspace's Durable Object instance;
- `TRADING_V1_SIMULATION_INSTRUMENTS` and `TRADING_V1_SIMULATION_PRICES` provide explicit staging-only market context;
- optional `TRADING_V1_SIMULATION_EXPOSURES` provides staging exposure context;
- missing/invalid simulation context becomes `simulation.status=BLOCKED` with `executionEnabled=false` and no actions;
- rejected or duplicate ingress never enters orchestration.

These simulation metadata variables are staging/shadow aids only. They are **not** substitutes for live broker catalog/quote metadata in demo/live execution.

### 9. cTrader foundations

Implemented/tested:

- official JSON WebSocket endpoint selection;
- application then account authentication;
- heartbeat, request correlation, timeouts, broker errors, socket-close rejection;
- account metadata/access/account type;
- account-specific symbol list/full symbol metadata;
- spot subscription and bid/ask quote cache;
- canonical order/management translation;
- persistent destination idempotency;
- market, pending, amend SL/TP, close/partial close, cancel pending;
- hedged/netted foundations;
- fill-safe market lifecycle.

#### Critical cTrader volume rule

`ProtoOASymbol.lotSize`, min/max/step volume, and order volume are protocol-cent units. The branch keeps `protocolLotSize` raw and converts canonical lots directly against it. **Do not reintroduce another `x100` conversion.**

#### Critical market-fill rule

The first `ProtoOAExecutionEvent` may be `ORDER_ACCEPTED`, not a fill. The session buffers unsolicited events and supports bounded `waitForEvent(...)`; market execution waits for `ORDER_FILLED`/position-bearing fill before applying absolute protection or reporting protected success.

#### Demo-safe runtime

`src/adapters/ctrader_runtime.js`:

- defaults to demo endpoint;
- live environment requires explicit `allowLiveTrading=true`;
- opens/authenticates the session;
- validates account trading access before exposing execution;
- loads actual account symbol catalog;
- refuses runtime readiness when account cannot open trades or no enabled symbols are available;
- reuses the idempotent cTrader V2 executor.

No real cTrader credentials have been configured or tested by this branch work yet.

### 10. MT5 foundations

- versioned `mkety.mt5.v1` command envelope;
- exact workspace/account/command/expiry scope;
- HMAC signing/verification;
- Python/EA bridge architecture rather than pretending MT5 runs in Workers;
- canonical-to-MT5 symbol/lot/price translation;
- persistent destination idempotency;
- pure Python bridge tests in CI.

Real demo bridge connectivity is still required.

## Database migrations

Numbered migrations now exist:

- `0001_enterprise_trading_foundation.sql`: workspace Zitadel binding, source registry, trading events, Position Groups/legs, destination-delivery audit/idempotency.
- `0002_trade_correlation_and_account_policy.sql`: Position Group correlation fields plus account execution/safety/fast-entry/entry-zone policies.

**No staging or production Supabase migration has been applied automatically.** Staging application is the next account/environment step.

## Cloudflare / environment configuration

Required or upcoming server-side secrets/config include:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE` or supported service-role alias
- `TRADING_MASTER_KEY`
- `TRADE_STATE_INTERNAL_TOKEN`
- `ZITADEL_ISSUER`
- `ZITADEL_AUDIENCE`
- `ZITADEL_JWKS_URL`
- optional `ZITADEL_PROJECT_ID`
- optional `ZITADEL_TRADING_ROLE`
- `TRADING_V1_SHADOW` (default off)
- `TRADING_V1_SIMULATION` (default off)
- staging-only `TRADING_V1_SIMULATION_INSTRUMENTS`
- staging-only `TRADING_V1_SIMULATION_PRICES`
- optional staging-only `TRADING_V1_SIMULATION_EXPOSURES`
- `TRADING_V1_AI_TIMEOUT_MS`

Never commit secret values.

## CI / verification evidence

GitHub Actions for PR #2 runs:

1. Node Worker/trading-core tests;
2. pure MT5 Python bridge tests;
3. Wrangler dry-run.

Verified checkpoints:

- run **33483562539** — safe V1 wrapper entrypoint: success.
- run **33483242592** — deterministic correlation: success.
- run **33484281245** — cTrader accepted-vs-filled lifecycle correction: success.
- run **33484683645** — V1 admin Zitadel/workspace gate: success.
- run **33484934076** — simulation-only orchestrator core: success.
- run **33485269429** on head `1b8fb5ef3e63283b6f1b83649b11a47315136dfb` — `/api/v1/events` simulation handoff: **success**; Node/core, pure MT5 bridge, Wrangler dry-run all passed.

Test-first RED workflow runs are expected and must not be cited as current failures after the matching implementation head is green.

Always inspect the newest branch/PR run before claiming current green status because concurrent commits may land.

## Provider verification notes

Verified against current provider documentation during this work:

- Cloudflare Durable Objects can make outbound WebSockets, but outbound sockets do not receive DO WebSocket Hibernation; reconnection/session recovery must be explicit.
- Cloudflare Queues are at-least-once; any queued trading path requires persistent idempotency.
- TradingView webhooks fit the signed universal HTTP ingress model.
- MT5 `symbols_get()` / `symbol_info()` provide broker-specific instrument/economic metadata.
- cTrader symbol IDs are account/broker specific.
- cTrader JSON Open API requires the authenticated WebSocket lifecycle.
- cTrader execution types distinguish ORDER_ACCEPTED, ORDER_FILLED, and ORDER_PARTIAL_FILL.
- cTrader spot prices use protocol relative units and require decoding.
- Deriv product discovery should use current `active_symbols` / `contracts_for`; the legacy CALL/PUT executor must not be described as a generic CFD copier.

## Remaining production blockers — priority order

The branch is **not** approved for production live copying yet.

1. **Staging Supabase:** deliberately apply migrations `0001` then `0002`; create a staging workspace, Zitadel org binding, encrypted source connection, and non-live trade-account configuration.
2. **Staging Cloudflare configuration:** set Worker secrets/config including master key, Trade State token, Zitadel values, Supabase service credentials; enable V1 simulation only after staging DB records exist.
3. **Staging V1 acceptance:** send signed universal events through `/api/v1/events`, verify persistent idempotency, deterministic/AI interpretation, Trade State correlation, account safety, Position Groups, and simulation actions with no broker dispatch.
4. **cTrader real demo E2E:** configure encrypted app/account credentials and an authorized demo account; verify live demo catalog/quotes -> canonical plan -> idempotent market/pending/protection/close/partial-close/cancel/BE/multi-leg behavior.
5. **MT5 demo E2E:** configure a reachable authenticated demo bridge; verify `order_check`, placement, SL/TP, multi-leg, BE/partial close, pending/cancel, replay/idempotency.
6. **MTProto listener V1 migration/recovery:** sign universal V1 events while preserving the existing legacy path and verify Cloudflare idle/restart/reconnect behavior.
7. **Destination formatting profiles:** canonical per-destination Telegram/custom output with bounded AI and deterministic fallback.
8. **Deriv scope:** decide Options versus CFD/account API contract before implementing a replacement adapter.
9. Only after staging + both demo adapter paths pass may deliberately tiny controlled live tests be considered.

## Account-side setup still required

Do outside source control and do not paste secrets into chat/logs:

- staging Supabase project/access and migration application;
- Zitadel issuer/audience/project role/org mapping;
- Worker `TRADING_MASTER_KEY`;
- Worker `TRADE_STATE_INTERNAL_TOKEN`;
- staging source HMAC secret encrypted before DB storage;
- cTrader Open API app credentials and authorized **demo** account/access token/account ID;
- MT5 demo terminal/account plus authenticated Python/EA bridge endpoint/secret.

## Exact next safe starting point

1. Prepare a staging deployment/config runbook and migration verification checks; do not mutate production.
2. Apply `0001` and `0002` to staging Supabase only when staging credentials/access are available.
3. Configure staging Worker secrets and create one staging workspace/source/account with execution still non-live.
4. Enable `TRADING_V1_SIMULATION=true` in staging and run signed V1 end-to-end acceptance scenarios.
5. Then configure cTrader demo credentials and replace staging static simulation metadata with actual demo catalog/quotes for cTrader acceptance.
6. Configure MT5 demo bridge and run the same canonical scenario matrix.
7. Preserve the legacy Telegram path and keep real-money execution disabled until those demo gates pass.

## Mandatory progress update rule

After every meaningful implementation/testing batch, update this file with:

- branch / PR / merge state;
- what changed;
- test/build/provider verification evidence;
- migrations/config changes;
- remaining blockers;
- account-side setup still required;
- exact next safe starting point.
