import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const here = new URL('.', import.meta.url);
const sql = readFileSync(new URL('../db/postgres-migrations/0002_trading_domain_schema.sql', here), 'utf8');
const foundationSql = readFileSync(new URL('../db/postgres-migrations/0001_trading_storage_replication_authority.sql', here), 'utf8');
const columns = JSON.parse(readFileSync(new URL('../../docs/supabase-trading-schema-snapshot-2026-10-17.json', here), 'utf8'));
const metadata = JSON.parse(readFileSync(new URL('../../docs/supabase-trading-constraints-snapshot-2026-10-17.json', here), 'utf8'));
const migrations = ['0001_trading_storage_replication_authority.sql', '0002_trading_domain_schema.sql', '0003_trading_replication_health.sql']
  .map((name) => [name, readFileSync(new URL(`../db/postgres-migrations/${name}`, here), 'utf8')]);

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
  assert.match(sql, /CREATE OR REPLACE FUNCTION trading_storage\.sync_trading_workspace_access_code_status\([\s\S]*?SECURITY DEFINER/);
  assert.match(sql, /REVOKE ALL ON FUNCTION trading_storage\.sync_trading_workspace_access_code_status\(\) FROM PUBLIC;/);
  assert.match(sql, /CREATE OR REPLACE FUNCTION trading_storage\.trading_set_default_source\(/);
  assert.doesNotMatch(sql.slice(sql.indexOf('CREATE OR REPLACE FUNCTION trading_storage.trading_set_default_source(')), /SECURITY DEFINER/);
  assert.match(sql, /trg_enforce_connected_demo_execution BEFORE INSERT OR UPDATE ON trading_storage\.trade_accounts/);
});

test('PostgreSQL function bodies terminate each CREATE FUNCTION statement', () => {
  const functionClosures = [...sql.matchAll(/^\$function\$;?$/gm)].map(([closure]) => closure);
  assert.equal(functionClosures.length, 4);
  assert.ok(functionClosures.every((closure) => closure === '$function$;'));
});

test('composite foreign keys have a unique target before dependent table creation', () => {
  const targetIndex = sql.indexOf('CREATE UNIQUE INDEX IF NOT EXISTS idx_source_connections_workspace_id_unique');
  const dependentTable = sql.indexOf('CREATE TABLE IF NOT EXISTS trading_storage."source_feeds"');
  assert.ok(targetIndex >= 0 && dependentTable > targetIndex);
});

test('Postgres triggers use syntax supported by the existing Coolify server', () => {
  const triggerStatements = [...sql.matchAll(/^CREATE TRIGGER\b[^\n]*$/gim)].map(([statement]) => statement);
  assert.equal(triggerStatements.length, 2);
  for (const statement of triggerStatements) {
    assert.match(statement, /\bEXECUTE PROCEDURE\b/i);
  }
  assert.doesNotMatch(sql, /\bEXECUTE FUNCTION\b/i);
});

test('all PostgreSQL migrations stay inside the Trading schema on the existing database', () => {
  const combined = migrations.map(([, contents]) => contents).join('\n');
  const executableSql = combined.replace(/^\s*--.*$/gm, '');
  assert.doesNotMatch(executableSql, /^\s*CREATE\s+SCHEMA\b/im, 'the installer creates trading_storage before switching to the restricted owner role');
  assert.doesNotMatch(executableSql, /^\s*(?:ALTER|DROP|TRUNCATE|COMMENT|GRANT|DO|CALL|COPY)\b/im);
  assert.doesNotMatch(executableSql, /\bpublic\s*\./i, 'must not modify Mkety shared public objects');
  const revokeCommands = [...executableSql.matchAll(/^\s*REVOKE\b[^;]*;?/gim)];
  for (const revoke of revokeCommands) {
    assert.match(revoke[0], /^\s*REVOKE\s+ALL\s+ON\s+FUNCTION\s+trading_storage\.[^\s(]+\([^)]*\)\s+FROM\s+PUBLIC/i);
  }

  const createCommands = [...executableSql.matchAll(/^\s*CREATE\s+(?:OR\s+REPLACE\s+)?(SCHEMA|TABLE|UNIQUE\s+INDEX|INDEX|TRIGGER|FUNCTION)\b/gim)];
  const createStarts = [...executableSql.matchAll(/^\s*CREATE\b/gim)];
  assert.equal(createCommands.length, createStarts.length, 'every CREATE command must use an explicitly allowed object type');
  for (const match of createCommands) {
    const kind = match[1].toUpperCase().replace(/\s+/g, ' ');
    const statement = executableSql.slice(match.index).split(';', 1)[0];
    if (kind === 'SCHEMA') {
      assert.match(statement, /^\s*CREATE\s+SCHEMA\s+(?:IF\s+NOT\s+EXISTS\s+)?trading_storage\b/i);
    } else if (kind === 'TABLE') {
      assert.match(statement, /^\s*CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?trading_storage\./i);
    } else if (kind === 'INDEX' || kind === 'UNIQUE INDEX') {
      assert.match(statement, /^\s*CREATE\s+(?:UNIQUE\s+)?INDEX\s+[^;]*?\bON\s+trading_storage\./i);
    } else if (kind === 'FUNCTION') {
      assert.match(statement, /^\s*CREATE\s+OR\s+REPLACE\s+FUNCTION\s+trading_storage\./i);
    } else if (kind === 'TRIGGER') {
      assert.match(statement, /^\s*CREATE\s+TRIGGER\s+[^\n]*?\bON\s+trading_storage\./i);
    }
  }
  for (const match of executableSql.matchAll(/\bCREATE\s+SCHEMA\s+(?:IF\s+NOT\s+EXISTS\s+)?([^\s;]+)/gi)) {
    assert.equal(match[1].replaceAll('"', ''), 'trading_storage');
  }
  for (const match of executableSql.matchAll(/\bCREATE\s+(?:UNIQUE\s+)?TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([^\s(]+)/gi)) {
    assert.match(match[1], /^trading_storage\./i, `table escapes Trading schema: ${match[1]}`);
  }
  for (const match of executableSql.matchAll(/\bCREATE\s+(?:UNIQUE\s+)?INDEX\s+[^\n]*?\bON\s+([^\s(]+)/gi)) {
    assert.match(match[1], /^trading_storage\./i, `index target escapes Trading schema: ${match[1]}`);
  }
  for (const match of executableSql.matchAll(/\bCREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+([^\s(]+)/gi)) {
    assert.match(match[1], /^trading_storage\./i, `function escapes Trading schema: ${match[1]}`);
  }
  for (const match of executableSql.matchAll(/\bCREATE\s+TRIGGER\s+[^\n]*?\bON\s+([^\s;]+)/gi)) {
    assert.match(match[1], /^trading_storage\./i, `trigger target escapes Trading schema: ${match[1]}`);
  }
  const mutationSql = executableSql.replace(/^.*\bCREATE\s+TRIGGER\b.*$/gim, '');
  for (const match of mutationSql.matchAll(/\b(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+([^\s(]+)/gi)) {
    assert.match(match[1], /^trading_storage\./i, `data write escapes Trading schema: ${match[1]}`);
  }
});

test('new PostgreSQL authority and runtime controls start fenced and disabled', () => {
  const foundation = migrations[0][1];
  assert.match(foundation, /VALUES\s*\(1,\s*'d1',\s*1,\s*1,\s*true\)/i);
  assert.match(foundation, /'trading_access_enabled',\s*false/i);
  assert.match(foundation, /'broker_execution_enabled',\s*false/i);
  assert.match(foundation, /'live_broker_execution_enabled',\s*false/i);
});
