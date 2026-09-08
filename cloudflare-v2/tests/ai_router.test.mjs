import test from 'node:test';
import assert from 'node:assert/strict';
import { UniversalAIRouter } from '../src/ai/universal_ai.js';

test('uses database priority_rank and accepts legacy api_key during migration', async () => {
  const calls = [];
  class TestRouter extends UniversalAIRouter {
    async executeProviderCall(provider) {
      calls.push(provider.provider_name);
      return { success: true, text: `<b>${provider.provider_name}</b>` };
    }
  }
  const router = new TestRouter([
    { provider_name: 'slow-second', priority_rank: 2, api_key: 'k2', is_active: true },
    { provider_name: 'fast-first', priority_rank: 1, api_key: 'k1', is_active: true },
  ]);
  const result = await router.processSignal('BUY GOLD', 'format');
  assert.equal(result.success, true);
  assert.equal(result.provider, 'fast-first');
  assert.deepEqual(calls, ['fast-first']);
});

test('supports injected credential resolver so encrypted storage is not coupled to router', async () => {
  let seenKey;
  class TestRouter extends UniversalAIRouter {
    async executeProviderCall(provider) {
      seenKey = provider.resolved_api_key;
      return { success: true, text: 'ok' };
    }
  }
  const router = new TestRouter([
    { provider_name: 'gemini', priority_rank: 1, api_key_ciphertext: 'cipher', is_active: true },
  ], { credentialResolver: async () => 'decrypted-key' });
  const result = await router.processSignal('x', 'y');
  assert.equal(result.success, true);
  assert.equal(seenKey, 'decrypted-key');
});

test('respects caller latency budget instead of fixed 12 second wait', async () => {
  class TestRouter extends UniversalAIRouter {
    async executeProviderCall(_provider, _raw, _prompt, signal) {
      return await new Promise((resolve, reject) => {
        const timer = setTimeout(() => resolve({ success: true, text: 'too late' }), 100);
        signal.addEventListener('abort', () => { clearTimeout(timer); reject(new DOMException('Aborted', 'AbortError')); });
      });
    }
  }
  const router = new TestRouter([{ provider_name: 'ai', api_key: 'k', is_active: true }]);
  const started = Date.now();
  const result = await router.processSignal('x', 'y', { timeoutMs: 10 });
  assert.equal(result.success, false);
  assert.ok(Date.now() - started < 80);
});

test('passes Cloudflare account id through router env instead of undefined global env', async () => {
  let requestedUrl;
  const router = new UniversalAIRouter([
    { provider_name: 'cloudflare_ai', api_key: 'token', model_name: '@cf/test/model', is_active: true },
  ], {
    env: { CLOUDFLARE_ACCOUNT_ID: 'acct-123' },
    fetchFn: async (url) => {
      requestedUrl = String(url);
      return { ok: true, json: async () => ({ result: { response: 'formatted' } }) };
    },
  });
  const result = await router.processSignal('x', 'y', { timeoutMs: 100 });
  assert.equal(result.success, true);
  assert.match(requestedUrl, /accounts\/acct-123\/ai\/run/);
});

test('does not silently fall back to stale provider model names', async () => {
  let fetchCalls = 0;
  const fetchFn = async () => {
    fetchCalls += 1;
    return { ok: true, json: async () => ({ choices: [{ message: { content: 'ok' } }] }) };
  };
  const router = new UniversalAIRouter([
    { provider_name: 'openai', api_key: 'token', is_active: true },
  ], { fetchFn });
  const result = await router.processSignal('x', 'y', { timeoutMs: 100 });
  assert.equal(result.success, false);
  assert.equal(fetchCalls, 0);
});