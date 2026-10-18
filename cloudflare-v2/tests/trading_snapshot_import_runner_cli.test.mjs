import test from 'node:test';
import assert from 'node:assert/strict';
import { runTradingSnapshotImport } from '../scripts/run_trading_snapshot_import.mjs';

test('private importer refuses to start without exact import confirmation and a cutover reference', async () => {
  await assert.rejects(() => runTradingSnapshotImport({ env: {} }), /explicit trading snapshot import confirmation/i);
  await assert.rejects(() => runTradingSnapshotImport({ env: {
    TRADING_SNAPSHOT_IMPORT_CONFIRM: 'IMPORT_TRADING_CONTINUITY_FRESH_START',
    TRADING_PG_EXPECTED_DATABASE: 'mkety',
  } }), /source cutover reference/i);
  await assert.rejects(() => runTradingSnapshotImport({ env: {
    TRADING_SNAPSHOT_IMPORT_CONFIRM: 'IMPORT_TRADING_CONTINUITY_FRESH_START',
    TRADING_MIGRATION_CUTOVER_REFERENCE: 'source-cutover:CHANGE-123',
    TRADING_PG_EXPECTED_DATABASE: 'mkety',
  } }), /TRADING_MASTER_KEY/);
});
