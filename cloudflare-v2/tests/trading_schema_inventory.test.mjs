import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const snapshot = JSON.parse(readFileSync(resolve(root, '../docs/supabase-trading-schema-snapshot-2026-10-17.json'), 'utf8'));
const baseline = readFileSync(resolve(root, 'db/schema.sql'), 'utf8');
const numberedMigrations = readdirSync(resolve(root, 'db/migrations'))
  .filter(name => name.endsWith('.sql'))
  .map(name => ({ name, sql: readFileSync(resolve(root, 'db/migrations', name), 'utf8') }));

test('all production-referenced tables have a checked-in creation source', () => {
  const missing = snapshot.tables.filter(({ name }) => {
    const createPattern = new RegExp(`CREATE\\s+TABLE(?:\\s+IF\\s+NOT\\s+EXISTS)?\\s+(?:public\\.)?${name}\\b`, 'i');
    return !createPattern.test(baseline) && !numberedMigrations.some(({ sql }) => createPattern.test(sql));
  }).map(({ name }) => name);
  assert.deepEqual(missing, []);
  assert.equal(snapshot.tables.length, 28);
});

test('legacy shared tables remain accounted for separately from Trading migrations', () => {
  const legacy = ['workspaces', 'ai_providers', 'signal_routes', 'trade_accounts', 'vip_members', 'bank_deposits', 'signal_logs'];
  for (const name of legacy) {
    assert.match(baseline, new RegExp(`CREATE\\s+TABLE(?:\\s+IF\\s+NOT\\s+EXISTS)?\\s+public\\.${name}\\b`, 'i'));
  }
  assert.ok(numberedMigrations.some(({ sql }) => /ALTER TABLE public\.ai_providers/i.test(sql)));
  assert.ok(numberedMigrations.some(({ sql }) => /ALTER TABLE public\.trade_accounts/i.test(sql)));
});
