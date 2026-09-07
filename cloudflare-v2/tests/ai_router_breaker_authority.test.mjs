import test from 'node:test';
import assert from 'node:assert/strict';

import { UniversalAIRouter } from '../src/ai/universal_ai.js';
import { createWorkspaceAIRouter } from '../src/ai/workspace_ai.js';
import { interpretTradingEvent } from '../src/ai/trading_interpreter.js';

function provider(id, name, priority = 1) {
  return {
    id,
    provider_name: name,
    model_name: 'test-model',
    priority_rank: priority,
    is_active: true,
    api_key: `key-${id}`,
    base_url: 'https://ai.example/v1',
  };
}

test('AI cascade keys breaker from trusted router workspace and exact database provider row', async () => {
  const seen = [];
  const breaker = {
    canAttempt(key) {
      seen.push(['can', key]);
      return { allowed: key.provider !== 'provider-a' };
    },
    recordSuccess(key) { seen.push(['success', key]); },
    recordFailure(key) { seen.push(['failure', key]); },
  };
  let fetchCalls = 0;
  const router = new UniversalAIRouter([
    provider('provider-a', 'openai-a', 1),
    provider('provider-b', 'openai-b', 2),
  ], {
    workspaceId: 'ws-trusted',
    circuitBreaker: breaker,
    fetchFn: async () => {
      fetchCalls += 1;
      return new Response(JSON.stringify({ choices: [{ message: { content: '{"event_type":"NON_ACTIONABLE"}' } }] }), { status: 200 });
    },
  });

  const result = await router.processSignal('ambiguous', 'prompt', {
    timeoutMs: 50,
    purpose: 'ambiguity_ai',
    workspaceId: 'ws-evil',
    aiProviderId: 'provider-evil',
  });

  assert.equal(result.success, true);
  assert.equal(fetchCalls, 1);
  assert.deepEqual(seen[0], ['can', { purpose: 'ambiguity_ai', provider: 'provider-a', workspaceId: 'ws-trusted' }]);
  assert.deepEqual(seen[1], ['can', { purpose: 'ambiguity_ai', provider: 'provider-b', workspaceId: 'ws-trusted' }]);
  assert.deepEqual(seen[2], ['success', { purpose: 'ambiguity_ai', provider: 'provider-b', workspaceId: 'ws-trusted' }]);
});

test('provider failure records only the exact attempted database provider and cascade continues to healthy sibling', async () => {
  const failures = [];
  const successes = [];
  const breaker = {
    canAttempt() { return { allowed: true }; },
    recordFailure(key) { failures.push(key); },
    recordSuccess(key) { successes.push(key); },
  };
  let calls = 0;
  const router = new UniversalAIRouter([
    provider('provider-a', 'openai-a', 1),
    provider('provider-b', 'openai-b', 2),
  ], {
    workspaceId: 'ws-a',
    circuitBreaker: breaker,
    fetchFn: async () => {
      calls += 1;
      if (calls === 1) throw new Error('provider a down');
      return new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }), { status: 200 });
    },
  });

  const result = await router.processSignal('x', 'prompt', { purpose: 'destination_ai', timeoutMs: 50 });
  assert.equal(result.success, true);
  assert.deepEqual(failures, [{ purpose: 'destination_ai', provider: 'provider-a', workspaceId: 'ws-a' }]);
  assert.deepEqual(successes, [{ purpose: 'destination_ai', provider: 'provider-b', workspaceId: 'ws-a' }]);
});

test('workspace AI factory permanently binds authenticated workspace into router breaker authority', async () => {
  const filters = [];
  const supabase = {
    from() {
      const chain = {
        select() { return chain; },
        eq(field, value) { filters.push([field, value]); return chain; },
        then(resolve) { resolve({ data: [provider('provider-a', 'openai-a')], error: null }); },
      };
      return chain;
    },
  };
  const breaker = { canAttempt: () => ({ allowed: true }), recordFailure() {}, recordSuccess() {} };
  const router = await createWorkspaceAIRouter(supabase, 'ws-authenticated', { circuitBreaker: breaker });

  assert.equal(router.workspaceId, 'ws-authenticated');
  assert.equal(router.circuitBreaker, breaker);
  assert.deepEqual(filters, [['workspace_id', 'ws-authenticated'], ['is_active', true]]);
});

test('interpreter labels its router call as ambiguity_ai without supplying caller-selected provider authority', async () => {
  let options;
  const result = await interpretTradingEvent({ text: 'gold looks good maybe buy around here' }, {
    aiRouter: {
      async processSignal(_text, _prompt, received) {
        options = received;
        return { success: false, error: 'unavailable' };
      },
    },
  });

  assert.equal(result.status, 'NEEDS_REVIEW');
  assert.equal(options.purpose, 'ambiguity_ai');
  assert.equal(Object.hasOwn(options, 'workspaceId'), false);
  assert.equal(Object.hasOwn(options, 'aiProviderId'), false);
});
