import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createTradingV1Entrypoint } from '../src/v1_entry.js';

const ACCESS_ON = { TRADING_ACCESS_ENABLED: 'true' };

test('legacy process_signal execution webhook is retired before legacy code, shadowing, database access, or broker dispatch', async () => {
  let legacyCalls = 0;
  let shadowCalls = 0;
  const entry = createTradingV1Entrypoint({
    legacy: {
      async fetch() {
        legacyCalls += 1;
        return new Response(JSON.stringify({ success: true }), { status: 200 });
      },
    },
    shadowBuilder: async () => { shadowCalls += 1; return { status: 'READY' }; },
  });

  for (const env of [
    {},
    { TRADING_V1_SHADOW: 'false' },
    { TRADING_V1_SHADOW: 'true', TRADING_ACCESS_ENABLED: 'true', BROKER_EXECUTION_ENABLED: 'true' },
  ]) {
    const response = await entry.fetch(new Request('https://trade.test/api/webhook/process_signal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source_chat_id: -1001,
        source_message_id: 1,
        raw_text: 'BUY XAUUSD NOW',
        simulate: false,
      }),
    }), env, {});
    assert.equal(response.status, 410);
    assert.deepEqual(await response.json(), {
      ok: false,
      reason: 'LEGACY_SIGNAL_WEBHOOK_RETIRED',
      replacement: '/api/v1/internal/source-event or /api/v1/events',
    });
  }

  assert.equal(legacyCalls, 0);
  assert.equal(shadowCalls, 0);
});

test('versioned universal event endpoint bypasses legacy Worker and uses V1 ingress handler when Trading access is enabled', async () => {
  let legacyCalls = 0;
  let v1Calls = 0;
  const entry = createTradingV1Entrypoint({
    legacy: { fetch: async () => { legacyCalls += 1; return new Response('legacy'); } },
    eventsHandler: async () => { v1Calls += 1; return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json' } }); },
  });
  const response = await entry.fetch(new Request('https://trade.test/api/v1/events', { method: 'POST', body: '{}' }), ACCESS_ON);
  assert.equal(response.status, 200);
  assert.equal(v1Calls, 1);
  assert.equal(legacyCalls, 0);
});

test('workspace-scoped V1 admin endpoint bypasses legacy Worker when Trading access is enabled', async () => {
  let legacyCalls = 0;
  let adminCalls = 0;
  const entry = createTradingV1Entrypoint({
    legacy: { fetch: async () => { legacyCalls += 1; return new Response('legacy'); } },
    adminHandler: async () => { adminCalls += 1; return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json' } }); },
  });
  const response = await entry.fetch(new Request('https://trade.test/api/v1/admin/workspace'), ACCESS_ON);
  assert.equal(response.status, 200);
  assert.equal(adminCalls, 1);
  assert.equal(legacyCalls, 0);
});

test('Trading access fuse blocks external V1 events and admin before their handlers', async () => {
  let legacyCalls = 0;
  let eventCalls = 0;
  let adminCalls = 0;
  const entry = createTradingV1Entrypoint({
    legacy: { fetch: async () => { legacyCalls += 1; return new Response('legacy'); } },
    eventsHandler: async () => { eventCalls += 1; return new Response('event'); },
    adminHandler: async () => { adminCalls += 1; return new Response('admin'); },
  });

  for (const request of [
    new Request('https://trade.test/api/v1/events', { method: 'POST', body: '{}' }),
    new Request('https://trade.test/api/v1/admin/workspace'),
  ]) {
    const response = await entry.fetch(request, { TRADING_ACCESS_ENABLED: 'false' }, {});
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { ok: false, reason: 'TRADING_ACCESS_DISABLED' });
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
  }

  assert.equal(eventCalls, 0);
  assert.equal(adminCalls, 0);
  assert.equal(legacyCalls, 0);
});

test('missing Trading access flag fails closed for external V1 application APIs', async () => {
  let eventCalls = 0;
  const entry = createTradingV1Entrypoint({
    legacy: { fetch: async () => new Response('legacy') },
    eventsHandler: async () => { eventCalls += 1; return new Response('event'); },
  });
  const response = await entry.fetch(new Request('https://trade.test/api/v1/events', { method: 'POST', body: '{}' }), {}, {});
  assert.equal(response.status, 503);
  assert.equal((await response.json()).reason, 'TRADING_ACCESS_DISABLED');
  assert.equal(eventCalls, 0);
});

test('unsafe legacy admin API surface fails closed instead of reaching unscoped proxy', async () => {
  let legacyCalls = 0;
  const entry = createTradingV1Entrypoint({
    legacy: { fetch: async () => { legacyCalls += 1; return new Response('legacy'); } },
  });
  for (const path of ['/api/admin/data/workspaces', '/api/admin/data/proxy', '/api/admin/bot/authorize', '/api/admin/bank/decision', '/api/admin/listener/start']) {
    const response = await entry.fetch(new Request(`https://trade.test${path}`, { method: path.includes('/data/workspaces') ? 'GET' : 'POST' }), {});
    assert.equal(response.status, 410);
  }
  assert.equal(legacyCalls, 0);
});

test('V1 health bypasses legacy Worker and remains readable while Trading access is disabled', async () => {
  let legacyCalls = 0;
  const entry = createTradingV1Entrypoint({
    legacy: { fetch: async () => { legacyCalls += 1; return new Response('legacy'); } },
  });
  const env = {
    SUPABASE_URL: 'https://staging-secret-project.supabase.co',
    SUPABASE_SERVICE_ROLE: 'service-secret-value',
    TRADING_MASTER_KEY: 'master-secret-value',
    ZITADEL_ISSUER: 'https://auth.example.com',
    ZITADEL_AUDIENCE: 'trading-api',
    ZITADEL_JWKS_URL: 'https://auth.example.com/oauth/v2/keys',
    TRADING_V1_SIMULATION: 'true',
    TRADING_ACCESS_ENABLED: 'false',
  };
  const response = await entry.fetch(new Request('https://trade.test/api/v1/health'), env);
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(legacyCalls, 0);
  assert.equal(body.service, 'mkety-trading-v1');
  assert.equal(body.ready, true);
  assert.equal(body.simulationReady, false);
  assert.equal(body.features.simulationEnabled, true);
  assert.equal(body.simulationMissing.includes('TRADE_STATE_INTERNAL_TOKEN'), true);

  const serialized = JSON.stringify(body);
  assert.equal(serialized.includes('service-secret-value'), false);
  assert.equal(serialized.includes('master-secret-value'), false);
  assert.equal(serialized.includes('staging-secret-project'), false);
});

test('V1 health is GET-only and never delegates invalid methods to legacy Worker', async () => {
  let legacyCalls = 0;
  const entry = createTradingV1Entrypoint({
    legacy: { fetch: async () => { legacyCalls += 1; return new Response('legacy'); } },
  });
  const response = await entry.fetch(new Request('https://trade.test/api/v1/health', { method: 'POST' }), {});
  assert.equal(response.status, 405);
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

test('Cloudflare entrypoint switches through the unified connections wrapper while V1 remains intact underneath', async () => {
  const wrangler = await fs.readFile(new URL('../wrangler.toml', import.meta.url), 'utf8');
  assert.match(wrangler, /main\s*=\s*["']src\/v1_connections_entry\.js["']/);
});
