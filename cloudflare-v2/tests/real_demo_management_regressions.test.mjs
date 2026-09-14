import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMachinePlan } from '../src/pipeline/machine_plan.js';
import { executeCTraderAction } from '../src/adapters/ctrader_executor_v2.js';

test('SL AT BE variants are deterministic break-even management', () => {
  for (const text of ['SL AT BE', 'SL at BE now', 'SL TO BE NOW']) {
    assert.deepEqual(buildMachinePlan({ text }), {
      status: 'MANAGEMENT', management: { type: 'MOVE_SL_TO_BE' },
    }, text);
  }
});

test('stopped-at-break-even result text is informational, not a new management action', () => {
  const plan = buildMachinePlan({ text: 'STOPPED AT BE AFTER TP2' });
  assert.equal(plan.status, 'NO_ACTION');
});

test('cTrader terminal rejection preserves broker description in persisted failure payload', async () => {
  let persisted = null;
  const brokerError = Object.assign(new Error('INVALID_REQUEST: bad close volume'), {
    code: 'INVALID_REQUEST',
    deliveryFailureClass: 'TERMINAL',
  });
  const deliveryStore = {
    reserve: async () => ({ ok: true, duplicate: false }),
    complete: async () => {},
    fail: async (_key, failure) => { persisted = failure; },
  };
  const session = { request: async () => { throw brokerError; } };
  const catalog = [{
    platform: 'ctrader', platformSymbol: 'XAUUSD', canonical: 'XAUUSD', platformId: 41,
    protocolLotSize: 10000, minVolume: 100, maxVolume: 100000, stepVolume: 100,
  }];

  await assert.rejects(() => executeCTraderAction({
    type: 'CLOSE_POSITION', symbol: 'XAUUSD', brokerPositionId: '136391850', lots: 0.01,
    idempotencyKey: 'close-demo-regression',
  }, { session, accountId: 48685071, catalog, deliveryStore }), /INVALID_REQUEST/);

  assert.equal(persisted.code, 'INVALID_REQUEST');
  assert.equal(persisted.error, 'INVALID_REQUEST: bad close volume');
  assert.deepEqual(persisted.result, {
    code: 'INVALID_REQUEST', message: 'INVALID_REQUEST: bad close volume',
  });
});
