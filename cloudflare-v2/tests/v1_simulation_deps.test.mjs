import test from 'node:test';
import assert from 'node:assert/strict';
import { createV1SimulationDependencies } from '../src/pipeline/v1_simulation_deps.js';

test('V1 simulation dependencies expose authenticated matched-group reads for fast-entry completion', async () => {
  const calls = [];
  const group = { id: 'group/fast 1', tradeAccountId: 'acct-1', incomplete: true };
  const stub = {
    fetch: async (url, init = {}) => {
      calls.push({ url: String(url), method: init.method, headers: init.headers });
      return new Response(JSON.stringify(group), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    },
  };
  const env = {
    TRADE_STATE_INTERNAL_TOKEN: 'internal-secret',
    TRADE_STATE_NAMESPACE: {
      idFromName: (name) => `id:${name}`,
      get: () => stub,
    },
  };
  const supabase = { from() { throw new Error('database should not be used for group read'); } };

  const deps = await createV1SimulationDependencies({
    env,
    supabase,
    event: { workspace_hint: 'workspace-1' },
  });

  assert.equal(typeof deps.stateStore.getGroup, 'function');
  assert.deepEqual(await deps.stateStore.getGroup('group/fast 1'), group);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, 'GET');
  assert.match(calls[0].url, /\/groups\/group%2Ffast%201$/);
  assert.equal(calls[0].headers['x-mkety-internal-token'], 'internal-secret');
});
