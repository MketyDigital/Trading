import test from 'node:test';
import assert from 'node:assert/strict';
import { createCloudflareD1SnapshotDatabase } from '../scripts/cloudflare_d1_snapshot_database.mjs';
import { getTradingSnapshotDomainTableInventory } from '../scripts/trading_data_snapshot.mjs';

function response(payload, ok = true) {
  return { ok, async json() { return payload; } };
}

test('D1 fresh-start reset accepts only the exact reviewed domain tables', async () => {
  const requests = [];
  const fetchFn = async (url, init = {}) => {
    if (init.method === 'GET') return response({ success: true, result: { uuid: '4f00d59a-3d90-4146-832d-36230d5648bb', name: 'trading-staging' } });
    const body = JSON.parse(init.body);
    requests.push(body);
    return response({ success: true, result: body.batch.map(() => ({ success: true, results: [] })) });
  };
  const db = createCloudflareD1SnapshotDatabase({
    apiToken: 'test-token', accountId: 'a'.repeat(32),
    databaseId: '4f00d59a-3d90-4146-832d-36230d5648bb', fetchFn,
  });
  const domain = await getTradingSnapshotDomainTableInventory();
  const names = domain.map(({ name }) => name);

  await assert.rejects(() => db.deleteAllDomainTables(names.slice(1)), /exact reviewed Trading domain table set/);
  assert.equal(requests.length, 0);

  const result = await db.deleteAllDomainTables(names);
  assert.deepEqual(result, { deletedTables: 28 });
  assert.equal(requests.length, 1);
  assert.equal(requests[0].batch.length, 28);
  assert.deepEqual(requests[0].batch.map(({ sql }) => sql), [...names].reverse().map((name) => `DELETE FROM "${name}"`));
  assert.equal(requests[0].batch.some(({ sql }) => /trading_storage_control|authority_control|replication_/i.test(sql)), false);
});

test('D1 query requests have a bounded timeout', async () => {
  const calls = [];
  const timeouts = [];
  const nativeTimeout = AbortSignal.timeout;
  AbortSignal.timeout = (milliseconds) => {
    timeouts.push(milliseconds);
    return nativeTimeout(milliseconds);
  };
  const fetchFn = async (url, init = {}) => {
    calls.push(init);
    if (init.method === 'GET') return response({ success: true, result: { uuid: '4f00d59a-3d90-4146-832d-36230d5648bb', name: 'trading-staging' } });
    return response({ success: true, result: [{ success: true, results: [{ ok: 1 }] }] });
  };
  try {
    const db = createCloudflareD1SnapshotDatabase({
      apiToken: 'test-token', accountId: 'a'.repeat(32),
      databaseId: '4f00d59a-3d90-4146-832d-36230d5648bb', fetchFn,
    });
    await db.query('SELECT 1');
    assert.deepEqual(calls.map(({ method, signal }) => ({ method, hasTimeout: signal instanceof AbortSignal })), [
      { method: 'GET', hasTimeout: true }, { method: 'POST', hasTimeout: true },
    ]);
    assert.deepEqual(timeouts, [20000, 20000]);
    assert.equal(calls.every(({ signal }) => signal.aborted === false), true);
  } finally {
    AbortSignal.timeout = nativeTimeout;
  }
});
