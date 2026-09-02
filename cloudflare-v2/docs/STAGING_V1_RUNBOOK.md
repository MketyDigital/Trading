# Trading V1 Shared-Supabase Acceptance Runbook

This is the current environment procedure for `MketyDigital/Trading` V1. Trading shares the existing Mkety Supabase project because no separate development branch is available, so every change must remain strictly Trading-owned and must not alter unrelated Mkety application state.

## Hard safety boundary

Trading-owned database surface:

- `public.trading_workspace_access`
- `public.trading_workspace_memberships` after migration `0009` is applied
- `public.source_connections`
- `public.trading_events`
- `public.position_groups`
- `public.position_legs`
- `public.destination_deliveries`
- the existing Trading-specific `public.trade_accounts` table and additive Trading policy/index columns

Do not alter, drop, rewrite, or add Trading entitlement state to shared `public.workspaces` or unrelated Mkety tables/functions. Trading authorization belongs to `trading_workspace_access` plus exact Trading-owned subject membership; V1 does not use a browser-supplied workspace id as authority and does not depend on a foreign key to shared `public.workspaces`.

Real-money execution remains disabled. Demo broker actions remain behind their explicit demo-only acceptance gates.

## Verified database state — 2026-09-02

Connected project: `Mkety Digital`.

The following Trading migrations have been reviewed, applied, and verified in the live shared Supabase project:

1. `0001_enterprise_trading_foundation.sql`
2. `0002_trade_correlation_and_account_policy.sql`
3. `0003_multi_source_provider_registry.sql`
4. `0004_cross_provider_event_identity.sql`
5. `0005_mtproto_provider_credentials.sql`
6. `0006_mtproto_recovery_state.sql`
7. `0007_trading_internal_privilege_hardening.sql`
8. `0008_trading_default_source_search_path.sql`

Migration `0009_trading_workspace_memberships.sql` is checked into the active feature branch but **is not yet claimed live-applied**. Do not treat source/CI presence as migration-ledger evidence.

Supabase migration ledger names already verified live include:

- `trading_0003_multi_source_provider_registry`
- `trading_0004_cross_provider_event_identity`
- `trading_0005_mtproto_provider_credentials`
- `trading_0006_mtproto_recovery_state`
- `trading_0007_internal_privilege_hardening`
- `trading_0008_default_source_search_path`

Do not re-run these migrations blindly. Inspect the real migration ledger and schema first if a later environment reports drift.

### Verified effects

`0003`:
- provider/source-family/default/priority/external-identity/config/health columns exist on `source_connections`;
- active family/default/provider indexes exist;
- `trading_set_default_source(uuid,text,uuid)` exists and performs a family-scoped atomic default switch.

`0004`:
- `trading_events.canonical_event_id` exists;
- unique partial `(workspace_id, canonical_event_id)` index exists for persistent cross-provider native-event collapse.

`0005`:
- `source_connections.provider_secret_ciphertext` exists as the separate encrypted provider-credential envelope;
- provider credentials remain server-side only and are not the same field as ingress HMAC ciphertext.

`0006`:
- per-source durable recovery attempt/backoff/error timestamps/counters exist;
- the active first-party Container MTProto recovery index exists.

`0007`:
- `anon` and `authenticated` have no table privileges on `trading_workspace_access`, `source_connections`, `trading_events`, `position_groups`, `position_legs`, `destination_deliveries`, or `trade_accounts`;
- `service_role` retains the required table privileges;
- RLS remains enabled on all existing Trading internal tables;
- zero client RLS policies exist by design because these are server/service-role internals;
- `trading_set_default_source` can be executed by `service_role` only.

`0008`:
- `trading_set_default_source` has pinned empty `search_path`;
- the function remains SECURITY INVOKER;
- `anon_execute=false`, `authenticated_execute=false`, `service_role_execute=true`.

`0009` source contract, pending live application/verification:
- creates `trading_workspace_memberships` as the exact `(workspace_id, zitadel_subject)` Trading entitlement boundary;
- keeps client access closed and service-side authority explicit;
- does not add Trading authorization state to shared `public.workspaces` or MKSaaS user tables.

### Shared-schema and data invariants

Before `0009` live application:

- shared `public.workspaces` still has its pre-existing 10-column definition; no Trading column was added;
- `source_connections`, `trading_events`, `position_groups`, `position_legs`, `destination_deliveries`, and `trade_accounts` remain empty;
- exactly one `trading_workspace_access` row exists;
- that row remains `trading_access_enabled=false` and `zitadel_org_id` remains unset;
- no source credentials, Telegram sessions, broker credentials, or execution accounts were inserted as part of migration readiness.

## Supabase Security Advisor state

After `0008`, the Trading-owned mutable-function-search-path warning is resolved.

Trading tables still produce informational `RLS enabled, no policy` notices. That is intentional because client table privileges are explicitly revoked and the runtime uses server/service-role access.

Other project warnings, including unrelated public-schema extensions or pre-existing SECURITY DEFINER functions, are outside this Trading migration scope. Do not modify them from this repository without a separate Mkety security plan.

Supabase linter remediation reference for the intentional RLS/no-policy notices:
https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy

## Shared Mkety Zitadel identity model

Identity topology:

```text
One managed Mkety Zitadel instance
  -> MKSaaS project/app (separate DB)
  -> Trading project/app (Trading DB)
       -> trading_workspace_access
       -> trading_workspace_memberships
```

Authoritative operator reference:

`cloudflare-v2/docs/SHARED_ZITADEL_ENTERPRISE_IDENTITY.md`

Zitadel login is identity only. Trading entitlement additionally requires exact Trading workspace access, exact project/org authorization, exact immutable token `sub` membership, and a Trading workspace-role capability. Trading authorization must not query the MKSaaS database or shared Mkety user/workspace tables.

A Trading-only identity with no MKSaaS DB profile is supported. Broker execution is a separate safety boundary and is not granted by identity, membership, or workspace role.

## Worker configuration required before non-live acceptance

Server-side names:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE` or supported service-role alias
- `TRADING_MASTER_KEY`
- `TRADE_STATE_INTERNAL_TOKEN`
- `ZITADEL_ISSUER`
- `ZITADEL_AUDIENCE`
- `ZITADEL_JWKS_URL`
- `ZITADEL_PROJECT_ID` for strict Trading project isolation in the intended environment
- optional `ZITADEL_TRADING_ROLE`
- `TRADING_V1_SHADOW` — default off
- `TRADING_V1_SIMULATION` — default off
- `TRADING_V1_AI_TIMEOUT_MS`

Simulation context:

- `TRADE_STATE_NAMESPACE`
- `TRADING_V1_SIMULATION_INSTRUMENTS`
- `TRADING_V1_SIMULATION_PRICES`
- optional `TRADING_V1_SIMULATION_EXPOSURES`

Never commit secret values or paste them into logs/chat.

## Health preflight

Use:

```text
GET /api/v1/health
```

The endpoint must expose readiness booleans, feature state, and missing configuration names only. It must never echo secret values.

Before simulation acceptance:

- core readiness must be true;
- simulation readiness must be true;
- real broker execution remains unavailable.

## Trading workspace authorization setup

`trading_workspace_access` is the V1 workspace entitlement boundary. `trading_workspace_memberships` is the exact subject-to-workspace membership boundary after `0009` is live-applied. The existing workspace entitlement row is intentionally disabled.

### Real non-live shared-Zitadel acceptance checklist

Keep `trading_access_enabled=false` while preparing the test identities and configuration. Verify all of the following against the deployed non-live Worker and the existing managed Mkety Zitadel instance before enabling the intended non-live workspace entitlement:

1. **Same issuer identity plane:** both product entry paths use the intended managed Mkety Zitadel issuer.
2. **Trading-specific application/audience:** Trading tokens are issued for the intended Trading application/client and `ZITADEL_AUDIENCE`.
3. **Exact project claim:** with `ZITADEL_PROJECT_ID` configured, the matching `urn:zitadel:iam:org:project:<projectId>:roles` claim authorizes; a role only in another project or generic fallback claim fails.
4. **Exact organization:** the Trading role must be granted for the workspace-bound Zitadel organization; the same role for another org fails.
5. **Exact immutable `sub` membership:** the token subject must match an enabled `(workspace_id, zitadel_subject)` Trading membership.
6. **Wrong-workspace membership:** a subject who belongs only to another Trading workspace fails for the selected workspace.
7. **Disabled membership:** a disabled membership fails without affecting an enabled sibling member.
8. **Existing-Mkety logical user:** an intended user that also exists in MKSaaS succeeds only because its Zitadel `sub` has Trading entitlement/membership, not because of any MKSaaS DB row.
9. **Trading-only logical user:** a separate test subject with no MKSaaS DB profile succeeds when the same Zitadel identity/project/org checks and Trading membership are valid.
10. **MKSaaS independence:** Trading remains operable for the Trading-only test identity without reading/querying the MKSaaS database or shared Mkety user/workspace tables.
11. **No broker/live coupling:** no live broker account, real-money execution, or execution enablement is introduced during identity acceptance.
12. **Secret-free evidence:** logs and responses contain no bearer tokens, secrets, service-role keys, or private credentials.

Only after the negative and positive identity cases pass should the intended non-live workspace entitlement be enabled for subsequent source/runtime acceptance. Do not enable entitlement merely to satisfy a readiness check.

## Source connection setup

Do not create a source until the Worker `TRADING_MASTER_KEY` and the intended non-live workspace authorization are ready.

For signed V1 ingress:

1. generate a random per-source HMAC secret outside Git;
2. encrypt it with the Trading AES-GCM envelope;
3. store only ciphertext in `source_connections.secret_ciphertext`;
4. configure provider-specific encrypted credentials separately in `provider_secret_ciphertext` when applicable;
5. keep source/chat scope explicit and tenant-local;
6. sign the exact raw request body with the registered source identity/timestamp/signature headers.

Never store plaintext source/provider credentials in Supabase.

## Non-live multi-source/MTProto acceptance

Primary operational procedure:

`cloudflare-v2/docs/NON_LIVE_MULTI_SOURCE_ACCEPTANCE.md`

Required observations include:

- multiple source/provider families coexist without global coupling;
- one source/provider failure does not alter sibling authorization, health, retries, defaults, credentials, or event handling;
- Container, Durable Object, and external MTProto replays use provider-independent Telegram native identity;
- reconnect/catch-up replay does not create a second orchestration path;
- destination fan-out succeeds/fails/retries independently;
- failed-destination retry does not redispatch successful siblings;
- foreign-workspace/duplicate destinations fail locally;
- health and errors remain secret-free.

Observation-only Container soak command:

```text
npm run soak:mtproto:container
```

A static/CI GREEN harness is not proof of lossless real reconnect behavior. Container disk is ephemeral and real Telegram restart/catch-up must still be exercised using a test account/channel.

## Static V1 simulation acceptance

When non-live workspace/source configuration is ready, enable only simulation and run:

```text
npm run accept:v1:simulation
```

Acceptance must cover at minimum:

- complete deterministic signal;
- exact duplicate event;
- invalid signature/stale replay rejection before persistence;
- bounded AI ambiguity that still passes deterministic validation;
- disabled account/kill switch producing zero actions;
- fast-entry wait policy and completion without duplicate legs;
- reply/thread-targeted management;
- missing broker/market metadata failing closed;
- zero broker dispatch from the simulation path.

## cTrader demo acceptance

Only after static simulation is green, configure a real authorized **demo** account outside source control and run:

```text
npm run accept:ctrader:demo
```

Validate app/account authentication, account trading rights, live demo symbol metadata/quotes, raw cTrader protocol-cent volume semantics, market/pending orders, fill-before-protection, arbitrary TP groups, BE, partial/full close, pending cancellation, account mode, and persistent destination idempotency.

Never point the acceptance command at a live cTrader environment unless a later deliberate live-cutover decision explicitly authorizes it.

## MT5 demo acceptance

Only with a reachable authenticated demo bridge/terminal and explicit demo gate:

```text
npm run accept:mt5:demo
```

Validate signed command expiry/replay rejection, account/server identity, broker symbol metadata/suffixes, `order_check`, volume constraints, market/pending orders, SL/TP, arbitrary TP groups, BE/protection, partial/full close, cancel pending, and persistent idempotency.

## Legacy cutover

Do not delete/rename legacy Trading runtime/tables simply because V1 exists.

Cutover remains:

1. pass shared-Zitadel non-live project/org/sub membership acceptance;
2. pass signed V1 simulation;
3. pass non-live source/provider soak;
4. pass cTrader demo matrix;
5. pass MT5 demo matrix;
6. compare V1 behavior/state with the legacy path;
7. only then design a separately reversible legacy retirement/cutover.

## Stop conditions

Stop and fix the root cause if any of these occur:

- an unrelated Mkety table/function/schema is modified by Trading work;
- shared `workspaces` schema changes;
- Trading auth/admin code depends on the MKSaaS database or shared Mkety user/workspace tables;
- wrong project/org/subject/workspace membership is accepted;
- client table privileges reappear on Trading internal tables;
- secrets appear in plaintext database fields, logs, health, or API responses;
- invalid/replayed source events reach persistence;
- ambiguous AI output becomes executable;
- blocked accounts produce actions;
- duplicate events create duplicate Position Groups/orders/deliveries;
- a source/provider/destination failure changes a sibling integration's state or behavior;
- simulation reaches a broker executor;
- broker metadata/economics are guessed rather than discovered/validated.

## Current next step

Source/CI shared-Zitadel acceptance is being completed on the feature branch. Migration `0009` remains checked in but not yet claimed live-applied.

Next safe environment work is **non-live identity and runtime configuration**:

1. apply and verify migration `0009` to the Trading database only, preserving the disabled entitlement until identity tests are ready;
2. configure the Trading project/application and workspace-bound organization in the existing managed Mkety Zitadel instance;
3. run the exact project/org/`sub` negative/positive checklist above, including a Trading-only identity with no MKSaaS DB profile;
4. configure one deliberately non-live source identity using server-side encrypted credentials;
5. deploy/verify the required Cloudflare V1/Container/DO bindings without enabling real broker execution;
6. run signed V1 simulation and MTProto non-live soak/replay/isolation acceptance;
7. then run cTrader/MT5 demo acceptance behind their explicit demo-only gates.

Real-money execution remains disabled.