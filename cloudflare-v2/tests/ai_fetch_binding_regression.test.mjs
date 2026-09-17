import test from 'node:test';
import assert from 'node:assert/strict';

import { UniversalAIRouter } from '../src/ai/universal_ai.js';

test('default AI transport invokes fetch without rebinding this to the router', async () => {
  const originalFetch = globalThis.fetch;
  let receiver = null;
  globalThis.fetch = function (..._args) {
    receiver = this;
    if (this !== globalThis && this !== undefined) {
      throw new TypeError('Illegal invocation: wrong this');
    }
    return Promise.resolve({
      ok: true,
      status: 200,
      json: async () => ({ output_text: '{"side":"BUY","symbol":"XAUUSD"}' }),
    });
  };

  try {
    const router = new UniversalAIRouter([{
      id: 'provider-1',
      provider_name: 'openai',
      model_name: 'gpt-5.6-luna',
      resolved_api_key: 'test-key',
      is_active: true,
    }]);
    const result = await router.processSignal('buy gold', 'Return JSON');
    assert.equal(result.success, true);
    assert.ok(receiver === globalThis || receiver === undefined);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
