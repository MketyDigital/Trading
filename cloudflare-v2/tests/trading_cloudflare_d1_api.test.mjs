import test from 'node:test';
import assert from 'node:assert/strict';
import { createCloudflareD1SnapshotDatabase } from '../scripts/cloudflare_d1_snapshot_database.mjs';

const TARGET = {
  apiToken: 'd1-token',
  accountId: 'a'.repeat(32),
  databaseId: '4f00d59a-3d90-4146-832d-36230d5648bb',
};

test('D1 snapshot database requires an explicit existing database identity', () => {
  assert.throws(() => createCloudflareD1SnapshotDatabase({ ...TARGET, databaseId: '' }), /database id/i);
  assert.throws(() => createCloudflareD1SnapshotDatabase({ ...TARGET, accountId: 'x' }), /account id/i);
  assert.throws(() => createCloudflareD1SnapshotDatabase({ ...TARGET, apiToken: '' }), /api token/i);
});

test('prepared D1 queries use the configured database and return Cloudflare rows', async () => {
  const calls = [];
  const db = createCloudflareD1SnapshotDatabase({
    ...TARGET,
    fetchFn: async (url, init) => {
      calls.push({ url, init });
      if (init.method === 'GET') return Response.json({ success: true, result: { uuid: TARGET.databaseId, name: 'trading-staging' } });
      return Response.json({ success: true, result: [{ success: true, results: [{ name: 'workspaces' }] }] });
    },
  });

  const result = await db.prepare('PRAGMA table_info("workspaces")').all();

  assert.deepEqual(result.results, [{ name: 'workspaces' }]);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, `https://api.cloudflare.com/client/v4/accounts/${TARGET.accountId}/d1/database/${TARGET.databaseId}`);
  assert.equal(calls[1].url, `https://api.cloudflare.com/client/v4/accounts/${TARGET.accountId}/d1/database/${TARGET.databaseId}/query`);
  assert.equal(calls[1].init.headers.Authorization, `Bearer ${TARGET.apiToken}`);
  assert.deepEqual(JSON.parse(calls[1].init.body), { sql: 'PRAGMA table_info("workspaces")', params: [] });
});

test('D1 snapshot batch accepts only idempotent INSERT upserts', async () => {
  let body;
  const db = createCloudflareD1SnapshotDatabase({
    ...TARGET,
    fetchFn: async (_url, init) => {
      if (init.method === 'GET') return Response.json({ success: true, result: { uuid: TARGET.databaseId, name: 'trading-staging' } });
      body = JSON.parse(init.body);
      return Response.json({ success: true, result: [{ success: true }, { success: true }] });
    },
  });
  const statements = [
    { sql: 'INSERT INTO "workspaces" ("id") VALUES (?) ON CONFLICT ("id") DO UPDATE SET "id" = EXCLUDED."id"', values: ['w1'] },
    { sql: 'INSERT INTO "workspaces" ("id") VALUES (?) ON CONFLICT ("id") DO NOTHING', values: ['w2'] },
  ];

  const result = await db.batch(statements);

  assert.deepEqual(result.map((entry) => entry.success), [true, true]);
  assert.deepEqual(body.batch, statements.map(({ sql, values }) => ({ sql, params: values })));
});

test('D1 snapshot batch rejects non-upsert SQL before sending a request', async () => {
  let calls = 0;
  const db = createCloudflareD1SnapshotDatabase({ ...TARGET, fetchFn: async () => { calls += 1; } });

  await assert.rejects(() => db.batch([{ sql: 'DELETE FROM "workspaces"', values: [] }]), /INSERT upserts/i);
  assert.equal(calls, 0);
});

test('D1 snapshot import refuses a database id that resolves to another database', async () => {
  let queryCalls = 0;
  const db = createCloudflareD1SnapshotDatabase({
    ...TARGET,
    fetchFn: async (_url, init) => {
      if (init.method !== 'GET') queryCalls += 1;
      return Response.json({ success: true, result: { uuid: TARGET.databaseId, name: 'unrelated-database' } });
    },
  });

  await assert.rejects(() => db.batch([
    { sql: 'INSERT INTO "workspaces" ("id") VALUES (?) ON CONFLICT ("id") DO NOTHING', values: ['w1'] },
  ]), /approved existing database/i);
  assert.equal(queryCalls, 0);
});

test('D1 API batch failure is surfaced without exposing response payloads', async () => {
  const db = createCloudflareD1SnapshotDatabase({
    ...TARGET,
    fetchFn: async (_url, init) => init.method === 'GET'
      ? Response.json({ success: true, result: { uuid: TARGET.databaseId, name: 'trading-staging' } })
      : Response.json({ success: false, errors: [{ code: 7500, message: 'sensitive payload text' }] }, { status: 400 }),
  });

  await assert.rejects(() => db.prepare('SELECT 1').all(), (error) => {
    assert.match(error.message, /Cloudflare D1 query failed/);
    assert.doesNotMatch(error.message, /sensitive payload text/);
    return true;
  });
});
