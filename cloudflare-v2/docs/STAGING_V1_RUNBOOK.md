# Trading V1 Shared-Supabase Acceptance Runbook

This runbook is the current environment procedure for `MketyDigital/Trading` V1. The Trading runtime shares the existing Mkety Supabase project because a separate paid/development branch is not available, but **Trading V1 must remain schema-isolated from unrelated Mkety application tables**.

## Hard safety boundary

Allowed database changes:

- new Trading-owned `public.trading_workspace_access`;
- new Trading-owned `public.source_connections`;
- new Trading-owned `public.trading_events`;
- new Trading-owned `public.position_groups`;
- new Trading-owned `public.position_legs`;
- new Trading-owned `public.destination_deliveries`;
- additive policy/index columns on the existing Trading-specific `public.trade_accounts` table.

Do **not** alter, drop, rewrite, or add Trading entitlement columns to shared `public.workspaces` or unrelated Mkety tables such as users, campaigns, blogs, leads, chats, packages, or SaaS-template tables.

The stable Trading workspace ID may mirror an existing Mkety workspace UUID, but Trading authorization belongs to `trading_workspace_access`; there is deliberately no foreign key from the new V1 tables to `public.workspaces`.

Real broker execution remains disabled until demo acceptance is complete.

## Current database state — 2026-09-01

The isolated Trading schema has already been applied to the existing Supabase project.

Applied:

1. `db/migrations/0001_enterprise_trading_foundation.sql`
2. `db/migrations/0002_trade_correlation_and_account_policy.sql`

Verified after application:

- shared `public.workspaces` retained its exact pre-migration 10-column definition;
- all new V1 workspace foreign keys point to `trading_workspace_access`;
- RLS is enabled on all six new Trading-owned public tables;
- no anon/authenticated RLS policies are intentionally created because these tables are server/service-role internals;
- the five V1 foreign-key lookup indexes recommended by the Supabase performance advisor were added;
- the reused Trading `trade_accounts.workspace_id` lookup is indexed;
- one Trading workspace-access row exists but `trading_access_enabled=false` and `zitadel_org_id` is unset;
- `source_connections`, `trading_events`, `position_groups`, `position_legs`, `destination_deliveries`, and `trade_accounts` are empty.

Do not re-run migrations blindly. They are additive/idempotent, but inspect current schema and Git history first.

Migrations `0003_multi_source_provider_registry.sql`, `0004_cross_provider_event_identity.sql`, `0005_mtproto_provider_credentials.sql`, and `0006_mtproto_recovery_state.sql` are checked in but are **not yet claimed applied**. Review the actual shared Supabase schema before applying any of them.

## Supabase advisor notes

Security advisor findings attributable to the new V1 tables are informational `RLS enabled, no policy`, which is intentional for service-role-only access.

Pre-existing warnings such as public-schema extensions, existing SECURITY DEFINER functions, or policies on unrelated Mkety tables are outside this Trading migration scope. Do not modify them from this repository without a separate Mkety security plan.

Performance advisor initially identified missing V1 foreign-key indexes; those were added. Newly created indexes can show as `unused` until traffic exercises them; that is expected immediately after creation.

## Worker configuration required before V1 acceptance

Server-side names:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE` or supported service-role alias
- `TRADING_MASTER_KEY`
- `TRADE_STATE_INTERNAL_TOKEN`
- `ZITADEL_ISSUER`
- `ZITADEL_AUDIENCE`
- `ZITADEL_JWKS_URL`
- optional `ZITADEL_PROJECT_ID`
- optional `ZITADEL_TRADING_ROLE`
- `TRADING_V1_SHADOW` — default off
- `TRADING_V1_SIMULATION` — default off
- `TRADING_V1_AI_TIMEOUT_MS`

Simulation-only context:

- `TRADE_STATE_NAMESPACE` Durable Object binding
- `TRADING_V1_SIMULATION_INSTRUMENTS`
- `TRADING_V1_SIMULATION_PRICES`
- optional `TRADING_V1_SIMULATION_EXPOSURES`

Never commit secret values or paste them into logs/chat.

## Health preflight

Use:

```text
GET /api/v1/health
```

The endpoint must return only readiness booleans, feature states, and missing configuration **names**, never values.

Before simulation acceptance:

- core readiness must be true;
- simulation readiness must be true;
- real broker execution remains unavailable.

## Trading workspace authorization setup

`trading_workspace_access` is now the V1 entitlement boundary.

The existing seeded row is intentionally disabled. Before enabling it:

1. configure the correct Zitadel organization mapping;
2. set the required Trading role;
3. verify issuer/audience/JWKS configuration in the Worker;
4. verify wrong-org and missing-role tokens fail;
5. only then set `trading_access_enabled=true`.

The main Mkety control plane can later provision/revoke this Trading access without changing Trading runtime code.

Do not use a browser-supplied workspace ID as authorization by itself.

## Source connection setup

A source connection cannot be safely created until a Worker `TRADING_MASTER_KEY` exists.

When ready:

1. generate a random source HMAC secret outside Git;
2. encrypt it using the Trading AES-GCM secret envelope;
3. store only the ciphertext in `source_connections.secret_ciphertext`;
4. keep `is_active=true` only for the source being accepted;
5. sign event requests with the exact raw body using:
   - `X-Mkety-Source-Id`
   - `X-Mkety-Timestamp`
   - `X-Mkety-Signature`.

Never store the plaintext source secret in Supabase.

## External MTProto non-live setup

The portable runtime is `cloudflare-v2/external/mtproto-adapter/`. It is transport-only and uses the existing signed `POST /api/v1/events` boundary. It does not own workspace authorization, chat authorization, signal interpretation, AI selection, risk, trade accounts, broker execution, or destination fan-out.

Customer/external-host configuration names:

- `TELEGRAM_API_ID`
- `TELEGRAM_API_HASH`
- `TELEGRAM_SESSION`
- `TRADING_ENDPOINT`
- `TRADING_SOURCE_ID`
- `TRADING_SOURCE_SECRET`
- optional `TELEGRAM_ACCOUNT_SCOPE`
- optional `ALLOWED_CHAT_IDS`

The external host receives only its own Telegram credentials and its own source-specific Trading HMAC secret. It must never receive Supabase service role, `TRADING_MASTER_KEY`, Cloudflare internal transport token, AI credentials, broker credentials, or another tenant/source credential.

Telegram API/session credentials for `external_mtproto` stay on the customer host and are not stored in Mkety by this provider design.

Server-side source policy is authoritative:

- `source_connections.config.chat_acceptance_mode` defaults to fail-closed `allowlist`;
- empty/missing server `allowed_chat_ids` accepts no chats;
- `all_visible` requires an explicit server-side setting;
- external payload/local forward-all metadata cannot authorize `all_visible`;
- optional caller `metadata.account_scope` must match the authenticated source `external_identity` when supplied;
- authenticated source workspace remains authoritative even if the caller supplies another workspace hint.

`ALLOWED_CHAT_IDS` on the VM is only local transport filtering. Empty/absent means the adapter may forward all supported visible events to Mkety, where server policy still decides whether they are authorized. Changing Telegram channels should not require Telethon code changes.

Canonical Telegram identity remains:

```text
telegram:<accountScope>:<chatId>:<messageId>
```

Container, Durable Object, and external MTProto replay of the same native event must collapse through persistent workspace-scoped idempotency after authentication. The same Telegram native identity in two different workspaces must remain two tenant-scoped events.

Non-live acceptance procedure:

1. Review/apply only required pending Trading migrations after inspecting the real shared Supabase schema; do not apply them blindly.
2. Create/select a non-live `external_mtproto` source in the correct Trading workspace.
3. Keep broker/live execution disabled.
4. Configure server `chat_acceptance_mode` / `allowed_chat_ids` deliberately; safe default is deny-all until the intended test chat is added.
5. Configure the external host using the names above; keep values out of Git/chat/logs.
6. Use a Telegram test account/channel and verify an authorized event reaches signed V1 once.
7. Replay the same native message and verify persistent duplicate terminal success with zero second interpretation/orchestration/destination work.
8. Send an unauthorized chat event and verify rejection before reservation/AI.
9. Exercise a retryable network/429/5xx failure and verify only that source retries while another source/workspace continues.
10. Revoke/disable one external source and verify a separate workspace/source remains operational.
11. Inspect only sanitized health: status/connectivity/counters/timestamps/queue depth; no source secret, Telegram session, signature, or credential value may appear.

External MTProto setup does not enable demo broker orders or real-money execution. Full operator detail: `external/mtproto-adapter/README.md`.

## Trade account setup

The existing Trading-specific `trade_accounts` table is being reused because it was empty before V1 migration.

For initial simulation:

- create a clearly labelled non-live/demo account record only after required encrypted credential handling exists;
- default `execution_enabled=false`;
- use conservative `safety_policy` values;
- configure `fast_entry_policy` deliberately;
- configure `entry_zone_policy` deliberately;
- do not insert fake live credentials merely to satisfy a schema.

Simulation can later test an enabled account because the V1 simulation orchestrator has no broker-dispatch dependency. That does not authorize demo or live broker orders.

## Static simulation acceptance matrix

Once Worker configuration, one source connection, and one non-live account exist, enable only:

```text
TRADING_V1_SIMULATION=true
```

Use `POST /api/v1/events` and test at minimum:

### 1. Complete deterministic signal

Verify one event reservation, canonical READY interpretation, account-policy evaluation, risk-sized Position Group/legs, simulation actions matching arbitrary TP count, and zero broker dispatch.

### 2. Duplicate event

Send the same source/external event identity twice. Verify persistent duplicate recognition, one event row, no second Position Group, and no repeated planning.

### 3. Invalid signature/replay

Verify rejection occurs before event persistence.

### 4. AI-required conversational signal

Verify AI is loaded only after authenticated workspace resolution, obeys latency budget, and its structured result is deterministically validated. Malformed/impossible geometry must fail closed.

### 5. Kill switch / disabled account

Verify zero actions and no executable Position Group.

### 6. Fast-entry wait policy

With `wait_for_complete_signal`, an incomplete fast signal must remain action-free.

### 7. Fast-entry completion

Verify full signal correlates to the existing incomplete group and does not create duplicate TP legs/positions.

### 8. Reply/thread management

Verify BE, close/partial close, cancel pending, and other management target the correct existing group. Ambiguous unthreaded management must fail closed.

### 9. Missing market metadata

Verify simulation blocks rather than guessing tick value, volume, symbol mapping, or price.

## cTrader demo acceptance

After static simulation passes, configure a real authorized **demo** account outside source control.

The acceptance matrix must exercise:

- app authentication then account authentication;
- account trading rights;
- live account-specific symbol catalog and IDs;
- live bid/ask acquisition;
- symbol aliases/suffixes resolved through actual catalog metadata;
- correct cTrader protocol-cent volume conversion;
- market orders waiting for `ORDER_FILLED`/position-bearing event before protection;
- pending orders;
- absolute SL/TP protection;
- arbitrary multi-TP Position Groups;
- fast-entry promotion without duplicate positions;
- BE and subsequent protection ladder;
- partial/full close;
- pending cancellation;
- hedged and netted semantics where available;
- persistent destination idempotency/replay safety.

Do not use a live cTrader endpoint unless deliberately enabled after demo acceptance.

## MT5 demo acceptance

Use a reachable authenticated Python/EA bridge attached to a demo terminal/account.

Verify:

- signed `mkety.mt5.v1` envelope;
- command expiry/replay rejection;
- `symbols_get`/`symbol_info` metadata normalization;
- `order_check` before placement;
- broker symbol suffix/prefix mapping;
- volume min/max/step;
- market/pending orders;
- SL/TP;
- multi-leg TP groups;
- BE/protection changes;
- partial/full close;
- pending cancel;
- persistent idempotency.

## Legacy Trading cutover

Do not delete or rename legacy Trading tables simply because V1 tables exist.

Cutover sequence:

1. pass V1 static simulation;
2. pass cTrader demo matrix;
3. pass MT5 demo matrix;
4. migrate the MTProto listener to signed V1 events while retaining legacy fallback;
5. validate destination/customer formatting profiles;
6. compare V1 state/output with the legacy path;
7. only then plan migration/retirement of obsolete legacy Trading tables.

Any legacy replacement must have a separate migration, rollback path, and data verification even if the legacy tables are currently empty.

## Stop conditions

Stop and fix the root cause if any of these occur:

- an unrelated Mkety table is modified by Trading migration;
- shared `workspaces` schema changes;
- secrets appear in database plaintext, API responses, or logs;
- invalid/replayed source events reach persistence;
- ambiguous AI output becomes executable;
- blocked accounts produce actions;
- duplicate events produce duplicate Position Groups/orders;
- simulation reaches a broker executor;
- correlation targets the wrong trade;
- broker metadata is guessed instead of discovered/validated;
- one workspace/source/provider failure changes another workspace/source/provider's authorization, retry state, health, credentials, idempotency, or execution behavior.

## Current next step

External MTProto source/static acceptance is implemented in code and CI. The next environment step for that provider is a controlled **non-live external VM soak** using a Telegram test account/channel and a non-live `external_mtproto` source after the real shared-Supabase migration state is reviewed. If those runtime credentials are not available, do not block unrelated work: continue the multi-source implementation with TradingView/custom/MT5/cTrader source adapters. cTrader and MT5 broker order acceptance remain demo-only gates, and real-money execution remains disabled.