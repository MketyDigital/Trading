import test from 'node:test';
import assert from 'node:assert/strict';
import { activatePopulatedTradingD1Authority, assertTradingSnapshotTargetIdentities, verifyTradingSnapshotTarget } from '../scripts/trading_snapshot_import_runner.mjs';

const snapshot = {
  rowsByTable: { workspaces: [{ id: 'ws-1', name: 'Owner workspace', enabled: false }] },
  tableManifest: [{ name: 'workspaces', primaryKeys: ['id'] }],
};
const definitions = {
  workspaces: {
    columns: [
      { name: 'id', type: 'TEXT' },
      { name: 'name', type: 'TEXT' },
      { name: 'enabled', type: 'INTEGER' },
    ],
    primaryKeys: ['id'],
  },
};

test('target parity verifies row counts, keys, and transformed row contents', async () => {
  const result = await verifyTradingSnapshotTarget({
    target: 'd1',
    database: { async query() { return { results: [{ id: 'ws-1', name: 'Owner workspace', enabled: 0 }] }; } },
    rowsByTable: snapshot.rowsByTable,
    tableManifest: snapshot.tableManifest,
    tableDefinitions: definitions,
    masterKey: 'test-master-key',
  });

  assert.deepEqual(result, { target: 'd1', tables: 1, rows: 1, verifiedRows: { workspaces: 1 } });
});

test('target parity rejects content drift for a matching primary key', async () => {
  await assert.rejects(() => verifyTradingSnapshotTarget({
    target: 'd1',
    database: { async query() { return { results: [{ id: 'ws-1', name: 'Wrong owner workspace', enabled: 0 }] }; } },
    rowsByTable: snapshot.rowsByTable,
    tableManifest: snapshot.tableManifest,
    tableDefinitions: definitions,
    masterKey: 'test-master-key',
  }), /parity mismatch for workspaces/i);
});

test('target parity rejects extra target rows and unsupported targets', async () => {
  const input = {
    target: 'd1',
    database: { async query() { return { results: [
      { id: 'ws-1', name: 'Owner workspace', enabled: 0 },
      { id: 'unexpected', name: 'Extra row', enabled: 0 },
    ] }; } },
    rowsByTable: snapshot.rowsByTable,
    tableManifest: snapshot.tableManifest,
    tableDefinitions: definitions,
    masterKey: 'test-master-key',
  };
  await assert.rejects(() => verifyTradingSnapshotTarget(input), /parity mismatch for workspaces/i);
  await assert.rejects(() => verifyTradingSnapshotTarget({ ...input, target: 'unknown' }), /target must be d1 or postgres/i);
});

test('PostgreSQL numeric strings and timestamp values normalize to the snapshot representation', async () => {
  const rowsByTable = { workspaces: [{ id: 'ws-1', leverage: 0.01, created_at: '2026-10-18T00:00:00.000Z' }] };
  await verifyTradingSnapshotTarget({
    target: 'postgres',
    database: { async query() { return { rows: [{ id: 'ws-1', leverage: '0.010000', created_at: new Date('2026-10-18T00:00:00.000Z') }] }; } },
    rowsByTable,
    tableManifest: [{ name: 'workspaces', primaryKeys: ['id'] }],
    tableDefinitions: { workspaces: { columns: [
      { name: 'id', type: 'text' }, { name: 'leverage', type: 'numeric' },
      { name: 'created_at', type: 'timestamp with time zone' },
    ], primaryKeys: ['id'] } },
    masterKey: 'test-master-key',
  });
});

test('import target identity check requires the existing named D1 and mkety database', async () => {
  const d1Database = { identity: { databaseId: '4f00d59a-3d90-4146-832d-36230d5648bb', databaseName: 'trading-staging' } };
  const postgresClient = { async query() { return { rows: [{ database_name: 'mkety' }] }; } };
  assert.deepEqual(await assertTradingSnapshotTargetIdentities({ d1Database, postgresClient }), {
    d1: 'trading-staging', postgres: 'mkety',
  });
  await assert.rejects(() => assertTradingSnapshotTargetIdentities({
    d1Database: { identity: { ...d1Database.identity, databaseName: 'other' } }, postgresClient,
  }), /approved existing trading-staging/i);
  await assert.rejects(() => assertTradingSnapshotTargetIdentities({
    d1Database, postgresClient: { async query() { return { rows: [{ database_name: 'other' }] }; } },
  }), /existing mkety/i);
});

test('D1 authority activates only after verified D1 and PostgreSQL parity', async () => {
  const statements = [];
  let writesFenced = 1;
  const database = { async query(sql) {
    statements.push(sql);
    if (sql.trimStart().startsWith('SELECT')) return { results: [{ active_authority: 'd1', authority_epoch: 1, writes_fenced: writesFenced }] };
    writesFenced = 0;
    return { meta: { changes: 1 }, results: [] };
  } };
  const parity = {
    d1: { target: 'd1', tables: 28, rows: 6 },
    postgres: { target: 'postgres', tables: 28, rows: 6 },
  };
  assert.deepEqual(await activatePopulatedTradingD1Authority({ database, parity }), {
    authority: 'd1', authorityEpoch: 1, writesFenced: false,
  });
  assert.equal(statements.length, 3);
  assert.match(statements[1], /UPDATE trading_storage_control/);
  await assert.rejects(() => activatePopulatedTradingD1Authority({ database, parity: {
    ...parity, postgres: { ...parity.postgres, rows: 5 },
  } }), /parity verification/i);
});
