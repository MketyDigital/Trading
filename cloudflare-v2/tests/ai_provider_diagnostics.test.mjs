import test from 'node:test';
import assert from 'node:assert/strict';

import { UniversalAIRouter } from '../src/ai/universal_ai.js';

function provider(overrides = {}) {
  return {
    id: 'provider-openai',
    provider_name: 'openai',
    model_name: 'gpt-test',
    priority_rank: 1,
    is_active: true,
    api_key: 'sk-secret-123',
    ...overrides,
  };
}

test('failed provider call returns normalized sanitized diagnostics without credential or raw-body leakage', async () => {
  const secret = 'sk-secret-123';
  const router = new UniversalAIRouter([provider({ api_key: secret })], {
    fetchFn: async () => ({
      ok: false,
      status: 401,
      text: async () => JSON.stringify({
        error: {
          message: `Invalid API key ${secret}`,
          type: 'invalid_request_error',
          code: 'invalid_api_key',
        },
        internal_debug: `Bearer ${secret} should never persist`,
      }),
    }),
  });

  const result = await router.processSignal('ambiguous trade', 'interpret safely', { timeoutMs: 100 });
  assert.equal(result.success, false);
  assert.equal(result.error, 'All AI providers failed in cascade.');
  assert.equal(result.diagnostics.length, 1);

  const diagnostic = result.diagnostics[0];
  assert.equal(diagnostic.providerId, 'provider-openai');
  assert.equal(diagnostic.providerType, 'openai');
  assert.equal(diagnostic.model, 'gpt-test');
  assert.equal(diagnostic.outcome, 'FAILED');
  assert.equal(diagnostic.httpStatus, 401);
  assert.equal(diagnostic.providerCode, 'invalid_api_key');
  assert.equal(diagnostic.retryable, false);
  assert.equal(diagnostic.errorClass, 'AUTH');
  assert.equal(Number.isFinite(diagnostic.latencyMs), true);
  assert.match(diagnostic.sanitizedMessage, /Invalid API key/i);
  assert.equal(JSON.stringify(diagnostic).includes(secret), false);
  assert.equal(JSON.stringify(diagnostic).includes('internal_debug'), false);
});

test('cascade preserves failed sibling diagnostic and successful provider diagnostic', async () => {
  let call = 0;
  const router = new UniversalAIRouter([
    provider({ id: 'provider-a', priority_rank: 1, api_key: 'key-a' }),
    provider({ id: 'provider-b', priority_rank: 2, api_key: 'key-b' }),
  ], {
    fetchFn: async () => {
      call += 1;
      if (call === 1) {
        return {
          ok: false,
          status: 429,
          text: async () => JSON.stringify({ error: { message: 'Rate limit reached', code: 'rate_limit_exceeded' } }),
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ output_text: 'READY' }),
      };
    },
  });

  const result = await router.processSignal('x', 'y', { timeoutMs: 100 });
  assert.equal(result.success, true);
  assert.equal(result.text, 'READY');
  assert.equal(result.provider, 'openai');
  assert.equal(result.diagnostics.length, 2);
  assert.equal(result.diagnostics[0].providerId, 'provider-a');
  assert.equal(result.diagnostics[0].outcome, 'FAILED');
  assert.equal(result.diagnostics[0].errorClass, 'RATE_LIMIT');
  assert.equal(result.diagnostics[0].retryable, true);
  assert.equal(result.diagnostics[1].providerId, 'provider-b');
  assert.equal(result.diagnostics[1].outcome, 'SUCCESS');
  assert.equal(result.diagnostics[1].httpStatus, 200);
});

test('provider timeout is normalized as retryable timeout diagnostic without inventing HTTP status zero', async () => {
  const router = new UniversalAIRouter([provider()], {
    fetchFn: async (_url, options) => await new Promise((_resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
    }),
  });

  const result = await router.processSignal('x', 'y', { timeoutMs: 5 });
  assert.equal(result.success, false);
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].outcome, 'FAILED');
  assert.equal(result.diagnostics[0].errorClass, 'TIMEOUT');
  assert.equal(result.diagnostics[0].providerCode, 'AI_TIMEOUT');
  assert.equal(result.diagnostics[0].retryable, true);
  assert.equal(Number.isFinite(result.diagnostics[0].latencyMs), true);
  assert.equal(Object.hasOwn(result.diagnostics[0], 'httpStatus'), false);
});
