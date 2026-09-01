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
- Existing `cloudflare-v2/src/index.js` live orchestration has intentionally **not** yet been switched to the new execution core.
- Real-money execution remains disabled.

## Current implementation state — 2026-09-01

The branch contains testable foundations for:

### Event / ingress / security

- versioned universal Trading Event normalization, including reply/thread/edit metadata;
- HMAC-authenticated universal source payloads;
- authenticated-source-first workspace authority: clients cannot choose another workspace through payload fields;
- AI router selection only after source authentication establishes the trusted workspace;
- persistent source/event interfaces and Supabase-backed stores;
- real Zitadel RS256 JWT verification including issuer, audience, exp/nbf, required Trading role, and organization/workspace binding;
- AES-256-GCM tenant secret envelopes (`v1` format) using a Worker-held master key;
- persistent event reservation before interpretation so duplicate retries do not rerun AI/execution.

### Parsing / AI

- deterministic parser for common market/pending forms, LONG/SHORT aliases, side-before-symbol and symbol-before-side forms, entry ranges, SL, arbitrary TP lists, fast-entry messages, BE, close, close-half, and cancel-pending management;
- conversational/ambiguous prose routes to bounded AI rather than being over-parsed;
- AI output is structured JSON and deterministically validated before execution eligibility;
- `UniversalAIRouter` now respects `priority_rank`, accepts an injected credential resolver, receives env through the constructor, and supports caller-defined latency budgets;
- AI/provider loading is workspace-aware only after authenticated source resolution.

### Normalization / broker metadata

- canonical symbol/order/price/volume normalization;
- seed aliases for common metals, indices, energy, crypto, and Deriv synthetic names;
- live catalog resolution that fails closed on ambiguity;
- MT5 symbol metadata normalization;
- cTrader account-specific symbol metadata normalization;
- Deriv active-symbol metadata normalization;
- entry-zone materialization policies for abstract price ranges.

### Critical cTrader volume correction

Current cTrader Open API metadata expresses `ProtoOASymbol.lotSize`, `minVolume`, `maxVolume`, `stepVolume`, and order volume in protocol cents.

The branch now keeps raw `protocolLotSize` separate from human units and converts canonical lots directly against the protocol lot size. Do **not** reintroduce an additional `x100` conversion; that can oversize orders by 100x.

### Risk / safety / Position Groups

- metadata-driven cross-market risk engine;
- adapter-supplied loss-per-lot support for instruments where simple tick math is not reliable;
- safe volume floors so sizing never increases intended risk;
- rejection when the broker minimum lot would exceed configured risk;
- Position Groups with arbitrary TP count and deterministic volume splitting;
- fast-entry promotion into TP1 with only missing legs created;
- BE/close/partial-close management action generation;
- account safety policy: enabled/disabled, kill switch, allowed symbols, max lots, max risk, daily-loss lock, open-risk/exposure lock;
- risk-reducing management remains permitted under drawdown locks unless an explicit global kill switch blocks all actions;
- execution planning returns `READY` or `BLOCKED` before adapter translation and emits deterministic idempotency keys.

### cTrader

- real Open API JSON message builders for app auth, account auth, new order, cancel, amend SL/TP, close/partial close, trader metadata, symbol list/details, spot subscriptions, and quote decoding;
- WebSocket session abstraction with application/account auth, request correlation, heartbeat, timeout/error/close handling;
- account metadata and market-data service with account type/access, broker-specific symbol IDs/details, bid/ask quote cache, BUY=ask and SELL=bid;
- market-order protection sequence uses the returned position ID before applying absolute SL/TP;
- pending-order protection and management commands;
- idempotent cTrader execution client foundations.

### MT5

- Worker-side signed `mkety.mt5.v1` command envelope with workspace/account scope, command ID, issue/expiry timestamps, and HMAC;
- Python/EA bridge contract rather than pretending MT5 can run inside a Worker;
- broker symbol/lot/price translation;
- idempotent MT5 execution client foundations;
- pure Python bridge tests run in CI.

### Persistence / correlation

- migration `0001_enterprise_trading_foundation.sql` adds workspace Zitadel bindings, source connections, trading events, Position Groups/legs, and idempotent destination delivery audit records;
- migration `0002_trade_correlation_and_account_policy.sql` adds source/thread correlation state plus account execution/safety/fast-entry/entry-zone policy fields;
- Supabase delivery store implements persistent broker-command reservation/completion/failure against unique workspace/idempotency keys;
- deterministic trade correlator prioritizes replies/thread IDs and handles fast-entry completion safely;
- Durable-Object-compatible trade state store/coordinator persists groups, source event IDs, broker IDs, leg state, and status;
- internally authenticated Trade State Node API exists for durable coordination.

### Shadow path

- canonical shadow interpretation exists and is constructed so it cannot emit broker actions;
- this is the intended first live integration beside the legacy Telegram path before execution cutover.

## CI / verification evidence

GitHub Actions is now active for the branch/PR.

- Verified successful PR run: **33483691837**, head `ddecf44504ff13b681f3874ecc2f2ebd3c1ee30a`, completed 2026-09-01.
- Earlier verified successful run: **33483045111**; Worker/trading-core tests, pure MT5 bridge tests, and Wrangler dry-run all passed.
- CI was changed to run feature/design branches through the PR only while `main` verifies on push, avoiding duplicate branch+PR runs and reducing Actions usage.
- Newer commits after a recorded green head must still be treated as unverified until their latest PR run completes successfully.

Do not claim the current branch head is green merely because an older run passed; always inspect the newest PR-head workflow.

## Provider verification notes

Current provider documentation checked during this work confirms:

- Cloudflare Durable Objects can make outbound WebSockets, but outbound WebSockets do not receive DO WebSocket Hibernation. Listener/session recovery must be explicit and persisted.
- Cloudflare Queues are at-least-once; any queued trading work requires idempotency. Avoid unnecessary queue hops on latency-critical execution paths.
- TradingView webhooks fit the universal HTTP ingress contract.
- MT5 `symbols_get()` / `symbol_info()` expose broker instrument/economic metadata needed for normalization and risk.
- cTrader symbol IDs are account/broker specific and full metadata must be discovered from the authenticated account. JSON uses the Open API JSON endpoint/port and trading requires application then account authentication.
- cTrader spot prices arrive in relative units and must be decoded per the current Open API contract.
- Deriv `active_symbols` / `contracts_for` should drive product discovery; the legacy Deriv executor in `src/executors/trade_executors.js` is a short-duration CALL/PUT flow and must **not** be treated as a generic CFD copier.

## Current production blockers

The foundations above do **not** mean production live execution is enabled.

Remaining blockers:

1. Safely integrate the new canonical/shadow ingress into `cloudflare-v2/src/index.js` without breaking the existing Telegram route. The file is large; do not reconstruct or broadly refactor it without exact full-file access and regression tests.
2. Export/bind the Trade State Durable Object in the Worker/Wrangler config and add the next Cloudflare DO migration only after the integration can be edited safely.
3. Replace the current admin bearer-presence placeholder in `index.js` with the already-tested Zitadel verifier and enforce workspace scoping on every admin route.
4. Apply/verify DB migrations in the actual Supabase project; no production migration has been applied by this branch work yet.
5. Wire encrypted credential resolution to real tenant source/AI/broker configuration; do not store plaintext secrets.
6. Add/verify safe configuration/health endpoints that expose readiness but never secret values.
7. Verify MTProto listener reconnect/recovery under actual Cloudflare DO lifecycle behavior.
8. Run cTrader end-to-end against an authorized demo account using real account symbols/quotes/orders/protection/close flows.
9. Run MT5 end-to-end against a demo terminal/bridge, including `order_check`, order placement, SL/TP, multi-leg execution, BE/partial close, pending/cancel, and idempotent retries.
10. Decide the exact Deriv product/API scope (Options versus CFD/account path) and implement only the verified contract.
11. Only after demo verification may deliberately tiny controlled live tests be considered. Never use meaningful capital for verification.

## Account-side setup still required

For real adapter testing, configure outside source control:

- Zitadel issuer/audience, Trading project role, and workspace organization mappings;
- Cloudflare Worker secrets for the tenant secret master key/internal service tokens;
- Supabase production/staging connection and migration application;
- cTrader Open API application credentials plus an authorized **demo** account/access token/account ID;
- MT5 demo terminal/account plus the authenticated Python or EA bridge endpoint/secret;
- no live broker, AI, Telegram, or source secret may be committed or pasted into logs/browser responses.

## Exact next safe starting point

1. Check the latest PR-head CI. Fix any failure before feature work.
2. Integrate the canonical pipeline into `index.js` in **shadow/simulation mode first**, preserving existing Telegram behavior and preventing new broker calls.
3. Bind Trade State DO only after its current tests and Wrangler dry-run are green.
4. Replace admin auth placeholder with tested Zitadel/workspace enforcement.
5. Apply migrations to a staging Supabase project.
6. Configure cTrader and MT5 **demo** credentials/bridges and run real execution acceptance tests.
7. Keep Deriv live execution out of scope until its product/API contract is explicitly chosen and verified.

## Mandatory progress update rule

After every meaningful implementation/testing batch, update this file with:

- branch / PR / merge state;
- what changed;
- test/build/provider verification evidence;
- migrations/config changes;
- remaining blockers;
- account-side setup still required;
- exact next safe starting point.
