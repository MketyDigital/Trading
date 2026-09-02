import test from 'node:test';
import assert from 'node:assert/strict';
import { createTradingV1Entrypoint } from '../src/v1_entry.js';

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

test('exact TradingView webhook prefix routes to dedicated handler and never legacy', async () => {
  const calls = [];
  const worker = createTradingV1Entrypoint({
    legacy: {
      async fetch() { calls.push('legacy'); return jsonResponse({ legacy: true }); },
    },
    tradingViewHandler: async (request) => {
      calls.push(['tradingview', new URL(request.url).pathname]);
      return jsonResponse({ ok: true }, 202);
    },
  });

  const response = await worker.fetch(new Request(
    'https://trading.example.com/api/v1/webhooks/tradingview/tv_public_abc123',
    { method: 'POST', body: '{}' },
  ), {}, {});

  assert.equal(response.status, 202);
  assert.deepEqual(calls, [[
    'tradingview',
    '/api/v1/webhooks/tradingview/tv_public_abc123',
  ]]);
});

test('unmatched V1 webhook paths remain closed and do not fall through to legacy', async () => {
  let legacyCalls = 0;
  let tradingViewCalls = 0;
  const worker = createTradingV1Entrypoint({
    legacy: { async fetch() { legacyCalls += 1; return jsonResponse({ legacy: true }); } },
    tradingViewHandler: async () => { tradingViewCalls += 1; return jsonResponse({ ok: true }); },
  });

  const response = await worker.fetch(new Request(
    'https://trading.example.com/api/v1/webhooks/other/source',
    { method: 'POST', body: '{}' },
  ), {}, {});

  assert.equal(response.status, 404);
  assert.equal(legacyCalls, 0);
  assert.equal(tradingViewCalls, 0);
});

test('existing signed V1 events route remains independent from TradingView handler', async () => {
  let eventCalls = 0;
  let tradingViewCalls = 0;
  let legacyCalls = 0;
  const worker = createTradingV1Entrypoint({
    legacy: { async fetch() { legacyCalls += 1; return jsonResponse({ legacy: true }); } },
    eventsHandler: async () => { eventCalls += 1; return jsonResponse({ ok: true, signed: true }); },
    tradingViewHandler: async () => { tradingViewCalls += 1; return jsonResponse({ ok: true }); },
  });

  const response = await worker.fetch(new Request(
    'https://trading.example.com/api/v1/events',
    { method: 'POST', body: '{}' },
  ), {}, {});

  assert.equal(response.status, 200);
  assert.equal(eventCalls, 1);
  assert.equal(tradingViewCalls, 0);
  assert.equal(legacyCalls, 0);
});
