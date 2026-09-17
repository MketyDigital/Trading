import assert from 'node:assert/strict';
import test from 'node:test';

import { buildMachinePlan } from '../src/pipeline/machine_plan.js';
import { UniversalAIRouter } from '../src/ai/universal_ai.js';

const STARPIPS_SIGNAL = `BUY XAUUSD (4324.7-4314.7)\n\nTake Profit 1 at 4328.7\nTake Profit 2 at 4334.7\nTake Profit 3 at 4354.7\n\nStop Loss at 4309.7\n\n~~~\nStarpips Forex`;

test('real Starpips TP-at signal parses deterministically without AI', () => {
  const result = buildMachinePlan({ text: STARPIPS_SIGNAL });
  assert.equal(result.status, 'READY');
  assert.equal(result.intent.side, 'BUY');
  assert.equal(result.intent.symbol.canonical, 'XAUUSD');
  assert.deepEqual(result.intent.entry, { kind: 'RANGE', min: 4314.7, max: 4324.7 });
  assert.equal(result.intent.stopLoss, 4309.7);
  assert.deepEqual(result.intent.takeProfits, [4328.7, 4334.7, 4354.7]);
});

test('default Worker fetch preserves global invocation binding for OpenAI', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async function boundWorkerFetch(url, init) {
    if (this !== globalThis) {
      throw new TypeError('Illegal invocation: function called with incorrect `this` reference.');
    }
    calls.push({ url, init });
    return {
      ok: true,
      status: 200,
      async json() {
        return { output_text: '{"event_type":"NO_ACTION"}' };
      },
      async text() { return ''; },
    };
  };

  try {
    const router = new UniversalAIRouter([{
      id: 'provider-1',
      provider_name: 'openai',
      model_name: 'gpt-5.6-luna',
      resolved_api_key: 'test-key',
      is_active: true,
      priority_rank: 1,
    }]);
    const result = await router.processSignal('ambiguous input', 'Return JSON only');
    assert.equal(result.success, true);
    assert.equal(result.provider, 'openai');
    assert.equal(calls.length, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
