# Unified Trading Connections Design

## Goal

Make Mkety's Connections area suitable for B2B signal, copier and investment businesses by giving workspace owners a simple, broker-agnostic way to connect and manage cTrader and MT5 accounts while making all supported connection types safely editable after creation.

## Product model

Mkety is infrastructure for businesses that operate signal, copier or investment workflows. Mkety does not maintain customers' brokerage accounts and does not act as the customer's signal provider. Workspace owners connect accounts and integrations they control.

A connection must remain manageable after creation. Non-secret metadata and stable endpoints remain reviewable. Secrets and bearer credentials are never displayed after initial issuance; they are replaced or rotated through explicit actions.

## cTrader

Mkety owns one Spotware Open API application configured through environment secrets:

- `CTRADER_CLIENT_ID`
- `CTRADER_CLIENT_SECRET`
- `CTRADER_REDIRECT_URI`

The customer flow is `Connect cTrader -> cTrader OAuth -> authorize accounts -> return to Mkety`.

Customers must not be asked for cTrader client IDs, API secrets, trading passwords or broker server values in the normal flow. Mkety exchanges the authorization code server-side, stores access/refresh credentials encrypted, discovers authorized trading accounts, and persists each selected account with broker/account/environment metadata.

The cTrader application may be in Spotware `Submitted` state during development. The integration must report an explicit not-configured/not-ready state until production credentials are supplied. No secret is committed to the repository.

A connected cTrader account may be assigned one or both workspace roles:

- source/master
- execution/destination

The same physical account must not need to be connected twice merely to serve both roles.

## MT5 hybrid

Mkety exposes two MT5 connection modes behind one trading-account connection model.

### MT5 Bridge

The customer runs one or more MT5 terminals on Windows/VPS infrastructure they maintain. Mkety issues a one-time pairing token. A Mkety bridge/connector pairs with the workspace and registers terminal/account metadata. Broker passwords do not need to be stored in the Mkety web application when the terminal is already authenticated.

The UI must clearly state that MT5 Bridge requires a running terminal and that multiple simultaneously active accounts may require multiple terminal instances.

### MT5 Cloud

Mkety exposes a cloud connection option behind a provider abstraction. The UI may collect MT5 login, broker server and trading credential only when a configured cloud provider requires them. Credentials are encrypted and never returned.

The initial implementation must build the Mkety provider interface and safe lifecycle/configuration model without coupling the product permanently to a single cloud vendor. If no provider is configured, the UI must show the option as unavailable rather than pretending connectivity exists.

## Connection management

Sources, trading accounts, destinations and similar connection records must support a consistent lifecycle where applicable:

- view
- edit safe metadata/configuration
- enable/disable
- rotate/replace credentials or secrets
- remove

Editing must not expose encrypted credentials or historical plaintext secrets.

For source connections, editable safe fields include as applicable:

- display name
- source/reference instance
- external identity
- priority
- safe provider configuration such as allowed source/chat IDs

Provider type/source family are immutable after creation when changing them would alter the connection's security or runtime semantics; users should create a new connection instead.

## External MTProto

Existing external MTProto integrations remain backward compatible.

Workspace owners must be able to return to a source and see its stable non-secret connection information and edit allowed source/chat IDs or other safe configuration. The existing secret-bearing endpoint format must not become permanently redisplayable.

New/rotated external MTProto connections should expose a stable endpoint based on source identity, for example:

`https://trade.mkety.com/api/v1/external/mtproto/<source-id>`

Authentication is carried separately by a generated secret/token. The page shows:

- endpoint
- source ID
- authentication configured status
- rotate secret action

Plaintext secrets may be shown exactly once when generated/rotated, then never returned by normal reads.

Legacy secret-in-path endpoints must continue functioning until explicitly rotated/migrated.

## Unified trading-account connection model

Trading accounts are persisted once and can be assigned source/master and/or execution/destination roles. Platform-specific details live behind provider adapters rather than leaking into common UI lifecycle logic.

Initial provider modes:

- `ctrader_oauth`
- `mt5_bridge`
- `mt5_cloud`

Common safe metadata includes label, platform, broker/server where applicable, external account ID, environment, roles, connection health, enabled state and execution safety state.

Provider credentials remain encrypted and are represented to the UI only as configured/not configured.

## API and UI behavior

The existing admin APIs remain backward compatible. Add update/delete/detail actions rather than breaking current create/enable/default/credential-replacement routes.

The Connections UI should separate:

### Signal Inputs

- Telegram / external MTProto
- TradingView
- Signed API/webhook
- trading-account source roles

### Trading Accounts

- Connect cTrader
- Connect MT5 -> Bridge or Cloud

Rows/cards expose View/Edit, Enable/Disable, secret/credential rotation where supported, and Remove.

cTrader's manual account-ID/server/password form is removed from the normal customer path and replaced with OAuth connect/disconnect management.

## Security

- Never return or log cTrader client secret, OAuth refresh tokens, MT5 trading passwords, source ingress secrets or cloud-provider credentials.
- Encrypt persisted provider credentials with the existing trading master-key mechanism.
- Keep authorization/permission checks on all connection mutations.
- Secret rotation invalidates or supersedes the previous secret where the provider/runtime supports it.
- OAuth state must be server-generated, integrity-protected, workspace/user-bound, short-lived and single-use.
- OAuth callback must reject state mismatch, expired state, missing authorization and account/workspace mismatch.

## Production execution safety

This feature must not authorize production real-money execution by itself.

Acceptance requires:

- persisted owner master switch `brokerExecutionEnabled=false`
- effective broker execution remains BLOCKED
- new broker/trading-account connections are created inactive or execution-disabled by default
- deployment/config capability may be available, but capability is not authorization

Demo connectivity can be exercised while this safety gate remains in force.

## Backward compatibility

Existing source records, routes, destinations, external MTProto integrations, MT5 source bridge records and cTrader source records must continue to load. New APIs and UI should normalize legacy records into the new management presentation without requiring destructive migration.

## Tests

Add focused tests for:

- safe source metadata updates
- immutable provider/source-family fields
- external MTProto stable endpoint visibility without plaintext secret disclosure
- secret rotation one-time disclosure
- cTrader OAuth start/callback state validation and encrypted token persistence
- cTrader account discovery/normalization without manual password/server entry
- MT5 Bridge pairing lifecycle
- MT5 Cloud configured/unconfigured provider behavior
- trading-account role assignment without duplicate physical connection
- edit/delete permission enforcement
- portal rendering for View/Edit/Enable/Disable/Rotate/Remove controls
- mobile no-horizontal-overflow regression
- persisted owner broker switch OFF and effective execution BLOCKED throughout acceptance
