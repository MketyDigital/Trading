# External MTProto Adapter

Portable Telegram MTProto source runtime for Mkety Trading V1. It is a transport adapter only: it receives Telegram events and submits them to Mkety ingress. It does not interpret signals, calculate risk, choose trade accounts, dispatch broker orders, or perform destination fan-out.

This runtime is **external MTProto** and is intentionally separate from Mkety's hosted, source-bound `cloudflare-v2/containers/mtproto-listener`. The hosted listener must not be converted into a shared collector.

## Recommended shared-collector mode

The preferred external deployment is one shared Telegram collector whose chat/source routing policy is database-authoritative in Mkety.

Required external collector configuration:

- `TELEGRAM_API_ID`
- `TELEGRAM_API_HASH`
- `TELEGRAM_SESSION`
- `TRADING_ENDPOINT=https://trade.mkety.com/api/v1/external/mtproto/collect`
- `TRADING_COLLECTOR_TOKEN=<collector bearer token>`

In collector mode, do **not** configure `TRADING_SOURCE_ID`, `TRADING_SOURCE_SECRET`, or `ALLOWED_CHAT_IDS`. Mkety resolves the visible Telegram chat against active `external_mtproto` source rows and their persisted chat policy. An unselected chat is accepted/ignored; a selected chat fans out only to matching authorized sources.

The bearer token belongs in the `Authorization` header. It is never placed in the URL. The protected Mkety admin collector API creates/rotates the credential and returns the clean collector endpoint plus the one-time token.

## Legacy signed-source mode

The older one-runtime-per-source signed ingress remains available for compatibility. It uses:

- `TELEGRAM_API_ID`
- `TELEGRAM_API_HASH`
- `TELEGRAM_SESSION`
- `TRADING_ENDPOINT`
- `TRADING_SOURCE_ID`
- `TRADING_SOURCE_SECRET`

Optional local transport settings for this legacy mode:

- `TELEGRAM_ACCOUNT_SCOPE`
- `ALLOWED_CHAT_IDS`

Do not mix the shared collector token with source ID/secret or `ALLOWED_CHAT_IDS`; startup rejects mixed configuration so the authority boundary stays explicit.

## Trust and tenancy boundary

The external host must never receive Supabase service-role credentials, `TRADING_MASTER_KEY`, Cloudflare internal transport tokens, AI credentials, broker credentials, or another workspace/source secret.

Mkety remains authoritative for workspace, source, account scope and chat authorization. A caller-supplied workspace/source hint cannot move an event between tenants.

## Database-authoritative chat selection

For shared collector mode, local Telegram visibility is not authorization. Mkety loads active external source configuration and applies persisted policy:

- `chat_acceptance_mode: "allowlist"` is the default;
- an empty server allowlist accepts no chats;
- `chat_acceptance_mode: "all_visible"` must be explicitly configured server-side;
- payload metadata cannot enable `all_visible`.

For legacy signed-source mode, `ALLOWED_CHAT_IDS` is only a local transport optimization and never grants server authorization.

Changing Telegram signal channels should therefore be a database/source-policy operation, not a code redeploy.

## Event identity and replay safety

Telegram native identity is preserved as the provider-independent canonical identity:

```text
telegram:<accountScope>:<chatId>:<messageId>
```

Container, Durable Object, external collector and legacy external MTProto replays of the same native event collapse through persistent workspace-scoped idempotency after authentication. A persistent duplicate is terminal success for the adapter and must not cause a second interpretation, Position Group, destination delivery or broker action.

## Delivery and failure isolation

Each adapter process owns its Telegram client/session, bounded receive queue, retry/backoff state, delivery counters and sanitized health. Retryable network/429/5xx failures stay local to the collector/source runtime. Permanent auth/policy/validation rejection is recorded once and later events continue.

In shared collector mode, routing/fan-out happens server-side after collector authentication; the external runtime does not choose a workspace or trade account.

## Legacy source signing

Legacy signed-source mode signs the exact compact raw JSON body with the existing V1 source-auth contract:

```text
basis = "v1:<timestamp_ms>:<raw_json_body>"
signature = "v1=" + hex(HMAC-SHA256(TRADING_SOURCE_SECRET, basis))
```

Headers:

- `X-Mkety-Source-Id`
- `X-Mkety-Timestamp`
- `X-Mkety-Signature`

Retries keep the semantic event body byte-stable while refreshing timestamp/signature freshness. Source/collector secrets and signing material must never appear in body, health, exception output, logs or committed configuration.

## Non-live acceptance procedure

1. Keep broker/live execution disabled.
2. Create/select non-live `external_mtproto` source rows in the intended workspaces.
3. Configure each source's persisted `chat_acceptance_mode` and `allowed_chat_ids` deliberately.
4. Create/rotate a shared collector credential through the protected Mkety admin API and save the one-time token securely.
5. Configure only the **external** MTProto listener with the clean `/api/v1/external/mtproto/collect` endpoint plus `TRADING_COLLECTOR_TOKEN`. Do not change the hosted MTProto listener.
6. Start the adapter against a Telegram test account/channel.
7. Send from an unselected chat and confirm the collector request succeeds but Mkety ignores it with no interpretation/routing work.
8. Send from a selected chat and confirm only matching source rows receive the native event.
9. Replay the same native Telegram message and confirm persistent duplicate success with no second interpretation/orchestration work.
10. Exercise a retryable downstream failure and confirm later events continue and no secret appears in health/log output.

## Rotation and revocation

Shared collector credentials are server-managed and can be rotated independently of source policy. Legacy Trading HMAC credentials remain source-specific. A compromise of this external runtime must not expose another workspace's broker/AI credentials, database credential or Cloudflare internal credential.

Telegram API/session credentials are external-host credentials; this adapter does not store them as customer trading authority in Mkety.

## What this setup does not enable

This adapter setup does **not** apply database migrations, enable a Trading workspace entitlement, enable a trade account, enable demo broker orders, enable live/real-money trading, deploy the Worker/gateway, or merge `main`. Those remain separate controlled acceptance gates.
