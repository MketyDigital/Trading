import test from 'node:test';
import assert from 'node:assert/strict';
import { interpretTradingEvent } from '../src/ai/trading_interpreter.js';

test('does not call AI for deterministic straightforward signal', async () => {
  let called = false;
  const result = await interpretTradingEvent({ text: 'BUY XAUUSD 2526 SL 2518 TP 2530 2535' }, {
    aiRouter: { processSignal: async () => { called = true; return { success: false }; } },
  });
  assert.equal(result.status, 'READY');
  assert.equal(result.source, 'deterministic');
  assert.equal(called, false);
});

test('does not call AI for deterministic management commands', async () => {
  const aiRouter = {
    processSignal: async () => {
      throw new Error('AI must not be on deterministic management hot path');
    },
  };
  const result = await interpretTradingEvent({ text: 'MOVE SL TO BE' }, { aiRouter });
  assert.equal(result.status, 'MANAGEMENT');
  assert.equal(result.source, 'deterministic');
  assert.deepEqual(result.management, { type: 'MOVE_SL_TO_BE' });
});

test('uses AI only for ambiguous natural language and validates structured result', async () => {
  const result = await interpretTradingEvent({ text: 'Buy gold if this setup is confirmed. Entry 2526, risk 2518, objectives 2530 and 2535' }, {
    aiRouter: {
      processSignal: async () => ({
        success: true,
        text: JSON.stringify({
          event_type: 'NEW_SIGNAL', side: 'BUY', symbol: 'GOLD', order_type: 'MARKET',
          entry: 2526, stop_loss: 2518, take_profits: [2530, 2535],
        }),
        provider: 'fast-ai', model: 'model-1',
      }),
    },
    timeoutMs: 800,
  });
  assert.equal(result.status, 'READY');
  assert.equal(result.source, 'ai');
  assert.equal(result.intent.symbol.canonical, 'XAUUSD');
  assert.deepEqual(result.intent.takeProfits, [2530, 2535]);
});

test('AI outage on an ambiguous signal fails to review instead of guessing execution', async () => {
  let calls = 0;
  const result = await interpretTradingEvent({ text: 'gold looks good maybe buy around here' }, {
    aiRouter: {
      processSignal: async () => {
        calls += 1;
        return { success: false, error: 'AI_PROVIDER_UNAVAILABLE' };
      },
    },
  });
  assert.equal(calls, 1);
  assert.equal(result.status, 'NEEDS_REVIEW');
  assert.equal(result.source, 'ai');
  assert.equal(result.reason, 'AI_PROVIDER_UNAVAILABLE');
});

test('rejects AI result with impossible BUY stop/target geometry instead of executing it', async () => {
  const result = await interpretTradingEvent({ text: 'buy gold somehow' }, {
    aiRouter: {
      processSignal: async () => ({ success: true, text: JSON.stringify({
        event_type: 'NEW_SIGNAL', side: 'BUY', symbol: 'GOLD', order_type: 'MARKET',
        entry: 2526, stop_loss: 2530, take_profits: [2520],
      }) }),
    },
  });
  assert.equal(result.status, 'NEEDS_REVIEW');
  assert.match(result.reason, /geometry/i);
});

test('rejects malformed AI JSON and unsupported event types fail closed', async () => {
  const malformed = await interpretTradingEvent({ text: 'weird signal' }, {
    aiRouter: { processSignal: async () => ({ success: true, text: 'not json' }) },
  });
  assert.equal(malformed.status, 'NEEDS_REVIEW');

  const unsupported = await interpretTradingEvent({ text: 'weird signal' }, {
    aiRouter: { processSignal: async () => ({ success: true, text: JSON.stringify({ event_type: 'MAGIC', side: 'BUY', symbol: 'GOLD' }) }) },
  });
  assert.equal(unsupported.status, 'NEEDS_REVIEW');
});

test('passes the requested latency budget into AI router', async () => {
  let seen;
  await interpretTradingEvent({ text: 'ambiguous trade words' }, {
    aiRouter: { processSignal: async (_text, _prompt, options) => { seen = options.timeoutMs; return { success: false, error: 'timeout' }; } },
    timeoutMs: 333,
  });
  assert.equal(seen, 333);
});
