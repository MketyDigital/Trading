import test from 'node:test';
import assert from 'node:assert/strict';
import { interpretTradingEvent } from '../src/ai/trading_interpreter.js';
import { validateCanonicalSignalIntent } from '../src/pipeline/signal_intent_validator.js';
import { normalizeSymbol } from '../src/normalization/trading_normalizer.js';

function intent(overrides = {}) {
  return {
    side: 'BUY',
    symbol: normalizeSymbol('GOLD'),
    orderType: 'MARKET',
    entry: { kind: 'PRICE', value: 2526 },
    stopLoss: 2518,
    takeProfits: [2530, 2535],
    fastEntry: false,
    incomplete: false,
    ...overrides,
  };
}

test('second-pass value evidence is advisory and does not veto a coherent AI trade', () => {
  const result = validateCanonicalSignalIntent(intent({ takeProfits: [2530, 2535.1] }), {
    rawText: 'BUY GOLD entry 2526 SL 2518 TP1 2530 TP2 2535',
  });

  assert.equal(result.ok, true);
  assert.ok(Array.isArray(result.warnings));
  assert.match(result.warnings.join(' '), /price evidence/i);
});

test('hard contradiction still blocks an AI trade', () => {
  const result = validateCanonicalSignalIntent(intent({
    side: 'SELL',
    stopLoss: 2532,
    takeProfits: [2520, 2510],
  }), {
    rawText: 'BUY GOLD entry 2526 SL 2532 TP1 2520 TP2 2510',
  });

  assert.equal(result.ok, false);
  assert.match(result.reason, /side|conflict/i);
});

test('AI outage falls back to material raw signal evidence instead of NEEDS_REVIEW', async () => {
  const result = await interpretTradingEvent({
    text: 'Gold long setup. Entry 2526. Risk 2518. Objectives 2530, 2535.',
  }, {
    aiRouter: {
      async processSignal() {
        throw new Error('provider unavailable');
      },
    },
  });

  assert.equal(result.status, 'READY');
  assert.match(result.source, /fallback|deterministic/i);
  assert.equal(result.intent.side, 'BUY');
  assert.equal(result.intent.symbol.canonical, 'XAUUSD');
  assert.equal(result.intent.entry.value, 2526);
  assert.equal(result.intent.stopLoss, 2518);
  assert.deepEqual(result.intent.takeProfits, [2530, 2535]);
});

test('AI invalid JSON also falls back to material raw signal evidence', async () => {
  const result = await interpretTradingEvent({
    text: 'Gold long setup. Entry 2526. Risk 2518. Objectives 2530, 2535.',
  }, {
    aiRouter: {
      async processSignal() {
        return { success: true, text: 'not-json', provider: 'test', model: 'test' };
      },
    },
  });

  assert.equal(result.status, 'READY');
  assert.match(result.source, /fallback|deterministic/i);
});
