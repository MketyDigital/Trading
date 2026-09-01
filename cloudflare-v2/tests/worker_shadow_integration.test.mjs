import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createTradingV1Entrypoint } from '../src/v1_entry.js';

test('feature flag off delegates process_signal to legacy Worker unchanged', async () => {
  let legacyCalls = 0;
  let shadowCalls = 0;
  const legacy = {
    async fetch() {
      legacyCalls += 1;
      return new Response(JSON.stringify({ success: true, trace: { legacy: true } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    },
  };
  const entry = createTradingV1Entrypoint({
    legacy,
    shadowBuilder: async () => { shadowCalls += 1; return { status: 'READY' }; },
  });

  const response = await entry.fetch(new Request('https://trade.test/api/webhook/process_signal', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ source_chat_id: -1001, source_message_id: 1, raw_text: 'BUY GOLD NOW' }),
  }), { TRADING_V1_SHADOW: 'false' });

  assert.equal(legacyCalls, 1);
  assert.equal(shadowCalls, 0);
  assert.deepEqual(await response.json(), { success: true, trace: { legacy: true } });
});

test('feature flag on adds side-effect-free canonical shadow diagnostics to legacy JSON response', async () => {
  const legacy = {
    async fetch() {
      return new Response(JSON.stringify({ success: true, trace: { legacy: true } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    },
  };
  const entry = createTradingV1Entrypoint({
    legacy,
    shadowBuilder: async (event) => ({
      status: 'READY', source: 'deterministic', executionEnabled: false, actions: [],
      intent: { symbol: { canonical: event.text.includes('GOLD') ? 'XAUUSD' : 'UNKNOWN' } },
    }),
  });

  const response = await entry.fetch(new Request('https://trade.test/api/webhook/process_signal', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ source_chat_id: -1001, source_message_id: 2, raw_text: 'BUY GOLD NOW' }),
  }), { TRADING_V1_SHADOW: 'true' });
  const body = await response.json();

  assert.equal(body.success, true);
  assert.equal(body.trace.legacy, true);
  assert.equal(body.trace.v1_shadow.status, 'READY');
  assert.equal(body.trace.v1_shadow.executionEnabled, false);
  assert.deepEqual(body.trace.v1_shadow.actions, []);
});

test('shadow interpretation failure never interrupts legacy delivery or execution response', async () => {
  const legacy = {
    async fetch() {
      return new Response(JSON.stringify({ success: true, trace: { legacy: true } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    },
  };
  const entry = createTradingV1Entrypoint({
    legacy,
    shadowBuilder: async () => { throw new Error('shadow failed'); },
  });

  const response = await entry.fetch(new Request('https://trade.test/api/webhook/process_signal', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ source_chat_id: -1001, source_message_id: 3, raw_text: 'BUY XAUUSD 2500' }),
  }), { TRADING_V1_SHADOW: 'true' });
  const body = await response.json();

  assert.equal(body.success, true);
  assert.equal(body.trace.legacy, true);
  assert.equal(body.trace.v1_shadow.status, 'ERROR');
  assert.match(body.trace.v1_shadow.error, /shadow failed/i);
});

test('versioned universal event endpoint bypasses legacy Worker and uses V1 ingress handler', async () => {
  let legacyCalls = 0;
  let v1Calls = 0;
  const entry = createTradingV1Entrypoint({
    legacy: { fetch: async () => { legacyCalls += 1; return new Response('legacy'); } },
    eventsHandler: async () => { v1Calls += 1; return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json' } }); },
  });
  const response = await entry.fetch(new Request('https://trade.test/api/v1/events', { method: 'POST', body: '{}' }), {});
  assert.equal(response.status, 200);
  assert.equal(v1Calls, 1);
  assert.equal(legacyCalls, 0);
});

test('scheduled handler remains delegated to legacy Worker', async () => {
  let called = false;
  const entry = createTradingV1Entrypoint({
    legacy: { fetch: async () => new Response('ok'), scheduled: async () => { called = true; } },
  });
  await entry.scheduled({}, {}, {});
  assert.equal(called, true);
});

test('Cloudflare entrypoint switches through the V1 wrapper while legacy Worker remains intact', async () => {
  const wrangler = await fs.readFile(new URL('../wrangler.toml', import.meta.url), 'utf8');
  assert.match(wrangler, /main\s*=\s*["']src\/v1_entry\.js["']/);
});
