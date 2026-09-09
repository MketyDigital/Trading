import test from 'node:test';
import assert from 'node:assert/strict';

import { createTradingV1Entrypoint } from '../src/v1_entry.js';

function inlineScripts(html) {
  return [...String(html).matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)].map((match) => match[1]);
}

test('fully assembled enterprise portal emits syntactically valid inline JavaScript', async () => {
  const worker = createTradingV1Entrypoint({
    legacy: {
      fetch() {
        return new Response('legacy');
      },
    },
  });

  const response = await worker.fetch(new Request('https://trade.mkety.com/'), {
    TRADING_ACCESS_ENABLED: 'true',
    BROKER_EXECUTION_ENABLED: 'false',
    TRADING_CUSTOM_HOSTNAMES_ENABLED: 'true',
  }, {});
  assert.equal(response.status, 200);

  const html = await response.text();
  const scripts = inlineScripts(html);
  assert.ok(scripts.length >= 4, `expected assembled portal scripts, got ${scripts.length}`);

  for (const [index, source] of scripts.entries()) {
    assert.doesNotThrow(
      () => new Function(source),
      `inline portal script ${index + 1} must compile`,
    );
  }
});
