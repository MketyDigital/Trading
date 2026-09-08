import test from 'node:test';
import assert from 'node:assert/strict';
import { createTradingV1Entrypoint } from '../src/v1_entry.js';

async function html() {
  const worker = createTradingV1Entrypoint({ legacy: { fetch: async () => new Response('legacy') } });
  return (await worker.fetch(new Request('https://trade.mkety.com/'), { TRADING_ACCESS_ENABLED: 'true', BROKER_EXECUTION_ENABLED: 'false' }, {})).text();
}

test('enterprise portal exposes runtime controls for accounts, destinations and routes', async () => {
  const page = await html();
  assert.match(page, /data-account-active/);
  assert.match(page, /data-account-execution/);
  assert.match(page, /data-account-kill/);
  assert.match(page, /data-destination-toggle/);
  assert.match(page, /data-route-toggle/);
  assert.match(page, /Broker master fuse remains OFF/i);
});

test('broker destination target is selected from configured broker connections, not free text authority', async () => {
  const page = await html();
  assert.match(page, /brokerAccountDestinationSelector/);
  assert.match(page, /destination_ref/i);
});

test('webhook UI requires a signing secret and sends signingSecret', async () => {
  const page = await html();
  assert.match(page, /Webhook signing secret/i);
  assert.match(page, /signingSecret/);
  assert.doesNotMatch(page, /Webhook secret \(optional\)/i);
});

test('source create button is replaced before enhanced handler is attached so only one create workflow remains', async () => {
  const page = await html();
  assert.match(page, /cloneNode\(true\)/);
});
