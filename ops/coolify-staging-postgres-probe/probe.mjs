import { createServer } from 'node:http';
import { checkStagingPostgresConnection } from './cloudflare-v2/scripts/check_staging_postgres_connection.mjs';
import { applyTradingPostgresMigrations } from './cloudflare-v2/scripts/apply_trading_postgres_migrations.mjs';
import { runTradingSnapshotImport } from './cloudflare-v2/scripts/run_trading_snapshot_import.mjs';

if (process.env.TRADING_SNAPSHOT_IMPORT_CONFIRM === 'IMPORT_TRADING_DATA_TO_EXISTING_TARGETS') {
  const result = await runTradingSnapshotImport();
  console.log(`TRADING_SNAPSHOT_IMPORT_OK=${JSON.stringify(result)}`);
} else if (process.env.TRADING_PG_SCHEMA_MIGRATION_CONFIRM === 'APPLY_TRADING_STORAGE_SCHEMA') {
  const result = await applyTradingPostgresMigrations();
  console.log(`TRADING_PG_MIGRATION_OK=${JSON.stringify(result)}`);
} else {
  const identity = await checkStagingPostgresConnection();
  console.log(`TRADING_PG_PROBE_OK=${JSON.stringify(identity)}`);
}

createServer((request, response) => {
  if (request.url !== '/health') {
    response.writeHead(404).end();
    return;
  }
  response.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' }).end('ok');
}).listen(3000, '0.0.0.0');
