import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { decryptSecret, encryptSecret } from '../src/security/secret_box.js';
import { exportTradingDataSnapshot, prepareTradingSnapshotRows, prepareTradingSnapshotForImport, readTradingDataSnapshot, validateTradingSnapshotRequest } from '../scripts/trading_data_snapshot.mjs';

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
    assert.equal('payloadCiphertext' in artifact, true);
    assert.equal(JSON.stringify(artifact).includes('owner@example.test'), false);
    assert.equal(result.tableManifest.reduce((sum, table) => sum + table.rowCount, 0), 0);
    assert.deepEqual(JSON.parse(await decryptSecret(artifact.payloadCiphertext, 'snapshot-test-key')), Object.fromEntries(artifact.tableManifest.map((table) => [table.name, []])));
    const verified = await readTradingDataSnapshot({ artifactPath: outputPath, masterKey: 'snapshot-test-key' });
    assert.equal(verified.rowsByTable.operation_journal.length, 0);
    artifact.tableManifest[0].rowCount += 1;
    await rm(outputPath);
    await writeFile(outputPath, JSON.stringify(artifact));
    await assert.rejects(() => readTradingDataSnapshot({ artifactPath: outputPath, masterKey: 'snapshot-test-key' }), /integrity check failed/);

    const missingTable = Object.fromEntries(artifact.tableManifest.map((table) => [table.name, []]));
    delete missingTable.operation_journal;
    artifact.tableManifest[0].rowCount -= 1;
    artifact.payloadCiphertext = await encryptSecret(JSON.stringify(missingTable), 'snapshot-test-key');
    await writeFile(outputPath, JSON.stringify(artifact));
    await assert.rejects(() => readTradingDataSnapshot({ artifactPath: outputPath, masterKey: 'snapshot-test-key' }), /table set is incomplete/);
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
