import test from 'node:test';
import assert from 'node:assert/strict';
import { createTradingV1Entrypoint } from '../src/v1_entry.js';

function createWorker() {
  return createTradingV1Entrypoint({
    legacy: {
      fetch: async () => new Response(JSON.stringify({ ok: false, reason: 'LEGACY_NOT_EXPECTED' }), { status: 599 }),
    },
  });
}

test('TradingView certificate probe reaches probe handler while Trading access is disabled', async () => {
  const worker = createWorker();

  const response = await worker.fetch(new Request('https://trade.mkety.com/api/v1/webhooks/tradingview/probe', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ event_id: 'spoof-only', text: 'probe' }),
  }), {
    TRADING_ACCESS_ENABLED: 'false',
    TRADINGVIEW_CERT_PROBE_ENABLED: 'true',
  }, {});

  assert.equal(response.status, 403);
  assert.equal((await response.json()).reason, 'TRADINGVIEW_TRANSPORT_NOT_VERIFIED');
});

test('TradingView non-probe webhooks remain blocked while Trading access is disabled', async () => {
  const worker = createWorker();

  const response = await worker.fetch(new Request('https://trade.mkety.com/api/v1/webhooks/tradingview/live-handle', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ event_id: 'normal-webhook', text: 'probe' }),
  }), {
    TRADING_ACCESS_ENABLED: 'false',
    TRADINGVIEW_CERT_PROBE_ENABLED: 'true',
  }, {});

  assert.equal(response.status, 503);
  assert.equal((await response.json()).reason, 'TRADING_ACCESS_DISABLED');
});
