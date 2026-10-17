# Supabase runtime dependency inventory — 2026-10-16

This inventory uses the restored `MketyDigital/Trading` `main` snapshot at commit `d71c6ea471d33a20d6545d73cacf9550a8a9517c` and read-only metadata from Supabase project `Mkety Digital` (`vdblajgxrfndjesoyayy`, status `ACTIVE_HEALTHY`, Postgres 17.6.1.121). It exists to prevent a partial migration from being described as Supabase-free.

The read-only column/key inventory for the 28 live-referenced tables is preserved in [`supabase-trading-schema-snapshot-2026-10-17.json`](./supabase-trading-schema-snapshot-2026-10-17.json). It contains schema metadata and row counts only, not production row contents or credentials.

The project contains other Mkety application, content, and Academy tables. This migration scope is the Trading Worker dependencies only; moving those other product domains would expand risk and is not required to remove the Trading Worker's Supabase dependency.

## Direct table references

Static scan of `cloudflare-v2/src/**/*.js` found 28 distinct `.from(...)` table names:

```text
ai_providers
bank_deposits
destination_deliveries
operation_journal
orphan_signal_recovery_cursors
position_groups
position_legs
signal_logs
signal_routes
source_connections
source_destination_routes
source_feeds
trade_accounts
trading_access_code_redemptions
trading_access_codes
trading_ctrader_oauth_states
trading_destination_connections
trading_destination_templates
trading_destinations
trading_event_revisions
trading_events
trading_ingress_collectors
trading_runtime_controls
trading_workspace_access
trading_workspace_hostnames
trading_workspace_memberships
vip_members
workspaces
```

The numbered Trading migrations create 21 of the 28 referenced tables. The other seven (`workspaces`, `ai_providers`, `signal_routes`, `trade_accounts`, `vip_members`, `bank_deposits`, and `signal_logs`) are created in `cloudflare-v2/db/schema.sql`, the shared Mkety/Supabase baseline. Their ownership is therefore split: the baseline creates them, then numbered Trading migrations alter `ai_providers` and `trade_accounts` and repoint their tenant foreign keys to Trading-owned workspaces. The schema conversion must use the final production snapshot plus the full baseline-and-migration history; copying only the numbered `CREATE TABLE` statements would omit seven required tables and would miss later column, constraint, index, and trigger changes.

### Creation sources for all referenced tables

| Source definition | Tables |
| --- | --- |
| `cloudflare-v2/db/schema.sql` | `workspaces`, `ai_providers`, `signal_routes`, `trade_accounts`, `vip_members`, `bank_deposits`, `signal_logs` |
| `0001_enterprise_trading_foundation.sql` | `trading_workspace_access`, `source_connections`, `trading_events`, `position_groups`, `position_legs`, `destination_deliveries` |
| `0009_trading_workspace_memberships.sql` | `trading_workspace_memberships` |
| `0013_trading_workspace_hostnames.sql` | `trading_workspace_hostnames` |
| `0014_trading_access_code_onboarding.sql` | `trading_access_codes`, `trading_access_code_redemptions` |
| `0015_trading_destinations_templates_routes.sql` | `trading_destination_templates`, `trading_destinations`, `source_destination_routes` |
| `0017_trading_runtime_controls.sql` | `trading_runtime_controls` |
| `0024_ctrader_oauth_states.sql` | `trading_ctrader_oauth_states` |
| `0027_external_mtproto_collectors.sql` | `trading_ingress_collectors` |
| `0035_source_feeds_and_route_scope.sql` | `source_feeds` |
| `0036_reusable_destination_connections.sql` | `trading_destination_connections` |
| `0039_trading_event_revisions.sql` | `trading_event_revisions` |
| `0042_operation_journal.sql` | `operation_journal` |
| `0049_orphan_signal_recovery_cursor.sql` | `orphan_signal_recovery_cursors` |

The shared baseline also defines `listener_nodes`, which is not among the Trading Worker's current 28 direct table references. Do not migrate it merely because it appears in the shared schema file; first confirm whether any active Trading code still uses it.

### Credential migration requirements

The shared baseline allowed plaintext `workspaces.tg_bot_token` and `ai_providers.api_key`. Current code supports encrypted AI provider credentials in `ai_providers.api_key_ciphertext`; trade accounts, sources, and destinations also have ciphertext fields. The production metadata snapshot deliberately has no rows, so it does not reveal how many legacy plaintext credentials remain. Before any data copy, inventory credential-bearing rows without returning secret values, encrypt any still-needed legacy values with the existing `TRADING_MASTER_KEY` secret-box format, validate ciphertext can be decrypted in a controlled environment, then replicate only ciphertext and safe identifier hashes. Replication journals, logs, snapshots, and parity reports must never contain plaintext credentials.

The connected production project's read-only table metadata reports these current sizes: `trading_events` 6,799 rows; `position_groups` 1,036; `position_legs` 1,854; `destination_deliveries` 5,551; `trading_event_revisions` 2,333; `operation_journal` 50,269; `source_feeds` 9; `source_connections` 3; `source_destination_routes` 18; `trading_destinations` 12; `trade_accounts` 7; `ai_providers` 3. These counts are useful for initial sizing, not a checksum or a migration-readiness proof.

## RPC references

- `rotate_trading_access_code`
- `trading_set_default_source`

These functions need D1/PostgreSQL repository equivalents or their callsites must be retired with behavior-owner signoff. SQL `rpc` scan alone does not identify dynamic names.

## Active Worker and runtime dependency areas

The entrypoint `src/v1_runtime_entry.js` creates Supabase for the V1 event/admin/external/webhook paths. `src/v1_entry.js` also provides public branding/hostname-proof access and delegates legacy routes. Additional Supabase-specific modules include:

- Durable trade state, runtime controls, source queue and ingest: `src/persistence/supabase_*`, `src/storage/supabase_ingest_store.js`, `src/sources/source_queue_runtime.js`, `src/sources/orphan_signal_recovery_runtime.js`, `src/sources/mtproto/recovery_runtime.js`.
- Access/customer/admin: `src/access/trading_access_codes.js`, `src/security/trading_membership_store.js`, `src/http/v1_*`, Telegram admin/webhook, connector/admin control and repair endpoints.
- Execution state and recovery: destination retry, broker TP fill protection, binding repair, live group repair, operation journal, and production execution dependencies.
- Legacy scheduled code: `src/index.js` and `src/vip/vip_manager.js` include data paths outside the main V1 repository seam. `wrangler.toml` currently runs both `*/15 * * * *` and `* * * * *` cron schedules.
- Acceptance/diagnostic commands in `src/testing/` use Supabase directly. They may remain only if explicitly classified as isolated tooling with no Worker production import path and with documented credentials.

Environment-variable scan still finds `SUPABASE_URL` in the runtime entry, legacy entry, webhook/admin/connector endpoints, recovery workers, membership/access paths, and readiness/config helpers. `@supabase/supabase-js` remains a production package dependency.

## Migration classification required

Before a complete port, assign each of the 28 tables, two RPCs, and each Supabase client factory one disposition:

1. migrate to the D1/PostgreSQL dual backend using a domain repository;
2. retain as isolated local acceptance tooling only; or
3. retire with an explicit behavior and data-retention decision.

Each migrated table needs D1 and PostgreSQL schema parity, indexes and uniqueness, foreign-key/delete behavior, security/ownership checks, query pagination bounds, retention/cleanup policy, and a secret-safe outbox projection. Generic row replication must not copy plaintext `ai_providers.api_key` or any connection credentials.

## Cost/egress implications

One read-only query over the project's unified logs for the preceding 24 hours returned 161,016 `edge_logs`, 3,821 `postgrest_logs`, 3,483 `postgres_logs`, 62 `supavisor_logs`, 2 `auth_audit_logs`, and 2 `auth_logs`. The PostgREST log records exposed only project/host/sequence metadata keys in that query; they did not identify request paths or response bytes. These counts aggregate the whole project, not only the Trading Worker, and are not billable egress measurements.

The source tree and logs prove numerous runtime call paths and sustained request activity but do not prove billable bytes per service or per Trading endpoint. Obtain provider usage metrics for actual egress and add route-level request counts, response sizes, and query timings before setting savings targets. Supabase removal alone will not make D1 cheap if repeated reads, unbounded scans, or polling remain; measure those after repositories are instrumented and before choosing cache/retention changes.
