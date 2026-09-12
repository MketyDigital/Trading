# DB-First Ingress, Cross-Broker Symbols, and Outbound MT5 Design

## Goal
Make Mkety Trading accept one authenticated Telegram transport that forwards all visible messages and let Mkety select matching customer sources from persisted database configuration; make dynamic customer/account configuration database-authoritative across the system; make broker-symbol resolution catalog-driven for every supported broker/platform; and replace the inbound/public-HTTPS MT5 bridge requirement with an outbound paired MT5 connector.

## Non-negotiable architecture

- The existing Mkety Worker remains the single authoritative orchestration/execution system.
- Customer-specific or workspace-specific configuration belongs in Supabase unless the value is an unavoidable local/runtime bootstrap secret.
- Deployment environment variables are reserved for platform bootstrap secrets and infrastructure credentials such as `TRADING_MASTER_KEY`, Supabase service credentials, cBot gateway signing/control keys, and provider/deployment credentials that cannot bootstrap from the DB safely.
- Telegram transport authentication is never removed. A shared Mkety listener authenticates once as a collector; customer source selection happens after transport authentication from persisted source/chat configuration.
- Existing source-specific external MTProto endpoints remain supported for backwards compatibility.
- Broker execution continues to use the current deterministic canonical trade model. Human-formatted or AI-generated text is never the final broker execution contract.
- One cTrader cBot instance binds to one broker account, not one pair. Symbol/timeframe selected by cTrader when starting a cBot is host-instance context only.
- Symbol resolution is broker/platform agnostic. cTrader and MT5 adapters resolve canonical/alias symbols against the actual catalog published by the connected account. No Deriv-only or broker-only logic.
- Existing Mkety owner execution-switch state is preserved. Deployment verification may report the state but must not change it or require a specific ON/OFF value merely for deployment.
- No customer VPS requirement is introduced.

## 1. Shared authenticated Telegram collector

Add a DB-backed collector identity table. Each collector has an ID/name, token hash, active state, optional metadata/account scope, and timestamps. The plaintext token is shown only at creation/rotation time and is not stored.

Add `POST /api/v1/external/mtproto/collect` and token-in-path compatibility `POST /api/v1/external/mtproto/collect/:token`. The endpoint:

1. authenticates the collector token against the DB;
2. extracts Telegram native identity (`chat_id`, `message_id`) from the payload;
3. queries enabled `external_mtproto` sources whose persisted policy matches the chat ID;
4. for each matching source, builds the existing signed source-bound `/api/v1/events` request and invokes the existing V1 event handler;
5. preserves source/workspace isolation and existing replay/idempotency semantics;
6. returns 202 with `matchedSources: 0` for authenticated but unselected chats rather than 401/404;
7. rejects unauthenticated collectors before source lookup or parsing.

The listener may therefore forward every visible Telegram message once. Customer changes to `allowed_chat_ids` or source enablement take effect from DB state without restarting the listener.

## 2. Configuration ownership audit

Dynamic values that must be database-authoritative:

- source selection and chat IDs;
- source roles/policies and health state;
- customer broker account IDs and broker/server/environment;
- cTrader/MT5 connection state and encrypted connection credentials;
- account roles;
- symbol catalogs, aliases and last-refresh timestamps;
- routes and destination bindings;
- formatting templates and presentation settings;
- risk/lot/safety policies;
- workspace/customer settings;
- customer provider credentials that the Worker can decrypt from DB;
- connector pairing/revocation/reconnect state.

Values that remain environment/bootstrap configuration:

- `TRADING_MASTER_KEY`;
- Supabase URL/service credential needed to open the DB;
- Cloudflare/deployment credentials;
- cBot shared gateway signing/control secrets;
- infrastructure host/port values that exist before DB access and are not customer-specific;
- optional provider application credentials where the external provider requires one Mkety-wide application identity (for example cTrader Open API app credentials).

Tests must lock this boundary and prevent new customer-specific values from becoming required deployment variables.

## 3. Broker symbol catalog and resolution

Extend the existing catalog-first execution model so every connected execution adapter can publish/refresh its actual account symbol catalog.

Persist a safe catalog snapshot per trade account in `provider_config` or a dedicated table if size/indexing requires it. A catalog row/snapshot includes safe fields needed for resolution/execution, e.g. platform symbol, display/description, base/quote or normalized key when available, min/max/step volume, tick size/value metadata when available, and active/tradable state. Never persist broker secrets in symbol metadata.

Resolution order:

1. exact platform symbol;
2. exact normalized canonical key;
3. explicitly persisted workspace/account alias;
4. unique normalized catalog match (including suffix/prefix normalization already supported by the resolver);
5. otherwise fail closed as ambiguous/not found.

The resolver never guesses between multiple valid symbols.

This applies to all brokers on cTrader and MT5, including brokers exposing synthetic/derived indices, suffixes, prefixes or non-FX symbols. A symbol works only when the connected broker account actually advertises/trades it.

## 4. cTrader cBot account behavior

The cBot remains one instance per account. On authentication and periodic refresh it publishes a bounded symbol catalog for the account. The gateway stores the current session catalog and exposes it to the Worker/control plane; Mkety persists the safe catalog snapshot/refresh timestamp on sync or refresh.

The cBot receives an execution command containing the resolved platform symbol. It still validates Mkety account row ID, actual broker account number, expiry and replay before execution.

Frontend wording must explain that cTrader's pair/timeframe picker does not bind Mkety to that pair.

## 5. Outbound MT5 connector

Replace the current customer-facing inbound public-HTTPS bridge requirement with an outbound session protocol while preserving the existing MT5 execution engine and replay/reconciliation logic.

Customer/operator flow:

1. create an MT5 connection in Mkety;
2. receive one-time pairing token/connector ID;
3. run/download the Mkety MT5 Connector on the Windows machine where MT5 is logged in;
4. paste pairing token once;
5. connector validates the actual MT5 terminal login/server and opens an outbound authenticated WebSocket to Mkety;
6. Mkety binds the authenticated connector to the trade-account row and persists actual account/server/environment plus safe symbol catalog;
7. connector stores only its post-pairing local credential in protected local storage for reconnects;
8. commands flow Worker -> Mkety gateway/session -> connector -> existing MT5 engine;
9. result/replay/reconciliation flow returns through the same session.

No customer inbound port, public bridge URL, VPS, or six-customer-env-variable setup is required.

The existing HTTP MT5 bridge remains temporarily compatible for existing operators, but the frontend default/recommended MT5 method becomes the outbound connector after acceptance.

## 6. Canonical execution path

Preserve the current canonical interpretation and current last-mile actions (`OPEN_POSITION`, `MODIFY_POSITION`, `CLOSE_PARTIAL`, `CLOSE_POSITION`, `CANCEL_PENDING`). The preferred low-failure path is:

`authenticated source -> deterministic canonical parse -> canonical event -> persisted route -> account/risk revalidation -> catalog symbol resolution -> deterministic platform translation -> adapter execution`

AI may remain where already permitted for bounded interpretation/presentation, but broker execution never consumes a Telegram-formatted message or AI-formatted presentation as its command. If a signal cannot be converted to an unambiguous canonical intent, execution fails closed/needs review.

For Telegram presentation, deterministic `template` remains the recommended default; `ai_then_fallback` is optional presentation only.

## 7. Production execution-switch behavior

Do not mutate the persisted Mkety owner broker switch in deployment. Do not make CI/deployment require it to be OFF. Deployment should verify that runtime controls are readable and report current capability/owner/effective values. Tests/demo workflows must explicitly control their own acceptance assumptions without rewriting production owner state.

## 8. Verification

Required tests include:

- unauthenticated collector rejected;
- authenticated unselected Telegram chat accepted/ignored with no parsing/routing;
- selected chat fans out only to matching enabled source(s)/workspace(s);
- duplicate native Telegram events converge through existing idempotency;
- source-specific legacy endpoint remains valid;
- customer-specific DB settings change behavior without deployment env changes;
- cBot instance catalog is account-wide and can resolve symbols other than host pair;
- ambiguous/missing symbol fails closed;
- MT5 and cTrader both use actual broker catalogs;
- outbound MT5 pairing validates actual terminal account/server and reconnect credential;
- MT5 outbound command uses existing engine/replay/reconciliation behavior;
- current canonical parser/platform translation remains compatible;
- deployment no longer requires owner switch OFF;
- complete Worker/trading-core, MTProto, MT5, cBot gateway, .NET cBot, Docker/Compose and production frontend suites pass before rollout.
