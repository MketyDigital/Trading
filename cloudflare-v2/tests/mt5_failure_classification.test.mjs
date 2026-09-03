import test from 'node:test';
import assert from 'node:assert/strict';
import { executeMT5Action } from '../src/adapters/mt5_executor_v2.js';

const symbol = {
  platform: 'mt5', platformSymbol: 'XAUUSD.a', canonical: 'XAUUSD', aliases: ['GOLD'],
  digits: 2, tickSize: 0.01, minLots: 0.01, maxLots: 100, stepLots: 0.01,
};

function store() {
  const calls = [];
  return {
    calls,
    reserve: async () => ({ ok: true, duplicate: false }),
    complete: async (key, result) => calls.push({ type: 'complete', key, result }),
    fail: async (key, failure) => calls.push({ type: 'fail', key, failure }),
    markRetryable: async (key, failure, options) => calls.push({ type: 'retryable', key, failure, options }),
    markUncertain: async (key, failure) => calls.push({ type: 'uncertain', key, failure }),
  };
}

function openAction(idempotencyKey = 'open-1') {
  return {
    type: 'OPEN_POSITION', side: 'BUY', orderType: 'MARKET', symbol: 'XAUUSD',
    entry: { kind: 'MARKET' }, lots: 0.01, stopLoss: 2500, takeProfit: 2550, idempotencyKey,
  };
}

function baseDeps(deliveryStore, overrides = {}) {
  return {
    workspaceId: 'ws-1', accountId: 'acct-1', bridgeUrl: 'https://bridge.test/v1/command',
    bridgeSecret: 'secret', catalog: [symbol], deliveryStore, nowMs: 1700000000000,
    ...overrides,
  };
}

test('OPEN_POSITION transport ambiguity is retryable with the same idempotency key after MT5 reconciliation support', async () => {
  const deliveryStore = store();
  await assert.rejects(() => executeMT5Action(openAction('safe-open-retry'), baseDeps(deliveryStore, {
    retryDelayMs: 15000,
    fetchFn: async () => { throw new TypeError('fetch failed'); },
  })), /fetch failed/);

  assert.equal(deliveryStore.calls.length, 1);
  assert.equal(deliveryStore.calls[0].type, 'retryable');
  assert.equal(deliveryStore.calls[0].key, 'safe-open-retry');
  assert.equal(deliveryStore.calls[0].failure.code, 'MT5_TRANSPORT_AMBIGUOUS');
  assert.equal(deliveryStore.calls[0].options.nextAttemptAt, '2023-11-14T22:13:35.000Z');
});

test('management transport ambiguity is UNCERTAIN and never scheduled for blind retry', async () => {
  const deliveryStore = store();
  await assert.rejects(() => executeMT5Action({
    type: 'CLOSE_POSITION', brokerPositionId: '900', symbol: 'XAUUSD', idempotencyKey: 'close-1',
  }, baseDeps(deliveryStore, {
    fetchFn: async () => { throw new TypeError('fetch failed'); },
  })), /fetch failed/);

  assert.deepEqual(deliveryStore.calls.map((item) => item.type), ['uncertain']);
  assert.equal(deliveryStore.calls[0].failure.code, 'MT5_MANAGEMENT_OUTCOME_UNCERTAIN');
});

test('bridge reconciliation uncertainty is UNCERTAIN even for OPEN_POSITION', async () => {
  const deliveryStore = store();
  await assert.rejects(() => executeMT5Action(openAction('reconcile-uncertain'), baseDeps(deliveryStore, {
    fetchFn: async () => ({
      ok: false, status: 409,
      json: async () => ({ ok: false, error: 'MT5_RECONCILIATION_UNCERTAIN:history_deals' }),
    }),
  })), /MT5_RECONCILIATION_UNCERTAIN/);

  assert.deepEqual(deliveryStore.calls.map((item) => item.type), ['uncertain']);
  assert.equal(deliveryStore.calls[0].failure.code, 'MT5_RECONCILIATION_UNCERTAIN');
});

test('bridge reconciliation ambiguity is UNCERTAIN and never retryable', async () => {
  const deliveryStore = store();
  await assert.rejects(() => executeMT5Action(openAction('reconcile-ambiguous'), baseDeps(deliveryStore, {
    fetchFn: async () => ({
      ok: false, status: 409,
      json: async () => ({ ok: false, error: 'MT5_RECONCILIATION_AMBIGUOUS' }),
    }),
  })), /MT5_RECONCILIATION_AMBIGUOUS/);

  assert.deepEqual(deliveryStore.calls.map((item) => item.type), ['uncertain']);
  assert.equal(deliveryStore.calls[0].failure.code, 'MT5_RECONCILIATION_AMBIGUOUS');
});

test('deterministic bridge rejection remains terminal FAILED', async () => {
  const deliveryStore = store();
  await assert.rejects(() => executeMT5Action(openAction('bad-order'), baseDeps(deliveryStore, {
    fetchFn: async () => ({ ok: false, status: 409, json: async () => ({ ok: false, error: 'order_check failed' }) }),
  })), /order_check failed/);

  assert.deepEqual(deliveryStore.calls.map((item) => item.type), ['fail']);
  assert.equal(deliveryStore.calls[0].failure.code, 'MT5_BRIDGE_REJECTED');
});
