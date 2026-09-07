# Trading V1 Shared-Supabase Acceptance Runbook

This is the current environment procedure for `MketyDigital/Trading` V1. Trading shares the existing Mkety Supabase project, so all changes must remain strictly Trading-owned and must not alter unrelated Mkety application state.

## Hard safety boundary

Trading-owned database surface:

- `public.trading_workspace_access`
- `public.trading_workspace_memberships`
- `public.source_connections`
- `public.trading_events`
- `public.position_groups`
- `public.position_legs`
- `public.destination_deliveries`
- the Trading-specific `public.trade_accounts` table and additive Trading policy/index columns

Do not alter, drop, rewrite, or add Trading entitlement state to shared `public.workspaces` or unrelated Mkety tables/functions. Trading authorization belongs to `trading_workspace_access` plus exact Trading-owned subject membership. Browser/caller workspace values are never authority.

Real-money execution remains disabled. Demo broker actions remain behind explicit demo-only acceptance gates.

## Verified database state — 2026-09-02

Connected Supabase project: `Mkety Digital` (`vdblajgxrfndjesoyayy`, PostgreSQL 17.6.1).

Trading migrations now verified in the live shared Supabase project:

1. `0001_enterprise_trading_foundation.sql`
2. `0002_trade_correlation_and_account_policy.sql`
3. `0003_multi_source_provider_registry.sql`
4. `0004_cross_provider_event_identity.sql`
5. `0005_mtproto_provider_credentials.sql`
6. `0006_mtproto_recovery_state.sql`
7. `0007_trading_internal_privilege_hardening.sql`
8. `0008_trading_default_source_search_path.sql`
9. `0009_trading_workspace_memberships.sql`

Verified live ledger entry for `0009`:

```text
20260902154413  trading_0009_workspace_memberships
```

Do not re-run these migrations blindly. Inspect the migration ledger and actual schema first if a later environment reports drift.

## Verified `0009` effects

`public.trading_workspace_memberships` is live and has the reviewed schema:

- `id UUID NOT NULL DEFAULT uuid_generate_v4()` primary key;
- `workspace_id UUID NOT NULL` referencing `trading_workspace_access(id) ON DELETE CASCADE`;
- `zitadel_subject TEXT NOT NULL`;
- `trading_role TEXT NOT NULL` constrained to `owner`, `admin`, `operator`, `viewer`;
- `membership_enabled BOOLEAN NOT NULL DEFAULT true`;
- `metadata JSONB NOT NULL DEFAULT '{}'::jsonb`;
- `created_at` / `updated_at` timestamps defaulting to `now()`;
- unique `(workspace_id, zitadel_subject)` identity boundary.

Verified indexes:

- `idx_trading_workspace_memberships_subject (zitadel_subject, membership_enabled)`;
- `idx_trading_workspace_memberships_workspace (workspace_id, membership_enabled)`;
- primary-key and unique workspace/subject indexes.

Verified security:

- RLS enabled;
- zero RLS policies by design;
- `anon` has no table privileges;
- `authenticated` has no table privileges;
- `service_role` retains required table privileges;
- membership row count remains `0` immediately after migration.

This is intentionally a service-side authorization table, not a browser/client data surface.

## Shared-schema and data invariants after `0009`

Post-migration verification confirmed:

- shared `public.workspaces` still has its pre-existing **10-column** definition;
- `source_connections=0`;
- `trading_events=0`;
- `position_groups=0`;
- `position_legs=0`;
- `destination_deliveries=0`;
- `trade_accounts=0`;
- `trading_workspace_memberships=0`;
- the existing `trading_workspace_access` entitlement remains disabled;
- its `zitadel_org_id` remains unset;
- no source, Telegram, broker, execution, or membership credentials/data were inserted by the migration.

## Supabase Advisor state after `0009`

Security Advisor reports `RLS Enabled No Policy` as **INFO** for `trading_workspace_memberships`. This is intentional because client privileges are revoked and server/service-role access is the design.

Performance Advisor reports both new membership indexes as unused **INFO**, expected on a newly created empty table.

Pre-existing unrelated WARN findings include the public `vector` extension and `public.rls_auto_enable()` SECURITY DEFINER executability, plus unrelated policy/performance notices. They are outside this Trading migration scope and must not be changed from this repository without a separate Mkety security plan.

Supabase advisor references:

- RLS/no-policy: https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy
- public extension: https://supabase.com/docs/guides/database/database-linter?lint=0014_extension_in_public
- anonymous SECURITY DEFINER execution: https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable
- authenticated SECURITY DEFINER execution: https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable

## Shared Mkety Zitadel identity model

Identity topology:

```text
One managed Mkety Zitadel instance
  -> MKSaaS project/app (separate DB)
  -> Trading project/app (Trading DB)
       -> trading_workspace_access
       -> trading_workspace_memberships
```

Operator reference:

`cloudflare-v2/docs/SHARED_ZITADEL_ENTERPRISE_IDENTITY.md`

Zitadel login proves identity only. Trading entitlement additionally requires exact Trading workspace access, exact project/org authorization, exact immutable token `sub` membership, and a Trading workspace-role capability. Trading authorization must not query the MKSaaS database or shared Mkety user/workspace tables.

A Trading-only identity with no MKSaaS DB profile is supported. Broker execution remains a separate safety boundary and is not granted by identity, membership, or workspace role.

## Worker configuration required before non-live identity acceptance

Server-side configuration names:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE` or supported service-role alias
- `TRADING_MASTER_KEY`
- `TRADE_STATE_INTERNAL_TOKEN`
- `ZITADEL_ISSUER`
- `ZITADEL_AUDIENCE`
- `ZITADEL_JWKS_URL`
- `ZITADEL_PROJECT_ID` for strict Trading project isolation
- optional `ZITADEL_TRADING_ROLE`
- `TRADING_V1_SHADOW` — default off
- `TRADING_V1_SIMULATION` — default off
- `TRADING_V1_AI_TIMEOUT_MS`

Simulation context later requires:

- `TRADE_STATE_NAMESPACE`
- `TRADING_V1_SIMULATION_INSTRUMENTS`
- `TRADING_V1_SIMULATION_PRICES`
- optional `TRADING_V1_SIMULATION_EXPOSURES`

Never commit secret values or paste them into logs/chat.

## Trading workspace authorization setup

`trading_workspace_access` is the workspace/org entitlement boundary. `trading_workspace_memberships` is now the live exact subject-to-workspace boundary. The current workspace entitlement is intentionally still disabled and unbound to a Zitadel organization.

### Real non-live shared-Zitadel acceptance checklist

Keep `trading_access_enabled=false` while preparing the Zitadel project/application, workspace organization binding, and test identities. Verify all of the following against the deployed non-live Worker and the existing managed Mkety Zitadel instance before enabling the intended non-live workspace entitlement:

1. **Same issuer identity plane:** both product entry paths use the intended managed Mkety Zitadel issuer.
2. **Trading-specific application/audience:** Trading tokens are issued for the intended Trading application/client and `ZITADEL_AUDIENCE`.
3. **Exact project claim:** with `ZITADEL_PROJECT_ID` configured, the matching `urn:zitadel:iam:org:project:<projectId>:roles` claim authorizes; another project or generic fallback claim fails.
4. **Exact organization:** the Trading role must be granted for the exact workspace-bound Zitadel organization; the same role for another org fails.
5. **Exact immutable `sub` membership:** token subject must match an enabled `(workspace_id, zitadel_subject)` Trading membership.
6. **Wrong-workspace membership:** subject belonging only to another Trading workspace fails.
7. **Disabled membership:** disabled membership fails without affecting an enabled sibling member.
8. **Existing-Mkety logical user:** succeeds only because its Zitadel `sub` has Trading entitlement/membership, never because an MKSaaS DB row exists.
9. **Trading-only logical user:** a separate test subject with no MKSaaS DB profile succeeds when the same identity/project/org/membership checks are valid.
10. **MKSaaS independence:** Trading remains operable for the Trading-only identity without querying the MKSaaS database or shared Mkety user/workspace tables.
11. **No broker/live coupling:** no live broker account, real-money execution, or execution enablement is introduced during identity acceptance.
12. **Secret-free evidence:** logs/responses contain no bearer tokens, service-role keys, source secrets, or private credentials.

Only after all negative and positive identity cases pass may the intended non-live workspace entitlement be enabled for subsequent source/runtime acceptance.

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

## Source connection setup

Do not create a source until Worker encryption configuration and intended non-live workspace authorization are ready.

For signed V1 ingress:

1. generate a random per-source HMAC secret outside Git;
2. encrypt it with the Trading AES-GCM envelope;
3. store only ciphertext in `source_connections.secret_ciphertext`;
4. configure provider credentials separately in `provider_secret_ciphertext` where applicable;
5. keep source/chat scope explicit and tenant-local;
6. sign the exact raw request body using the registered source identity/timestamp/signature headers.

Never store plaintext source/provider credentials in Supabase.

## Non-live multi-source / MTProto acceptance

Primary procedure:

`cloudflare-v2/docs/NON_LIVE_MULTI_SOURCE_ACCEPTANCE.md`

Require:

- multiple provider families coexist without global coupling;
- one source/provider failure does not alter sibling authorization, health, retries, defaults, credentials, or event handling;
- Container, Durable Object, and external MTProto replays use provider-independent native Telegram identity;
- reconnect/catch-up replay cannot create a second orchestration;
- destination fan-out succeeds/fails/retries independently;
- failed-destination retry never redispatches successful siblings;
- foreign-workspace/duplicate destinations fail locally;
- health/errors remain secret-free.

Observation-only Container soak command:

```text
npm run soak:mtproto:container
```

Static/CI GREEN is not proof of lossless real reconnect behavior. Real Telegram restart/catch-up still requires a test account/channel.

## Static V1 simulation acceptance

When non-live workspace/source configuration is ready, enable only simulation and run:

```text
npm run accept:v1:simulation
```

Acceptance must include deterministic signal, duplicate event, invalid/stale source auth, bounded AI ambiguity, kill switch, fast-entry completion, management correlation, missing metadata fail-closed behavior, and zero broker dispatch from simulation.

## Broker demo acceptance

Only after identity, runtime, source soak, and static simulation are green:

```text
npm run accept:ctrader:demo
npm run accept:mt5:demo
```

Use explicit authorized **demo** accounts only. Validate broker metadata, account identity/rights, idempotency, protected order lifecycle, arbitrary TP groups, BE, partial/full close, pending cancellation, and platform-specific volume semantics.

Never point these acceptance commands at live environments without a later deliberate live-cutover decision.

## Legacy cutover

Do not delete/rename the legacy runtime merely because V1 exists.

Cutover remains:

1. pass real non-live shared-Zitadel project/org/sub membership acceptance;
2. pass signed V1 simulation;
3. pass non-live source/provider soak;
4. pass cTrader demo matrix;
5. pass MT5 demo matrix;
6. compare V1 behavior/state with legacy;
7. only then design a separately reversible retirement/cutover.

## Stop conditions

Stop and fix the root cause if any of these occur:

- unrelated Mkety table/function/schema modified by Trading work;
- shared `workspaces` schema changes;
- Trading auth/admin depends on the MKSaaS database/shared Mkety user/workspace tables;
- wrong project/org/subject/workspace membership is accepted;
- client table privileges appear on Trading internal tables;
- secrets appear in plaintext DB fields, logs, health, or API responses;
- invalid/replayed source events reach persistence;
- ambiguous AI output becomes executable;
- blocked accounts produce actions;
- duplicate events create duplicate Position Groups/orders/deliveries;
- one integration failure changes a sibling integration's state/behavior;
- simulation reaches a broker executor;
- broker metadata/economics are guessed instead of discovered/validated.

## Current next step

Migration `0009` is now **live-applied and verified** while the existing Trading workspace entitlement remains disabled/unbound and all Trading execution/source tables remain empty.

Next safe work is real non-live identity/runtime configuration:

1. configure the Trading project/application in the existing managed Mkety Zitadel instance;
2. bind the intended test Trading workspace to the exact Zitadel organization while keeping entitlement disabled during negative-test preparation;
3. provision only deliberate non-live membership test subjects (including one Trading-only identity) and run the project/org/`sub` checklist;
4. enable only the intended non-live workspace entitlement after negative/positive auth evidence passes;
5. deploy/verify Cloudflare V1/Queue/Container/DO configuration without enabling broker execution;
6. configure one deliberately non-live source and run signed V1 simulation plus MTProto soak/replay/isolation;
7. then run cTrader/MT5 demo acceptance behind explicit demo-only gates.

Real-money execution remains disabled.