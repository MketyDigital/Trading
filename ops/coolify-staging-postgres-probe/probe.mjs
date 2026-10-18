import { checkStagingPostgresConnection } from './cloudflare-v2/scripts/check_staging_postgres_connection.mjs';
import { applyTradingPostgresMigrations } from './cloudflare-v2/scripts/apply_trading_postgres_migrations.mjs';
import { runTradingSnapshotImport } from './cloudflare-v2/scripts/run_trading_snapshot_import.mjs';
import { startProbeRuntime } from './probe_runtime.mjs';

if (process.env.TRADING_SNAPSHOT_IMPORT_CONFIRM === 'IMPORT_TRADING_DATA_TO_EXISTING_TARGETS') {
  await startProbeRuntime({
    runTask: runTradingSnapshotImport,
    successMarker: 'TRADING_SNAPSHOT_IMPORT_OK='
  });
} else if (process.env.TRADING_PG_SCHEMA_MIGRATION_CONFIRM === 'APPLY_TRADING_STORAGE_SCHEMA') {
  await startProbeRuntime({
    runTask: applyTradingPostgresMigrations,
    successMarker: 'TRADING_PG_MIGRATION_OK='
  });
} else {
  await startProbeRuntime({
    runTask: checkStagingPostgresConnection,
    successMarker: 'TRADING_PG_PROBE_OK='
  });
}
