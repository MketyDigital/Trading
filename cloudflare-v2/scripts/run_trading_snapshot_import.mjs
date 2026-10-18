import { readFile, unlink } from 'node:fs/promises';
import { Client } from 'pg';
import { createCloudflareD1SnapshotDatabase } from './cloudflare_d1_snapshot_database.mjs';
import {
  exportTradingDataSnapshot,
  createTradingSnapshotRestClient,
  readTradingDataSnapshot,
} from './trading_data_snapshot.mjs';
import { importTradingSnapshotToTargets } from './trading_snapshot_import_runner.mjs';

const SOURCE_PROJECT_REF = 'vdblajgxrfndjesoyayy';
const D1_ID = '4f00d59a-3d90-4146-832d-36230d5648bb';
const CONFIRMATION = 'IMPORT_TRADING_DATA_TO_EXISTING_TARGETS';

function required(name, env = process.env) {
  const value = env[name];
  if (typeof value !== 'string' || !value.trim()) throw new Error(`Missing required migration setting ${name}`);
  return value;
}

/** One-shot entrypoint for the private, disposable Coolify migration runner. */
export async function runTradingSnapshotImport({ env = process.env } = {}) {
  if (env.TRADING_SNAPSHOT_IMPORT_CONFIRM !== CONFIRMATION) {
    throw new Error('Explicit Trading snapshot import confirmation is required');
  }
  if (!/^source-cutover:[A-Z0-9][A-Z0-9-]{5,79}$/.test(String(env.TRADING_MIGRATION_CUTOVER_REFERENCE || ''))) {
    throw new Error('An auditable source cutover reference is required before exporting Trading data');
  }
  if (env.TRADING_PG_EXPECTED_DATABASE !== 'mkety') throw new Error('PostgreSQL target must be the existing mkety database');

  const masterKey = required('TRADING_MASTER_KEY', env);
  const snapshotPath = '/tmp/trading-migration.snapshot.enc';
  const checkpointPaths = {
    d1: '/tmp/trading-migration.d1.checkpoint.json',
    postgres: '/tmp/trading-migration.postgres.checkpoint.json',
  };
  let client;
  let connected = false;
  try {
    const sourceUrl = required('SUPABASE_URL', env);
    const serviceRole = required('SUPABASE_SERVICE_ROLE', env);
    const sourceHost = new URL(sourceUrl).hostname.toLowerCase();
    if (sourceHost !== `${SOURCE_PROJECT_REF}.supabase.co`) throw new Error('Migration source project does not match the reviewed Trading source');
    const source = createTradingSnapshotRestClient({ url: sourceUrl, serviceRole });
    const exported = await exportTradingDataSnapshot({
      client: source,
      masterKey,
      cutoverReference: env.TRADING_MIGRATION_CUTOVER_REFERENCE,
      sourceProjectRef: SOURCE_PROJECT_REF,
      outputPath: snapshotPath,
      pageSize: 200,
      onProgress: (event) => process.stdout.write(`snapshot_import_progress=${JSON.stringify(event)}\n`),
    });
    const d1 = createCloudflareD1SnapshotDatabase({
      apiToken: required('CLOUDFLARE_API_TOKEN', env),
      accountId: required('CLOUDFLARE_ACCOUNT_ID', env),
      databaseId: D1_ID,
    });
    const caFile = required('TRADING_PG_CA_FILE', env);
    const ca = await readFile(caFile, 'utf8');
    if (!ca.trim()) throw new Error('Coolify PostgreSQL trust certificate is empty');
    const connectionUrl = new URL(required('TRADING_PG_STAGING_DATABASE_URL', env));
    if (!['postgres:', 'postgresql:'].includes(connectionUrl.protocol)
      || decodeURIComponent(connectionUrl.pathname.replace(/^\//, '')) !== 'mkety') {
      throw new Error('PostgreSQL connection is not the existing mkety database');
    }
    connectionUrl.searchParams.set('sslmode', 'verify-ca');
    connectionUrl.searchParams.set('sslrootcert', caFile);
    connectionUrl.searchParams.set('uselibpqcompat', 'true');
    client = new Client({
      connectionString: connectionUrl.toString(),
      connectionTimeoutMillis: 10_000,
      query_timeout: 120_000,
      statement_timeout: 120_000,
    });
    await client.connect();
    connected = true;
    const pgTls = await client.query('SELECT current_database() AS database_name, current_setting(\'ssl\') AS tls_enabled');
    if (pgTls.rows?.[0]?.database_name !== 'mkety' || pgTls.rows?.[0]?.tls_enabled !== 'on') {
      throw new Error('PostgreSQL connection identity or TLS verification failed');
    }
    // pg's sslrootcert parameter resolves through libpq compatibility; the existing probe mounts the pinned Coolify CA.

    const snapshot = await readTradingDataSnapshot({ artifactPath: exported.outputPath, masterKey });
    const report = await importTradingSnapshotToTargets({
      snapshot,
      d1Database: d1,
      postgresClient: client,
      masterKey,
      checkpointPaths,
      batchSize: 50,
      onProgress: (event) => process.stdout.write(`snapshot_import_progress=${JSON.stringify(event)}\n`),
    });
    return {
      capturedAt: report.source.capturedAt,
      tables: report.d1Parity.tables,
      d1Rows: report.d1Parity.rows,
      postgresRows: report.postgresParity.rows,
      targetsParityVerified: true,
      authorityActivated: report.authority?.authority === 'd1' && report.authority?.writesFenced === false,
      importantRows: Object.fromEntries([
        'workspaces', 'trading_workspace_access', 'trading_workspace_memberships',
        'trade_accounts', 'source_connections', 'source_destination_routes',
        'trading_destinations', 'trading_destination_templates', 'ai_providers',
      ].map((name) => [name, snapshot.rowsByTable[name]?.length ?? 0])),
      fences: report.fences,
      sourceDrift: snapshot.sourceDrift,
      snapshotConsistency: 'bounded-rolling-live-source',
    };
  } finally {
    if (connected) await client.end().catch(() => {});
    await Promise.all([snapshotPath, ...Object.values(checkpointPaths), ...Object.values(checkpointPaths).map((path) => `${path}.lock`)]
      .map((path) => unlink(path).catch(() => {})));
  }
}

if (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1]) {
  runTradingSnapshotImport().then((report) => {
    process.stdout.write(`TRADING_SNAPSHOT_IMPORT_OK=${JSON.stringify(report)}\n`);
  }).catch((error) => {
    process.stderr.write(`${error?.message || 'Trading snapshot import failed'}\n`);
    process.exitCode = 1;
  });
}
