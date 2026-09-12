import test from 'node:test';
import assert from 'node:assert/strict';

import { interpretTradingEvent } from '../src/ai/trading_interpreter.js';

function noAi() {
  return { processSignal: async () => { throw new Error('AI unavailable'); } };
}

test('known natural-language BUY phrasing is recovered deterministically before AI', async () => {
  let aiCalls = 0;
  const result = await interpretTradingEvent({
    text: 'Gold is good here, buy around 2526 and protect under 2518, aim 2530 then 2535',
  }, {
    aiRouter: { processSignal: async () => { aiCalls += 1; return { success: false }; } },
  });

  assert.equal(result.status, 'READY');
  assert.equal(result.source, 'deterministic_relaxed');
  assert.equal(result.intent.side, 'BUY');
  assert.equal(result.intent.symbol.canonical, 'XAUUSD');
  assert.equal(result.intent.entry.kind, 'PRICE');
  assert.equal(result.intent.entry.value, 2526);
  assert.equal(result.intent.stopLoss, 2518);
  assert.deepEqual(result.intent.takeProfits, [2530, 2535]);
  assert.equal(aiCalls, 0);
});

test('known natural-language SELL phrasing is recovered only when geometry is valid', async () => {
  const result = await interpretTradingEvent({
    text: 'Sell gold at 2526, protect above 2534, target 2518 then 2510',
  }, { aiRouter: noAi() });

  assert.equal(result.status, 'READY');
  assert.equal(result.source, 'deterministic_relaxed');
  assert.equal(result.intent.side, 'SELL');
  assert.equal(result.intent.stopLoss, 2534);
  assert.deepEqual(result.intent.takeProfits, [2518, 2510]);
});

test('relaxed parser refuses contradictory geometry rather than guessing around AI failure', async () => {
  const result = await interpretTradingEvent({
    text: 'Buy gold around 2526, protect under 2535, aim 2510',
  }, { aiRouter: { processSignal: async () => ({ success: false, error: 'AI down' }) } });

  assert.notEqual(result.status, 'READY');
});

test('relaxed parser refuses prose that lacks explicit side, recognized symbol or numeric protection/target evidence', async () => {
  for (const text of [
    'Gold looks nice here',
    'Buy something around 2526 protect under 2518 aim 2530',
    'Gold buy around 2526 and let it run',
  ]) {
    const result = await interpretTradingEvent({ text }, { aiRouter: { processSignal: async () => ({ success: false }) } });
    assert.notEqual(result.status, 'READY', text);
  }
});
