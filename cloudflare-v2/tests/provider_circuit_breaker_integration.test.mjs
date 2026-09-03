import test from 'node:test';
import assert from 'node:assert/strict';

import { UniversalAIRouter } from '../src/ai/universal_ai.js';
import { interpretTradingEvent } from '../src/ai/trading_interpreter.js';
import { renderTelegramDestination } from '../src/destinations/telegram_presentation.js';
import { createProviderCircuitBreaker } from '../src/resilience/provider_circuit_breaker.js';

const AMBIGUOUS = { text: 'gold looks good maybe buy around here' };
const CANONICAL = {
  status: 'READY',
  intent: {
    side: 'BUY',
    symbol: { canonical: 'XAUUSD' },
    entry: { kind: 'PRICE', value: 2526 },
    stopLoss: 2518,
    takeProfits: [2530, 2535],
  },
};

function openCircuit(breaker, key) {
  breaker.recordFailure(key);
}

function ambiguityRouter({ breaker, workspaceId = 'ws-a', fetchFn } = {}) {
  return new UniversalAIRouter([{
    id: 'fast-ai',
    provider_name: 'openai',
    model_name: 'gpt-test',
    api_key: 'test-key',
    priority_rank: 1,
    is_active: true,
  }], {
    workspaceId,
    circuitBreaker: breaker,
    fetchFn,
  });
}

test('open ambiguity-AI circuit returns NEEDS_REVIEW without calling provider', async () => {
  const breaker = createProviderCircuitBreaker({ failureThreshold: 1 });
  openCircuit(breaker, { purpose: 'ambiguity_ai', provider: 'fast-ai', workspaceId: 'ws-a' });
  let calls = 0;
  const aiRouter = ambiguityRouter({
    breaker,
    fetchFn: async () => {
      calls += 1;
      throw new Error('provider must not be called');
    },
  });

  const result = await interpretTradingEvent(AMBIGUOUS, { aiRouter });

  assert.equal(calls, 0);
  assert.equal(result.status, 'NEEDS_REVIEW');
  assert.equal(result.source, 'ai');
  assert.equal(result.reason, 'AI_CIRCUIT_OPEN');
});

test('ambiguity-AI failure records only its trusted workspace/provider circuit', async () => {
  const breaker = createProviderCircuitBreaker({ failureThreshold: 1 });
  const aiRouter = ambiguityRouter({
    breaker,
    fetchFn: async () => { throw new Error('provider unavailable'); },
  });

  await interpretTradingEvent(AMBIGUOUS, { aiRouter });

  assert.equal(breaker.canAttempt({ purpose: 'ambiguity_ai', provider: 'fast-ai', workspaceId: 'ws-a' }).allowed, false);
  assert.equal(breaker.canAttempt({ purpose: 'ambiguity_ai', provider: 'fast-ai', workspaceId: 'ws-b' }).allowed, true);
  assert.equal(breaker.canAttempt({ purpose: 'ambiguity_ai', provider: 'other-ai', workspaceId: 'ws-a' }).allowed, true);
  assert.equal(breaker.canAttempt({ purpose: 'destination_ai', provider: 'fast-ai', workspaceId: 'ws-a' }).allowed, true);
});

test('deterministic execution never consults an open ambiguity-AI circuit', async () => {
  const breaker = {
    canAttempt() { throw new Error('breaker must not be on deterministic hot path'); },
    recordFailure() { throw new Error('breaker must not be on deterministic hot path'); },
    recordSuccess() { throw new Error('breaker must not be on deterministic hot path'); },
  };
  const aiRouter = ambiguityRouter({
    breaker,
    fetchFn: async () => { throw new Error('AI must not run'); },
  });

  const result = await interpretTradingEvent({ text: 'BUY XAUUSD 2526 SL 2518 TP 2530 2535' }, { aiRouter });

  assert.equal(result.status, 'READY');
  assert.equal(result.source, 'deterministic');
});

test('open destination-AI circuit falls back deterministically without calling formatter', async () => {
  const breaker = createProviderCircuitBreaker({ failureThreshold: 1 });
  openCircuit(breaker, { purpose: 'destination_ai', provider: 'brand-ai', workspaceId: 'ws-a' });
  let calls = 0;

  const result = await renderTelegramDestination({
    canonicalEvent: CANONICAL,
    destination: { presentation: { useAi: true, brandName: 'Mkety' } },
    workspaceId: 'ws-a',
    aiProviderId: 'brand-ai',
    circuitBreaker: breaker,
    aiFormatter: async () => { calls += 1; return { success: false }; },
  });

  assert.equal(calls, 0);
  assert.equal(result.mode, 'DETERMINISTIC');
  assert.equal(result.fallbackReason, 'AI_CIRCUIT_OPEN');
  assert.match(result.text, /BUY XAUUSD/);
});

test('destination-AI timeout/failure opens only exact destination circuit and preserves deterministic fallback', async () => {
  const breaker = createProviderCircuitBreaker({ failureThreshold: 1 });

  const result = await renderTelegramDestination({
    canonicalEvent: CANONICAL,
    destination: { presentation: { useAi: true } },
    workspaceId: 'ws-a',
    aiProviderId: 'brand-ai',
    circuitBreaker: breaker,
    timeoutMs: 5,
    aiFormatter: async () => new Promise(() => {}),
  });

  assert.equal(result.mode, 'DETERMINISTIC');
  assert.equal(result.fallbackReason, 'AI_TIMEOUT');
  assert.equal(breaker.canAttempt({ purpose: 'destination_ai', provider: 'brand-ai', workspaceId: 'ws-a' }).allowed, false);
  assert.equal(breaker.canAttempt({ purpose: 'destination_ai', provider: 'brand-ai', workspaceId: 'ws-b' }).allowed, true);
  assert.equal(breaker.canAttempt({ purpose: 'ambiguity_ai', provider: 'brand-ai', workspaceId: 'ws-a' }).allowed, true);
});

test('breaker internal failure is fail-open to existing AI fallback semantics', async () => {
  const brokenBreaker = {
    canAttempt() { throw new Error('breaker unavailable'); },
    recordFailure() { throw new Error('breaker unavailable'); },
    recordSuccess() { throw new Error('breaker unavailable'); },
  };

  const destination = await renderTelegramDestination({
    canonicalEvent: CANONICAL,
    destination: { presentation: { useAi: true } },
    workspaceId: 'ws-a', aiProviderId: 'brand-ai', circuitBreaker: brokenBreaker,
    aiFormatter: async () => ({ success: false }),
  });
  assert.equal(destination.mode, 'DETERMINISTIC');
  assert.equal(destination.fallbackReason, 'AI_FAILED');

  const aiRouter = ambiguityRouter({
    breaker: brokenBreaker,
    fetchFn: async () => { throw new Error('provider unavailable'); },
  });
  const ambiguity = await interpretTradingEvent(AMBIGUOUS, { aiRouter });
  assert.equal(ambiguity.status, 'NEEDS_REVIEW');
  assert.equal(ambiguity.reason, 'All AI providers failed in cascade.');
});