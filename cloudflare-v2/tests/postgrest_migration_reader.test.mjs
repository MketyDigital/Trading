import test from 'node:test';
import assert from 'node:assert/strict';
import { createPostgrestMigrationClient } from '../scripts/postgrest_migration_reader.mjs';

const projectUrl = 'https://vdblajgxrfndjesoyayy.supabase.co';

test('migration REST reader pins the only permitted source host', () => {
  assert.throws(() => createPostgrestMigrationClient({ url: 'https://attacker.example', serviceRole: 'secret' }), /pinned Trading project/);
  assert.throws(() => createPostgrestMigrationClient({ url: projectUrl, serviceRole: '' }), /credentials are incomplete/);
});

test('migration REST reader makes bounded ordered requests and never logs the service credential', async () => {
  const calls = [];
  const client = createPostgrestMigrationClient({
    url: projectUrl,
    serviceRole: 'private-service-key',
    fetchFn: async (url, options) => {
      calls.push({ url: String(url), options });
      return new Response(JSON.stringify([{ id: 'row-1' }]), { status: 200, headers: { 'content-type': 'application/json' } });
    },
  });

  const result = await client.from('trade_accounts').select('*').order('id', { ascending: true }).range(0, 99);
  assert.deepEqual(result.data, [{ id: 'row-1' }]);
  assert.equal(result.error, null);
  assert.equal(calls.length, 1);
  const call = calls[0];
  assert.equal(new URL(call.url).hostname, 'vdblajgxrfndjesoyayy.supabase.co');
  assert.equal(new URL(call.url).pathname, '/rest/v1/trade_accounts');
  assert.equal(new URL(call.url).searchParams.get('select'), '*');
  assert.equal(new URL(call.url).searchParams.get('order'), 'id.asc');
  assert.equal(call.options.method, 'GET');
  assert.equal(call.options.headers.range, '0-99');
  assert.equal(call.options.headers.authorization, 'Bearer private-service-key');
});

test('migration REST reader confines mutation methods to explicit migration-tool callers', async () => {
  const calls = [];
  const client = createPostgrestMigrationClient({
    url: projectUrl,
    serviceRole: 'private-service-key',
    fetchFn: async (url, options) => {
      calls.push({ url: String(url), options });
      return new Response(null, { status: 204 });
    },
  });
  await client.from('workspaces').update({ name: 'staging' }).eq('id', 'workspace-1');
  assert.equal(calls[0].options.method, 'PATCH');
  assert.deepEqual(JSON.parse(calls[0].options.body), { name: 'staging' });
  assert.equal(new URL(calls[0].url).searchParams.get('id'), 'eq.workspace-1');
});
