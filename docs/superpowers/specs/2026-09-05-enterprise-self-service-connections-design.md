# Enterprise Self-Service Connections Design

## Goal
Allow a Trading workspace owner to connect and manage Telegram/MTProto sources, MT5 accounts, and cTrader accounts from the Trading product without GitHub-secret edits or developer intervention.

## Scope
This design covers workspace-scoped connection onboarding, encrypted credential persistence, safe status surfaces, connection validation hooks, and account/source lifecycle controls. It does not enable real-money broker execution, change the Mkety access-gateway contract, or merge the Trading runtime to `main`.

## Product model
One enterprise customer owns one Trading workspace. Connection records belong only to that workspace and are operated through authorized `/api/v1/admin/*` routes. Browser clients never receive stored credentials after submission.

The onboarding lifecycle is:

`Connect -> validate shape -> encrypt -> persist -> probe/health -> ready -> enable`

A record may be saved before an external provider is reachable, but its health must remain explicit (`STARTING`, `READY`, `ERROR`, `DISABLED`) and must never be inferred from credential presence alone.

## Security boundary
`TRADING_MASTER_KEY` remains the application-owned 32-byte AES-GCM master key. Existing `src/security/secret_box.js` is the encryption primitive and its versioned `v1.<iv>.<ciphertext>` envelope remains the storage format.

Secrets are accepted only over authorized server-side admin routes and encrypted before persistence. Plain credentials must not be written into JSON configuration, logs, health responses, audit payloads, or browser-visible API responses.

Source credentials use `source_connections.provider_secret_ciphertext`, which already exists specifically for provider credential envelopes. Broker credentials require a new `trade_accounts.credential_ciphertext` column because broker access tokens/passwords are a separate trust domain and must not be embedded in `safety_policy` or other public configuration JSON.

Credential updates are replace-only. API responses expose only a boolean such as `credentialsConfigured` plus safe provider/account metadata. There is no endpoint to retrieve plaintext credentials.

## Source connections
`POST /api/v1/admin/sources` creates a source in the authenticated workspace.

Request contract:
- `providerType`: registered provider type.
- `sourceFamily`: must match provider registry definition.
- `sourceInstanceId`: workspace-unique stable identifier.
- `displayName`: optional.
- `externalIdentity`: required non-secret provider identity.
- `config`: non-secret provider configuration validated by `validateProviderConfiguration`.
- `credentials`: provider-specific secret object.
- `enabled`: defaults false until onboarding has completed enough validation to be intentionally enabled.

For MTProto, credentials are serialized as a versioned JSON object and encrypted into `provider_secret_ciphertext`. Non-secret chat allowlists/policies remain in `config`.

`PUT /api/v1/admin/sources/:id/credentials` replaces encrypted credentials without exposing the prior value. `POST /api/v1/admin/sources/:id/enable|disable` remains the lifecycle control. Existing source listing/get routes return `credentialsConfigured` and sanitized config only.

## Broker accounts
`POST /api/v1/admin/accounts` creates an MT5 or cTrader destination account in the authenticated workspace.

Common request contract:
- `platform`: `mt5` or `ctrader`.
- `label`.
- `accountId`.
- `serverName`: required for MT5; optional provider metadata for cTrader.
- `credentials`: encrypted at rest.
- risk/execution configuration: lot sizing, fast-entry policy, entry-zone policy, safety policy.

New accounts default to:
- `is_active=true` only when explicitly requested; otherwise false.
- `execution_enabled=false` always at creation.
- safety policy enabled with kill switch false unless a stricter existing default applies.

`PUT /api/v1/admin/accounts/:id/credentials` replaces credential ciphertext. Account list/get responses expose `credentialsConfigured` but never credential material.

The global `BROKER_EXECUTION_ENABLED` master gate remains authoritative. Per-account `execution_enabled=true` cannot cause execution while the master gate is false. Enabling real-money execution remains a separate owner approval requiring exact financial limits.

## Credential serialization
Provider/account credentials are normalized into versioned JSON before encryption:

```json
{
  "version": 1,
  "kind": "mtproto|mt5|ctrader",
  "data": { "providerSpecificKey": "secret-value" }
}
```

Only allowlisted keys for each `kind` are accepted. Unknown keys fail closed so accidental sensitive metadata is not silently persisted.

Initial allowlists:
- MTProto: `apiId`, `apiHash`, `session`.
- MT5: `bridgeUrl`, `bridgeSecret`, with optional broker-login credential fields only if the existing bridge contract consumes them.
- cTrader: `clientId`, `clientSecret`, `accessToken`, `refreshToken`.

The implementation must inspect existing bridge/provider contracts before accepting optional keys; YAGNI applies.

## Persistence changes
Add migration `0014_trading_connection_credentials.sql`:
- `trade_accounts.credential_ciphertext TEXT` nullable.
- column comment stating server-side decrypt only; never expose.
- no anon/authenticated grants.
- retain service-role-only Trading access model and existing RLS posture.

No shared Mkety tables are modified.

## Runtime integration
Create a focused credential-envelope module that wraps `encryptSecret`/`decryptSecret` with JSON version/kind validation. Admin stores use it to encrypt before inserts/updates. Runtime adapters may decrypt only at the point a provider/broker operation needs credentials.

No decrypted credential is cached in database JSON or returned from admin APIs. If decryption fails, runtime reports a stable error code and leaves the connection disabled/error rather than attempting execution.

## Authorization
All create/update connection endpoints run only after the existing Mkety signed Trading assertion and workspace authorization boundary. Workspace ID comes from server authorization, never from the request body.

Required permissions remain `sources.write` for source mutations and `accounts.write` for account mutations. Cross-workspace IDs must return not found/forbidden without revealing existence.

## Validation and health
Creation validates local schema immediately. External connectivity validation is a separate probe operation so storing a connection does not depend on a third-party outage.

A later provider-specific `probe` action may update health fields but must be non-ordering for brokers and observation-only for Telegram. Existing Gate 5/6 acceptance harnesses remain useful infrastructure validation, while product onboarding uses the same provider/broker adapters.

## Error handling
Stable API reasons include:
- `SOURCE_CREATE_INVALID`
- `SOURCE_CREDENTIALS_INVALID`
- `SOURCE_CREATE_FAILED`
- `ACCOUNT_CREATE_INVALID`
- `ACCOUNT_CREDENTIALS_INVALID`
- `ACCOUNT_CREATE_FAILED`
- `CREDENTIAL_ENCRYPTION_FAILED`

Do not echo provider secrets, encrypted envelopes, raw third-party errors containing tokens, or database exception text.

## Testing
Use TDD.

Required coverage:
- credential envelope round-trip and wrong-kind/version rejection;
- source create encrypts credentials and persists no plaintext secret in config;
- source responses never expose credentials/envelope;
- source credential replacement is workspace scoped;
- account create defaults execution off and encrypts credentials;
- account responses never expose credentials/envelope;
- account credential replacement is workspace scoped;
- unsupported credential keys fail closed;
- master broker execution gate behavior remains unchanged;
- existing source/account list/enable/disable behavior remains green.

## Rollout
Implement and verify entirely on `design/enterprise-trading-event-core`. Do not enable `BROKER_EXECUTION_ENABLED`, merge runtime to `main`, or connect a real broker account as part of this feature. Once code and migration are green, the next external acceptance can use a demo/test credential set through the actual product connection path instead of GitHub-only account configuration.
