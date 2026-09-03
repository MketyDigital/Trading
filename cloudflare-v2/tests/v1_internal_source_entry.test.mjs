import test from 'node:test';
import assert from 'node:assert/strict';

import { createTradingV1Entrypoint } from '../src/v1_entry.js';

test('worker routes only exact internal source-event path to trusted handoff handler even when Trading access is disabled', async () => {
  const seen = [];
  const worker = createTradingV1Entrypoint({
    legacy: { async fetch() { return new Response('legacy'); } },
    internalSourceHandler: async (request, env, options) => {
      seen.push({ request, env, options });
      return new Response(JSON.stringify({ ok: true, queued: true }), {
        status: 202,
        headers: { 'Content-Type': 'application/json' },
      });
    },
  });

  const env = { INTERNAL_SOURCE_TRANSPORT_TOKEN: 'configured', TRADING_ACCESS_ENABLED: 'false' };
  const ctx = { waitUntil() {} };
  const request = new Request('https://trade.mkety.com/api/v1/internal/source-event', {
    method: 'POST',
    body: '{}',
  });
  const response = await worker.fetch(request, env, ctx);

  assert.equal(response.status, 202);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].request, request);
  assert.equal(seen[0].env, env);
  assert.equal(seen[0].options.ctx, ctx);
});

test('nearby internal paths remain closed to legacy routing while Trading access is disabled', async () => {
  let legacyCalls = 0;
  const worker = createTradingV1Entrypoint({
    legacy: { async fetch() { legacyCalls += 1; return new Response('legacy'); } },
    internalSourceHandler: async () => new Response('internal'),
  });

  const response = await worker.fetch(new Request('https://trade.mkety.com/api/v1/internal/source-events', {
    method: 'POST',
  }), { TRADING_ACCESS_ENABLED: 'false' }, {});

  assert.equal(response.status, 404);
  assert.equal(legacyCalls, 0);
});
