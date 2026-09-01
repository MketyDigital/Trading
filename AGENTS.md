# Trading Project Agent Handoff

This file is the current operational source of truth for `MketyDigital/Trading`. Read it before changing the project. The immediate goal is to finish and production-harden the existing Cloudflare-v2 trading/copier system before starting the broader MkSaaS upgrade in `MketyDigital/Mkety`.

## Repository intent

The repository contains two generations of work:

- Root-level `server.js`, `wrangler.toml`, `patch_admin_api.js`, and the old root package are legacy/reference material.
- **`cloudflare-v2/` is the intended active next-generation project.** New work should stay there unless a deliberate migration plan says otherwise.

The current architecture aims to run the copier/signal/VIP stack without a VPS using Cloudflare Workers, Durable Objects, Supabase/PostgreSQL, Telegram APIs/MTProto, AI provider APIs, and broker/platform adapters.

## Intended system components

### 1. Core Worker — `cloudflare-v2/src/index.js`

Responsibilities currently include:

- Telegram Bot webhook routing.
- Signal-processing webhook from the MTProto listener.
- Durable Object listener-control proxying.
- Admin/data APIs.
- Signal route lookup and deduplication.
- AI provider loading and signal transformation.
- Per-destination branding/formatting.
- Telegram forwarding and trade-executor dispatch.
- VIP subscription cron entry point.
- HTML dashboard rendering through `dashboard.js`.

This file is currently large and contains several responsibilities. Harden behavior first; do not refactor broadly until tests cover the critical flows.

### 2. MTProto listener Durable Object — `src/listener/listener_node.js`

Current intent:

- store Telegram MTProto state/session in Durable Object storage;
- connect with `@mtcute/web`;
- listen to configured Telegram messages;
- POST raw messages to the main `/api/webhook/process_signal` router;
- expose `/start`, `/send_code`, `/stop`, and `/status` controls through the Durable Object stub.

The Worker binding is declared as:

```text
MTPROTO_LISTENER_NAMESPACE → MTProtoListenerNode
```

and the current cron is every 15 minutes.

Before production use, verify the listener lifecycle against current Cloudflare Durable Object/socket behavior under real idle/resume/restart conditions. Do not assume a long-lived Telegram session is reliable merely because the constructor reconnects.

### 3. Universal AI router — `src/ai/universal_ai.js`

Current intent:

- priority-based provider cascade;
- 12-second provider timeout;
- Gemini support;
- OpenAI-compatible support for OpenAI/DeepSeek/Groq/custom endpoints;
- Workers AI adapter;
- cleanup of generated Telegram HTML.

Known correctness gaps to resolve before production:

- `UniversalAIRouter` expects provider credentials as `api_key_encrypted`, while the checked-in schema currently defines `ai_providers.api_key`.
- the Workers AI adapter references `env.CLOUDFLARE_ACCOUNT_ID` from a scope where `env` is not currently supplied to the class.
- provider-secret encryption/decryption is not actually implemented despite field names implying encryption.
- AI output must never be allowed to place a real trade without deterministic validation of action, symbol, side, price/SL/TP semantics, and account-specific risk rules.

### 4. Trade executors — `src/executors/trade_executors.js`

Current modules:

- Telegram VIP forwarder.
- Deriv executor.
- cTrader executor.
- MT5 webhook executor.

Important current limitations:

- the Deriv implementation is presently a short-duration `CALL`/`PUT` proposal/buy flow using stake-style contracts. It is not yet a verified general CFD copier and must not be described as one.
- the cTrader implementation is a simplified HTTP-shaped request and is not yet a verified implementation of cTrader Open API's actual authenticated Protobuf/WebSocket lifecycle.
- MT5 depends on an external webhook/EA bridge and therefore is not truly zero-external-runtime unless that bridge is separately hosted and secured.
- trade-account secrets in the current schema need a real encryption/key-management design before production real-money accounts are stored.

Real-money execution must remain disabled until these adapters have broker-specific integration tests and safety controls.

### 5. VIP manager — `src/vip/vip_manager.js`

Current capabilities include:

- Telegram Bot commands;
- 3-day trial flow;
- one-use invite links;
- manual receipt upload and admin approval buttons;
- Telegram Stars/invoice-related code;
- expiry cron/kick lifecycle.

Known issues to resolve before production:

- `handleWebhookUpdate` checks generic `update.message` before the `successful_payment` case, so successful-payment handling needs to be audited/fixed to ensure it can actually execute.
- manual admin approval callbacks must verify that the callback is genuinely from the configured admin/verification context before changing payment/subscription state.
- sample/hard-coded bank/payment copy must be replaced by tenant/workspace configuration rather than product code.
- billing amounts/plans must come from configuration/database and not assumptions embedded in message handlers.
- Telegram webhook authenticity/secret-token strategy should be added rather than trusting possession of a URL containing a bot token.

### 6. Database — `cloudflare-v2/db/schema.sql`

Current tables:

- `workspaces`
- `listener_nodes`
- `ai_providers`
- `signal_routes`
- `trade_accounts`
- `vip_members`
- `bank_deposits`
- `signal_logs`

The current schema is a single bootstrap SQL file, not a production migration history.

Before production:

- introduce numbered/checksummed migrations rather than repeatedly editing one schema file;
- decide whether Trading owns its own PostgreSQL/Supabase project or shares any data contracts with MkSaaS;
- implement proper tenant isolation;
- enable and verify RLS if browser-accessible Supabase credentials will ever be used;
- avoid storing raw Telegram API hashes, sessions, AI keys, bot tokens, or broker tokens in plaintext database columns;
- use server/service credentials only in Worker secrets and/or envelope encryption for tenant-managed secrets.

### 7. Admin/auth

The architecture documents describe Zitadel/OIDC protection for `trade.mkety.com`, but the current Worker only checks for the presence of a Bearer token when `ZITADEL_JWKS_URL` is configured. The source explicitly leaves cryptographic JWT/JWKS validation as a future step.

This is a **production blocker**. Before any admin API is exposed:

- verify JWT signature;
- validate issuer, audience, expiry/not-before;
- extract the authenticated tenant/workspace from trusted claims/server mapping;
- enforce workspace scoping on every admin query/write;
- enforce the required entitlement/role for Trading/copy access;
- never accept an arbitrary `workspace_id` from the browser as authority by itself.

The current `/api/admin/data/workspaces` path can list/update workspace data and must not be treated as secure until this is fixed.

## Current Cloudflare configuration

`cloudflare-v2/wrangler.toml` currently declares:

```text
name = mkety-copier-engine
main = src/index.js
nodejs_compat
MTPROTO_LISTENER_NAMESPACE Durable Object
v1 Durable Object SQLite migration
*/15 * * * * cron
```

The compatibility date is currently old relative to the 2026 project work and should be deliberately refreshed only after tests prove the application against the new date.

The project should continue to prefer included/free-tier capabilities whenever usage remains inside provider limits. The owner has upgraded Workers to a paid plan for capacity/safety margin; do not introduce paid-only dependencies merely because the account is paid. Correctness and portability come first, then scale based on measured usage.

## Current package/tooling state

`cloudflare-v2/package.json` now has a Node test command on the active design branch. A repository CI workflow has also been added on that branch, but GitHub Actions did not automatically run for the API-created commits during the current session, so do not claim CI verification from that alone.

Dependencies remain primarily `@mtcute/web`, `@supabase/supabase-js`, and Wrangler.

## Documentation caveat

Existing documents under `cloudflare-v2/` are useful architecture intent, but several statements are aspirational and must not be treated as verified production behavior. Examples include claims that every old fail-safe is preserved, that cTrader/Deriv execution is complete, and that Zitadel JWT verification exists. Always verify the actual source and provider documentation.

The root `README.md` is stale AI-Studio boilerplate and is not the source of truth for the Trading platform.

## Safety rules for the completion pass

1. Never test production order execution with meaningful real capital.
2. Build deterministic parser/validation and simulation modes before live execution.
3. Require idempotency keys/durable dedupe for every signal-to-order path.
4. Separate “signal formatting/forwarding” from “trade authorization/execution.” A message being valid to post on Telegram does not automatically make it valid to place a trade.
5. Every account must have explicit enable/disable, allowed symbols, max lot/risk, max daily loss/exposure, and kill-switch semantics before live copying.
6. Broker credentials/tokens are secrets and must never appear in browser responses, logs, or committed configuration.
7. Admin authentication and workspace scoping must be fixed before exposing configuration APIs.
8. Do not rely on warm-isolate memory as the only safety lock. Persistent idempotency must remain authoritative.
9. Fail closed on malformed AI output, ambiguous symbols, missing prices, unsupported instruments, or provider outages.
10. Keep the Trading repo independent from the later MkSaaS repo upgrade. Define integration contracts first; do not create hidden cross-repo coupling.

## Recommended completion sequence

### Phase 1 — production foundation

- add a real test runner and GitHub CI;
- inventory all env vars/secrets and create an authoritative environment reference;
- implement verified admin auth/JWT + workspace isolation;
- create migration tooling/history;
- correct schema/code naming mismatches and secret handling;
- add health/config validation endpoints that expose no secrets.

### Phase 2 — signal pipeline correctness

- formalize normalized signal schema;
- add deterministic parser/validator around AI output;
- make persistent dedupe/idempotency authoritative;
- verify per-destination formatting without changing parsed trade semantics;
- test Telegram listener → router → Telegram forwarder end-to-end in simulation.

### Phase 3 — broker execution adapters

Treat each adapter independently with its own tests and provider contract:

1. Deriv: decide exact products/API path required (Options vs CFDs) and implement only that verified contract.
2. cTrader: implement the actual Open API auth/account/application/JSON or Protobuf/WebSocket flow.
3. MT5: define the bridge protocol, authentication, replay/idempotency protection, and hosting ownership.

No adapter is production-live until simulation and deliberately tiny controlled execution tests pass.

### Phase 4 — VIP/subscription lifecycle

- fix webhook/update routing;
- secure admin callbacks;
- externalize plans/prices/payment details;
- verify Stars/manual payment lifecycle;
- verify invite, expiry warning, kick/unban behavior;
- add idempotent payment/subscription state transitions.

### Phase 5 — deployment/load/resilience

- refresh Cloudflare compatibility date;
- verify Durable Object listener recovery/hibernation behavior;
- measure Worker CPU/subrequests/WebSocket/DO/database usage;
- keep free/included paths where usage permits;
- use paid-plan headroom only when actually needed;
- perform controlled production shadow/simulation testing before live copying.

## Relationship to MkSaaS

The intended product relationship is:

- `trade.mkety.com` / this repository: standalone Trading execution/signal/VIP solution runtime.
- `app.mkety.com` / Mkety SaaS: control plane for identity, enterprise entitlement, provisioning, billing and access revocation.

Trading must remain independently deployable. Mkety access should be provisioned/revoked through stable Zitadel/entitlement contracts rather than requiring Trading code changes for each customer.

## Enterprise Trading Event Core decision — 2026-09-01

### Product direction

Mkety Trading is an enterprise/custom multi-tenant trading automation product, not a Telegram-only copier. The system must accept versioned authenticated trading-event payloads from interchangeable sources such as Telegram MTProto Durable Objects, Telethon/Python VM listeners, TradingView webhooks, MT5/bridges, REST/webhooks and future custom adapters. It must also dispatch to interchangeable destinations including Telegram, generic authenticated webhooks, MT5, cTrader, Deriv product-specific adapters, other Workers/services and enterprise custom integrations.

The authoritative internal model is `Trading Event -> correlation/state -> canonical intent/management event -> deterministic validation -> risk/policy -> execution commands`. Telegram HTML is presentation output and never the machine-execution source of truth.

### Latency model

Telegram/manual-trader delivery and machine execution planning are parallel paths. AI remains available for intelligent destination formatting when it improves the requested output and can satisfy the route latency budget; deterministic formatting is the immediate fallback. For machine execution, deterministic parsing/normalization is authoritative and AI may resolve ambiguity only before deterministic validation.

### Trade-state behavior

- Fast signals are configurable per workspace/route/account: `execute_immediately`, `wait_for_complete_signal`, or `forward_only`.
- A fast position may later be reconciled into Leg 1/TP1 of a complete multi-TP Position Group; only missing legs are created.
- Replies, threads, message edits, corrections, pending orders, cancel, close, partial close, BE, SL/TP updates and TP/SL-hit management events target evolving trade state rather than being treated as unrelated new trades.
- Multi-TP trades are Position Groups with independently managed legs.
- Risk is calculated for the total allowed trade first, then volume is split deterministically across TP legs while respecting platform volume constraints.

## Implementation progress — 2026-09-01

### Branch / state

- Active isolated branch: `design/enterprise-trading-event-core`.
- Branch was verified earlier as ahead of `main` and not behind it; re-check before PR/merge.
- Existing live Worker orchestration in `cloudflare-v2/src/index.js` has intentionally **not** been switched to the new execution core yet.
- No real-money execution has been enabled.

### Added and verified in isolation

The design branch now contains independently testable modules for:

- versioned universal Trading Event normalization;
- deterministic machine-signal parsing for straightforward market/pending signals and management commands;
- Position Groups and multi-TP leg allocation;
- fast-entry reconciliation where the existing first position is promoted to TP1 and only missing TP legs are opened;
- BE/close/partial-close management action generation;
- cTrader application/account/new-order JSON protocol message builders;
- platform-neutral symbol/order/price/volume normalization;
- broker symbol catalog resolution with fail-closed ambiguous matching;
- normalized catalog adapters for MT5 `symbols_get`/`symbol_info` metadata, cTrader account symbol metadata, and Deriv `active_symbols` metadata;
- canonical action translation into MT5 broker-specific commands and cTrader protocol semantics;
- metadata-driven risk sizing that supports both tick-value calculations and adapter-computed loss-per-lot models.

### Normalization policy

Static aliases are seed hints only. The execution system must **not** attempt to enumerate every broker symbol in source code.

Authoritative execution mapping is based on a connected account/platform symbol catalog:

1. normalize human/source wording to a canonical instrument intent;
2. load the connected broker/platform's actual symbols and trading metadata;
3. resolve canonical intent to the actual broker symbol / symbol ID;
4. normalize price precision/tick size and volume constraints from that metadata;
5. translate the canonical command to platform-specific execution semantics;
6. fail closed if no symbol exists or multiple valid symbols remain ambiguous.

This is intended to cover forex, metals, indices, commodities/energy, crypto, synthetic indices, equities/CFDs and future markets without hard-coding every broker naming convention.

### Provider research evidence checked 2026-09-01

- MT5 Python `symbols_get()` exposes the terminal's available instruments; `symbol_info()` exposes fields including tick size, contract size and volume min/max/step. Use these rather than assuming forex conventions.
- cTrader Open API exposes account-specific symbol lists and symbol metadata. cTrader documentation explicitly notes symbol IDs can differ between servers/brokers. JSON and Protobuf use separate Open API ports; account/application authentication is required before trading.
- Deriv `active_symbols` exposes currently available underlyings and `contracts_for` exposes contracts available for a symbol. Current Deriv API naming includes `underlying_symbol`, `underlying_symbol_name`, `underlying_symbol_type` and `pip_size`; new synthetic symbols can appear without core code changes when catalog discovery is used.
- Deriv added additional synthetic families in 2026 including Volatility 15/30/90 (1s), reinforcing the decision not to freeze supported markets to a short static list.

### Test evidence

Test-first verification was performed for the newly added normalization/execution pieces in isolated Node harnesses during this session:

- broker-catalog symbol resolution: exact aliases/suffixes resolve; ambiguous matches fail closed;
- MT5/cTrader/Deriv symbol-catalog normalization;
- MT5 and cTrader platform translation from the same canonical action;
- risk sizing from tick metadata and adapter-computed loss models;
- fail-closed behavior when a reliable risk/loss model is unavailable.

Earlier on this branch, the event/parser/Position Group/cTrader contract test batches were reported green before the current normalization extension. Before merge, run the complete repository test command and Wrangler dry-run again from an actual checkout/CI environment; do not rely only on isolated harness evidence.

### Migrations / config

- No production DB migration has been applied yet.
- No production Worker secret/config has been changed yet.
- GitHub CI workflow exists on the branch, but API-created commits did not trigger a workflow run in-session; normal PR/push CI must be observed before merge.

### Remaining production blockers

- integrate the new core behind `index.js` without breaking current Telegram behavior;
- persistent event idempotency and source authentication;
- Zitadel JWT verification and enterprise entitlement mapping/revocation;
- database migrations and secret handling;
- source correlation/Trade State Durable Object persistence;
- live broker symbol-catalog fetching rather than fixture metadata;
- actual cTrader authenticated WebSocket session lifecycle;
- authenticated MT5 EA/Python bridge and platform-side order checks;
- account safety policy: allowed symbols, max risk, max exposure/daily loss and kill switch;
- demo-account end-to-end tests, followed only by deliberately tiny controlled live tests.

### Account-side setup still required for real adapter tests

- cTrader Open API application credentials and an authorized demo trading account/access token.
- an MT5 demo terminal/account with the selected authenticated EA or Python bridge reachable by the Trading Worker.
- do not store or commit those credentials in Git.

## Exact next safe starting point

Continue on `design/enterprise-trading-event-core` by adding the account safety/risk policy contract and adapter session boundaries, then wire the canonical pipeline into `index.js` in simulation/shadow mode first. cTrader remains in the current verification scope. Do not enable real orders until the complete test suite, source auth/idempotency, entitlement enforcement and demo execution path are green.

Every meaningful implementation/testing batch must update this file with:

- branch/PR/merge state;
- what changed;
- tests/build/provider verification evidence;
- migrations/config changes;
- remaining blockers;
- account-side setup still required;
- exact next safe starting point.
