import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCanonicalShadow } from '../src/pipeline/canonical_shadow.js';

test('produces canonical intent beside legacy formatting without executing broker actions', async () => {
  let aiCalled = false;
  const result = await buildCanonicalShadow({
    text: 'BUY XAUUSD 2526 SL 2518 TP1 2530 TP2 2535 TP3 2545',
    source: { type: 'telegram_mtproto', instance_id: 'listener-1' },
    external_event_id: '123',
  }, {
    aiRouter: { processSignal: async () => { aiCalled = true; throw new Error('AI should not be called'); } },
  });

  assert.equal(result.status, 'READY');
  assert.equal(result.source, 'deterministic');
  assert.equal(result.intent.symbol.canonical, 'XAUUSD');
  assert.deepEqual(result.intent.takeProfits, [2530, 2535, 2545]);
  assert.equal(result.executionEnabled, false);
  assert.deepEqual(result.actions, []);
  assert.equal(aiCalled, false);
});

test('uses bounded AI interpretation for conversational signal but remains shadow-only', async () => {
  let timeoutSeen;
  const result = await buildCanonicalShadow({
    text: 'Gold is good here, buy around 2526 and protect under 2518, aim 2530 then 2535',
  }, {
    aiTimeoutMs: 600,
    aiRouter: { processSignal: async (_text, _prompt, options) => {
      timeoutSeen = options.timeoutMs;
      return { success: true, provider: 'fast-ai', model: 'fast-1', text: JSON.stringify({
        event_type: 'NEW_SIGNAL', side: 'BUY', symbol: 'GOLD', order_type: 'MARKET',
        entry: 2526, stop_loss: 2518, take_profits: [2530, 2535],
      }) };
    } },
  });
  assert.equal(result.status, 'READY');
  assert.equal(result.source, 'ai');
  assert.equal(timeoutSeen, 600);
  assert.equal(result.executionEnabled, false);
  assert.deepEqual(result.actions, []);
});

test('malformed or ambiguous shadow interpretation cannot affect legacy delivery', async () => {
  const result = await buildCanonicalShadow({ text: 'Maybe gold later.' }, { aiRouter: null });
  assert.equal(result.executionEnabled, false);
  assert.deepEqual(result.actions, []);
  assert.equal(result.status, 'NEEDS_REVIEW');
});
