# Trading D1 and mkety cutover import

This data-load gate uses only the existing Cloudflare D1 database `trading-staging` and existing Coolify PostgreSQL database `mkety`. It does not create a database. Public source writes continue during export.

## Snapshot behavior

The source is not transactionally frozen. Export uses two ordered reads across the 28 reviewed tables, retains the newest full pass, then refreshes workspace identity, access, memberships, accounts, connections, routes, sources, destinations, templates, AI settings, hostnames, and runtime controls. Bounded row changes are recorded by table; the workflow stops if drift exceeds 2,000 changed rows in any table or 10,000 overall. These are rolling snapshots, not atomic snapshots. The later tables can reflect a newer instant than earlier tables.

The importer verifies exact row, key, and content parity against the captured artifact in both targets. This proves target parity with the captured snapshot, not that every source write after a table was read is included. Keep broker execution fenced and reconcile current broker state before allowing any execution or management action on migrated positions.

## Before dispatch

1. Confirm the latest successful Coolify backup is less than 24 hours old. The workflow checks this automatically.
2. Choose and record a change/incident reference for the cutover attempt. The reference is for audit only and does not pause public writes.
3. Keep the source system live. Avoid making owner/access/config changes during the short capture window where practical; the final refresh captures those tables again.
4. The importer preserves workspace access, owner membership, connections and encrypted credentials, routes, sources, destinations, AI settings, templates, and the reviewed trade/event rows. It disables global broker/live execution and non-demo account execution in the imported target.

## Dispatch

Run **Trading V1 CI** on branch `feat/trading-d1-cutover-implementation` with:

- Mode: `import-existing-trading-data`
- Confirmation: `IMPORT_TRADING_DATA_TO_EXISTING_TARGETS`
- Cutover reference: `source-cutover:<change-reference>` (for example `source-cutover:TRADING-D1-CUTOVER-2026-10-18`)

The importer refuses a Cloudflare D1 UUID other than the existing `trading-staging` UUID or a PostgreSQL connection other than database `mkety`. The private temporary Coolify app applies bounded idempotent upserts, verifies all 28 tables in both targets, then activates D1 authority epoch 1 with broker execution fenced. The workflow checks workspace/access rows and removes the temporary app in cleanup.

## After successful import

Review the table counts and bounded drift report. Confirm owner workspace/access rows are present and broker execution remains fenced. Complete production deployment promptly after this import so the snapshot-to-cutover gap stays small. If deployment is delayed or an import is rerun, recapture the source and verify exact target parity again. Keep broker execution disabled until the selected open/pending positions are reconciled against their brokers; do not assume copied statuses represent current broker truth.

The encrypted snapshot and per-target checkpoint files are temporary and deleted when the app exits/is removed. Logs contain aggregate counts and drift only, not row values or credentials.
