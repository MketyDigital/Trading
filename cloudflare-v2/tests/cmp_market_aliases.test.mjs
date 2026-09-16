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
