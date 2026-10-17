import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { applyTradingPostgresMigrations } from '../scripts/apply_trading_postgres_migrations.mjs';

const migrations = [
  { name: '0001_trading_storage_replication_authority.sql', sql: 'CREATE SCHEMA IF NOT EXISTS trading_storage;' },
  { name: '0002_trading_domain_schema.sql', sql: 'CREATE TABLE IF NOT EXISTS trading_storage.example (id integer);' },
  { name: '0003_trading_replication_health.sql', sql: 'CREATE TABLE IF NOT EXISTS trading_storage.health (id integer);' }
];
const restrictedOwner = {
  owner_is_superuser: false,
  owner_can_login: false,
  owner_can_create_database: false,
  owner_can_create_roles: false,
  owner_bypasses_rls: false,
  owner_inherits_roles: false
};
const safeSchemaState = {
  active_authority: 'd1',
  writes_fenced: true,
  control_count: 3,
  disabled_control_count: 3,
  schema_owner: 'trading_owner',
  unsafe_definer_owner_count: 0,
  public_definer_execute_count: 0
};

test('PostgreSQL schema installer requires an explicit apply confirmation', async () => {
  let connected = false;
  class Client { async connect() { connected = true; } }
  await assert.rejects(
    applyTradingPostgresMigrations({
      connectionString: 'postgres://user:secret@private.invalid/mkety',
      expectedDatabaseName: 'mkety',
      caCertificate: 'synthetic CA',
      ClientClass: Client,
      migrations
    }),
    /explicit PostgreSQL schema migration confirmation/i
  );
  assert.equal(connected, false);
});

test('PostgreSQL schema installer applies only approved migrations in one transaction', async () => {
  const calls = [];
  class Client {
    constructor(options) { calls.push(['construct', options]); }
    async connect() { calls.push(['connect']); }
    async query(sql) {
      calls.push(['query', sql]);
      if (sql.includes('current_database()')) return { rows: [{ database_name: 'mkety', transaction_read_only: 'off', trading_schema_exists: false, schema_owner: '', owner_role_exists: false, current_role_is_superuser: true }] };
      if (sql.includes('FROM pg_roles') && sql.includes("rolname = 'trading_owner'")) return { rows: [restrictedOwner] };
      if (sql.includes('pg_has_role')) return { rows: [{ is_member: true }] };
      if (sql.includes('SELECT current_user')) return { rows: [{ current_role: 'trading_owner' }] };
      if (sql.includes('FROM trading_storage.authority_control')) return { rows: [safeSchemaState] };
      return { rows: [] };
    }
    async end() { calls.push(['end']); }
  }

  const result = await applyTradingPostgresMigrations({
    connectionString: 'postgres://user:secret@private.invalid/mkety',
    expectedDatabaseName: 'mkety',
    confirmation: 'APPLY_TRADING_STORAGE_SCHEMA',
    caFilePath: '/etc/ssl/certs/coolify-ca.crt',
    caCertificate: 'synthetic CA',
    ClientClass: Client,
    migrations
  });

  assert.deepEqual(result, { databaseName: 'mkety', schemaName: 'trading_storage', applied: migrations.map(({ name }) => name), alreadyApplied: false });
  const queries = calls.filter(([kind]) => kind === 'query').map(([, sql]) => sql);
  assert.equal(queries[0], 'BEGIN');
  assert.ok(queries.includes('COMMIT'));
  assert.equal(queries.filter((sql) => sql === 'ROLLBACK').length, 0);
  assert.ok(queries.includes('SELECT pg_advisory_xact_lock(hashtext($1))'));
  assert.ok(queries.includes('CREATE ROLE trading_owner NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOINHERIT'));
  assert.ok(queries.includes('CREATE SCHEMA trading_storage AUTHORIZATION trading_owner'));
  assert.ok(queries.includes('SET LOCAL ROLE trading_owner'));
  assert.ok(migrations.every(({ sql }) => queries.includes(sql)));
  assert.ok(queries.includes('CREATE TABLE trading_storage.schema_migrations (version text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())'));
  assert.doesNotMatch(JSON.stringify(result), /secret|private\.invalid/);
});

test('PostgreSQL schema installer refuses a different database and rolls back', async () => {
  const calls = [];
  class Client {
    async connect() { calls.push('connect'); }
    async query(sql) {
      calls.push(sql);
      if (sql.includes('current_database()')) return { rows: [{ database_name: 'another_db', transaction_read_only: 'off', trading_schema_exists: false, schema_owner: '', ...restrictedOwner }] };
      return { rows: [] };
    }
    async end() { calls.push('end'); }
  }

  await assert.rejects(
    applyTradingPostgresMigrations({ connectionString: 'postgres://user:secret@private.invalid/mkety', expectedDatabaseName: 'mkety', confirmation: 'APPLY_TRADING_STORAGE_SCHEMA', caCertificate: 'synthetic CA', ClientClass: Client, migrations }),
    /expected database/i
  );
  assert.ok(calls.includes('ROLLBACK'));
  assert.equal(calls.at(-1), 'end');
  assert.equal(calls.some((sql) => typeof sql === 'string' && sql.startsWith('CREATE')), false);
});

test('PostgreSQL schema installer refuses to create the owner role without a superuser connection', async () => {
  const calls = [];
  class Client {
    async connect() {}
    async query(sql) {
      calls.push(sql);
      if (sql.includes('current_database()')) return { rows: [{ database_name: 'mkety', transaction_read_only: 'off', trading_schema_exists: false, schema_owner: '', owner_role_exists: false, current_role_is_superuser: false }] };
      return { rows: [] };
    }
    async end() {}
  }

  await assert.rejects(
    applyTradingPostgresMigrations({ connectionString: 'postgres://user:secret@private.invalid/mkety', expectedDatabaseName: 'mkety', confirmation: 'APPLY_TRADING_STORAGE_SCHEMA', caCertificate: 'synthetic CA', ClientClass: Client, migrations }),
    /current database role cannot provision trading_owner/i
  );
  assert.ok(calls.includes('ROLLBACK'));
  assert.equal(calls.some((sql) => typeof sql === 'string' && sql.startsWith('CREATE ROLE')), false);
});

test('PostgreSQL schema installer refuses an existing owner role with unsafe privileges', async () => {
  const calls = [];
  class Client {
    async connect() {}
    async query(sql) {
      calls.push(sql);
      if (sql.includes('current_database()')) return { rows: [{ database_name: 'mkety', transaction_read_only: 'off', trading_schema_exists: false, schema_owner: '', owner_role_exists: true, current_role_is_superuser: true }] };
      if (sql.includes('FROM pg_roles') && sql.includes("rolname = 'trading_owner'")) return { rows: [{ ...restrictedOwner, owner_is_superuser: true }] };
      return { rows: [] };
    }
    async end() {}
  }

  await assert.rejects(
    applyTradingPostgresMigrations({ connectionString: 'postgres://user:secret@private.invalid/mkety', expectedDatabaseName: 'mkety', confirmation: 'APPLY_TRADING_STORAGE_SCHEMA', caCertificate: 'synthetic CA', ClientClass: Client, migrations }),
    /trading owner role has unsafe privileges/i
  );
  assert.ok(calls.includes('ROLLBACK'));
  assert.equal(calls.some((sql) => typeof sql === 'string' && sql.startsWith('CREATE SCHEMA')), false);
});

test('PostgreSQL schema installer refuses an untracked pre-existing Trading schema', async () => {
  class Client {
    async connect() {}
    async query(sql) {
      if (sql.includes('current_database()')) return { rows: [{ database_name: 'mkety', transaction_read_only: 'off', trading_schema_exists: true, schema_owner: 'trading_owner', owner_role_exists: true, current_role_is_superuser: true }] };
      if (sql.includes('FROM pg_roles') && sql.includes("rolname = 'trading_owner'")) return { rows: [restrictedOwner] };
      if (sql.includes('to_regclass')) return { rows: [{ ledger_exists: false }] };
      return { rows: [] };
    }
    async end() {}
  }

  await assert.rejects(
    applyTradingPostgresMigrations({ connectionString: 'postgres://user:secret@private.invalid/mkety', expectedDatabaseName: 'mkety', confirmation: 'APPLY_TRADING_STORAGE_SCHEMA', caCertificate: 'synthetic CA', ClientClass: Client, migrations }),
    /untracked trading_storage schema/i
  );
});

test('PostgreSQL schema installer skips an exact checksum-matched migration ledger', async () => {
  const calls = [];
  const ledger = migrations.map(({ name, sql }) => ({
    version: name.slice(0, 4),
    checksum: createHash('sha256').update(sql).digest('hex')
  }));
  class Client {
    async connect() { calls.push('connect'); }
    async query(sql) {
      calls.push(sql);
      if (sql.includes('current_database()')) return { rows: [{ database_name: 'mkety', transaction_read_only: 'off', trading_schema_exists: true, schema_owner: 'trading_owner', owner_role_exists: true, current_role_is_superuser: true }] };
      if (sql.includes('FROM pg_roles') && sql.includes("rolname = 'trading_owner'")) return { rows: [restrictedOwner] };
      if (sql.includes('to_regclass')) return { rows: [{ ledger_exists: true }] };
      if (sql.includes('SELECT version, checksum')) return { rows: ledger };
      if (sql.includes('FROM trading_storage.authority_control')) return { rows: [safeSchemaState] };
      return { rows: [] };
    }
    async end() { calls.push('end'); }
  }

  const result = await applyTradingPostgresMigrations({
    connectionString: 'postgres://user:secret@private.invalid/mkety',
    expectedDatabaseName: 'mkety',
    confirmation: 'APPLY_TRADING_STORAGE_SCHEMA',
    caCertificate: 'synthetic CA',
    ClientClass: Client,
    migrations
  });
  assert.deepEqual(result, { databaseName: 'mkety', schemaName: 'trading_storage', applied: [], alreadyApplied: true });
  assert.equal(calls.filter((sql) => typeof sql === 'string' && sql.startsWith('CREATE')).length, 0);
  assert.ok(calls.includes('COMMIT'));
  assert.equal(calls.at(-1), 'end');
});

test('PostgreSQL schema installer does not report an unsafe applied schema as safe', async () => {
  const ledger = migrations.map(({ name, sql }) => ({ version: name.slice(0, 4), checksum: createHash('sha256').update(sql).digest('hex') }));
  const calls = [];
  class Client {
    async connect() {}
    async query(sql) {
      calls.push(sql);
      if (sql.includes('current_database()')) return { rows: [{ database_name: 'mkety', transaction_read_only: 'off', trading_schema_exists: true, schema_owner: 'trading_owner', owner_role_exists: true, current_role_is_superuser: true }] };
      if (sql.includes('FROM pg_roles') && sql.includes("rolname = 'trading_owner'")) return { rows: [restrictedOwner] };
      if (sql.includes('to_regclass')) return { rows: [{ ledger_exists: true }] };
      if (sql.includes('SELECT version, checksum')) return { rows: ledger };
      if (sql.includes('FROM trading_storage.authority_control')) return { rows: [{ ...safeSchemaState, writes_fenced: false }] };
      return { rows: [] };
    }
    async end() {}
  }

  await assert.rejects(
    applyTradingPostgresMigrations({ connectionString: 'postgres://user:secret@private.invalid/mkety', expectedDatabaseName: 'mkety', confirmation: 'APPLY_TRADING_STORAGE_SCHEMA', caCertificate: 'synthetic CA', ClientClass: Client, migrations }),
    /restricted, fenced\/off defaults/i
  );
  assert.ok(calls.includes('ROLLBACK'));
  assert.equal(calls.includes('COMMIT'), false);
});
