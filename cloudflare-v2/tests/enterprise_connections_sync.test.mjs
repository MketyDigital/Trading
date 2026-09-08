import test from 'node:test';
import assert from 'node:assert/strict';
import { createTradingV1Entrypoint } from '../src/v1_entry.js';

async function portalHtml() {
  const worker = createTradingV1Entrypoint({
    legacy: { async fetch() { return new Response('legacy'); } },
  });
  const response = await worker.fetch(new Request('https://trade.mkety.com/'), {
    TRADING_ACCESS_ENABLED: 'true',
    BROKER_EXECUTION_ENABLED: 'false',
  }, {});
  return response.text();
}

test('enterprise Connections UI exposes authoritative Telegram source filtering and activation', async () => {
  const html = await portalHtml();
  assert.match(html, /Telegram account scope/i);
  assert.match(html, /Allowed chat IDs/i);
  assert.match(html, /chat_acceptance_mode/);
  assert.match(html, /allowed_chat_ids/);
  assert.match(html, /data-source-toggle/);
  assert.match(html, /\/api\/v1\/admin\/sources\/.+enable/);
});

test('external MTProto UI explains the signed Mkety handoff contract rather than endpoint-only forwarding', async () => {
  const html = await portalHtml();
  assert.match(html, /TRADING_SOURCE_ID/);
  assert.match(html, /TRADING_SOURCE_SECRET/);
  assert.match(html, /\/api\/v1\/events/);
  assert.match(html, /HMAC|signed/i);
});

test('enterprise AI model guidance reflects September 2026 production model families', async () => {
  const html = await portalHtml();
  assert.match(html, /gpt-5\.6-(?:luna|terra|sol)/i);
  assert.match(html, /gemini-3\.8-flash/i);
  assert.match(html, /deepseek-v4-(?:flash|pro)/i);
  assert.match(html, /openai\/gpt-oss-120b/i);
  assert.doesNotMatch(html, /placeholder=\"gpt-5-mini\"/i);
});
