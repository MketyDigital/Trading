# D1-first Trading storage with a PostgreSQL switch path

## User requirements

- D1 is the first authority after the cutover.
- The existing Mkety self-hosted PostgreSQL database, reached through a dedicated Hyperdrive binding, is supported as an alternate authority from the start.
- Exactly one database is authoritative for trading reads and writes at a time. The other may be a passive replica; request-time fallback and dual broker dispatch are prohibited.
- Preserve current source, routing, execution, management, recovery, admin, customer-copy, and safety behavior.
- Remove all runtime Supabase dependency only after schema, data, behavior, and recovery parity are proven.
- Perform the work with a measured cutover and minimal downtime. Do not promise zero RPO or near-zero downtime before rehearsals establish the measured values.
- Reuse the PostgreSQL database already running in Coolify. Do not provision a second Coolify database for staging or later delete it; isolate Trading in `trading_storage` and leave shared schemas untouched.

## Current repository facts (2026-10-16)

- The Worker entrypoint is `cloudflare-v2/src/v1_runtime_entry.js` and constructs a Supabase client from `SUPABASE_URL` plus service-role/anon credentials.
- `cloudflare-v2/wrangler.toml` has Queues, Durable Objects, Containers, and crons, but no D1 or Hyperdrive bindings.
- There is no D1 schema/migration directory on `main` at this point. Existing `cloudflare-v2/db/migrations/0001...0049` are PostgreSQL/Supabase migrations.
- Production dependencies include `@supabase/supabase-js`; no PostgreSQL driver is present.
- Supabase call sites include source intake/queues, events, runtime controls, route and account administration, access codes, destinations, cTrader/MT5 connector control, trade-state persistence/repair, retries, recovery, hostnames/branding, Telegram Bot API paths, VIP management, testing/acceptance commands, and legacy `src/index.js` routes/scheduled tasks.
- Numbered migrations create 21 of the 28 directly referenced tables; the other seven are created by the shared `cloudflare-v2/db/schema.sql` baseline. Later Trading migrations alter `ai_providers` and `trade_accounts`, including their workspace ownership. Historical migrations also add constraints/functions/triggers. A complete schema inventory must include every relation and RPC used by code, not only the numbered `CREATE TABLE` statements. The source mapping and credential migration requirements are recorded in `docs/SUPABASE_RUNTIME_DEPENDENCY_INVENTORY_2026-10-16.md`.
- The production trading behavior has safety requirements in root `AGENTS.md`; they remain release-blocking and unchanged.

## Architecture

1. **Final authority selection:** `TRADING_STORAGE_AUTHORITY` explicitly selects `d1` or `postgres`; absence defaults to D1 only for the future D1-first runtime. Unknown values and missing bindings fail closed.
2. **Dedicated resources:** use the existing Trading D1 database and the existing Coolify PostgreSQL service/database; do not create another Coolify database. Isolate Trading in a dedicated `trading_storage` schema and use a least-privilege role plus a dedicated Hyperdrive binding/ID over the established Workers VPC route. Preserve the existing Mkety application schema and `MKETY_DB` binding unchanged; Trading must not borrow the app's Hyperdrive identity or access its application tables. Migrate only Trading-owned relations and explicitly retained Trading legacy paths, not unrelated Mkety product/Academy tables. Cloudflare currently recommends `node-postgres` (`pg`) and documents 8.16.3 as the minimum supported version.
3. **Single writer:** each runtime version uses exactly one selected authority for all domain reads and writes. No repository-level catch-and-fallback to the other backend. Trading is denied if selected authority health or persisted epoch disagrees with the configured epoch.
4. **Passive replication:** every durable mutation is recorded transactionally in the active authority's ordered outbox with an idempotency key and authority epoch. A bounded worker replays in order, validates gaps, records checkpoints only after idempotent apply, and surfaces poison events. Direction reverses after promotion.
5. **Secret isolation:** replication payloads use table/domain allowlists. Provider and broker secrets are excluded or copied only as ciphertext. No generic trigger may serialize rows containing plaintext credentials.
6. **Cutover:** pause or durably buffer ingress and consumers; wait for in-flight requests, Queue batches, cron recovery, and uncertain broker commands to settle/reconcile; fence the old writer; drain replication; compare critical rows/state; advance authority epoch and activate one target; verify controls, routing, account safety, and recovery; resume consumers. Rollback is a reverse promotion with a new epoch, never simultaneous writes.
7. **RPO/RTO claims:** asynchronous replication has nonzero RPO unless zero lag is established at promotion. Measure interruption, backlog, state comparison, replay, and rollback in rehearsals before setting availability claims.

## Phased implementation gates

### Phase A — foundation (local code only)

- Define authority resolver, epoch/fencing state, dedicated binding names, journal schemas, ordered replay, gaps, checkpoints, and switch preconditions.
- Port the global trading/broker/LIVE runtime controls as the first dual-backend conformance repository; each read/write checks persisted authority, epoch, and fence state.
- Build a complete table/RPC/route/scheduled-job inventory, including secrets and legacy branches.
- No production environment or database mutation.

### Phase B — schema and domain repositories

- Convert the full current relational schema into D1 and dedicated PostgreSQL schema migrations; prove constraints, unique indexes, transactions, JSON semantics, timestamp/UUID behavior, and query limits.
- Define backend-neutral domain repositories for each durable store and compose all active paths through them.
- Add transactional outbox writes to every durable mutation and explicit secret-safe serialization.
- Preserve old Supabase adapter only for a temporary read-only parity exporter; remove it from runtime composition after parity.

### Phase C — shadow parity, no trading authority

- Copy current data into D1 and dedicated PostgreSQL; validate row counts, keyed checksums, foreign-key relationships, critical runtime controls, active routes/accounts, open positions, pending orders, retries, and recovery cursors.
- Replay changes into passive stores and compare continuously. Do not dispatch trading from shadow data.
- Exercise all behavior/regression tests against both adapters.

### Phase D — staged D1 activation

- Use a controlled maintenance window and the cutover procedure. D1 becomes the only active authority; PostgreSQL remains passive and is kept caught up.
- Run the full DEMO acceptance matrix and observe source ingestion, broker execution, management, completion/protection, reconciliation, recovery, customer access, and ops for an agreed soak period.
- Roll back only by fencing D1 and promoting caught-up PostgreSQL under a higher epoch.

### Phase E — Supabase removal and PostgreSQL switch rehearsal

- Remove Supabase Worker secrets, package and code paths only after proving no active or scheduled callsite requires them, and after validated backup/export retention.
- Rehearse D1 -> PostgreSQL -> D1 with queue/cron fences, epoch checks, row-level parity, broker uncertainty handling, observed RPO/RTO, and safety gate checks.
- Production switch capability is not declared complete until both directions pass in a production-like environment.

## Exit criteria

- Static inventory reports zero runtime Supabase imports, environment reads, REST calls, SQL triggers, scheduled calls, or admin-only paths; any dev/acceptance-only Supabase tooling is clearly isolated.
- All D1 and PostgreSQL repository conformance tests pass and all existing trading behavior tests remain green.
- Every mutation has an atomic outbox record; replay is ordered, idempotent, bounded, and monitored.
- No secrets are emitted in logs, journal payloads, snapshots, or test artifacts.
- Both switch directions and rollback are rehearsed with measured nonzero/zero lag and interruption evidence.
- DEMO acceptance matrix from `AGENTS.md` is green; LIVE controls remain disabled unless separately and explicitly authorized.
- Current production remains untouched until the staged change is explicitly released.
