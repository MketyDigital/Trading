import test from 'node:test';
import assert from 'node:assert/strict';
import { checkStagingPostgresConnection } from '../scripts/check_staging_postgres_connection.mjs';

test('staging PostgreSQL probe uses a read-only transaction and returns safe identity metadata', async () => {
  const calls = [];
  class Client {
    constructor(options) { calls.push(['constructor', options]); }
    async connect() { calls.push(['connect']); }
    async query(sql) {
      calls.push(['query', sql]);
      if (sql.includes('current_database()')) return { rows: [{ database_name: 'trading_stage', schema_name: 'public', transaction_read_only: 'on', trading_schema_exists: false, role_is_superuser: false }] };
      return { rows: [] };
    }
    async end() { calls.push(['end']); }
  }

  const result = await checkStagingPostgresConnection({
    connectionString: 'postgres://secret-user:secret-password@private.invalid/stage',
    ClientClass: Client
  });

  assert.deepEqual(result, {
    databaseName: 'trading_stage',
    schemaName: 'public',
    transactionReadOnly: true,
    tradingSchemaExists: false,
    roleIsSuperuser: false
  });
  assert.equal(calls[0][0], 'constructor');
  assert.deepEqual(calls[0][1], {
    connectionString: 'postgres://secret-user:secret-password@private.invalid/stage',
    connectionTimeoutMillis: 10000,
    query_timeout: 10000,
    statement_timeout: 10000
  });
  assert.deepEqual(calls.slice(1).map(([kind, sql]) => kind === 'query' ? sql : kind), [
    'connect',
    'BEGIN READ ONLY',
    calls[3][1],
    'ROLLBACK',
    'end'
  ]);
  assert.match(calls[3][1], /current_database\(\)/);
  assert.match(calls[3][1], /current_user/);
  assert.match(calls[3][1], /pg_namespace/);
  assert.match(calls[3][1], /pg_roles/);
  assert.doesNotMatch(calls[3][1], /INSERT|UPDATE|DELETE|CREATE|ALTER|DROP/i);
  assert.doesNotMatch(JSON.stringify(result), /secret-user|secret-password|private\.invalid/);
});

test('staging PostgreSQL probe refuses a connection that is not read-only and still closes it', async () => {
  const calls = [];
  class Client {
    async connect() { calls.push('connect'); }
    async query(sql) {
      calls.push(sql);
      if (sql.includes('current_database()')) return { rows: [{ database_name: 'trading_stage', schema_name: 'public', transaction_read_only: 'off', trading_schema_exists: false, role_is_superuser: false }] };
      return { rows: [] };
    }
    async end() { calls.push('end'); }
  }

  await assert.rejects(
    checkStagingPostgresConnection({ connectionString: 'postgres://staging', ClientClass: Client }),
    /must be read-only/
  );
  assert.ok(calls.includes('ROLLBACK'));
  assert.equal(calls.at(-1), 'end');
});

test('staging PostgreSQL probe requires its explicitly scoped staging URL', async () => {
  await assert.rejects(checkStagingPostgresConnection({ connectionString: '' }), /TRADING_PG_STAGING_DATABASE_URL/);
});

test('staging PostgreSQL probe surfaces only a safe failure stage and code', async () => {
  class Client {
    async connect() {
      throw Object.assign(new Error('failed for postgres://secret-user:secret-password@private.invalid/stage'), { code: 'ECONNREFUSED' });
    }
    async query() { throw new Error('unexpected query'); }
    async end() {}
  }

  await assert.rejects(
    checkStagingPostgresConnection({ connectionString: 'postgres://secret-user:secret-password@private.invalid/stage', ClientClass: Client }),
    error => {
      assert.match(error.message, /connect.*ECONNREFUSED/i);
      assert.doesNotMatch(error.message, /secret-user|secret-password|private\.invalid/);
      return true;
    }
  );
});

test('staging PostgreSQL probe safely classifies TLS failures without exposing host details', async () => {
  class Client {
    async connect() {
      throw new Error('self-signed certificate in certificate chain for private-db.internal');
    }
    async query() { throw new Error('unexpected query'); }
    async end() {}
  }

  await assert.rejects(
    checkStagingPostgresConnection({ connectionString: 'postgres://staging', ClientClass: Client }),
    error => {
      assert.match(error.message, /connect.*TLS_CERTIFICATE/i);
      assert.doesNotMatch(error.message, /self-signed|private-db\.internal/);
      return true;
    }
  );
});
