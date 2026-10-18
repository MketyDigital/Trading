import test from 'node:test';
import assert from 'node:assert/strict';
import { runTradingSnapshotImport } from '../scripts/run_trading_snapshot_import.mjs';

test('private importer refuses to start without explicit import and source-pause evidence', async () => {
  await assert.rejects(() => runTradingSnapshotImport({ env: {} }), /explicit trading snapshot import confirmation/i);
  await assert.rejects(() => runTradingSnapshotImport({ env: {
    TRADING_SNAPSHOT_IMPORT_CONFIRM: 'IMPORT_TRADING_DATA_TO_EXISTING_TARGETS',
    TRADING_PG_EXPECTED_DATABASE: 'mkety',
  } }), /source pause evidence/i);
  await assert.rejects(() => runTradingSnapshotImport({ env: {
    TRADING_SNAPSHOT_IMPORT_CONFIRM: 'IMPORT_TRADING_DATA_TO_EXISTING_TARGETS',
    TRADING_MIGRATION_FREEZE_EVIDENCE: 'source-freeze:CHANGE-123',
    TRADING_PG_EXPECTED_DATABASE: 'mkety',
  } }), /TRADING_MASTER_KEY/);
});
