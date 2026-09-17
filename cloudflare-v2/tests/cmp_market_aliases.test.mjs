import test from 'node:test';
import assert from 'node:assert/strict';

import { interpretTradingEvent } from '../src/ai/trading_interpreter.js';
import { normalizeCurrentMarketAliases } from '../src/normalization/current_market_aliases.js';

const aliases = [
  'BUY XAUUSD (CMP)',
  'SELL GOLD @ CURRENT MARKET PRICE',
  'BUY XAUUSD CURRENT MKT PRICE',
  'SELL XAUUSD C.M.P',
  'BUY GOLD CURRENT PRICE',
  'SELL XAUUSD MARKET PRICE',
  'BUY XAUUSD AT MARKET',
  'SELL GOLD CURRENT MARKET',
  'BUY XAUUSD MKT PRICE',
  'BUY XAUUSD (CMP)\n\n~~~\nStarpips Forex',
];

for (const text of aliases) {
  test(`current-market alias is deterministic: ${text.replace(/\n/g, ' / ')}`, async () => {
    let aiCalled = false;
    const result = await interpretTradingEvent({ text }, {
      aiRouter: { async processSignal() { aiCalled = true; throw new Error('AI should not be called'); } },
    });
    assert.equal(result.status, 'READY');
    assert.equal(result.source, 'deterministic');
    assert.equal(result.intent.orderType, 'MARKET');
    assert.equal(result.intent.entry.kind, 'MARKET');
    assert.equal(result.intent.fastEntry, true);
    assert.equal(result.intent.incomplete, true);
    assert.equal(aiCalled, false);
  });
}

const incompleteDeterministicCases = [
  {
    name: 'production SL-only range signal',
    text: 'xauusd sell\n\nentry 4273.25-4279.76\nsl 4380',
    assertIntent(intent) {
      assert.equal(intent.side, 'SELL');
      assert.equal(intent.symbol.canonical, 'XAUUSD');
      assert.deepEqual(intent.entry, { kind: 'RANGE', min: 4273.25, max: 4279.76 });
      assert.equal(intent.stopLoss, 4380);
      assert.deepEqual(intent.takeProfits, []);
    },
  },
  {
    name: 'entry plus TP without SL',
    text: 'BUY XAUUSD ENTRY 4275 TP 4300',
    assertIntent(intent) {
      assert.equal(intent.side, 'BUY');
      assert.deepEqual(intent.entry, { kind: 'PRICE', value: 4275 });
      assert.equal(intent.stopLoss, null);
      assert.deepEqual(intent.takeProfits, [4300]);
    },
  },
  {
    name: 'market plus SL without TP',
    text: 'BUY XAUUSD NOW SL 4250',
    assertIntent(intent) {
      assert.equal(intent.entry.kind, 'MARKET');
      assert.equal(intent.stopLoss, 4250);
      assert.deepEqual(intent.takeProfits, []);
    },
  },
  {
    name: 'market plus TP without SL',
    text: 'SELL GOLD AT MARKET TP 4250',
    assertIntent(intent) {
      assert.equal(intent.entry.kind, 'MARKET');
      assert.equal(intent.stopLoss, null);
      assert.deepEqual(intent.takeProfits, [4250]);
    },
  },
  {
    name: 'Deriv fast shorthand',
    text: 'V75 index Sell Now!!! 😡😡😡',
    assertIntent(intent) {
      assert.equal(intent.side, 'SELL');
      assert.equal(intent.symbol.canonical, 'DERIV:VOLATILITY_75');
      assert.equal(intent.entry.kind, 'MARKET');
    },
  },
];

for (const item of incompleteDeterministicCases) {
  test(`clear incomplete signal bypasses AI: ${item.name}`, async () => {
    let aiCalled = false;
    const result = await interpretTradingEvent({ text: item.text }, {
      aiRouter: {
        async processSignal() {
          aiCalled = true;
          return { success: false, error: 'AI should not be required' };
        },
      },
    });

    assert.equal(result.status, 'READY');
    assert.equal(result.source, 'deterministic');
    assert.equal(result.intent.incomplete, true);
    assert.equal(aiCalled, false);
    item.assertIntent(result.intent);
  });
}

const productionParenthesizedRanges = [
  {
    name: 'BUY parenthesized market range with Starpips footer',
    text: 'BUY XAUUSD (4369-4359)\n\nTake Profit 1 at 4373\nTake Profit 2 at 4379\nTake Profit 3 at 4399\n\nStop Loss at 4353\n\n~~~\nStarpips Forex',
    side: 'BUY',
    entry: { kind: 'RANGE', min: 4359, max: 4369 },
    stopLoss: 4353,
    takeProfits: [4373, 4379, 4399],
  },
  {
    name: 'SELL parenthesized market range with Starpips footer',
    text: 'SELL XAUUSD (4354.8-4364.8)\n\nTake Profit 1 at 4348\nTake Profit 2 at 4342\nTake Profit 3 at 4320\n\nStop Loss at 4372\n\n~~~\nStarpips Forex',
    side: 'SELL',
    entry: { kind: 'RANGE', min: 4354.8, max: 4364.8 },
    stopLoss: 4372,
    takeProfits: [4348, 4342, 4320],
  },
];

for (const item of productionParenthesizedRanges) {
  test(`parenthesized market range remains deterministic: ${item.name}`, async () => {
    let aiCalled = false;
    const result = await interpretTradingEvent({ text: item.text }, {
      aiRouter: {
        async processSignal() {
          aiCalled = true;
          return { success: false, error: 'AI must not be required for a clear range signal' };
        },
      },
    });

    assert.equal(result.status, 'READY');
    assert.equal(result.source, 'deterministic');
    assert.equal(result.intent.side, item.side);
    assert.equal(result.intent.symbol.canonical, 'XAUUSD');
    assert.equal(result.intent.orderType, 'MARKET');
    assert.deepEqual(result.intent.entry, item.entry);
    assert.equal(result.intent.stopLoss, item.stopLoss);
    assert.deepEqual(result.intent.takeProfits, item.takeProfits);
    assert.equal(result.intent.fastEntry, false);
    assert.equal(result.intent.incomplete, false);
    assert.equal(aiCalled, false);
  });
}

test('CMP punctuation normalizes to NOW without changing unrelated command text', () => {
  assert.equal(normalizeCurrentMarketAliases('BUY XAUUSD (C.M.P.)'), 'BUY XAUUSD ( NOW )');
});

test('separator-delimited presentation footer is removed from deterministic CMP parsing', () => {
  assert.equal(normalizeCurrentMarketAliases('BUY XAUUSD (CMP)\n\n~~~\nStarpips Forex'), 'BUY XAUUSD ( NOW )');
});

test('messages without current-market aliases are left byte-for-byte unchanged by CMP normalization', () => {
  const raw = 'BUY XAUUSD 4300\nSL 4290\nTP 4310\n~~~\nStarpips Forex';
  assert.equal(normalizeCurrentMarketAliases(raw), raw);
});

test('hedged commentary containing current-market wording still fails closed', async () => {
  const result = await interpretTradingEvent({ text: 'Maybe BUY XAUUSD at current market price later' }, {
    aiRouter: { async processSignal() { return { success: false, error: 'test' }; } },
  });
  assert.equal(result.status, 'NEEDS_REVIEW');
});
