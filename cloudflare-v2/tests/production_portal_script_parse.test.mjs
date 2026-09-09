import test from 'node:test';
import assert from 'node:assert/strict';

import { createTradingV1Entrypoint } from '../src/v1_entry.js';

test('composed customer portal inline scripts all parse', async () => {
  const worker = createTradingV1Entrypoint();
  const response = await worker.fetch(new Request('https://trade.mkety.com/'), {
    TRADING_ACCESS_ENABLED: 'true',
    BROKER_EXECUTION_ENABLED: 'true',
    TRADING_ACCESS_CODE_REDEMPTION_ENABLED: 'true',
    TRADING_ACCESS_CODE_SESSION_ENABLED: 'true',
    TRADING_ACCESS_CODE_SESSION_SECRET: 'test-session-secret',
  }, {});

  assert.equal(response.status, 200);
  const html = await response.text();
  const scripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)].map((match) => match[1]);
  assert.ok(scripts.length >= 3, `expected composed portal scripts, found ${scripts.length}`);

  for (const [index, source] of scripts.entries()) {
    assert.doesNotThrow(
      () => new Function(source),
      `inline script ${index + 1} must parse as browser JavaScript`,
    );
  }
});
