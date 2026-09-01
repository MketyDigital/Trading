# Trading Project Agent Handoff

This file is the operational source of truth for `MketyDigital/Trading`. Read it before changing the project.

## Repository boundaries

- Active next-generation work stays in `cloudflare-v2/` unless a deliberate migration says otherwise.
- Root `server.js`, root `wrangler.toml`, `patch_admin_api.js`, and the old root package are legacy/reference material.
- `trade.mkety.com` / this repository is the standalone Trading runtime.
- `app.mkety.com` / Mkety is the identity, billing, entitlement, provisioning, and revocation control plane.
- `cloudflare-v2/src/index.js` is the preserved legacy Worker. Do not broad-refactor it while V1 is being proven.
- `cloudflare-v2/src/v1_entry.js` is the design-branch Cloudflare entrypoint and delegates legacy behavior except explicit V1 routes/shadow behavior.
- `main` is unchanged by this branch work.

## Product and architecture

Mkety Trading is an enterprise/custom multi-tenant trading automation platform, not a Telegram-only copier.

Authoritative machine flow:

```text
Source Adapter
  -> authenticated/versioned Trading Event
  -> persistent event idempotency
  -> deterministic normalization / bounded AI ambiguity resolution
  -> correlation + Trade State
  -> canonical intent / management event
  -> deterministic validation
  -> account safety + risk
  -> Position Group / arbitrary TP legs
  -> platform translation
  -> persistent destination idempotency
  -> destination / broker adapter
```

Human delivery/formatting is a parallel fast path. Telegram HTML or other rendered output is presentation only and must never become execution authority.

### Universal source/destination rule

The same V1 contract must accept Telegram MTProto/DO, Telethon/Python VM listeners, TradingView, MT5 bridges, REST/custom webhooks, and future adapters without rewriting the core. Canonical events may fan out to Telegram/manual outputs, MT5, cTrader, product-specific Deriv adapters, webhooks, Workers/services, and enterprise custom destinations.

### Normalization rule

Do not hard-code the platform around GOLD/XAUUSD or a fixed pair list. Static aliases are hints only. Connected-account broker catalogs/metadata are authoritative for symbol IDs/names, prefixes/suffixes, market availability, precision, tick economics, lot/volume units, order semantics, and account mode. Ambiguous/not-found resolution fails closed.

### AI latency rule

- Straightforward signals use deterministic processing and may bypass AI.
- Ambiguous language may use AI only inside a caller-defined latency budget.
- AI-derived structure must pass the same deterministic semantic/risk validation.
- A slow/failing AI provider must not block straightforward execution or customer output unnecessarily.
- Per-subscriber/per-destination formatting may use bounded AI with deterministic fallback.

## Mandatory trading safety

1. Real-money execution remains disabled until static simulation plus cTrader and MT5 demo acceptance are complete.
2. Never test live execution with meaningful capital.
3. Every event and destination/order requires persistent idempotency; in-memory dedupe is not authoritative.
4. Separate formatting/forwarding from trade authorization/execution.
5. Every account requires explicit execution enablement, symbol policy, max lot/risk, daily-loss/exposure controls, and kill switch before broker dispatch.
6. Fail closed on malformed/ambiguous AI, missing price, unsupported instrument, unavailable broker metadata, provider outage, ambiguous correlation, missing credentials, or unreliable risk economics.
7. Broker/source/provider secrets must never be returned to browsers, logged, or committed.
8. Preserve hedged vs netted semantics.
9. Protective/risk-reducing management may remain allowed under drawdown locks unless a global kill switch blocks all actions.
10. Do not replace the legacy Telegram route until V1 comparison and demo acceptance are satisfactory.

## Active branch / PR

- Branch: `design/enterprise-trading-event-core`
- Draft PR: **#2 — `feat: build enterprise trading event core foundation`**
- Wrangler entrypoint: `cloudflare-v2/src/v1_entry.js`
- Real-money execution: disabled

## Verified implementation state — 2026-09-01

### Worker compatibility / V1 APIs

- Legacy `POST /api/webhook/process_signal` remains authoritative by default.
- `TRADING_V1_SHADOW=true` adds side-effect-free canonical diagnostics only; shadow has no broker/destination actions and cannot interrupt legacy response.
- `POST /api/v1/events` is the universal signed V1 ingress.
- `GET /api/v1/health` is a non-secret readiness endpoint; GET-only, `no-store`, names/booleans only, and initializes no DB/AI/DO/broker client.
- `/api/v1/admin/*` uses the V1 Zitadel gate.
- legacy `/api/admin/*` is retired by the wrapper with `410 LEGACY_ADMIN_API_RETIRED`.

### Universal ingress / idempotency / secrets

Implemented/tested:

- exact raw-body HMAC using `X-Mkety-Source-Id`, `X-Mkety-Timestamp`, `X-Mkety-Signature`;
- authenticated source identity establishes trusted workspace/source authority;
- persistent `trading_events` reservation before interpretation;
- duplicates stop before AI/orchestration;
- reply/thread/edit metadata preserved;
- AES-256-GCM versioned secret envelopes with random IV via `src/security/secret_box.js`;
- source secrets decrypted only server-side;
- AI provider credentials support encrypted loading with legacy plaintext fallback only as migration compatibility.

### Parser / intelligence / normalization

Implemented/tested:

- market and pending signals;
- LONG/SHORT, side-before-symbol and concise symbol-before-side variants;
- entry ranges, SL, arbitrary TP lists;
- fast/incomplete entries;
- BE, close, partial close, cancel pending and management events;
- conversational/filler language routes to bounded AI instead of inventing symbols;
- impossible AI geometry fails closed;
- dynamic catalog normalization for MT5, cTrader and Deriv metadata;
- aliases/prefixes/suffixes resolved through actual catalog data;
- price/tick/volume normalization and entry-zone policies.

### Risk / Position Groups / account safety

Implemented/tested:

- fixed-lot and metadata-driven risk sizing;
- adapter-provided loss-per-lot for non-simple instruments;
- min/max/step flooring without silently increasing intended risk;
- safe rejection if risk-sized volume is below broker minimum;
- worst-case entry-range risk;
- current price required for MARKET/NOW sizing when entry price is absent;
- Position Groups with arbitrary TP count;
- deterministic lot split across legs;
- fast first position promotion to TP1 with only missing legs created;
- BE, protection, partial/full close generation;
- account enabled state, kill switch, symbol allowlist, max lots/risk, daily loss and exposure locks;
- deterministic action idempotency keys.

### Correlation / Trade State

Implemented/tested:

- reply and thread targeting;
- recent incomplete fast-entry completion by source + symbol + side + time window;
- ambiguous unthreaded management fails closed;
- persistent `TradeStateNode` Durable Object state;
- source-event IDs append idempotently;
- broker position/order IDs bind to canonical legs;
- closed groups excluded from active correlation but retained for audit.

Cloudflare binding:

```text
TRADE_STATE_NAMESPACE -> TradeStateNode
```

### Simulation-only orchestration

`src/pipeline/v1_orchestrator.js` composes interpretation -> correlation -> policy -> risk -> Position Group -> simulated actions.

- It imports no broker executor and has no broker dispatch dependency.
- Disabled/blocked/kill-switch accounts emit zero actions.
- `wait_for_complete_signal` emits no action for incomplete fast entries.
- matched/ambiguous correlation cannot create duplicate groups.
- `/api/v1/events` invokes it only when `TRADING_V1_SIMULATION=true`.
- static simulation market/exposure config is staging/shadow context only and never substitutes for broker metadata in demo/live execution.

### cTrader foundation and demo acceptance harness

Implemented/tested:

- JSON WebSocket endpoint and app -> account authentication;
- heartbeat, request correlation, timeouts, broker errors and socket-close failure;
- trader/account metadata, trading rights and account mode;
- account-specific symbol list/full metadata and live spot quotes;
- market, pending, amend SL/TP, close/partial close, cancel pending;
- persistent destination idempotency;
- hedged/netted foundations;
- demo-safe runtime defaults to demo; live requires explicit opt-in;
- demo probe resolves the real broker catalog symbol and first live quote;
- demo lifecycle opens a protected market trade, waits for the actual fill, exposes the actual fill price, moves SL to BE using that fill, partial-closes when broker volume step permits, and closes the exact remainder;
- lifecycle always closes its runtime in `finally` after post-open failure;
- persistent acceptance command uses the real `destination_deliveries` idempotency store scoped by Trading workspace and cTrader demo account;
- executable command: `npm run accept:ctrader:demo`;
- command output/error handling is sanitized and receives credentials only through runtime environment;
- default acceptance mode is `probe`; lifecycle requires `CTRADER_DEMO_ACCEPTANCE_MODE=lifecycle` **and** `CTRADER_DEMO_ORDER_TEST=true`.

Critical rules:

- cTrader `ProtoOASymbol.lotSize`, min/max/step volume and order volume are protocol-cent units. Keep raw `protocolLotSize`; **never add another x100 conversion**.
- `ORDER_ACCEPTED` is not a fill. Market execution waits for `ORDER_FILLED`/position-bearing event before applying absolute protection or reporting protected success.
- The acceptance command is hard-wired to the cTrader demo environment. Do not convert this harness into a live runner.

No real cTrader demo credentials have been configured through this work yet, and no actual cTrader demo order has been placed by this development session.

### MT5 foundation and demo acceptance harness

Implemented/tested:

- versioned signed `mkety.mt5.v1` bridge envelope;
- workspace/account/command/expiry scope;
- HMAC verification/replay rejection;
- Python/EA bridge architecture;
- canonical symbol/lot/price translation;
- persistent destination idempotency using `destination_deliveries` scoped by Trading workspace and MT5 demo account;
- pure Python bridge tests in CI;
- bridge execution results expose broker-confirmed `fill_price`, normalized by the Worker as `fillPrice` so BE never guesses from a pre-order quote;
- demo probe verifies bridge health, exact configured demo account and exact expected demo server before symbol/tick discovery;
- demo probe loads the terminal's actual symbol catalog, resolves broker aliases/prefixes/suffixes dynamically, and fetches the real tick;
- lifecycle is impossible without `MT5_DEMO_ORDER_TEST=true` and still requires the exact expected demo account/server match;
- lifecycle validates broker min/step volume, opens a protected market trade, moves SL to BE at the actual broker-confirmed fill, partial-closes, and closes the exact remainder;
- CLI defaults to probe-only and supports only `probe` / `lifecycle` modes; there is no live mode;
- command output/error handling is sanitized and receives bridge/Supabase credentials only through runtime environment;
- executable command: `npm run accept:mt5:demo`;
- default acceptance mode is `probe`; lifecycle requires `MT5_DEMO_ACCEPTANCE_MODE=lifecycle` **and** `MT5_DEMO_ORDER_TEST=true`.

No real MT5 demo terminal/bridge credentials have been configured through this work yet, and no actual MT5 demo order has been placed by this development session.

## Shared Supabase deployment decision — IMPORTANT

There is **no Supabase development branch**. The user explicitly requires using the existing free-tier Mkety Supabase project while keeping Trading isolated.

### Database boundary

Allowed Trading-owned schema:

- `public.trading_workspace_access`
- `public.source_connections`
- `public.trading_events`
- `public.position_groups`
- `public.position_legs`
- `public.destination_deliveries`
- additive V1 policy/index columns on the existing Trading-specific `public.trade_accounts`

Do **not** alter/drop/rewrite unrelated Mkety tables. In particular, V1 must not alter or depend on shared `public.workspaces` for Trading authorization. A Trading workspace UUID may mirror a Mkety workspace UUID, but `trading_workspace_access` is the V1 entitlement authority and there is deliberately no FK to shared `workspaces`.

### Database changes actually applied — 2026-09-01

The checked-in `0001` and `0002` schema changes were applied to the existing Supabase project under this isolation rule.

Verified database state after application:

- shared `public.workspaces` retained the exact pre-change 10-column schema, including order/default/nullability;
- all new V1 workspace FKs point to `trading_workspace_access`;
- RLS is enabled on all six new Trading-owned public tables;
- no anon/authenticated policies are created on them; service-role-only access is intentional;
- Supabase advisor-reported V1 FK indexes were added;
- reused `trade_accounts.workspace_id` is indexed;
- one `trading_workspace_access` row exists as the stable Trading identity, but `trading_access_enabled=false` and no Zitadel org is bound;
- `source_connections`, `trading_events`, `position_groups`, `position_legs`, `destination_deliveries`, and `trade_accounts` were empty at the verified database checkpoint.

Do not re-run or redesign the database from scratch. Inspect schema/history first. Do not create a paid/dev Supabase branch.

### Supabase advisor status

- New V1 tables: `RLS enabled, no policy` INFO is intentional for service-role-only internals.
- Missing FK indexes attributable to V1 were corrected.
- Newly created indexes may appear as `unused` until traffic exercises them.
- Existing unrelated warnings (for example public extension/security-definer/policies on other Mkety tables) predate this work and must not be changed from the Trading repo without a separate Mkety security task.

Current environment procedure: `cloudflare-v2/docs/STAGING_V1_RUNBOOK.md` (despite the historical filename, it now documents shared-Supabase isolated Trading acceptance).

## GitHub verification evidence

CI executes on `main`, `design/enterprise-trading-event-core`, and PR path changes:

1. Node Worker/trading-core tests;
2. pure MT5 bridge tests;
3. Wrangler dry-run.

Relevant verified GREEN checkpoints:

- `33484281245` — cTrader accepted-vs-filled lifecycle;
- `33484683645` — V1 admin Zitadel/workspace gate;
- `33484934076` — simulation orchestrator;
- `33485269429` — `/api/v1/events` simulation handoff;
- `33485665784` — readiness validator;
- `33485882224` — `/api/v1/health`;
- `33487857038` — Trading workspace isolation from shared Mkety `workspaces`;
- `33488433697` on head `01f3e3683eb92290ce80544bee963483187dc6a5` — final migration/index schema checkpoint;
- `33524593733` — persistent cTrader demo command dependencies;
- `33524857606` — sanitized executable cTrader demo command runner;
- `33525149642` on head `b9a0df968d526f4e952bc097d1faf1aaca508a73` — final cTrader demo package-command checkpoint: **Node Worker/core tests, pure MT5 bridge tests, and Wrangler dry-run all success**;
- `33526029652` — MT5 demo probe checkpoint;
- `33526411500` — MT5 protected-order / BE / partial-close / exact-remainder lifecycle checkpoint;
- `33526589705` — MT5 probe/lifecycle CLI dispatcher checkpoint;
- `33526882851` — persistent MT5 demo command dependency checkpoint;
- `33540733617` — sanitized MT5 demo command runner checkpoint;
- `33541021382` on head `f0d593c33b82e6c40fea9c6b940e5dfe987424d3` — final MT5 demo package-command checkpoint: **Node Worker/core tests, pure MT5 bridge tests, and Wrangler dry-run all success**.

Test-first RED runs are expected. Always inspect the newest branch/push run before claiming current green state because new commits trigger a later run.

## External configuration still required

No Cloudflare or Zitadel account connector is available in this session, so those settings have not been changed.

Required before signed V1 acceptance:

- Worker `SUPABASE_URL` / service-role secret;
- Worker `TRADING_MASTER_KEY` (32-byte base64url secret);
- Worker `TRADE_STATE_INTERNAL_TOKEN`;
- Zitadel issuer/audience/JWKS/project/role/org mapping;
- encrypted source HMAC secret stored only as ciphertext;
- explicit simulation instrument/price context;
- one restrictive non-live Trading account record.

Required for cTrader demo acceptance command:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `TRADING_WORKSPACE_ID`
- `CTRADER_CLIENT_ID`
- `CTRADER_CLIENT_SECRET`
- `CTRADER_ACCESS_TOKEN`
- `CTRADER_ACCOUNT_ID`
- optional `CTRADER_DEMO_SYMBOL`; defaults to `XAUUSD`
- lifecycle additionally requires `CTRADER_DEMO_ACCEPTANCE_MODE=lifecycle` and `CTRADER_DEMO_ORDER_TEST=true`.

Required for MT5 demo acceptance command:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `TRADING_WORKSPACE_ID`
- `MT5_BRIDGE_URL`
- `MT5_BRIDGE_SECRET`
- `MT5_ACCOUNT_ID`
- `MT5_EXPECTED_DEMO_SERVER`
- optional MT5 demo symbol/lot inputs supported by the acceptance harness;
- lifecycle additionally requires `MT5_DEMO_ACCEPTANCE_MODE=lifecycle` and `MT5_DEMO_ORDER_TEST=true`.

Do not paste these secret values into Git/chat/logs.

## Remaining blockers / priority order

1. Build/run the signed V1 simulation acceptance command against a configured non-live Worker so the real HTTP ingress, HMAC, persistent event idempotency, interpretation, correlation, risk/policy, Position Group and simulation actions are verified together with zero broker dispatch.
2. Configure Cloudflare Worker server-side secrets/bindings and Zitadel organization/role mapping.
3. Keep the existing Trading access row disabled until Zitadel authorization is verified.
4. Generate/store encrypted source credentials and create one active source connection.
5. Create one restrictive non-live trade account and run the signed `/api/v1/events` static simulation matrix.
6. Verify duplicate, replay, invalid signature, AI ambiguity, kill switch, fast-entry completion, reply/thread management, arbitrary TP count, risk and correlation against the real shared Supabase tables with zero broker dispatch.
7. Configure cTrader Open API app credentials + authorized **demo** account and run `npm run accept:ctrader:demo` first in probe mode, then the explicitly gated lifecycle mode.
8. Configure MT5 demo terminal + authenticated Python/EA bridge and run `npm run accept:mt5:demo` first in probe mode, then the explicitly gated lifecycle mode.
9. Migrate MTProto listener to signed V1 events while preserving legacy fallback/recovery behavior.
10. Add/verify per-customer destination formatting profiles with bounded AI and deterministic fallback.
11. Decide Deriv Options vs CFD/account API scope before replacing the legacy CALL/PUT executor.
12. Only after static simulation + cTrader demo + MT5 demo are green may deliberately tiny controlled live tests be considered.

## Exact next safe starting point

Because database schema is applied/inert and both cTrader and MT5 now have verified executable demo acceptance commands, do **not** redesign database schema or add more broker protocol abstraction first.

Next repo-side work while external broker secrets are unavailable:

1. keep CI green;
2. build the signed V1 simulation acceptance command around the existing `/api/v1/events` contract, with environment-only endpoint/source credentials and sanitized output;
3. verify a scenario matrix including normal signal, duplicate/replay, invalid signature, kill switch, fast-entry completion, reply/thread management and arbitrary TP count with zero broker dispatch;
4. keep cTrader/MT5 demo acceptance paths isolated from live execution;
5. once credentials are supplied outside chat, run real cTrader and MT5 demo E2E;
6. then return to listener migration, per-customer output profiles, and Deriv product-specific execution.

## Mandatory progress update rule

After every meaningful implementation/testing batch, update this file with:

- branch / PR / merge state;
- what changed;
- test/build/provider verification evidence;
- database/migration/config changes;
- remaining blockers;
- account-side setup still required;
- exact next safe starting point.
