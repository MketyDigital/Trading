import test from 'node:test';
import assert from 'node:assert/strict';

import {
  assertSemanticsPreserved,
  formatTelegramDestinationMessage,
} from '../src/destinations/formatting.js';

const interpretation = {
  status: 'READY',
  intent: {
    side: 'BUY',
    orderType: 'LIMIT',
    symbol: { canonical: 'XAUUSD' },
    entry: { kind: 'PRICE', value: 2500 },
    stopLoss: 2490,
    takeProfits: [2510, 2520],
  },
};

test('none formatting preserves source text exactly', () => {
  const result = formatTelegramDestinationMessage({
    mode: 'none',
    rawText: 'BUY XAUUSD 2500\nSL 2490\nTP1 2510',
    interpretation,
  }, {});

  assert.equal(result.ok, true);
  assert.equal(result.text, 'BUY XAUUSD 2500\nSL 2490\nTP1 2510');
  assert.equal(result.parseMode, 'plain');
});

test('clean formatting removes configured footer and links without changing signal values', () => {
  const result = formatTelegramDestinationMessage({
    mode: 'clean',
    rawText: 'BUY XAUUSD 2500\nSL 2490\nTP1 2510\nJoin @OldBrand https://example.com',
    interpretation,
  }, {
    cleanupRules: {
      removeLinks: true,
      removeLinesContaining: ['@OldBrand'],
    },
  });

  assert.equal(result.ok, true);
  assert.match(result.text, /BUY XAUUSD 2500/);
  assert.match(result.text, /SL 2490/);
  assert.match(result.text, /TP1 2510/);
  assert.doesNotMatch(result.text, /https:\/\//);
  assert.doesNotMatch(result.text, /@OldBrand/);
});

test('template formatting renders canonical trade values from interpretation', () => {
  const result = formatTelegramDestinationMessage({
    mode: 'template',
    rawText: 'messy source text',
    interpretation,
  }, {
    brandName: 'Starpips Forex',
    header: 'VIP SIGNAL',
    footer: 'Risk properly.',
    parseMode: 'HTML',
  });

  assert.equal(result.ok, true);
  assert.match(result.text, /Starpips Forex/);
  assert.match(result.text, /VIP SIGNAL/);
  assert.match(result.text, /XAUUSD/);
  assert.match(result.text, /BUY/);
  assert.match(result.text, /2500/);
  assert.match(result.text, /2490/);
  assert.match(result.text, /2510/);
  assert.match(result.text, /2520/);
  assert.match(result.text, /Risk properly\./);
  assert.equal(result.parseMode, 'HTML');
});

test('semantic guard rejects changed trade meaning', () => {
  const before = interpretation.intent;
  const after = {
    ...before,
    side: 'SELL',
  };

  const result = assertSemanticsPreserved(before, after);

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'SIDE_CHANGED');
});
