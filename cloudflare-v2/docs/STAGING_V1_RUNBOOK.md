# Trading V1 Staging Runbook

This runbook is for **staging only**. It prepares the Trading V1 event pipeline and simulation path without enabling real broker execution.

## Safety boundary

Before doing anything in this document, confirm all of the following:

- the Supabase project is a dedicated staging/non-production project;
- the Cloudflare Worker environment/route is staging/non-production;
- no production database URL, production service-role key, production bot token, or live broker credential is selected;
- `TRADING_V1_SIMULATION` is still off during schema migration and seed setup;
- no cTrader/MT5 live credentials are configured;
- trade accounts created for this exercise have `execution_enabled = false` until the simulation acceptance steps explicitly require testing account-policy behavior;
- no secret value is pasted into Git, PR comments, screenshots, issue text, or application logs.

If there is any doubt about the target environment, stop before applying SQL.

## 1. Preflight the Worker configuration

Deploy or preview the current design branch to a staging Worker environment only. Check:

```text
GET /api/v1/health
```

The endpoint is intentionally non-secret. It returns only readiness booleans, feature booleans, and missing configuration names.

Core staging configuration names are:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE` (or supported service-role alias)
- `TRADING_MASTER_KEY`
- `ZITADEL_ISSUER`
- `ZITADEL_AUDIENCE`
- `ZITADEL_JWKS_URL`

Simulation additionally needs:

- `TRADE_STATE_INTERNAL_TOKEN`
- `TRADE_STATE_NAMESPACE` binding
- `TRADING_V1_SIMULATION_INSTRUMENTS`
- `TRADING_V1_SIMULATION_PRICES`

Optional configuration includes:

- `ZITADEL_PROJECT_ID`
- `ZITADEL_TRADING_ROLE`
- `TRADING_V1_AI_TIMEOUT_MS`
- `TRADING_V1_SIMULATION_EXPOSURES`

Do not put secret values into a checklist. Record only whether each name is configured.

## 2. Confirm the migration files and order

Apply these files to the staging Supabase/PostgreSQL project **in this order**:

1. `db/migrations/0001_enterprise_trading_foundation.sql`
2. `db/migrations/0002_trade_correlation_and_account_policy.sql`

Do not skip, reorder, or partially copy statements from these files.

The migration application is intentionally manual at this stage. The repository does not auto-apply database migrations.

## 3. Verify migration 0001 before continuing

After applying `0001_enterprise_trading_foundation.sql`, verify the expected tables exist:

```sql
select table_name
from information_schema.tables
where table_schema = 'public'
  and table_name in (
    'source_connections',
    'trading_events',
    'position_groups',
    'position_legs',
    'destination_deliveries'
  )
order by table_name;
```

Expected: all five names are returned.

Verify the workspace entitlement columns:

```sql
select column_name, data_type
from information_schema.columns
where table_schema = 'public'
  and table_name = 'workspaces'
  and column_name in (
    'zitadel_org_id',
    'trading_access_enabled',
    'trading_required_role'
  )
order by column_name;
```

Verify the source/event idempotency constraints exist:

```sql
select conrelid::regclass as table_name, conname
from pg_constraint
where conrelid in (
  'public.source_connections'::regclass,
  'public.trading_events'::regclass,
  'public.position_legs'::regclass,
  'public.destination_deliveries'::regclass
)
order by table_name::text, conname;
```

Confirm there is a uniqueness constraint covering:

- source workspace + source instance;
- trading event workspace + source connection + external event ID;
- position group + target index;
- destination workspace + idempotency key.

Do not create staging records until these checks are correct.

## 4. Apply and verify migration 0002

Apply `0002_trade_correlation_and_account_policy.sql` only after the `0001` checks pass.

Verify the account safety/correlation columns using:

```sql
select table_name, column_name, data_type
from information_schema.columns
where table_schema = 'public'
  and (
    (table_name = 'position_groups' and column_name in (
      'source_instance_id',
      'source_event_ids',
      'thread_id',
      'incomplete',
      'position_mode'
    ))
    or
    (table_name = 'trade_accounts' and column_name in (
      'execution_enabled',
      'safety_policy',
      'fast_entry_policy',
      'entry_zone_policy'
    ))
  )
order by table_name, column_name;
```

Verify the source-correlation index exists:

```sql
select indexname, indexdef
from pg_indexes
where schemaname = 'public'
  and tablename = 'position_groups'
order by indexname;
```

Confirm the expected active source/correlation index from migration `0002` is present.

## 5. Create one staging workspace

Create exactly one test workspace for the first acceptance pass.

Required properties:

- unique staging-only name;
- staging owner/admin identity;
- `trading_access_enabled = true` only if the Zitadel staging org/role is ready;
- `zitadel_org_id` mapped to the staging Zitadel organization;
- `trading_required_role` set to the intended staging Trading role, normally `trading_access`.

Do not reuse a production workspace row.

## 6. Configure staging Zitadel authorization

Using the staging Zitadel tenant/project:

- create/use the Trading API audience expected by the Worker;
- create/use the required Trading role;
- bind the role to the exact staging organization stored in `workspaces.zitadel_org_id`;
- configure the staging Worker with issuer, audience, JWKS URL, and optional project ID;
- verify a valid token can access the scoped V1 workspace endpoint;
- verify a token for the wrong organization or missing role is rejected.

Never use a browser-supplied workspace ID as authorization by itself. The Worker must continue validating the role/organization binding.

## 7. Create an encrypted source connection

Generate a random staging HMAC source secret outside Git.

Encrypt it using the same staging `TRADING_MASTER_KEY` envelope contract before storing it in `source_connections.secret_ciphertext`.

Create one active source connection with:

- the staging workspace ID;
- a source type such as `custom_webhook` or the staging adapter being tested;
- a unique staging source instance ID;
- the encrypted secret ciphertext;
- `is_active = true`.

Do not store the raw HMAC secret in the database.

## 8. Create a non-live trade account policy record

Create a staging trade-account record associated with the staging workspace.

For the first acceptance pass:

- use a clearly labelled staging/demo account record;
- do not add live broker credentials;
- start with `execution_enabled = false`;
- set a restrictive `safety_policy` including an allowed-symbol list and conservative max-lot/risk limits;
- set `fast_entry_policy` deliberately, for example `wait_for_complete_signal`;
- set `entry_zone_policy` deliberately.

Simulation acceptance may temporarily set `execution_enabled = true` on this staging-only record because the V1 simulation orchestrator still has no broker dispatch path. This is **not** approval for real execution.

## 9. Configure explicit simulation market context

Set staging-only simulation metadata. Example shape only:

```json
TRADING_V1_SIMULATION_INSTRUMENTS = {
  "XAUUSD": {
    "tickSize": 0.01,
    "tickValue": 1,
    "minLots": 0.01,
    "maxLots": 100,
    "stepLots": 0.01
  }
}
```

```json
TRADING_V1_SIMULATION_PRICES = {
  "XAUUSD": 2500
}
```

These values are for staging simulation only. They must not be treated as authoritative broker metadata for demo/live execution.

Optional exposure simulation can use `TRADING_V1_SIMULATION_EXPOSURES` keyed by staging trade-account ID.

## 10. Re-check health before enabling simulation

Call:

```text
GET /api/v1/health
```

Expected before enabling simulation:

- `ready = true`;
- `simulationReady = true` once all required names/bindings/context exist;
- `features.simulationEnabled = false` if the flag has not yet been enabled;
- no secret or endpoint value is returned.

If `simulationReady` is false, fix the named missing configuration before proceeding.

## 11. Enable simulation only

Set:

```text
TRADING_V1_SIMULATION=true
```

Keep real broker execution unavailable. Do not add a live execution flag as part of this staging acceptance pass.

After deployment, `GET /api/v1/health` should show the simulation feature enabled and ready.

## 12. Sign and send V1 events

For every test request:

- serialize the exact JSON body once;
- use the same raw bytes for signing and sending;
- use the source ID that maps to the staging `source_connections` row;
- include a fresh timestamp within the accepted window;
- calculate the HMAC with the raw staging source secret;
- send headers:
  - `X-Mkety-Source-Id`
  - `X-Mkety-Timestamp`
  - `X-Mkety-Signature`;
- never print the secret itself.

Use `POST /api/v1/events`.

The response may include `simulation` diagnostics. Simulation remains non-executing even when it returns planned actions.

## 13. Acceptance matrix

Run all scenarios below and record only IDs/status/reasons—never secrets.

### A. Valid deterministic signal

Send a complete supported signal with a unique external event ID.

Verify:

- request authenticates;
- one `trading_events` row is reserved;
- interpretation is deterministic/READY;
- account policy is evaluated;
- a Position Group is persisted only when the simulation plan is READY;
- simulated child actions match TP count/volume policy;
- response has `executionEnabled = false` at the simulation boundary;
- no broker/destination request is sent.

### B. Duplicate event

Resend the exact same source + external event ID.

Verify:

- the existing event ID is returned/recognized;
- no second event row is created;
- no interpretation or simulation orchestration is re-run;
- no second Position Group is created.

### C. Invalid signature

Change the signature or body after signing.

Verify HTTP 401/fail-closed behavior and no event reservation.

### D. Ambiguous conversational signal

Send a signal that requires AI interpretation.

Verify:

- tenant AI is loaded only after source authentication resolves the workspace;
- AI timeout is bounded;
- structured output is deterministically validated;
- malformed or impossible geometry becomes review/block state, never executable action.

### E. Kill switch

Set the staging account policy kill switch on and send a valid new signal.

Verify:

- account status is BLOCKED;
- zero simulated actions;
- no new Position Group is persisted for execution.

### F. Disabled execution account

Set `execution_enabled = false`.

Verify account status is SKIPPED with zero actions.

### G. Fast-entry wait policy

Set `fast_entry_policy = wait_for_complete_signal` and send a fast/incomplete signal.

Verify status is WAITING and zero actions.

### H. Fast-entry completion / reply-thread correlation

Create an incomplete Position Group in the normal simulation flow, then send the matching completion or a management reply/thread event.

Verify:

- source instance, reply/thread metadata, symbol/side and time-window rules select the intended existing group;
- ambiguous matches become NEEDS_REVIEW;
- a second unrelated Position Group is not created.

### I. Missing market context

Remove the requested symbol from `TRADING_V1_SIMULATION_INSTRUMENTS` or its required price context.

Verify:

- simulation is BLOCKED;
- `executionEnabled = false`;
- zero actions;
- ingress/event persistence remains auditable.

## 14. Database audit after the matrix

Review the staging database for:

- one row per unique authenticated `trading_events` external event identity;
- expected canonical interpretation status;
- expected Position Groups only for allowed/READY simulation plans;
- source-event correlation identities;
- no plaintext source/provider/broker secret in new V1 tables;
- no duplicate destination/idempotency records from duplicate events.

## 15. Do not advance directly to live execution

Successful static simulation is only a staging pipeline gate.

The next adapter gates are:

1. cTrader **demo** account using live demo account catalog/quotes and the demo-safe runtime;
2. MT5 **demo** terminal/bridge using authenticated command envelopes and `order_check`/platform-side constraints;
3. MTProto listener signed V1 migration/recovery testing;
4. destination formatting profiles;
5. explicit Deriv product/API scope decision.

Only after those demo paths and safety/idempotency checks are green may deliberately tiny controlled live testing be considered.

## Rollback / stop conditions

Stop the staging exercise and disable `TRADING_V1_SIMULATION` if any of the following occurs:

- the target environment cannot be proven to be staging;
- a migration verification query fails;
- health output contains any configuration value rather than a name/boolean;
- duplicate events create duplicate state/actions;
- invalid signatures reach persistence;
- a blocked/disabled account produces actions;
- a simulation path reaches a broker/destination executor;
- secrets appear in logs or API responses;
- Trade State correlation creates/targets the wrong Position Group.

Do not work around these conditions. Fix the underlying issue and repeat the acceptance matrix.
