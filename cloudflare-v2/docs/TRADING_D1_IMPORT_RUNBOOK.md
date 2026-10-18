# Trading D1 and mkety import

This is the one-time data-load gate before the production Worker is changed. It uses only the existing Cloudflare D1 database `trading-staging` and the existing Coolify PostgreSQL database `mkety`. It does not create a database.

## Before dispatch

1. Confirm the latest successful Coolify backup is less than 24 hours old. The workflow checks this automatically.
2. Pause Trading writes at their sources and hold them paused through import, production Worker deployment, and the first production health/access checks. Include owner configuration changes, webhook/API ingress, and broker event ingress in that pause. If there is no reliable way to pause writes without losing incoming events, do not dispatch yet; first arrange a short maintenance window or a durable upstream queue.
3. Keep broker execution disabled. The import forces the global broker and live-broker controls off and disables non-demo account execution. It preserves workspace access, workspace owner membership, connections, credentials in encrypted form, routes, sources, destinations, AI settings, templates, and all reviewed trade/event rows.

## Dispatch

Run **Trading V1 CI** on branch `feat/trading-d1-cutover-implementation` with:

- Mode: `import-existing-trading-data`
- Confirmation: `IMPORT_TRADING_DATA_TO_EXISTING_TARGETS`
- Freeze evidence: `source-freeze:<change-reference>` (for example, an approved change or incident ID)

The evidence value records the operator’s pause; it does not pause traffic itself. The exporter performs two ordered reads of the 28-table allowlist and aborts if it detects any source drift. The import also refuses a Cloudflare D1 UUID other than the existing `trading-staging` UUID or a PostgreSQL connection other than database `mkety`.

The private temporary Coolify app encrypts the snapshot, applies bounded idempotent upserts, and checks row count, primary keys, and row content in both targets. It refuses extra target rows and content mismatches. Only after both targets pass exact parity does it activate D1 authority epoch 1; broker execution remains fenced. The workflow verifies owner workspace/access rows and removes the temporary app in its cleanup step.

## After successful import

Keep the source paused. Confirm the workflow reports all 28 tables, full D1/PostgreSQL parity, preserved owner access, D1 authority active, and broker execution fenced. Then proceed to the separately reviewed production Worker binding/deploy gate. Do not resume source writes between import and that deployment, or the copied state will become stale. Resume ingress only after the production health and owner-access checks pass. Keep broker execution off until pending/open trade reconciliation is reviewed explicitly.

The snapshot and checkpoint files exist only in the private ephemeral container and are removed when it is deleted. The workflow logs only table counts, source timestamps, drift counts, and parity summaries; it does not print row values or credentials.
