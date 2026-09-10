import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTradingConnectionsEntrypoint } from '../src/v1_connections_entry.js';

const here = path.dirname(fileURLToPath(import.meta.url));

function response(body, type = 'application/json') {
  return new Response(body, { status: 200, headers: { 'Content-Type': type } });
}

test('connection entry intercepts public cTrader callback without sending it to legacy worker', async () => {
  let baseCalls = 0;
  const worker = createTradingConnectionsEntrypoint({
    base: { fetch: async () => { baseCalls += 1; return response('{}'); } },
    ctraderCallbackHandler: () => new Response(null, { status: 302, headers: { Location: '/?ctrader_code=x' } }),
  });
  const r = await worker.fetch(new Request('https://trade.mkety.com/api/v1/integrations/ctrader/callback?code=x'), {}, {});
  assert.equal(r.status, 302);
  assert.equal(baseCalls, 0);
});

test('portal response receives unified connection management UI while preserving base portal', async () => {
  const worker = createTradingConnectionsEntrypoint({
    base: { fetch: async () => response('<html><body><div id="accountRows"></div></body></html>', 'text/html; charset=utf-8') },
  });
  const r = await worker.fetch(new Request('https://trade.mkety.com/'), {}, {});
  const html = await r.text();
  assert.match(html, /Connect cTrader/);
  assert.match(html, /Connect MT5 Bridge/);
  assert.match(html, /Connect MT5 Cloud/);
  assert.match(html, /Edit/);
  assert.match(html, /Remove/);
});

test('deployment configs keep the broker master execution fuse off through the unified entry', () => {
  for (const filename of ['wrangler.toml', 'wrangler.free.toml']) {
    const toml = fs.readFileSync(path.resolve(here, '..', filename), 'utf8');
    assert.match(toml, /main\s*=\s*"src\/v1_connections_entry\.js"/);
    assert.match(toml, /BROKER_EXECUTION_ENABLED\s*=\s*"false"/);
  }
});
