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

test('AI outage on an irrecoverable ambiguous signal reaches review only after fallback is attempted', async () => {
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
  assert.equal(result.source, 'fallback');
  assert.match(result.reason, /AI_PROVIDER_UNAVAILABLE|interpretation failed/i);
});

test('AI failure falls back to material source evidence instead of invalidating a coherent trade', async () => {
  let calls = 0;
  const result = await interpretTradingEvent({
    text: 'Long gold if confirmed; ENTRY PRICE: 2526; RISK: 2518; OBJECTIVE 1: 2530; OBJECTIVE 2: 2535',
  }, {
    aiRouter: {
      processSignal: async () => {
        calls += 1;
        throw new Error('provider timeout');
      },
    },
  });

  assert.equal(calls, 1);
  assert.equal(result.status, 'READY');
  assert.equal(result.source, 'deterministic_fallback');
  assert.equal(result.intent.side, 'BUY');
  assert.equal(result.intent.symbol.canonical, 'XAUUSD');
  assert.equal(result.intent.entry.value, 2526);
  assert.equal(result.intent.stopLoss, 2518);
  assert.deepEqual(result.intent.takeProfits, [2530, 2535]);
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

test('AI numeric values without exact raw numeric matches are advisory and do not veto a coherent trade', async () => {
  const result = await interpretTradingEvent({ text: 'buy gold somehow' }, {
    aiRouter: {
      processSignal: async () => ({ success: true, text: JSON.stringify({
        event_type: 'NEW_SIGNAL', side: 'BUY', symbol: 'GOLD', order_type: 'MARKET',
        entry: 2526, stop_loss: 2518, take_profits: [2530],
      }) }),
    },
  });
  assert.equal(result.status, 'READY');
  assert.equal(result.source, 'ai');
  assert.ok(Array.isArray(result.validationWarnings));
  assert.ok(result.validationWarnings.length > 0);
});

test('malformed AI JSON and unsupported event types reach review only when deterministic fallback cannot recover', async () => {
  const malformed = await interpretTradingEvent({ text: 'weird signal' }, {
    aiRouter: { processSignal: async () => ({ success: true, text: 'not json' }) },
  });
  assert.equal(malformed.status, 'NEEDS_REVIEW');
  assert.equal(malformed.source, 'fallback');

  const unsupported = await interpretTradingEvent({ text: 'weird signal' }, {
    aiRouter: { processSignal: async () => ({ success: true, text: JSON.stringify({ event_type: 'MAGIC', side: 'BUY', symbol: 'GOLD' }) }) },
  });
  assert.equal(unsupported.status, 'NEEDS_REVIEW');
  assert.equal(unsupported.source, 'fallback');
});

test('gives ambiguous AI interpretation a sufficient default bounded budget', async () => {
  let seen;
  await interpretTradingEvent({ text: 'ambiguous trade words' }, {
    aiRouter: { processSignal: async (_text, _prompt, options) => { seen = options.timeoutMs; return { success: false, error: 'timeout' }; } },
  });
  assert.equal(seen, 12000);
});

test('passes an explicit latency budget into AI router', async () => {
  let seen;
  await interpretTradingEvent({ text: 'ambiguous trade words' }, {
    aiRouter: { processSignal: async (_text, _prompt, options) => { seen = options.timeoutMs; return { success: false, error: 'timeout' }; } },
    timeoutMs: 333,
  });
  assert.equal(seen, 333);
});

test('does not call AI merely because a deterministic signal is missing optional protection', async () => {
  for (const text of [
    'xauusd sell\n\nentry 4273.25-4279.76\nsl 4380',
    'BUY XAUUSD ENTRY 4275 TP 4300',
    'SELL XAUUSD SL 4300',
    'BUY XAUUSD TP 4350',
    'V75 index Sell Now!!! 😡😡😡',
  ]) {
    let called = false;
    const result = await interpretTradingEvent({ text }, {
      aiRouter: {
        processSignal: async () => {
          called = true;
          throw new Error('AI must not run for deterministic incomplete signals');
        },
      },
    });
    assert.equal(result.status, 'READY', text);
    assert.equal(result.source, 'deterministic', text);
    assert.equal(called, false, text);
    assert.equal(result.intent.incomplete, true, text);
  }
});

test('understands invalid SELL SL geometry deterministically before execution validation', async () => {
  let called = false;
  const result = await interpretTradingEvent({ text: 'xauusd sell\n\nentry 4273.25-4279.76\nsl 4180' }, {
    aiRouter: {
      processSignal: async () => {
        called = true;
        throw new Error('AI must not decide deterministic geometry');
      },
    },
  });

  assert.equal(result.status, 'READY');
  assert.equal(result.source, 'deterministic');
  assert.equal(called, false);
  assert.equal(result.intent.side, 'SELL');
  assert.deepEqual(result.intent.entry, { kind: 'RANGE', min: 4273.25, max: 4279.76 });
  assert.equal(result.intent.stopLoss, 4180);
  assert.deepEqual(result.intent.takeProfits, []);
  assert.equal(result.intent.incomplete, true);
});
