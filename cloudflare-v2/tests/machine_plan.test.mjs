import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMachinePlan } from '../src/pipeline/machine_plan.js';

test('parses a three-TP market signal into canonical execution intent', () => {
  const plan = buildMachinePlan({ text: 'BUY XAUUSD 2526 SL 2518 TP 2530 2535 2545' });
  assert.equal(plan.status, 'READY');
  assert.equal(plan.intent.side, 'BUY');
  assert.equal(plan.intent.orderType, 'MARKET');
  assert.equal(plan.intent.symbol.canonical, 'XAUUSD');
  assert.deepEqual(plan.intent.entry, { kind: 'PRICE', value: 2526 });
  assert.equal(plan.intent.stopLoss, 2518);
  assert.deepEqual(plan.intent.takeProfits, [2530, 2535, 2545]);
});

test('parses entry ranges and common GOLD aliases', () => {
  const plan = buildMachinePlan({ text: 'SELL GOLD 2525-2528 SL 2535 TP1 2520 TP2 2515 TP3 2500' });
  assert.equal(plan.status, 'READY');
  assert.equal(plan.intent.symbol.canonical, 'XAUUSD');
  assert.deepEqual(plan.intent.entry, { kind: 'RANGE', min: 2525, max: 2528 });
  assert.deepEqual(plan.intent.takeProfits, [2520, 2515, 2500]);
});

test('parses pending orders', () => {
  const plan = buildMachinePlan({ text: 'BUY LIMIT EURUSD 1.1600 SL 1.1570 TP 1.1650' });
  assert.equal(plan.status, 'READY');
  assert.equal(plan.intent.orderType, 'LIMIT');
  assert.equal(plan.intent.entry.value, 1.16);
});

test('accepts symbol-before-side and long/short signal variants', () => {
  const symbolFirst = buildMachinePlan({ text: 'XAUUSD BUY @ 2526 SL:2518 TP1:2530 TP2:2535' });
  assert.equal(symbolFirst.status, 'READY');
  assert.equal(symbolFirst.intent.side, 'BUY');
  assert.equal(symbolFirst.intent.symbol.canonical, 'XAUUSD');
  assert.equal(symbolFirst.intent.entry.value, 2526);

  const longSignal = buildMachinePlan({ text: 'LONG GOLD NOW' });
  assert.equal(longSignal.status, 'READY');
  assert.equal(longSignal.intent.side, 'BUY');
  assert.equal(longSignal.intent.symbol.canonical, 'XAUUSD');
  assert.equal(longSignal.intent.fastEntry, true);

  const shortSignal = buildMachinePlan({ text: 'SHORT EUR/USD 1.0830 SL 1.0860 TP 1.0780' });
  assert.equal(shortSignal.status, 'READY');
  assert.equal(shortSignal.intent.side, 'SELL');
  assert.equal(shortSignal.intent.symbol.canonical, 'EURUSD');
});

test('treats clear action plus symbol as an incomplete market fast-entry signal in either order', () => {
  const cases = [
    ['BTCUSD buy', 'BUY', 'BTCUSD'],
    ['buy BTCUSD', 'BUY', 'BTCUSD'],
    ['ETHUSD SELL', 'SELL', 'ETHUSD'],
    ['short EURUSD', 'SELL', 'EURUSD'],
    ['GOLD long', 'BUY', 'XAUUSD'],
    ['please buy BTCUSD', 'BUY', 'BTCUSD'],
    ['BTCUSD sell please', 'SELL', 'BTCUSD'],
  ];

  for (const [text, side, canonical] of cases) {
    const plan = buildMachinePlan({ text });
    assert.equal(plan.status, 'READY', text);
    assert.equal(plan.intent.side, side, text);
    assert.equal(plan.intent.orderType, 'MARKET', text);
    assert.equal(plan.intent.symbol.canonical, canonical, text);
    assert.deepEqual(plan.intent.entry, { kind: 'MARKET' }, text);
    assert.equal(plan.intent.fastEntry, true, text);
    assert.equal(plan.intent.incomplete, true, text);
  }
});

test('does not execute uncertain, negated, question-form, or prose-like action-symbol commentary', () => {
  const cases = [
    'I might buy BTCUSD later',
    'should we buy BTCUSD?',
    "don't buy BTCUSD",
    'avoid selling XAUUSD',
    'watch BTCUSD, buy later',
    'buy gold somehow',
  ];

  for (const text of cases) {
    assert.equal(buildMachinePlan({ text }).status, 'NEEDS_INTERPRETATION', text);
  }
});

test('accepts NOW between side and symbol and punctuation-heavy channel formatting', () => {
  const plan = buildMachinePlan({ text: '🔥 BUY NOW GOLD 🔥\nEntry: 2526\nS/L: 2518\nT/P 1: 2530\nT/P 2: 2535' });
  assert.equal(plan.status, 'READY');
  assert.equal(plan.intent.side, 'BUY');
  assert.equal(plan.intent.symbol.canonical, 'XAUUSD');
  assert.equal(plan.intent.stopLoss, 2518);
  assert.deepEqual(plan.intent.takeProfits, [2530, 2535]);
});

test('classifies management instructions without inventing a new trade', () => {
  assert.deepEqual(buildMachinePlan({ text: 'MOVE SL TO BE' }), { status: 'MANAGEMENT', management: { type: 'MOVE_SL_TO_BE' } });
  assert.deepEqual(buildMachinePlan({ text: 'CLOSE HALF' }), { status: 'MANAGEMENT', management: { type: 'CLOSE_PARTIAL', fraction: 0.5 } });
  assert.deepEqual(buildMachinePlan({ text: 'CANCEL PENDING' }), { status: 'MANAGEMENT', management: { type: 'CANCEL_PENDING' } });
});

test('extracts an explicit symbol from concise management instructions', () => {
  assert.deepEqual(buildMachinePlan({ text: 'CLOSE BTCUSD' }), {
    status: 'MANAGEMENT', management: { type: 'CLOSE', symbol: { source: 'BTCUSD', canonical: 'BTCUSD' } },
  });
  assert.deepEqual(buildMachinePlan({ text: 'BTCUSD CLOSE HALF' }), {
    status: 'MANAGEMENT', management: { type: 'CLOSE_PARTIAL', fraction: 0.5, symbol: { source: 'BTCUSD', canonical: 'BTCUSD' } },
  });
  assert.deepEqual(buildMachinePlan({ text: 'MOVE GOLD SL TO BE' }), {
    status: 'MANAGEMENT', management: { type: 'MOVE_SL_TO_BE', symbol: { source: 'GOLD', canonical: 'XAUUSD' } },
  });
  assert.deepEqual(buildMachinePlan({ text: 'CANCEL BTCUSD PENDING' }), {
    status: 'MANAGEMENT', management: { type: 'CANCEL_PENDING', symbol: { source: 'BTCUSD', canonical: 'BTCUSD' } },
  });
});

test('management language fails closed when negated, uncertain, conditional, or interrogative', () => {
  for (const text of ["don't close BTCUSD", 'maybe close BTCUSD later', 'should we close BTCUSD?', 'close BTCUSD if it reverses']) {
    assert.equal(buildMachinePlan({ text }).status, 'NEEDS_INTERPRETATION', text);
  }
});

test('fast signal stays executable but explicitly incomplete for later reconciliation', () => {
  const plan = buildMachinePlan({ text: 'BUY GOLD NOW' });
  assert.equal(plan.status, 'READY');
  assert.equal(plan.intent.fastEntry, true);
  assert.equal(plan.intent.incomplete, true);
  assert.equal(plan.intent.symbol.canonical, 'XAUUSD');
});

test('ambiguous commentary fails closed for machine execution', () => {
  const plan = buildMachinePlan({ text: 'Gold looking interesting here, maybe buys later' });
  assert.equal(plan.status, 'NEEDS_INTERPRETATION');
});

test('normalizes grouped BTCUSD prices and an unambiguous duplicated decimal separator without changing MARKET semantics', () => {
  const plan = buildMachinePlan({ text: `BTCUSD Buy (77,010.81-77,140.80)

SL: 76,994.00
TP1: 77,400.54
TP2: 77,610,00
TP3: 78,201.24` });

  assert.equal(plan.status, 'READY');
  assert.equal(plan.intent.side, 'BUY');
  assert.equal(plan.intent.orderType, 'MARKET');
  assert.equal(plan.intent.symbol.canonical, 'BTCUSD');
  assert.deepEqual(plan.intent.entry, { kind: 'RANGE', min: 77010.81, max: 77140.80 });
  assert.equal(plan.intent.stopLoss, 76994);
  assert.deepEqual(plan.intent.takeProfits, [77400.54, 77610, 78201.24]);
  assert.equal(plan.intent.fastEntry, false);
  assert.equal(plan.intent.incomplete, false);
});

test('keeps a numeric entry range as MARKET unless pending-order language is explicit', () => {
  const market = buildMachinePlan({ text: 'BUY XAUUSD 3,650.10-3,655.20 SL 3,640.00 TP 3,680.00' });
  assert.equal(market.status, 'READY');
  assert.equal(market.intent.orderType, 'MARKET');

  const pending = buildMachinePlan({ text: 'BUY LIMIT XAUUSD 3,650.10 SL 3,640.00 TP 3,680.00' });
  assert.equal(pending.status, 'READY');
  assert.equal(pending.intent.orderType, 'LIMIT');
});

test('ordinary sentence commas after prices are punctuation, not malformed grouped numbers', () => {
  const plan = buildMachinePlan({ text: 'BUY XAUUSD 2526 SL 2518, TP1 2530, TP2 2535' });
  assert.equal(plan.status, 'READY');
  assert.equal(plan.intent.entry.value, 2526);
  assert.equal(plan.intent.stopLoss, 2518);
  assert.deepEqual(plan.intent.takeProfits, [2530, 2535]);
});
