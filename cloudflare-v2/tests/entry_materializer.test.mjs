import test from 'node:test';
import assert from 'node:assert/strict';
import { materializeExecutionEntry } from '../src/execution/entry_materializer.js';

const buyRange = { side: 'BUY', orderType: 'MARKET', entry: { kind: 'RANGE', min: 2525, max: 2528 } };
const sellRange = { side: 'SELL', orderType: 'MARKET', entry: { kind: 'RANGE', min: 2525, max: 2528 } };

test('executes at market when current price is already inside configured entry zone', () => {
  const result = materializeExecutionEntry(buyRange, { currentPrice: 2526, rangeMode: 'MARKET_IF_IN_RANGE' });
  assert.deepEqual(result, { orderType: 'MARKET', entry: { kind: 'MARKET', referencePrice: 2526 } });
});

test('uses nearest range boundary and infers pending order type when price is outside zone', () => {
  assert.deepEqual(materializeExecutionEntry(buyRange, { currentPrice: 2532, rangeMode: 'MARKET_IF_IN_RANGE' }), {
    orderType: 'LIMIT', entry: { kind: 'PRICE', value: 2528 }
  });
  assert.deepEqual(materializeExecutionEntry(buyRange, { currentPrice: 2520, rangeMode: 'MARKET_IF_IN_RANGE' }), {
    orderType: 'STOP', entry: { kind: 'PRICE', value: 2525 }
  });
  assert.deepEqual(materializeExecutionEntry(sellRange, { currentPrice: 2532, rangeMode: 'MARKET_IF_IN_RANGE' }), {
    orderType: 'STOP', entry: { kind: 'PRICE', value: 2528 }
  });
  assert.deepEqual(materializeExecutionEntry(sellRange, { currentPrice: 2520, rangeMode: 'MARKET_IF_IN_RANGE' }), {
    orderType: 'LIMIT', entry: { kind: 'PRICE', value: 2525 }
  });
});

test('supports midpoint lower and upper tenant entry policies', () => {
  assert.equal(materializeExecutionEntry(buyRange, { currentPrice: 2532, rangeMode: 'MIDPOINT' }).entry.value, 2526.5);
  assert.equal(materializeExecutionEntry(buyRange, { currentPrice: 2532, rangeMode: 'LOWER' }).entry.value, 2525);
  assert.equal(materializeExecutionEntry(buyRange, { currentPrice: 2532, rangeMode: 'UPPER' }).entry.value, 2528);
});

test('supports explicit market-only policy and fails closed without required market price', () => {
  assert.deepEqual(materializeExecutionEntry(buyRange, { currentPrice: 2532, rangeMode: 'MARKET_ALWAYS' }), {
    orderType: 'MARKET', entry: { kind: 'MARKET', referencePrice: 2532 }
  });
  assert.throws(() => materializeExecutionEntry(buyRange, { rangeMode: 'MARKET_IF_IN_RANGE' }), /current price/i);
});
