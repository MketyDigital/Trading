import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resetTradingContinuityTargets, verifyTradingSnapshotExcludedTablesEmpty } from '../scripts/trading_snapshot_import_runner.mjs';

function makeTargets({ d1Id = '4f00d59a-3d90-4146-832d-36230d5648bb', excludedRows = 0 } = {}) {
  const d1Calls = [];
  const pgCalls = [];
  let d1Fenced = 0;
  let pgFenced = false;
  const d1 = {
    identity: { databaseName: 'trading-staging', databaseId: d1Id },
    async query(sql) {
      d1Calls.push(sql.trim());
      if (/SELECT active_authority, authority_epoch, writes_fenced/.test(sql)) {
        return { results: [{ active_authority: 'd1', authority_epoch: 1, writes_fenced: d1Fenced }] };
      }
      if (/UPDATE trading_storage_control SET writes_fenced = 1/.test(sql)) d1Fenced = 1;
      return { meta: { changes: 1 }, results: [] };
    },
    async deleteAllDomainTables(names) { d1Calls.push({ reset: names }); },
  };
  const pg = {
    async query(sql) {
      pgCalls.push(sql.trim());
      if (/SELECT current_database/.test(sql)) return { rows: [{ database_name: 'mkety' }] };
      if (/SELECT active_authority, authority_epoch, writes_fenced/.test(sql)) {
        return { rows: [{ active_authority: 'd1', authority_epoch: 1, writes_fenced: pgFenced }] };
      }
      if (/UPDATE trading_storage\.authority_control SET writes_fenced = true/.test(sql)) pgFenced = true;
      if (/SELECT COUNT\(\*\) AS row_count/.test(sql)) return { rows: [{ row_count: excludedRows }] };
      return { rows: [] };
    },
  };
  return { d1, pg, d1Calls, pgCalls };
}

test('fresh-start reset fences both existing targets and deletes only domain rows in reverse dependency order', async () => {
  const targets = makeTargets();
  const directory = await mkdtemp(join(tmpdir(), 'trading-snapshot-reset-test-'));
  try {
    const checkpointPaths = { d1: join(directory, 'd1.checkpoint.json'), postgres: join(directory, 'pg.checkpoint.json') };
    const result = await resetTradingContinuityTargets({ d1Database: targets.d1, postgresClient: targets.pg, checkpointPaths });
    assert.deepEqual(result, { tablesResetPerTarget: 28, storageAuthorityPreserved: true, writesFenced: true });
    const d1Reset = targets.d1Calls.find((call) => call && typeof call === 'object' && call.reset);
    assert.equal(d1Reset.reset.length, 28);
    assert.match(targets.d1Calls.find((call) => typeof call === 'string' && call.startsWith('UPDATE trading_storage_control')), /writes_fenced = 1/);
    assert.match(targets.pgCalls.find((call) => call.startsWith('UPDATE trading_storage.authority_control')), /writes_fenced = true/);
    const deletes = targets.pgCalls.filter((call) => call.startsWith('DELETE FROM trading_storage.'));
    assert.equal(deletes.length, 28);
    assert.match(deletes[0], /"operation_journal"/);
    assert.match(deletes.at(-1), /"runtime_controls"/);
    assert.ok(targets.pgCalls.includes('COMMIT'));
    assert.equal(targets.pgCalls.some((call) => /DELETE FROM trading_storage\."(?:authority_control|replication_)/.test(call)), false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('fresh-start reset refuses a different D1 identity before any target deletion', async () => {
  const targets = makeTargets({ d1Id: 'a'.repeat(36) });
  await assert.rejects(() => resetTradingContinuityTargets({ d1Database: targets.d1, postgresClient: targets.pg }), /approved existing staging targets/);
  assert.equal(targets.d1Calls.some((call) => call && typeof call === 'object' && call.reset), false);
  assert.equal(targets.pgCalls.some((call) => call.startsWith('DELETE FROM')), false);
});

test('fresh-start reset rejects stale import checkpoints before deleting either target', async () => {
  const targets = makeTargets();
  const directory = await mkdtemp(join(tmpdir(), 'trading-snapshot-checkpoint-test-'));
  const checkpointPaths = { d1: join(directory, 'd1.checkpoint.json'), postgres: join(directory, 'pg.checkpoint.json') };
  try {
    await writeFile(checkpointPaths.d1, '{"appliedRows":50}\n', { mode: 0o600 });
    await assert.rejects(
      resetTradingContinuityTargets({ d1Database: targets.d1, postgresClient: targets.pg, checkpointPaths }),
      /existing import checkpoint or lock/,
    );
    assert.equal(targets.d1Calls.some((call) => call && typeof call === 'object' && call.reset), false);
    assert.equal(targets.pgCalls.some((call) => call.startsWith('DELETE FROM')), false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('fresh-start reset rejects a live checkpoint lock before deleting either target', async () => {
  const targets = makeTargets();
  const directory = await mkdtemp(join(tmpdir(), 'trading-snapshot-lock-test-'));
  const checkpointPaths = { d1: join(directory, 'd1.checkpoint.json'), postgres: join(directory, 'pg.checkpoint.json') };
  try {
    await writeFile(`${checkpointPaths.postgres}.lock`, '{"pid":123}\n', { mode: 0o600 });
    await assert.rejects(
      resetTradingContinuityTargets({ d1Database: targets.d1, postgresClient: targets.pg, checkpointPaths }),
      /existing import checkpoint or lock/,
    );
    assert.equal(targets.d1Calls.some((call) => call && typeof call === 'object' && call.reset), false);
    assert.equal(targets.pgCalls.some((call) => call.startsWith('DELETE FROM')), false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('excluded operational tables must be empty in each target after the selective import', async () => {
  const d1 = { async query() { return { results: [{ row_count: 0 }] }; } };
  const pg = { async query() { return { rows: [{ row_count: 0 }] }; } };
  const includedTableNames = [
    'workspaces', 'trading_workspace_access', 'trading_workspace_memberships', 'trading_access_codes',
    'trading_access_code_redemptions', 'trading_runtime_controls', 'source_connections', 'source_feeds',
    'source_destination_routes', 'signal_routes', 'trading_destinations', 'trading_destination_templates',
    'trading_destination_connections', 'ai_providers', 'trade_accounts', 'trading_workspace_hostnames',
    'trading_ingress_collectors', 'vip_members', 'bank_deposits', 'orphan_signal_recovery_cursors',
  ];
  const [d1Result, pgResult] = await Promise.all([
    verifyTradingSnapshotExcludedTablesEmpty({ target: 'd1', database: d1, includedTableNames }),
    verifyTradingSnapshotExcludedTablesEmpty({ target: 'postgres', database: pg, includedTableNames }),
  ]);
  assert.equal(d1Result.tables, 8);
  assert.equal(pgResult.tables, 8);
  assert.equal(d1Result.rows + pgResult.rows, 0);
  await assert.rejects(() => verifyTradingSnapshotExcludedTablesEmpty({
    target: 'd1', database: { async query() { return { results: [{ row_count: 1 }] }; } }, includedTableNames,
  }), /excluded table is not empty/);
});
