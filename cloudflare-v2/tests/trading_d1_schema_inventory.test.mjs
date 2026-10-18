import test from 'node:test';
import assert from 'node:assert/strict';
import { compareD1MigrationTableInventory } from '../scripts/trading_d1_schema_inventory.mjs';

test('D1 schema inventory accepts the exact migration table set', () => {
  const migrationSql = `
    CREATE TABLE IF NOT EXISTS "workspaces" (id TEXT PRIMARY KEY);
    CREATE TABLE IF NOT EXISTS replication_health (consumer TEXT PRIMARY KEY);
  `;
  assert.deepEqual(compareD1MigrationTableInventory({
    migrationSql,
    actualTables: ['workspaces', 'replication_health', 'd1_migrations', 'sqlite_sequence', '_cf_KV'],
  }), { expectedCount: 2, actualCount: 2, missing: [], unexpected: [] });
});

test('D1 schema inventory rejects missing and unexpected tables', () => {
  const migrationSql = `CREATE TABLE IF NOT EXISTS workspaces (id TEXT PRIMARY KEY);`;
  assert.deepEqual(compareD1MigrationTableInventory({
    migrationSql,
    actualTables: ['legacy_table', '_cf_unexpected'],
  }), { expectedCount: 1, actualCount: 2, missing: ['workspaces'], unexpected: ['_cf_unexpected', 'legacy_table'] });
  assert.throws(() => compareD1MigrationTableInventory({ migrationSql: '-- no tables', actualTables: [] }), /migration table inventory is empty/);
});
