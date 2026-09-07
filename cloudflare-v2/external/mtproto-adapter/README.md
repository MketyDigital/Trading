# External MTProto Adapter

Portable Telegram MTProto source runtime for Mkety Trading V1. It is a transport adapter only: it receives Telegram events and submits them to the existing signed `POST /api/v1/events` ingress. It does not interpret signals, calculate risk, choose trade accounts, dispatch broker orders, or perform destination fan-out.

## Trust and tenancy boundary

The external host owns only the credentials needed by this source runtime:

- `TELEGRAM_API_ID`
- `TELEGRAM_API_HASH`
- `TELEGRAM_SESSION`
- `TRADING_ENDPOINT`
- `TRADING_SOURCE_ID`
- `TRADING_SOURCE_SECRET`

Optional local transport settings:

- `TELEGRAM_ACCOUNT_SCOPE`
- `ALLOWED_CHAT_IDS`

The external host must never receive Supabase service-role credentials, `TRADING_MASTER_KEY`, Cloudflare internal transport tokens, AI credentials, broker credentials, or another workspace/source secret.

Mkety remains authoritative for workspace, source, account scope, and chat authorization. A caller-supplied workspace hint cannot move an event between tenants.

## Local filtering versus server authorization

`ALLOWED_CHAT_IDS` is only a local transport optimization:

- empty or absent: the adapter may forward all supported incoming Telegram events it can see;
- non-empty: the adapter pre-filters to those chat IDs before network delivery.

This setting never grants server authorization.

Mkety resolves `source_connections.config` after source HMAC authentication:

- `chat_acceptance_mode: "allowlist"` is the default;
- an empty server allowlist accepts no chats;
- `chat_acceptance_mode: "all_visible"` must be explicitly configured server-side;
- payload metadata cannot enable `all_visible`.

Changing the source's Telegram signal channels therefore requires no Telethon code change. Update local filtering if desired and update the authoritative Mkety source policy separately.

## Event identity and replay safety

Telegram native identity is preserved as the provider-independent canonical identity:

```text
telegram:<accountScope>:<chatId>:<messageId>
```

Container, Durable Object, and external MTProto replays of the same native event collapse through persistent workspace-scoped idempotency after authentication. A persistent duplicate is terminal success for the adapter and must not cause a second interpretation, Position Group, destination delivery, or broker action.

## Delivery and failure isolation

Each adapter process owns its own:

- Telegram client/session;
- bounded receive queue;
- signed-V1 sink;
- retry/backoff state;
- local filter;
- delivery counters and sanitized health.

Retryable network/429/5xx failures stay local to that source. Permanent auth/policy/validation rejection is recorded once and later events continue. One adapter/source/workspace failure must not stall or mutate another adapter/source/workspace.

## Source signing

The adapter signs the exact compact raw JSON body with the existing V1 source-auth contract:

```text
basis = "v1:<timestamp_ms>:<raw_json_body>"
signature = "v1=" + hex(HMAC-SHA256(TRADING_SOURCE_SECRET, basis))
```

Headers:

- `X-Mkety-Source-Id`
- `X-Mkety-Timestamp`
- `X-Mkety-Signature`

Retries keep the semantic event body byte-stable while refreshing timestamp/signature freshness. Source secrets and signing material must never appear in body, health, exception output, logs, or committed configuration.

## Non-live acceptance procedure

1. Create or select a non-live `external_mtproto` source connection in the correct Trading workspace.
2. Keep broker/live execution disabled.
3. Configure server-side `chat_acceptance_mode` and `allowed_chat_ids` deliberately. The safe default is allowlist with no accepted chats.
4. Configure the external host using the environment-variable names above. Keep values outside Git and chat.
5. Start the adapter against a Telegram test account/channel.
6. Confirm an authorized native message reaches `/api/v1/events` once.
7. Replay the same native Telegram message and confirm persistent duplicate success with no second interpretation/orchestration work.
8. Send from an unauthorized chat and confirm Mkety rejects it before event reservation/AI.
9. Exercise a retryable downstream failure and confirm only that source retries while another adapter/source continues normally.
10. Review sanitized health only; it should expose status/connectivity/counters/timestamps/queue depth, never secrets.

## Rotation and revocation

The Trading HMAC is source-specific. Rotate or revoke only the affected source credential. A compromise of this external provider must not expose another source, workspace, broker, AI provider, database credential, or Cloudflare internal credential.

Telegram API/session credentials are customer-host credentials for `external_mtproto`; they are not stored in Mkety by this adapter design.

## What this setup does not enable

This adapter setup does **not**:

- apply database migrations;
- enable Trading workspace entitlement;
- enable a trade account;
- enable demo broker orders;
- enable live/real-money trading;
- deploy or merge `main`.

Those remain separate controlled acceptance gates.
