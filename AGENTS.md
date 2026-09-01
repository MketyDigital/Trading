# Trading Project Agent Handoff

This file is the current operational source of truth for `MketyDigital/Trading`. Read it before changing the project.

## Repository intent

- Root-level `server.js`, root `wrangler.toml`, `patch_admin_api.js`, and the old root package are legacy/reference material.
- **All active next-generation work stays in `cloudflare-v2/`** unless a deliberate migration plan says otherwise.
- `trade.mkety.com` / this repository is the standalone enterprise Trading solution runtime.
- `app.mkety.com` / Mkety is the broader control plane for identity, billing, entitlement, provisioning, and revocation.
- Trading must remain independently deployable and integrate with Mkety through stable identity/entitlement contracts rather than hidden cross-repo coupling.

## Product architecture now approved

Mkety Trading is an enterprise/custom multi-tenant trading automation platform, not a Telegram-only copier.

The authoritative model is:

```text
Source Adapter
  -> authenticated/versioned Trading Event
  -> persistent idempotency
  -> normalization
  -> correlation / trade state
  -> deterministic parsing + bounded AI ambiguity resolution
  -> canonical trade intent / management event
  -> deterministic validation
  -> account risk + safety policy
  -> Position Group / child legs
  -> platform-specific translation
  -> destination/execution adapter
```

Telegram HTML is presentation output only. It must never be the machine-execution source of truth.

### Sources

The same versioned ingress contract must support, without core-code rewrites:

- Telegram MTProto Durable Object listeners;
- Telethon/Python VM listeners;
- TradingView/webhooks;
- MT5/bridge-originated events;
- REST/custom enterprise systems;
- future adapters.

### Destinations

The same canonical event/intent may fan out to:

- Telegram/manual-trader channels with per-destination formatting/branding;
- MT5;
- cTrader;
- Deriv product-specific adapters;
- generic signed webhooks/APIs;
- other Workers/services/custom enterprise destinations.

### Latency model

Human signal delivery and machine execution planning are parallel paths. Neither should wait unnecessarily for the other.

- For Telegram/manual delivery, AI may be preferred when configured and sufficiently fast because intelligent formatting is valuable. It must run inside a strict route latency budget and fall back immediately to deterministic formatting.
- Straightforward signals may bypass AI entirely.
- For machine execution, deterministic parsing is authoritative. AI may resolve ambiguous natural language only; AI-derived structure must pass deterministic schema/price/SL/TP/symbol/risk validation before it can become executable.

## Trade-state behavior required

- Fast signals are configurable per workspace/account/route: `execute_immediately`, `wait_for_complete_signal`, or `forward_only`.
- A fast first position may later become TP1/Leg 1 when the complete signal arrives; only missing legs should be created.
- Multi-TP signals are Position Groups with any number of TP legs, not a hard-coded three-TP limit.
- Risk is calculated for the entire intended trade first, then volume is divided across child legs while respecting broker minimum/maximum/step rules.
- Replies, thread IDs, edits, corrections, pending orders, cancel, close, partial close, break-even, SL/TP updates, and TP/SL-hit management must operate on evolving trade state rather than being parsed as unrelated fresh trades.
- Correlation is fail-closed. Reply/thread identity wins; symbol/side/time-window matching is fallback only. Ambiguous management targets require review rather than guessing.
- cTrader hedged and netted account semantics must remain distinct. Netted accounts cannot be modeled as independent physical positions for every TP.

## Normalization policy

Static symbol aliases are **seed hints only**, never the complete supported-market list.

Execution mapping must use the connected platform's actual catalog and metadata:

1. normalize source wording to canonical instrument intent;
2. load the broker/platform account's actual symbol catalog;
3. resolve canonical intent to the exact broker symbol/symbol ID;
4. use broker metadata for price precision, tick size, contract/lot economics, volume min/max/step, and execution capabilities;
5. translate the canonical action into platform-specific semantics;
6. fail closed when the symbol is missing or more than one candidate remains.

This is intended to cover forex, metals, indices, energy/commodities, crypto, synthetics, equities/CFDs, and future markets without enumerating every broker naming convention in source code.

## Active branch / PR

- Active isolated branch: `design/enterprise-trading-event-core`.
- Draft PR: **#2 — `feat: build enterprise trading event core foundation`**.
- `main` has not been changed by this work.
- `cloudflare-v2/src/index.js` remains intact as the legacy runtime implementation.
- `cloudflare-v2/wrangler.toml` on the design branch now enters through **`src/v1_entry.js`**, a thin compatibility wrapper. Every old route delegates to `index.js` unchanged unless an explicitly new V1 route/feature flag applies.
- Real-money execution remains disabled.

## Current implementation state — 2026-09-01

### Safe Worker integration / universal ingress

The new V1 core is integrated without rewriting the large legacy Worker:

- `src/v1_entry.js` is the branch Cloudflare entrypoint.
- Existing `/api/webhook/process_signal` still delegates to the legacy Worker by default.
- `TRADING_V1_SHADOW=true` runs canonical deterministic shadow interpretation beside the legacy signal request and only appends diagnostic `trace.v1_shadow` data. Shadow has `executionEnabled=false` and `actions=[]`; its failure cannot interrupt legacy Telegram forwarding/execution responses.
- New `POST /api/v1/events` bypasses the legacy Telegram-specific Worker and enters the universal authenticated event pipeline.
- Universal event ingress requires `X-Mkety-Source-Id`, `X-Mkety-Timestamp`, and `X-Mkety-Signature` over the exact raw request body.
- Source identity/workspace authority comes from the authenticated `source_connections` record, never from payload workspace fields.
- Persistent event reservation occurs before AI/interpretation so duplicates do not rerun expensive or money-moving work.
- Tenant AI providers are loaded only **after** source authentication establishes the trusted workspace.

### Event / ingress / security

- versioned universal Trading Event normalization, including reply/thread/edit metadata;
- HMAC-authenticated universal source payloads;
- authenticated-source-first workspace authority;
- persistent Supabase source/event stores;
- real Zitadel RS256 JWT verification including issuer, audience, exp/nbf, required Trading role, and organization/workspace binding;
- AES-256-GCM tenant secret envelopes (`v1` format) using a Worker-held master key;
- persistent event reservation before interpretation;
- workspace-aware AI provider factory with encrypted-credential preference and transitional legacy plaintext compatibility only for migration.

### Parsing / AI

- deterministic parser for common market/pending forms, LONG/SHORT aliases, side-before-symbol and concise symbol-before-side forms, entry ranges, SL, arbitrary TP lists, fast-entry messages, BE, close, close-half, and cancel-pending management;
- prose/filler wording such as conversational `buy around ...` fails to bounded AI rather than inventing a symbol;
- AI output is structured JSON and deterministically validated before execution eligibility;
- `UniversalAIRouter` respects `priority_rank`, accepts an injected credential resolver, receives env through the constructor, and supports caller-defined latency budgets;
- straightforward machine signals can avoid AI entirely;
- authenticated `/api/v1/events` can use tenant AI after workspace resolution; legacy shadow mode stays deterministic by default to avoid duplicating AI latency/cost.

### Normalization / broker metadata

- canonical symbol/order/price/volume normalization;
- seed aliases for common metals, indices, energy, crypto, and Deriv synthetic names;
- live catalog resolution that fails closed on ambiguity;
- MT5 symbol metadata normalization;
- cTrader account-specific symbol metadata normalization;
- Deriv active-symbol metadata normalization;
- entry-zone materialization policies for abstract price ranges.

Static aliases do not define market coverage. Actual connected-account symbol catalogs are authoritative.

### Critical cTrader volume correction

Current cTrader Open API metadata expresses `ProtoOASymbol.lotSize`, `minVolume`, `maxVolume`, `stepVolume`, and order volume in protocol cents.

The branch keeps raw `protocolLotSize` separate from human units and converts canonical lots directly against protocol lot size. **Do not reintroduce another `x100` conversion**; that can oversize orders by 100x.

### Risk / safety / Position Groups

- metadata-driven cross-market risk engine;
- adapter-supplied loss-per-lot support when simple tick math is not reliable;
- volume flooring so normalization never increases intended risk;
- rejection when broker minimum lot would exceed configured risk;
- Position Groups with arbitrary TP count and deterministic volume splitting;
- fast-entry promotion into TP1 with only missing legs created;
- BE/close/partial-close management action generation;
- account safety policy: enabled/disabled, kill switch, allowed symbols, max lots, max risk, daily-loss lock, open-risk/exposure lock;
- risk-reducing management may remain permitted under drawdown locks unless an explicit global kill switch blocks all actions;
- deterministic idempotency keys on planned broker actions.

### Correlation / state

- deterministic trade correlator prioritizes reply IDs and thread IDs;
- full signals can correlate to recent incomplete fast-entry groups by source + symbol + side + time window;
- ambiguous unthreaded management fails closed;
- Durable-Object-compatible trade-state foundations persist Position Group/source-event/broker-ID state;
- migration `0002_trade_correlation_and_account_policy.sql` contains correlation/account policy fields.

### cTrader

Implemented/tested foundations include:

- Open API JSON app/account auth;
- authenticated WebSocket session, heartbeat, timeouts/errors/close behavior;
- account metadata, access/account type, account-specific symbol catalogs, full symbol details, spot subscriptions, bid/ask quote cache;
- canonical order/management translation;
- persistent delivery idempotency;
- market and pending order handling;
- SL/TP amend, close/partial close, cancel pending;
- hedged/netted semantics foundation;
- **fill-safe market lifecycle:** the session now buffers unsolicited server execution events and supports bounded `waitForEvent(...)`; market execution distinguishes ORDER_ACCEPTED from ORDER_FILLED / ORDER_PARTIAL_FILL and does not apply absolute SL/TP or report protected success until a real position ID arrives from a fill event;
- disconnect rejects both request promises and event waiters so execution cannot hang silently.

The fill lifecycle correction is important: the first `ProtoOAExecutionEvent` for a market order may be `ORDER_ACCEPTED`, not a position-bearing fill.

### MT5

- Worker-side signed `mkety.mt5.v1` command envelope with workspace/account scope, command ID, issue/expiry timestamps, and HMAC;
- Python/EA bridge contract rather than pretending MT5 can run inside a Worker;
- broker symbol/lot/price translation;
- persistent idempotency foundations;
- pure Python bridge tests run in GitHub CI.

### Database migrations

- `0001_enterprise_trading_foundation.sql`: workspace Zitadel binding, `source_connections`, `trading_events`, Position Groups/legs, idempotent destination-delivery audit records.
- `0002_trade_correlation_and_account_policy.sql`: correlation state plus account execution/safety/fast-entry/entry-zone policy fields.

**No production/staging database migration has been applied automatically by this branch work.** Apply deliberately to a staging Supabase project first.

## CI / verification evidence

GitHub Actions is active for the branch/PR and runs:

1. Worker + Node trading-core tests;
2. pure MT5 Python bridge tests;
3. Wrangler dry-run.

Verified important checkpoints:

- PR run **33483562539** on head `ac1f35f8a71c85abc44b81789129904b3c73e593`: success after switching Cloudflare entry to the safe V1 wrapper.
- PR run **33483242592** on correlation head `edf009a1fe5a5c48cc45626f1d3a42b55229345f`: success.
- PR run **33484281245** on head `a67be3a1bc356e91d482080ca8844403c4fc386a`: **success** after cTrader accepted-vs-filled event buffering/wait logic and market-fill-before-protection correction. Worker/trading-core tests, pure MT5 bridge tests, and Wrangler dry-run all passed.

Earlier RED workflow runs associated with test-first commits are expected and must not be cited as final failures after the corresponding implementation head passes.

Always inspect the newest PR-head workflow before claiming the current branch is green.

## Provider verification notes

Current provider documentation checked during this work confirms:

- Cloudflare Durable Objects can make outbound WebSockets, but outbound WebSockets do not receive DO WebSocket Hibernation. Listener/session recovery must be explicit and persisted.
- Cloudflare Queues are at-least-once; queued trading work requires persistent idempotency. Avoid unnecessary queue hops on latency-critical paths.
- TradingView webhooks fit the universal HTTP ingress contract.
- MT5 `symbols_get()` / `symbol_info()` expose broker instrument/economic metadata needed for normalization/risk.
- cTrader symbol IDs are account/broker specific; JSON Open API uses its authenticated WebSocket lifecycle.
- cTrader execution events distinguish ORDER_ACCEPTED, ORDER_FILLED and ORDER_PARTIAL_FILL; market protection must wait for a position-bearing fill when necessary.
- cTrader spot prices arrive in relative units and require protocol decoding.
- Deriv `active_symbols` / `contracts_for` should drive product discovery; the legacy Deriv executor remains a short-duration CALL/PUT flow and must **not** be treated as a generic CFD copier.

## Production blockers remaining

The foundations above do **not** mean production live execution is enabled.

Remaining blockers, in current priority order:

1. **Admin authorization cutover:** intercept/protect legacy `/api/admin/*` through the already-tested Zitadel verifier, trusted workspace/org binding and Trading role/entitlement. The bearer-presence placeholder inside legacy `index.js` must not be considered secure.
2. **Apply migrations in staging Supabase** and create real source/workspace records with encrypted secrets. The `/api/v1/events` route depends on these tables/config when used outside tests.
3. **Universal orchestration after interpretation:** connect authenticated V1 events to trade correlation/state, account safety, risk plan, Position Groups and destination execution in simulation/shadow first. `/api/v1/events` currently authenticates/reserves/interprets/persists but does not yet authorize live broker commands.
4. **Trade State DO binding/config:** export/bind the trade-state Durable Object and add the next Wrangler migration only after its current state contract is integrated and CI remains green.
5. **cTrader demo session orchestration:** connect real encrypted app/account credentials -> session -> catalog/quotes -> canonical action -> idempotent executor; then run real demo orders/protection/close/pending/cancel/multi-leg/BE flows.
6. **MT5 demo bridge E2E:** configure a reachable demo Python/EA bridge and verify `order_check`, placement, SL/TP, multi-leg, BE/partial close, pending/cancel and retry/idempotency.
7. **MTProto listener migration/recovery:** sign and send universal V1 payloads while preserving backwards compatibility; verify reconnect/recovery under real Cloudflare DO lifecycle behavior.
8. **Destination formatting profiles:** move per-subscriber/per-destination Telegram/custom formatting to canonical output templates with bounded AI + deterministic fallback; legacy forwarding remains preserved until cutover.
9. **Deriv scope:** decide exact Options versus CFD/account API contract before replacing the legacy executor.
10. Only after demo verification may deliberately tiny controlled live tests be considered. Never use meaningful capital for verification.

## Account-side setup required for real adapter tests

Configure outside source control and do not paste secrets into chat/logs:

- Zitadel issuer, audience, Trading project role and organization mappings;
- `TRADING_MASTER_KEY` as a Cloudflare Worker secret;
- staging Supabase service credentials and migration application;
- cTrader Open API application credentials plus an authorized **demo** account/access token/account ID;
- MT5 demo terminal/account plus authenticated Python or EA bridge endpoint/secret;
- later internal DO/service authentication tokens as Worker secrets.

## Exact next safe starting point

1. Add wrapper-level Zitadel protection/workspace scoping for `/api/admin/*` while leaving legacy admin implementation behind the verified gate.
2. Add the V1 orchestration service that takes a persisted interpreted event through correlation -> account policy -> risk -> Position Group -> **simulation actions only**.
3. Bind/persist Trade State DO only after the orchestration tests define its use.
4. Apply migrations to staging Supabase and create staging workspace/source records.
5. Configure cTrader demo credentials and run actual demo execution acceptance tests; keep cTrader in today's verification scope.
6. Configure MT5 demo bridge and run the same canonical scenarios.
7. Preserve the legacy Telegram path until shadow comparisons prove the new pipeline; do not broad-refactor `src/index.js`.

## Mandatory progress update rule

After every meaningful implementation/testing batch, update this file with:

- branch / PR / merge state;
- what changed;
- test/build/provider verification evidence;
- migrations/config changes;
- remaining blockers;
- account-side setup still required;
- exact next safe starting point.
