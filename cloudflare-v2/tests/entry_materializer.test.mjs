import test from 'node:test';
import assert from 'node:assert/strict';
import { materializeExecutionEntry } from '../src/execution/entry_materializer.js';

const buyRange = { side: 'BUY', orderType: 'MARKET', entry: { kind: 'RANGE', min: 2525, max: 2528 } };
const sellRange = { side: 'SELL', orderType: 'MARKET', entry: { kind: 'RANGE', min: 2525, max: 2528 } };

test('executes at market when current price is already inside configured entry zone', () => {
  const result = materializeExecutionEntry(buyRange, { currentPrice: 2526, rangeMode: 'MARKET_IF_IN_RANGE' });
  assert.deepEqual(result, { orderType: 'MARKET', entry: { kind: 'MARKET', referencePrice: 2526 } });
});

test('never converts a MARKET entry range into an inferred pending order', () => {
  for (const [intent, currentPrice] of [
    [buyRange, 2532],
    [buyRange, 2520],
    [sellRange, 2532],
    [sellRange, 2520],
  ]) {
    assert.deepEqual(materializeExecutionEntry(intent, { currentPrice, rangeMode: 'MARKET_IF_IN_RANGE' }), {
      orderType: 'MARKET', entry: { kind: 'MARKET', referencePrice: currentPrice }
    });
  }
});

test('MARKET range semantics remain MARKET under every legacy range policy', () => {
  for (const mode of ['MARKET_ALWAYS', 'MARKET_IF_IN_RANGE', 'MIDPOINT', 'LOWER', 'UPPER']) {
    assert.deepEqual(materializeExecutionEntry(buyRange, { currentPrice: 2532, rangeMode: mode }), {
      orderType: 'MARKET', entry: { kind: 'MARKET', referencePrice: 2532 }
    });
  }
  assert.deepEqual(materializeExecutionEntry(buyRange, { rangeMode: 'MARKET_IF_IN_RANGE' }), {
    orderType: 'MARKET', entry: { kind: 'MARKET' }
  });
});

test('explicit pending range preserves the declared pending order type', () => {
  const buyLimit = { side: 'BUY', orderType: 'LIMIT', entry: { kind: 'RANGE', min: 2525, max: 2528 } };
  const sellStop = { side: 'SELL', orderType: 'STOP', entry: { kind: 'RANGE', min: 2525, max: 2528 } };
  assert.deepEqual(materializeExecutionEntry(buyLimit, { currentPrice: 2532, rangeMode: 'MARKET_IF_IN_RANGE' }), {
    orderType: 'LIMIT', entry: { kind: 'PRICE', value: 2528 }
  });
  assert.deepEqual(materializeExecutionEntry(sellStop, { currentPrice: 2520, rangeMode: 'MARKET_IF_IN_RANGE' }), {
    orderType: 'STOP', entry: { kind: 'PRICE', value: 2525 }
  });
  assert.equal(materializeExecutionEntry(buyLimit, { currentPrice: 2532, rangeMode: 'MIDPOINT' }).entry.value, 2526.5);
});
