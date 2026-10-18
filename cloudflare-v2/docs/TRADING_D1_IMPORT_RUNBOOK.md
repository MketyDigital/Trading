# Trading continuity fresh-start import

This one-shot migration uses only the existing Cloudflare D1 database `trading-staging` and the existing Coolify PostgreSQL database `mkety`. It does not provision a database. The live Supabase source remains available and public writes are not paused.

## Data carried forward

The explicit `continuity-fresh-start` profile copies 20 tables needed for workspace continuity and future incoming events:

- Workspaces, owners, access, memberships, access codes/redemptions, hostnames, VIP members and deposits.
- Trading accounts and their encrypted credentials, source connections/secrets, source feeds, ingress collectors, and the orphan-recovery high-water cursor.
- Routes, destinations, destination connections/credentials, templates, AI providers/settings, and runtime controls.

For Trading V1, `trading_workspace_access` is the canonical workspace/owner identity table; memberships, hostnames, access codes, accounts, sources, routes, destinations, templates, and AI providers reference those IDs. The legacy `workspaces` table is copied when it has rows (including its Telegram Bot API fields), but it may be empty without meaning that Trading V1 has no workspaces. Import acceptance requires at least one row across `workspaces` and `trading_workspace_access`, and separately requires non-empty canonical workspace access plus exact parity for every included table. If legacy `workspaces` is empty, incoming-source continuity comes from the preserved source connections, feeds, routes, account connections, destination settings, and runtime controls.

The importer encrypts legacy workspace Telegram bot tokens and AI provider keys using the target secret-box format, rejects plaintext credentials in the snapshot, and fences broker execution in global controls and LIVE accounts. Existing account and routing identities are retained so new events can follow the same workspace and route configuration.

It deliberately does not carry forward `signal_logs`, `trading_events`, `position_groups`, `position_legs`, `destination_deliveries`, `trading_event_revisions`, `operation_journal`, or temporary cTrader OAuth states. This drops the stale trade/execution history and outstanding delivery retry state. The recovery cursor is retained to avoid rescanning older orphaned events. Public source writes continue during the rolling capture, so events that arrive in the capture/cutover gap can be missed as authorized by the owner.

## Target reset and safety

Before importing, the workflow verifies the exact existing D1 UUID and `mkety` database identity, TLS to PostgreSQL, a recent successful Coolify PostgreSQL backup, and a D1 pre-reset export. The D1 export is encrypted with `TRADING_MASTER_KEY`, uploaded as a private GitHub Actions artifact with seven-day retention, and its plaintext temporary file is removed before the destructive runner is created. The artifact name includes the workflow run ID. The export is recovery evidence for the staging target; the workflow does not automatically restore it.

The importer refuses to reset either target if a prior per-target checkpoint or checkpoint lock exists. This prevents reset from deleting rows that a checkpoint would later cause the importer to skip. After confirming that no importer is active, review/remove only the exact stale checkpoint/lock files in the transient runner before retrying; the normal workflow deletes its temporary runner at completion. It then fences storage writes on both targets and deletes rows only from the 28 reviewed Trading domain tables, in reverse schema dependency order. It preserves D1/PostgreSQL authority-control and replication metadata, schemas, every non-Trading schema, and all source data.

It imports only the 20 allowlisted tables into both targets, verifies exact row/key/content parity, and verifies all eight excluded operational tables are empty in both targets. Only after these checks does it activate D1 storage authority epoch 1. The existing PostgreSQL authority remains fenced as a standby. The D1 staging target remains unbound to the production Worker until separately reviewed.

Broker execution remains disabled in imported runtime controls and LIVE account rows. Incoming message ingestion/routing can be smoke-tested, but automatic broker orders must remain blocked until the two manually managed broker positions are reconciled and execution is deliberately re-enabled through the approved operator process.

## Dispatch

Run **Trading V1 CI** on branch `feat/trading-d1-cutover-implementation` with:

- Mode: `import-continuity-fresh-start`
- Confirmation: `IMPORT_TRADING_CONTINUITY_FRESH_START`
- Cutover reference: `source-cutover:<change-reference>`

The workflow runs CI first, requires a recent existing Coolify PostgreSQL backup, checks/exports the existing staging D1, and deploys a private temporary Coolify runner at the exact reviewed commit. The runner cleans up the encrypted source snapshot and checkpoints; the workflow deletes the temporary Coolify app even on failure. Logs show aggregate counts and table names only, not row values or credentials.

## Acceptance after import

Before any production binding change, verify the 20-table target parity report, preserved owner/workspace/access counts, retained source/recovery configuration, empty excluded history tables, storage authority state, and broker execution fence. Then run non-trading ingress and destination smoke checks against the target to prove a newly received event can be authenticated, persisted, routed, and delivered exactly once. Do not place a broker order during this check.

This import alone does not remove all Supabase runtime dependencies or perform production cutover. Production must remain on its current runtime until the runtime fallback audit, production bindings, rollback path, and end-to-end acceptance are complete. Do not enable LIVE execution automatically.
