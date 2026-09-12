import test from 'node:test';
import assert from 'node:assert/strict';

import { handleV1EventsRequest } from '../src/http/v1_events.js';

function signedRequest() {
  return new Request('https://trade.test/api/v1/events', {
    method: 'POST',
    body: '{}',
    headers: {
      'X-Mkety-Source-Id': 'src-1',
      'X-Mkety-Timestamp': '1',
      'X-Mkety-Signature': 'sig',
    },
  });
}

function acceptedEvent() {
  return {
    ok: true,
    duplicate: false,
    eventId: 'event-1',
    event: {
      workspace_hint: 'workspace-1',
      external_event_id: 'external-1',
      text: 'BUY XAUUSD',
      source: { instance_id: 'src-1' },
      thread: {},
    },
    interpretation: {
      status: 'READY',
      source: 'deterministic',
      intent: {
        side: 'BUY',
        orderType: 'MARKET',
        symbol: { canonical: 'XAUUSD' },
        entry: { kind: 'MARKET' },
        stopLoss: 2300,
        takeProfits: [2400],
      },
    },
  };
}

test('slow destination delivery does not delay broker execution branch', async () => {
  let releaseDestination;
  const destinationGate = new Promise((resolve) => { releaseDestination = resolve; });
  let destinationStarted = false;
  let executionStarted = false;

  const responsePromise = handleV1EventsRequest(signedRequest(), { TRADING_MASTER_KEY: 'master' }, {
    supabaseFactory: async () => ({ from() {} }),
    storesFactory: () => ({ sourceStore: {}, eventStore: {} }),
    ingestFn: async () => acceptedEvent(),
    destinationStoreFactory: () => ({}),
    destinationStageFn: async () => {
      destinationStarted = true;
      await destinationGate;
      return { status: 'DELIVERED', succeeded: 1, failed: 0, rejected: 0, blocked: 0, outcomes: [] };
    },
    simulationDepsFactory: async () => ({ safe: true }),
    orchestrateFn: async () => ({
      status: 'SIMULATED',
      executionEnabled: true,
      accounts: [{ accountId: 'account-1', status: 'READY', actions: [{ type: 'OPEN_POSITION', symbol: 'XAUUSD' }] }],
    }),
    executionStageFn: async () => {
      executionStarted = true;
      return { status: 'SUCCEEDED', executionEnabled: true };
    },
  });

  await new Promise((resolve) => setTimeout(resolve, 25));
  assert.equal(destinationStarted, true);
  assert.equal(executionStarted, true, 'broker execution must start without waiting for Telegram/destination delivery');

  releaseDestination();
  const response = await responsePromise;
  assert.equal(response.status, 200);
});
