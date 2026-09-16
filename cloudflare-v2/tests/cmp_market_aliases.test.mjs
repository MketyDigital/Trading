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
];

for (const text of aliases) {
  test(`current-market alias is deterministic: ${text}`, async () => {
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

test('CMP punctuation normalizes to NOW without changing unrelated text', () => {
  assert.equal(normalizeCurrentMarketAliases('BUY XAUUSD (C.M.P.)'), 'BUY XAUUSD ( NOW )');
});

test('hedged commentary containing current-market wording still fails closed', async () => {
  const result = await interpretTradingEvent({ text: 'Maybe BUY XAUUSD at current market price later' }, {
    aiRouter: { async processSignal() { return { success: false, error: 'test' }; } },
  });
  assert.equal(result.status, 'NEEDS_REVIEW');
});
