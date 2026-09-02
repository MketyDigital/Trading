import test from 'node:test';
import assert from 'node:assert/strict';
import { validateStagingReadiness } from '../src/config/staging_readiness.js';
import { createTradingV1Entrypoint } from '../src/v1_entry.js';

function coreEnv(overrides = {}) {
  return {
    SUPABASE_URL: 'https://staging.example.invalid',
    SUPABASE_SERVICE_ROLE: 'service-role-secret',
    TRADING_MASTER_KEY: 'master-key-secret',
    ZITADEL_ISSUER: 'https://auth.example.invalid',
    ZITADEL_AUDIENCE: 'trading-api',
    ZITADEL_JWKS_URL: 'https://auth.example.invalid/oauth/v2/keys',
    ...overrides,
  };
}

function completeMtprotoEnv(overrides = {}) {
  return coreEnv({
    MTPROTO_CONTAINER_NAMESPACE: { idFromName() {}, get() {} },
    MTPROTO_INTERNAL_SOURCE_URL: 'https://worker.example.invalid/api/v1/internal/source-event',
    INTERNAL_SOURCE_TRANSPORT_TOKEN: 'internal-transport-secret',
    SOURCE_EVENT_QUEUE: { send() {} },
    ...overrides,
  });
}

test('first-party MTProto readiness reports only missing configuration names', () => {
  const result = validateStagingReadiness(coreEnv(), { requireMtprotoContainer: true });

  assert.equal(result.ready, false);
  assert.deepEqual(result.missing.sort(), [
    'INTERNAL_SOURCE_TRANSPORT_TOKEN',
    'MTPROTO_CONTAINER_NAMESPACE',
    'MTPROTO_INTERNAL_SOURCE_URL',
    'SOURCE_EVENT_QUEUE',
  ]);
  assert.equal(result.features.mtprotoContainerRequested, true);

  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes('service-role-secret'), false);
  assert.equal(serialized.includes('master-key-secret'), false);
});

test('complete first-party MTProto readiness accepts bindings without exposing values', () => {
  const result = validateStagingReadiness(completeMtprotoEnv(), { requireMtprotoContainer: true });

  assert.equal(result.ready, true);
  assert.deepEqual(result.missing, []);
  assert.equal(result.features.mtprotoContainerRequested, true);

  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes('internal-transport-secret'), false);
  assert.equal(serialized.includes('worker.example.invalid'), false);
});

test('V1 health exposes MTProto component readiness without making optional provider failure global', async () => {
  const legacy = {
    async fetch() { return new Response('legacy'); },
    async scheduled() {},
  };
  const worker = createTradingV1Entrypoint({ legacy });
  const response = await worker.fetch(
    new Request('https://trade.example.invalid/api/v1/health'),
    coreEnv(),
    {},
  );
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.ready, true);
  assert.equal(body.status, 'ready');
  assert.equal(body.mtprotoContainerReady, false);
  assert.deepEqual(body.mtprotoContainerMissing.sort(), [
    'INTERNAL_SOURCE_TRANSPORT_TOKEN',
    'MTPROTO_CONTAINER_NAMESPACE',
    'MTPROTO_INTERNAL_SOURCE_URL',
    'SOURCE_EVENT_QUEUE',
  ]);
  assert.equal(JSON.stringify(body).includes('service-role-secret'), false);
});

test('V1 health marks MTProto component ready when all first-party runtime dependencies exist', async () => {
  const worker = createTradingV1Entrypoint({
    legacy: { async fetch() { return new Response('legacy'); }, async scheduled() {} },
  });
  const response = await worker.fetch(
    new Request('https://trade.example.invalid/api/v1/health'),
    completeMtprotoEnv(),
    {},
  );
  const body = await response.json();

  assert.equal(body.ready, true);
  assert.equal(body.mtprotoContainerReady, true);
  assert.deepEqual(body.mtprotoContainerMissing, []);
  assert.equal(JSON.stringify(body).includes('internal-transport-secret'), false);
});
