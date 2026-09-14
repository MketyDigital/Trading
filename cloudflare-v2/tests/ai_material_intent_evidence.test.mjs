import test from 'node:test';
import assert from 'node:assert/strict';
import { validateCanonicalSignalIntent } from '../src/pipeline/signal_intent_validator.js';
import { normalizeSymbol } from '../src/normalization/trading_normalizer.js';

function intent({
  side = 'BUY',
  symbol = 'GOLD',
  orderType = 'MARKET',
  entry = { kind: 'PRICE', value: 2526 },
  stopLoss = 2518,
  takeProfits = [2530, 2535],
} = {}) {
  return {
    side,
    symbol: normalizeSymbol(symbol),
    orderType,
    entry,
    stopLoss,
    takeProfits,
    fastEntry: false,
    incomplete: false,
  };
}

test('structural validation without raw text remains valid for non-AI callers', () => {
  const result = validateCanonicalSignalIntent(intent());
  assert.equal(result.ok, true);
});

test('AI may arrange rough signal wording when side, alias-equivalent symbol, and executable prices are evidenced', () => {
  const result = validateCanonicalSignalIntent(intent(), {
    rawText: 'Buy gold if this setup is confirmed. Entry 2526, risk 2518, objectives 2530 and 2535',
  });
  assert.equal(result.ok, true);
});

test('AI may normalize a rough human instrument alias without exact canonical wording', () => {
  const result = validateCanonicalSignalIntent(intent({
    symbol: 'NAS100',
    entry: { kind: 'PRICE', value: 20150 },
    stopLoss: 20050,
    takeProfits: [20350],
  }), {
    rawText: 'long nasdaq if confirmed, entry 20150 risk 20050 objective 20350',
  });
  assert.equal(result.ok, true);
});

test('AI cannot substitute a different executable instrument even when all prices are copied from raw text', () => {
  const result = validateCanonicalSignalIntent(intent({ symbol: 'BTCUSD' }), {
    rawText: 'Buy gold if confirmed. Entry 2526, risk 2518, objectives 2530 and 2535',
  });
  assert.equal(result.ok, false);
  assert.match(result.reason, /symbol|instrument|evidence/i);
});

test('AI cannot downgrade an explicit pending LIMIT instruction into a MARKET order', () => {
  const result = validateCanonicalSignalIntent(intent({ orderType: 'MARKET' }), {
    rawText: 'If confirmed BUY LIMIT gold. Entry 2526, risk 2518, objectives 2530 and 2535',
  });
  assert.equal(result.ok, false);
  assert.match(result.reason, /order|limit|conflict/i);
});

test('AI cannot change one explicit pending order type into another', () => {
  const result = validateCanonicalSignalIntent(intent({ orderType: 'STOP' }), {
    rawText: 'If confirmed BUY LIMIT gold. Entry 2526, risk 2518, objectives 2530 and 2535',
  });
  assert.equal(result.ok, false);
  assert.match(result.reason, /order|limit|conflict/i);
});

test('AI cannot invent a side when the raw trading message contains no side instruction', () => {
  const result = validateCanonicalSignalIntent(intent(), {
    rawText: 'gold if confirmed. Entry 2526, risk 2518, objectives 2530 and 2535',
  });
  assert.equal(result.ok, false);
  assert.match(result.reason, /side|evidence/i);
});

test('AI cannot turn an explicit do-not-trade instruction into an executable trade', () => {
  const result = validateCanonicalSignalIntent(intent(), {
    rawText: 'Do not buy gold. Entry 2526, risk 2518, objectives 2530 and 2535',
  });
  assert.equal(result.ok, false);
  assert.match(result.reason, /negat|blocked|do not|instruction/i);
});
