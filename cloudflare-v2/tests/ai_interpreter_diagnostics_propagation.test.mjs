import test from 'node:test';
import assert from 'node:assert/strict';

import { interpretTradingEvent } from '../src/ai/trading_interpreter.js';

const SAFE_DIAGNOSTICS = [
  {
    providerId: 'provider-1',
    providerType: 'openai',
    model: 'gpt-5.6-luna',
    outcome: 'FAILED',
    latencyMs: 21,
    httpStatus: 401,
    providerCode: 'invalid_api_key',
    retryable: false,
    errorClass: 'AUTH',
    sanitizedMessage: 'Incorrect API key provided: [REDACTED]',
  },
];

test('AI cascade diagnostics survive deterministic fallback without changing the recovered trade', async () => {
  const result = await interpretTradingEvent({
    text: 'Gold long setup. Entry 2526. Risk 2518. Objectives 2530, 2535.',
  }, {
    aiRouter: {
      async processSignal() {
        return {
          success: false,
          error: 'All AI providers failed in cascade.',
          diagnostics: SAFE_DIAGNOSTICS,
        };
      },
    },
  });

  assert.equal(result.status, 'READY');
  assert.match(result.source, /fallback|deterministic/i);
  assert.equal(result.intent.side, 'BUY');
  assert.equal(result.intent.symbol.canonical, 'XAUUSD');
  assert.deepEqual(result.ai?.diagnostics, SAFE_DIAGNOSTICS);
  assert.equal(result.ai?.error, 'All AI providers failed in cascade.');
});

test('successful AI interpretation preserves provider, model, and sanitized attempt diagnostics', async () => {
  const diagnostics = [
    ...SAFE_DIAGNOSTICS,
    {
      providerId: 'provider-2',
      providerType: 'gemini',
      model: 'gemini-2.5-flash',
      outcome: 'SUCCESS',
      latencyMs: 42,
      httpStatus: 200,
      retryable: false,
    },
  ];
  const result = await interpretTradingEvent({
    text: 'Gold long setup around 2526 with protection 2518 and objectives 2530 then 2535.',
  }, {
    aiRouter: {
      async processSignal() {
        return {
          success: true,
          provider: 'gemini',
          model: 'gemini-2.5-flash',
          diagnostics,
          text: JSON.stringify({
            event_type: 'NEW_SIGNAL',
            side: 'BUY',
            symbol: 'XAUUSD',
            order_type: 'LIMIT',
            entry: 2526,
            stop_loss: 2518,
            take_profits: [2530, 2535],
            fast_entry: false,
          }),
        };
      },
    },
  });

  assert.equal(result.status, 'READY');
  assert.equal(result.source, 'ai');
  assert.equal(result.ai?.provider, 'gemini');
  assert.equal(result.ai?.model, 'gemini-2.5-flash');
  assert.deepEqual(result.ai?.diagnostics, diagnostics);
});
