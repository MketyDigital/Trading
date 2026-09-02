import test from 'node:test';
import assert from 'node:assert/strict';

import { createTradingV1Entrypoint } from '../src/v1_entry.js';

test('worker exposes Cloudflare queue handler and delegates batch to injected source queue runtime', async () => {
  const seen = [];
  const runtime = async (batch, env, options) => {
    seen.push({ batch, env, options });
    return { processed: 2, acknowledged: 2, retried: 0 };
  };

  const worker = createTradingV1Entrypoint({
    legacy: { fetch: async () => new Response('legacy') },
    queueRuntime: runtime,
  });
  const batch = { messages: [{ body: { id: 1 } }, { body: { id: 2 } }] };
  const env = { TRADING_MASTER_KEY: 'configured' };
  const ctx = { waitUntil() {} };

  assert.equal(typeof worker.queue, 'function');
  const result = await worker.queue(batch, env, ctx);

  assert.deepEqual(result, { processed: 2, acknowledged: 2, retried: 0 });
  assert.equal(seen.length, 1);
  assert.equal(seen[0].batch, batch);
  assert.equal(seen[0].env, env);
  assert.equal(seen[0].options.ctx, ctx);
});

test('queue handler is independent of legacy scheduled/fetch routing', async () => {
  let legacyCalls = 0;
  const worker = createTradingV1Entrypoint({
    legacy: {
      async fetch() { legacyCalls += 1; return new Response('legacy'); },
      async scheduled() { legacyCalls += 1; },
    },
    queueRuntime: async () => ({ processed: 0, acknowledged: 0, retried: 0 }),
  });

  await worker.queue({ messages: [] }, {}, {});
  assert.equal(legacyCalls, 0);
});
