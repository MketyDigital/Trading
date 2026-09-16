# Source Feeds, Telegram Endpoints, and Multi-Instance MT5 Design

## Status

Approved in chat on 2026-09-16. This design is additive and must preserve all existing source, route, destination, execution, reply-correlation, idempotency, formatting, account-policy, and broker-safety behavior.

## Goals

1. A single Telegram transport connection (external MTProto userbot, hosted/internal MTProto userbot, or normal Telegram Bot API source) may authorize two or many Telegram chats/channels while exposing each authorized chat as an independently routable source feed.
2. Users create another source connection only when they need another independent transport/session. Mkety does not care how an external transport internally aggregates sessions; it authenticates the configured connection and independently authorizes/routs each persisted feed identity.
3. A single Telegram Bot API destination credential may be reused for two or many destination chats/channels. Each destination endpoint remains independently routable.
4. Routes become feed -> destination endpoint/account, while legacy connection -> destination routes continue working unchanged during migration/compatibility.
5. Route filters may restrict broker delivery by canonical symbol/instrument family, but filtering is additive and must never silently broaden execution.
6. One Windows VPS may run multiple MT5 terminals/broker accounts. Each terminal/account has one isolated Mkety connector instance with an explicit terminal executable path, independent config, connector instance ID, reconnect token, and replay ledger.
7. LIVE remains disabled globally and per LIVE account throughout implementation and acceptance.

## Non-goals

- Do not replace the existing ingress pipeline.
- Do not remove legacy source_connection_id routing.
- Do not require one Telegram bot per channel.
- Do not require one VPS per MT5 account.
- Do not enable LIVE execution.
- Do not couple external MTProto VM internals to Mkety infrastructure.

## Source model

### Transport connection

`source_connections` remains the credential/runtime boundary. Examples:

- external MTProto userbot
- hosted/internal MTProto userbot
- Telegram Bot API bot/webhook
- TradingView webhook

Secrets stay on the connection and remain encrypted.

### Source feeds

Add `source_feeds` as workspace-scoped logical ingress identities underneath a source connection.

Required fields:

- `id uuid primary key`
- `workspace_id uuid not null`
- `source_connection_id uuid not null`
- `provider_feed_id text not null` (Telegram chat/channel ID for Telegram sources)
- `display_name text null`
- `feed_type text not null default 'telegram_chat'`
- `is_active boolean not null default true`
- `metadata jsonb not null default '{}'`
- timestamps
- unique `(workspace_id, source_connection_id, provider_feed_id)`

For existing Telegram source connections, the persisted allowed chat IDs in connection config remain authoritative for authorization. Feed rows refine routing; they do not weaken source authorization. Ingestion resolves the incoming authenticated chat ID to an active feed row when present.

Compatibility rule: if no feed-specific route exists for a resolved feed, existing connection-level routes continue to resolve exactly as they do today. Feed-specific routing, once configured, takes precedence for that feed so a user can prevent the source connection's other chats from inheriting the same fanout.

## Route model

Extend `source_destination_routes` with nullable `source_feed_id`.

- Legacy route: `source_connection_id != null`, `source_feed_id = null`.
- Granular route: `source_connection_id != null`, `source_feed_id != null` and feed belongs to that connection/workspace.

Runtime route resolution:

1. Authenticate the transport and authorize the incoming chat exactly as today.
2. Resolve active `source_feed` by connection + provider feed ID.
3. If the feed has any active feed-specific routes, resolve only those routes.
4. Otherwise resolve existing active connection-level routes.
5. Apply route filters fail-closed.
6. Fan out destinations independently with existing idempotency.

This preserves old workspaces while allowing a single multi-chat userbot/bot to route each chat independently.

## Route filters

Support an intentionally small first filter surface:

- `allowedCanonicalSymbols: string[]`
- `blockedCanonicalSymbols: string[]`

Filter evaluation uses the interpreted canonical symbol, not raw Telegram text. `blockedCanonicalSymbols` wins. A missing/empty filter preserves current behavior. Unknown/invalid filter shapes fail closed for broker destinations and may be surfaced as route configuration errors rather than guessed.

This allows, for example, an Octa MT5 route to accept XAUUSD while a Deriv cTrader route accepts supported synthetic indices. Broker symbol compatibility/normalization remains the final execution guard.

## Telegram destination credential reuse

Introduce `destination_connections` for reusable provider credentials and `destination_endpoints` for addressable output targets, without deleting `trading_destinations`.

Phase-one compatibility implementation may map these concepts onto existing destinations through a `credential_connection_id` reference while preserving all current destination IDs and delivery records. The public UX must behave as:

- Telegram Delivery Bot (credential entered once)
  - VIP Gold channel
  - Free Signals channel
  - Synthetic Signals channel

Each endpoint has its own chat ID, name, active state, template/formatting assignment, and independent route membership. Delivery resolves the encrypted bot token from the credential connection and the chat ID from the endpoint/destination.

Legacy Telegram destinations with their own encrypted bot token continue working.

## Telegram Bot API source UX

When provider `telegram_bot_api` is selected, the Connections UI must always render:

- Bot token (password input)
- allowed chat/channel IDs

The token is stored encrypted exactly once on the source connection and webhook registration stays connection-scoped. Allowed chats are materialized as source feeds so each can be routed independently.

## MT5 multi-terminal architecture

One connector process controls exactly one MT5 terminal/account identity.

Add CLI options:

- `--terminal PATH`: exact broker terminal executable, passed to `MetaTrader5.initialize(path=...)`.
- `--ledger PATH`: per-instance replay SQLite path.
- existing `--config PATH`: per-instance pairing/reconnect configuration.

If `--terminal` is omitted, preserve current plain `mt5.initialize()` behavior for backward compatibility.

Recommended Windows VPS layout:

```text
C:\MT5\Octa\terminal64.exe
C:\MT5\FBS\terminal64.exe
C:\MT5\Deriv\terminal64.exe

C:\Mkety\Octa\connector.json
C:\Mkety\Octa\ledger.sqlite
C:\Mkety\FBS\connector.json
C:\Mkety\FBS\ledger.sqlite
C:\Mkety\Deriv\connector.json
C:\Mkety\Deriv\ledger.sqlite
```

Run one connector process per account. All may connect outbound to the same Mkety gateway. Broker-account identity checks remain mandatory.

Windows VPS is the primary supported production target. Linux/Wine remains experimental until independently accepted.

## Frontend UX

Connections page:

- Source connection card shows transport/session once.
- Child `Source feeds` section lists allowed Telegram chats independently with active state and human label.
- Telegram Bot API source visibly shows Bot Token and allowed chats during creation.
- MT5 card/documentation shows one connector instance per terminal/account and generated example command including `--terminal`, `--config`, and `--ledger`.

Routing page:

- Source selector chooses a source feed when feeds exist; clearly displays parent connection.
- Destination selector chooses broker account or Telegram endpoint.
- Existing connection-level routes remain visible as `All feeds (legacy/default)`.
- UI prevents accidental all-destination fanout when a feed-specific route set exists.

Telegram destinations:

- Add/select a reusable bot credential connection.
- Add multiple channel/chat endpoints underneath it.
- Existing standalone destinations remain editable and functional.

## Data migration and backward compatibility

- Schema changes are additive.
- Existing rows are never deleted or rewritten destructively.
- Existing Telegram allowed chat IDs may be backfilled into `source_feeds` idempotently.
- Existing routes remain connection-level fallback routes.
- Existing Telegram destination credentials remain valid.
- Event IDs, reply/thread correlation, position groups/legs, delivery IDs, broker reconciliation, account policies, and LIVE gates remain unchanged.

## Testing and acceptance

Automated tests must prove:

- one source connection with two feeds routes feed A and feed B independently;
- feed-specific routes override connection-level fallback only for that feed;
- connection-level behavior is unchanged when no feed-specific routes exist;
- unauthorized Telegram chats remain rejected even if a feed row is mistakenly present;
- one normal Telegram bot source token supports multiple independently routable allowed chats under one webhook;
- one Telegram destination bot credential sends to multiple endpoint chat IDs without duplicating the credential;
- legacy standalone Telegram destinations still deliver;
- canonical-symbol route filters allow/block deterministically and fail closed on malformed broker filters;
- MT5 `--terminal` is passed to initialize, `--ledger` isolates replay state, old invocation still works;
- multiple connector instances have independent config/ledger/instance IDs;
- no LIVE flag or entitlement is enabled.

Manual DEMO acceptance follows the existing MT5 connector acceptance runbook after automated CI is green.
