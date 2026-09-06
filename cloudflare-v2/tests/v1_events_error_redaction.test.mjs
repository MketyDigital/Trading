import test from 'node:test';
import assert from 'node:assert/strict';
import { handleV1EventsRequest } from '../src/http/v1_events.js';

test('simulation planning failures never expose internal error details in the HTTP response', async () => {
  const secretDetail = 'sensitive stack-derived simulation failure detail';
  const request = new Request('https://trade.test/api/v1/events', {
    method: 'POST',
    body: '{}',
    headers: {
      'X-Mkety-Source-Id': 'src-1',
      'X-Mkety-Timestamp': '1',
      'X-Mkety-Signature': 'sig',
    },
  });

  const response = await handleV1EventsRequest(request, {
    TRADING_MASTER_KEY: 'master',
    TRADING_V1_SIMULATION: 'true',
  }, {
    supabaseFactory: async () => ({}),
    storesFactory: () => ({ sourceStore: {}, eventStore: {} }),
    ingestFn: async () => ({
      ok: true,
      duplicate: false,
      eventId: 'e-redaction',
      event: {},
      interpretation: { status: 'READY' },
    }),
    simulationDepsFactory: async () => {
      const error = new Error(secretDetail);
      error.stack = `Error: ${secretDetail}\n    at internal/provider/secrets.js:42:7`;
      throw error;
    },
  });

  const body = await response.json();
  const serialized = JSON.stringify(body);

  assert.equal(response.status, 200);
  assert.equal(body.simulation.status, 'BLOCKED');
  assert.equal(body.simulation.executionEnabled, false);
  assert.deepEqual(body.simulation.actions, []);
  assert.equal(body.simulation.error, 'SIMULATION_PLANNING_BLOCKED');
  assert.equal(serialized.includes(secretDetail), false);
  assert.equal(serialized.includes('internal/provider/secrets.js'), false);
});
