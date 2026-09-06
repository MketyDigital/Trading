import test from 'node:test';
import assert from 'node:assert/strict';
import { createTradingV1Entrypoint } from '../src/v1_entry.js';

test('TradingView certificate probe reaches probe handler while Trading access is disabled', async () => {
  const worker = createTradingV1Entrypoint({
    legacy: {
      fetch: async () => new Response(JSON.stringify({ ok: false, reason: 'LEGACY_NOT_EXPECTED' }), { status: 599 }),
    },
  });

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
