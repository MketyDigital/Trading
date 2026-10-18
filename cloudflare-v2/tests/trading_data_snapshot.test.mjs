import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { decryptSecret } from '../src/security/secret_box.js';
import { applyTradingSnapshotPlanToD1, applyTradingSnapshotPlanToPostgres, applyTradingSnapshotImportPlan, compareTradingSnapshotTableDrift, createTradingSnapshotImportPlan, exportTradingDataSnapshot, getD1SnapshotTargetDefinitions, getPostgresSnapshotTargetDefinitions, prepareTradingSnapshotRows, prepareTradingSnapshotForImport, readTradingDataSnapshot, validateTradingSnapshotRequest } from '../scripts/trading_data_snapshot.mjs';

test('legacy plaintext workspace and AI credentials become encrypted target columns only', async () => {
  const calls = [];
  const rows = await prepareTradingSnapshotRows({
    workspaces: [{ id: 'workspace-1', name: 'Tenant', owner_email: 'owner@example.test', tg_bot_token: 'bot-secret' }],
    ai_providers: [{ id: 'provider-1', provider_name: 'openai', model_name: 'model', api_key: 'provider-secret' }]
  }, {
    masterKey: 'test-master-key',
    encryptFn: async (secret) => { calls.push(secret); return `ciphertext:${calls.length}`; },
    hashFn: async (secret) => `sha256:${secret === 'bot-secret' ? 'bot' : 'provider'}`
  });

  assert.deepEqual(calls, ['bot-secret', 'provider-secret']);
  assert.equal(rows.workspaces[0].tg_bot_token_ciphertext, 'ciphertext:1');
  assert.equal(rows.workspaces[0].tg_bot_token_hash, 'sha256:bot');
  assert.equal(rows.ai_providers[0].api_key_ciphertext, 'ciphertext:2');
  assert.equal('tg_bot_token' in rows.workspaces[0], false);
  assert.equal('api_key' in rows.ai_providers[0], false);
  assert.equal(JSON.stringify(rows).includes('bot-secret'), false);
  assert.equal(JSON.stringify(rows).includes('provider-secret'), false);
});

test('snapshot credential envelopes use the production secret-box format', async () => {
  const masterKey = 'snapshot-credential-test-key';
  const rows = await prepareTradingSnapshotRows({
    workspaces: [{ id: 'workspace-1', tg_bot_token: '123456:token' }],
    ai_providers: [{ id: 'provider-1', api_key: 'sk-test-provider-key' }]
  }, { masterKey });
  assert.equal(await decryptSecret(rows.workspaces[0].tg_bot_token_ciphertext, masterKey), '123456:token');
  assert.equal(await decryptSecret(rows.ai_providers[0].api_key_ciphertext, masterKey), 'sk-test-provider-key');
});

test('snapshot request refuses absent, malformed or wrong-project freeze evidence', () => {
  assert.throws(() => validateTradingSnapshotRequest({}), /Explicit source-freeze evidence/);
  assert.throws(() => validateTradingSnapshotRequest({ freezeEvidence: 'source-freeze:short' }), /Explicit source-freeze evidence/);
  assert.throws(() => validateTradingSnapshotRequest({
    freezeEvidence: 'source-freeze:OPS-20261018',
    sourceProjectRef: 'wrong-project'
  }), /expected Supabase project/);
});

test('snapshot request accepts only the pinned production source and a bounded page size', () => {
  assert.equal(validateTradingSnapshotRequest({
    freezeEvidence: 'source-freeze:OPS-20261018',
    sourceProjectRef: 'vdblajgxrfndjesoyayy',
    pageSize: 200
  }).pageSize, 200);
  assert.throws(() => validateTradingSnapshotRequest({
    freezeEvidence: 'source-freeze:OPS-20261018',
    sourceProjectRef: 'vdblajgxrfndjesoyayy',
    pageSize: 5000
  }), /between 1 and 500/);
});

test('snapshot drift comparison distinguishes inserts from updates and deletions', () => {
  assert.deepEqual(compareTradingSnapshotTableDrift(
    { keyedRows: [{ key: ['1'], sha256: 'same' }, { key: ['2'], sha256: 'before' }] },
    { keyedRows: [{ key: ['1'], sha256: 'same' }, { key: ['2'], sha256: 'after' }, { key: ['3'], sha256: 'new' }] }
  ), { added: 1, removed: 0, modified: 1 });
});

test('import projection preserves business state but fences access and broker execution', () => {
  const sourceRows = {
    trading_runtime_controls: [
      { control_key: 'trading_access_enabled', enabled: true, metadata: {}, updated_by: 'live-operator', created_at: '2026-01-01', updated_at: '2026-10-18' },
      { control_key: 'broker_execution_enabled', enabled: true, metadata: {}, updated_by: 'live-operator', created_at: '2026-01-01', updated_at: '2026-10-18' },
      { control_key: 'live_broker_execution_enabled', enabled: true, metadata: {}, updated_by: 'live-operator', created_at: '2026-01-01', updated_at: '2026-10-18' }
    ],
    trading_workspace_access: [{ id: 'ws-1', trading_access_enabled: true, metadata: {} }],
    trade_accounts: [
      { id: 'acct-live', environment: 'live', execution_enabled: true, live_execution_enabled: true, is_active: true, safety_policy: { killSwitch: false, limit: 3 } },
      { id: 'acct-demo', environment: 'demo', execution_enabled: true, live_execution_enabled: false, is_active: true, roles: ['execution'], safety_policy: { killSwitch: false } }
    ],
    trading_events: [{ id: 'event-1', processing_status: 'READY' }]
  };
  const imported = prepareTradingSnapshotForImport(sourceRows, { target: 'd1', now: '2026-10-18T00:00:00.000Z' });

  assert.equal(imported.rowsByTable.trading_runtime_controls.every((row) => row.enabled === 0), true);
  assert.equal(imported.rowsByTable.trading_runtime_controls.every((row) => row.updated_by === 'migration-import-fenced'), true);
  assert.equal(imported.rowsByTable.trading_workspace_access[0].trading_access_enabled, 0);
  assert.equal(imported.rowsByTable.trade_accounts[0].execution_enabled, 0);
  assert.equal(imported.rowsByTable.trade_accounts[0].live_execution_enabled, 0);
  assert.deepEqual(imported.rowsByTable.trade_accounts[0].safety_policy, { killSwitch: true, limit: 3 });
  assert.equal(imported.rowsByTable.trade_accounts[0].is_active, true);
  assert.equal(imported.rowsByTable.trade_accounts[1].execution_enabled, true);
  assert.equal(imported.rowsByTable.trade_accounts[1].live_execution_enabled, 0);
  assert.deepEqual(imported.rowsByTable.trade_accounts[1].safety_policy, { killSwitch: false });
  assert.equal(imported.rowsByTable.trading_events[0].processing_status, 'READY');
  assert.deepEqual(imported.overrides, { globalControlsFenced: 3, workspaceAccessFenced: 1, accountsExecutionFenced: 1, demoExecutionPreserved: 1 });
  assert.equal(sourceRows.trade_accounts[0].execution_enabled, true);
  assert.equal(sourceRows.trade_accounts[0].safety_policy.killSwitch, false);

  const postgres = prepareTradingSnapshotForImport(sourceRows, { target: 'postgres', now: '2026-10-18T00:00:00.000Z' });
  assert.equal(postgres.rowsByTable.trading_runtime_controls[0].enabled, false);
  assert.equal(postgres.rowsByTable.trade_accounts[0].execution_enabled, false);
});

test('snapshot import plan uses only schema-checked idempotent upserts and maps PostgreSQL controls', () => {
  const snapshot = {
    rowsByTable: {
      trading_runtime_controls: [{ control_key: 'trading_access_enabled', enabled: false, updated_by: 'migration-import-fenced' }],
      workspaces: [{ id: 'ws-1', name: 'Tenant', metadata: { region: 'west' }, is_active: true }]
    },
    tableManifest: [
      { name: 'trading_runtime_controls', primaryKeys: ['control_key'] },
      { name: 'workspaces', primaryKeys: ['id'] }
    ]
  };
  const definitions = {
    runtime_controls: { columns: [{ name: 'control_key', type: 'text' }, { name: 'enabled', type: 'boolean' }, { name: 'updated_by', type: 'text' }], primaryKeys: ['control_key'] },
    workspaces: { columns: [{ name: 'id', type: 'text' }, { name: 'name', type: 'text' }, { name: 'metadata', type: 'jsonb' }, { name: 'is_active', type: 'boolean' }], primaryKeys: ['id'] }
  };

  const plan = createTradingSnapshotImportPlan({ snapshot, target: 'postgres', tableDefinitions: definitions });

  assert.equal(plan.rowCount, 2);
  assert.match(plan.statements[0].sql, /^INSERT INTO trading_storage\."runtime_controls"/);
  assert.match(plan.statements[0].sql, /ON CONFLICT \("control_key"\) DO UPDATE/);
  assert.deepEqual(plan.statements[0].values, ['trading_access_enabled', false, 'migration-import-fenced']);
  assert.deepEqual(plan.statements[1].values, ['ws-1', 'Tenant', { region: 'west' }, true]);
  assert.equal(plan.statements.some(({ sql }) => /\b(DELETE|TRUNCATE|DROP)\b/i.test(sql)), false);
});

test('snapshot import plan converts booleans and JSON values for D1', () => {
  const plan = createTradingSnapshotImportPlan({
    target: 'd1',
    snapshot: {
      rowsByTable: { trading_runtime_controls: [{ control_key: 'broker_execution_enabled', enabled: false, metadata: { source: 'import' } }] },
      tableManifest: [{ name: 'trading_runtime_controls', primaryKeys: ['control_key'] }]
    },
    tableDefinitions: {
      trading_runtime_controls: { columns: [{ name: 'control_key', type: 'TEXT' }, { name: 'enabled', type: 'INTEGER' }, { name: 'metadata', type: 'TEXT' }], primaryKeys: ['control_key'] }
    }
  });
  assert.deepEqual(plan.statements[0].values, ['broker_execution_enabled', 0, '{"source":"import"}']);
  assert.match(plan.statements[0].sql, /^INSERT INTO "trading_runtime_controls"/);
});

test('snapshot import plan rejects target schema gaps, key drift, malformed names and unverified tables', () => {
  const snapshot = {
    rowsByTable: { trading_events: [{ id: 'event-1', processing_status: 'READY' }] },
    tableManifest: [{ name: 'trading_events', primaryKeys: ['id'] }]
  };
  assert.throws(() => createTradingSnapshotImportPlan({ target: 'd1', snapshot, tableDefinitions: {} }), /missing from target schema/);
  assert.throws(() => createTradingSnapshotImportPlan({
    target: 'd1', snapshot,
    tableDefinitions: { trading_events: { columns: [{ name: 'id', type: 'TEXT' }, { name: 'processing_status', type: 'TEXT' }], primaryKeys: ['different_key'] } }
  }), /primary key/);
  assert.throws(() => createTradingSnapshotImportPlan({
    target: 'd1', snapshot: { ...snapshot, rowsByTable: { 'events;DROP TABLE workspaces': [] } }, tableDefinitions: {}
  }), /manifest/);
  assert.throws(() => createTradingSnapshotImportPlan({ target: 'sqlite', snapshot, tableDefinitions: {} }), /target must be d1 or postgres/);
});

test('snapshot import execution sends bounded atomic batches and stops on the first failure', async () => {
  const batches = [];
  const statements = Array.from({ length: 5 }, (_, index) => ({
    sourceTable: 'workspaces', targetTable: 'workspaces',
    sql: 'INSERT INTO "workspaces" ("id") VALUES (?) ON CONFLICT ("id") DO UPDATE SET "id" = EXCLUDED."id"',
    values: [`ws-${index}`]
  }));
  const progress = await applyTradingSnapshotImportPlan({ target: 'd1', rowCount: 5, statements }, {
    batchSize: 2,
    executeBatchAtomically: async (batch) => { batches.push(batch); }
  });
  assert.deepEqual(batches.map((batch) => batch.length), [2, 2, 1]);
  assert.deepEqual(progress, { target: 'd1', appliedRows: 5, batches: 3 });

  let attempts = 0;
  await assert.rejects(() => applyTradingSnapshotImportPlan({ target: 'd1', rowCount: 5, statements }, {
    batchSize: 2,
    executeBatchAtomically: async () => { attempts += 1; if (attempts === 2) throw new Error('batch failed'); }
  }), /batch failed/);
  assert.equal(attempts, 2);
});

test('snapshot import execution refuses destructive statements and invalid batch settings', async () => {
  const statement = { sourceTable: 'workspaces', targetTable: 'workspaces', sql: 'DELETE FROM "workspaces"', values: [] };
  await assert.rejects(() => applyTradingSnapshotImportPlan({ target: 'd1', rowCount: 1, statements: [statement] }, {
    executeBatchAtomically: async () => {}
  }), /only allowlisted INSERT upserts/);
  await assert.rejects(() => applyTradingSnapshotImportPlan({ target: 'd1', rowCount: 0, statements: [] }, {
    batchSize: 0,
    executeBatchAtomically: async () => {}
  }), /batch size/);
});

test('D1 snapshot adapter submits each validated batch through one atomic D1 batch call', async () => {
  const calls = [];
  const db = {
    prepare(sql) { return { bind: (...values) => ({ sql, values }) }; },
    async batch(statements) { calls.push(statements); return statements.map(() => ({ success: true })); }
  };
  const statements = [
    { sql: 'INSERT INTO "workspaces" ("id") VALUES (?) ON CONFLICT ("id") DO UPDATE SET "id" = EXCLUDED."id"', values: ['ws-1'] },
    { sql: 'INSERT INTO "workspaces" ("id") VALUES (?) ON CONFLICT ("id") DO UPDATE SET "id" = EXCLUDED."id"', values: ['ws-2'] }
  ];
  await applyTradingSnapshotPlanToD1(db, statements);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].map(({ values }) => values), [['ws-1'], ['ws-2']]);
});

test('PostgreSQL snapshot adapter commits successful batches and rolls failed batches back', async () => {
  const queries = [];
  let failInsert = false;
  const client = { async query(sql, values) {
    queries.push({ sql, values });
    if (failInsert && sql.startsWith('INSERT')) throw new Error('insert failed');
    return { rows: [] };
  } };
  const statements = [{ sql: 'INSERT INTO trading_storage."workspaces" ("id") VALUES ($1) ON CONFLICT ("id") DO UPDATE SET "id" = EXCLUDED."id"', values: ['ws-1'] }];
  await applyTradingSnapshotPlanToPostgres(client, statements);
  assert.deepEqual(queries.map(({ sql }) => sql), ['BEGIN', "SET LOCAL lock_timeout = '5s'", "SET LOCAL statement_timeout = '120s'", statements[0].sql, 'COMMIT']);

  queries.length = 0;
  failInsert = true;
  await assert.rejects(() => applyTradingSnapshotPlanToPostgres(client, statements), /insert failed/);
  assert.deepEqual(queries.map(({ sql }) => sql), ['BEGIN', "SET LOCAL lock_timeout = '5s'", "SET LOCAL statement_timeout = '120s'", statements[0].sql, 'ROLLBACK']);
});

test('D1 schema introspection reads allowlisted columns and preserves composite primary-key order', async () => {
  const calls = [];
  const db = { prepare(sql) { return { async all() {
    calls.push(sql);
    return { results: [
      { name: 'workspace_id', type: 'TEXT', pk: 2 },
      { name: 'id', type: 'TEXT', pk: 1 },
      { name: 'metadata', type: 'TEXT', pk: 0 }
    ] };
  } }; } };
  const result = await getD1SnapshotTargetDefinitions(db, [{ name: 'trading_workspace_memberships', primaryKeys: ['id', 'workspace_id'] }]);
  assert.deepEqual(calls, ['PRAGMA table_info("trading_workspace_memberships")']);
  assert.deepEqual(result.trading_workspace_memberships.primaryKeys, ['id', 'workspace_id']);
  assert.deepEqual(result.trading_workspace_memberships.columns.map(({ name }) => name), ['workspace_id', 'id', 'metadata']);
});

test('PostgreSQL schema introspection maps runtime controls and verifies primary keys', async () => {
  const calls = [];
  const client = { async query(sql, values) {
    calls.push({ sql, values });
    if (sql.includes('information_schema.columns')) return { rows: [
      { table_name: 'runtime_controls', column_name: 'control_key', data_type: 'text', ordinal_position: 1 },
      { table_name: 'runtime_controls', column_name: 'enabled', data_type: 'boolean', ordinal_position: 2 }
    ] };
    return { rows: [{ table_name: 'runtime_controls', column_name: 'control_key', ordinal_position: 1 }] };
  } };
  const result = await getPostgresSnapshotTargetDefinitions(client, [{ name: 'trading_runtime_controls', primaryKeys: ['control_key'] }]);
  assert.deepEqual(calls.map((call) => call.values), [['trading_storage', ['runtime_controls']], ['trading_storage', ['runtime_controls']]]);
  assert.deepEqual(result.runtime_controls.primaryKeys, ['control_key']);
  assert.deepEqual(result.runtime_controls.columns.map(({ name, type }) => [name, type]), [['control_key', 'text'], ['enabled', 'boolean']]);
});

test('snapshot artifact is encrypted at rest and includes only keyed checksums in its clear manifest', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'trading-snapshot-'));
  try {
    const outputPath = join(directory, 'snapshot.json');
    const result = await exportTradingDataSnapshot({
      client: { from: () => ({ select() { return this; }, order() { return this; }, range: async () => ({ data: [], error: null }) }) },
      masterKey: 'snapshot-test-key',
      sourceProjectRef: 'vdblajgxrfndjesoyayy',
      freezeEvidence: 'source-freeze:OPS-20261018',
      outputPath
    });
    const artifact = JSON.parse(await readFile(outputPath, 'utf8'));
    assert.equal((await stat(outputPath)).mode & 0o777, 0o600);
    assert.equal(artifact.format, 'mkety-trading-data-snapshot-v1');
    assert.equal(artifact.tableManifest.length, 28);
    assert.ok(artifact.tableManifest.findIndex(({ name }) => name === 'trading_workspace_access')
      < artifact.tableManifest.findIndex(({ name }) => name === 'trade_accounts'));
    assert.equal('payloadCiphertext' in artifact, true);
    assert.equal(JSON.stringify(artifact).includes('owner@example.test'), false);
    assert.equal(result.tableManifest.reduce((sum, table) => sum + table.rowCount, 0), 0);
    assert.deepEqual(JSON.parse(await decryptSecret(artifact.payloadCiphertext, 'snapshot-test-key')), Object.fromEntries(artifact.tableManifest.map((table) => [table.name, []])));
    const verified = await readTradingDataSnapshot({ artifactPath: outputPath, masterKey: 'snapshot-test-key' });
    assert.equal(verified.rowsByTable.operation_journal.length, 0);
    artifact.tableManifest[0].rowCount += 1;
    await rm(outputPath);
    await writeFile(outputPath, JSON.stringify(artifact));
    await assert.rejects(() => readTradingDataSnapshot({ artifactPath: outputPath, masterKey: 'snapshot-test-key' }), /metadata integrity/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('snapshot export aborts if a table changes between verification passes', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'trading-snapshot-'));
  let journalReads = 0;
  const client = {
    from(table) {
      return {
        table,
        select() { return this; },
        order() { return this; },
        async range(from) {
          if (table !== 'operation_journal' || from !== 0) return { data: [], error: null };
          journalReads += 1;
          return { data: [{ id: 'journal-1', summary: journalReads === 1 ? 'before' : 'after' }], error: null };
        }
      };
    }
  };
  try {
    await assert.rejects(() => exportTradingDataSnapshot({
      client,
      masterKey: 'snapshot-test-key',
      sourceProjectRef: 'vdblajgxrfndjesoyayy',
      freezeEvidence: 'source-freeze:OPS-20261018',
      outputPath: join(directory, 'snapshot.json')
    }), /Source changed during snapshot export at table operation_journal/);
    await assert.rejects(() => readFile(join(directory, 'snapshot.json')));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('snapshot export records a bounded append-only operation journal delta', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'trading-snapshot-'));
  let journalReads = 0;
  const client = {
    from(table) {
      return {
        select() { return this; },
        order() { return this; },
        async range() {
          if (table !== 'operation_journal') return { data: [], error: null };
          journalReads += 1;
          return { data: journalReads === 1 ? [] : [{ id: 'journal-new', summary: 'append-only' }], error: null };
        }
      };
    }
  };
  try {
    const result = await exportTradingDataSnapshot({
      client,
      masterKey: 'snapshot-test-key',
      sourceProjectRef: 'vdblajgxrfndjesoyayy',
      freezeEvidence: 'source-freeze:OPS-20261018',
      outputPath: join(directory, 'snapshot.json')
    });
    assert.deepEqual(result.sourceDrift, [{ table: 'operation_journal', added: 1, removed: 0, modified: 0 }]);
    const verified = await readTradingDataSnapshot({ artifactPath: result.outputPath, masterKey: 'snapshot-test-key' });
    assert.equal(verified.rowsByTable.operation_journal.length, 0);
    assert.deepEqual(verified.sourceDrift, result.sourceDrift);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('snapshot export rejects operation journal drift above the explicit bound', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'trading-snapshot-'));
  let journalReads = 0;
  const client = {
    from(table) {
      return {
        select() { return this; },
        order() { return this; },
        async range() {
          if (table !== 'operation_journal') return { data: [], error: null };
          journalReads += 1;
          return { data: journalReads === 1 ? [] : Array.from({ length: 101 }, (_, index) => ({ id: `journal-${index}` })), error: null };
        }
      };
    }
  };
  try {
    await assert.rejects(() => exportTradingDataSnapshot({
      client,
      masterKey: 'snapshot-test-key',
      sourceProjectRef: 'vdblajgxrfndjesoyayy',
      freezeEvidence: 'source-freeze:OPS-20261018',
      outputPath: join(directory, 'snapshot.json')
    }), /Source changed during snapshot export at table operation_journal/);
    await assert.rejects(() => readFile(join(directory, 'snapshot.json')));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
