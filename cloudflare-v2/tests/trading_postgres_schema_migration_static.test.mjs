import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const here = new URL('.', import.meta.url);
const sql = readFileSync(new URL('../db/postgres-migrations/0002_trading_domain_schema.sql', here), 'utf8');
const foundationSql = readFileSync(new URL('../db/postgres-migrations/0001_trading_storage_replication_authority.sql', here), 'utf8');
const columns = JSON.parse(readFileSync(new URL('../../docs/supabase-trading-schema-snapshot-2026-10-17.json', here), 'utf8'));
const metadata = JSON.parse(readFileSync(new URL('../../docs/supabase-trading-constraints-snapshot-2026-10-17.json', here), 'utf8'));

test('Postgres migration covers every inventoried relation and observed index', () => {
  for (const { name } of columns.tables) {
    if (name === 'trading_runtime_controls') continue;
    assert.match(sql, new RegExp(`CREATE TABLE IF NOT EXISTS trading_storage\\."?${name}"?\\s*\\(`), `missing PostgreSQL table ${name}`);
  }
  assert.match(foundationSql, /CREATE TABLE IF NOT EXISTS trading_storage\.runtime_controls\s*\(/);
  for (const reference of sql.matchAll(/REFERENCES\s+([^\s(]+)/gi)) {
    assert.match(reference[1], /^trading_storage\./, `foreign key escapes the dedicated schema: ${reference[1]}`);
  }
  for (const table of metadata.tables) {
    for (const index of table.indexes || []) {
      const name = index.match(/CREATE\s+(?:UNIQUE\s+)?INDEX\s+([^\s]+)/i)?.[1];
      if (!name || name.endsWith('_pkey') || table.constraints?.some(c => (c.type === 'u' || c.type === 'p') && c.name === name)) continue;
      assert.match(sql, new RegExp(`CREATE (?:UNIQUE )?INDEX IF NOT EXISTS ${name}\\b`), `missing PostgreSQL index ${name}`);
    }
  }
});

test('Postgres migration keeps credentials encrypted and preserves restricted function grants', () => {
  const workspaceStart = sql.indexOf('CREATE TABLE IF NOT EXISTS trading_storage."workspaces"');
  const sourceStart = sql.indexOf('\nCREATE TABLE IF NOT EXISTS ', workspaceStart + 1);
  const workspace = sql.slice(workspaceStart, sourceStart);
  const providerStart = sql.indexOf('CREATE TABLE IF NOT EXISTS trading_storage."ai_providers"');
  const providerEnd = sql.indexOf('\nCREATE TABLE IF NOT EXISTS ', providerStart + 1);
  const provider = sql.slice(providerStart, providerEnd);
  assert.ok(workspace.includes('"tg_bot_token_ciphertext"'));
  assert.ok(workspace.includes('"tg_bot_token_hash"'));
  assert.ok(!/"tg_bot_token"\s/.test(workspace));
  assert.ok(provider.includes('"api_key_ciphertext"'));
  assert.ok(!/"api_key"\s/.test(provider));
  assert.match(sql, /CREATE OR REPLACE FUNCTION trading_storage\.rotate_trading_access_code[\s\S]*?SECURITY DEFINER/);
  assert.match(sql, /REVOKE ALL ON FUNCTION trading_storage\.rotate_trading_access_code\([^;]+ FROM PUBLIC;/);
  assert.match(sql, /CREATE OR REPLACE FUNCTION trading_storage\.trading_set_default_source\(/);
  assert.doesNotMatch(sql.slice(sql.indexOf('CREATE OR REPLACE FUNCTION trading_storage.trading_set_default_source(')), /SECURITY DEFINER/);
  assert.match(sql, /trg_enforce_connected_demo_execution BEFORE INSERT OR UPDATE ON trading_storage\.trade_accounts/);
});
