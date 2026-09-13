import test from 'node:test';
import assert from 'node:assert/strict';

import { executeCTraderAction } from '../src/adapters/ctrader_executor_v2.js';

function store() {
  const failures = [];
  const completions = [];
  return {
    failures,
    completions,
    async reserve() { return { ok: true, duplicate: false }; },
    async complete(_key, value) { completions.push(value); },
    async fail(_key, failure) { failures.push(failure); },
  };
}

const symbol = {
  platform: 'ctrader',
  platformId: 75,
  platformSymbol: 'Volatility 75 (1s) Index',
  canonical: 'DERIV:VOLATILITY_75_1S',
  protocolLotSize: 100,
  minVolume: 5,
  maxVolume: 10000,
  stepVolume: 5,
  digits: 2,
};

const action = {
  type: 'OPEN_POSITION',
  idempotencyKey: 'evt:acct:leg:1',
  symbol: 'DERIV:VOLATILITY_75_1S',
  side: 'BUY',
  orderType: 'MARKET',
  entry: { kind: 'MARKET' },
  lots: 0.01,
};

test('cTrader fixed lots below symbol minimum fail with a specific pre-send code by default', async () => {
  const deliveryStore = store();
  const session = { request: async () => { throw new Error('must not send'); } };

  await assert.rejects(
    executeCTraderAction(action, { session, accountId: 48685071, catalog: [symbol], deliveryStore }),
    (error) => error?.code === 'CTRADER_VOLUME_BELOW_MINIMUM',
  );
  assert.equal(deliveryStore.failures[0]?.code, 'CTRADER_VOLUME_BELOW_MINIMUM');
});

test('explicit broker-minimum fallback uses the live symbol minimum and records executed lots', async () => {
  const deliveryStore = store();
  const requests = [];
  const session = {
    async request(message) {
      requests.push(message);
      return {
        payloadType: 2126,
        payload: {
          executionType: 3,
          position: { positionId: 9001, price: 6000 },
          order: { orderId: 8001 },
          deal: { dealId: 7001, positionId: 9001, orderId: 8001, executionPrice: 6000 },
        },
      };
    },
  };

  const result = await executeCTraderAction(action, {
    session,
    accountId: 48685071,
    catalog: [symbol],
    deliveryStore,
    allowBrokerMinimumVolumeFallback: true,
  });

  assert.equal(requests.length, 1);
  assert.equal(requests[0].payload.volume, 5);
  assert.equal(result.executedLots, 0.05);
  assert.equal(result.volumeStepLots, 0.05);
  assert.equal(result.minimumLots, 0.05);
});
