import test from 'node:test';
import assert from 'node:assert/strict';
import { interpretTradingEvent } from '../src/ai/trading_interpreter.js';
import { executeCTraderAction } from '../src/adapters/ctrader_executor_v2.js';
import { buildCTraderManagementCommand } from '../src/execution/platform_translation.js';

test('SL AT BE variants are deterministic break-even management', async () => {
  for (const text of ['SL AT BE', 'SL at BE now', 'SL TO BE NOW']) {
    const plan = await interpretTradingEvent({ text });
    assert.deepEqual(plan, {
      status: 'MANAGEMENT', source: 'deterministic', management: { type: 'MOVE_SL_TO_BE' },
    }, text);
  }
});

test('stopped-at-break-even result text is informational, not a new management action', async () => {
  const plan = await interpretTradingEvent({ text: 'STOPPED AT BE AFTER TP2' });
  assert.equal(plan.status, 'NO_ACTION');
  assert.equal(plan.source, 'deterministic');
});

test('cTrader transport clientMsgId is bounded to the API 64-character limit', () => {
  const longId = 'x'.repeat(175);
  const message = buildCTraderManagementCommand({
    type: 'CLOSE_POSITION', symbol: 'XAUUSD', brokerPositionId: '136391850', lots: 0.01,
  }, {
    accountId: 48685071,
    clientMsgId: longId,
    symbol: { protocolLotSize: 10000, minVolume: 100, maxVolume: 100000, stepVolume: 100 },
  });
  assert.ok(message.clientMsgId.length > 0);
  assert.ok(message.clientMsgId.length <= 64);
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
