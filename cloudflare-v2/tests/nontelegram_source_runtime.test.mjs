import test from 'node:test';
import assert from 'node:assert/strict';

import {
  PermanentSourceDeliveryError,
  RetryableSourceDeliveryError,
} from '../src/sources/nontelegram/signed_v1_client.js';
import { createNonTelegramSourceRuntime } from '../src/sources/nontelegram/source_runtime.js';

function native(providerType, nativeEventId = 'event-1') {
  return {
    providerType,
    nativeEventId,
    occurredAt: '2026-09-02T15:00:00.000Z',
    text: 'BUY XAUUSD 2500 SL 2490 TP 2520',
    metadata: { bridge_version: '1.0.0' },
  };
}

test('runtime builds once then retries only its own retryable delivery with the same payload', async () => {
  const sent = [];
  const sleeps = [];
  let attempts = 0;
  const client = {
    async send(payload) {
      sent.push(payload);
      attempts += 1;
      if (attempts === 1) throw new RetryableSourceDeliveryError('HTTP_RETRYABLE', 503);
      return { ok: true, duplicate: false, eventId: 'evt-1' };
    },
  };
  const runtime = createNonTelegramSourceRuntime({
    providerType: 'mt5_source_bridge',
    client,
    retryDelaysMs: [25, 50],
    sleep: async (ms) => { sleeps.push(ms); },
    nowMs: () => 1000,
  });

  const result = await runtime.deliver(native('mt5_source_bridge'));

  assert.equal(result.ok, true);
  assert.equal(attempts, 2);
  assert.deepEqual(sleeps, [25]);
  assert.equal(sent[0], sent[1]);
  assert.deepEqual(runtime.status(), {
    status: 'healthy',
    lastEventId: 'event-1',
    deliveryAttempts: 2,
    deliverySuccesses: 1,
    retryableFailures: 1,
    permanentFailures: 0,
    lastSuccessAtMs: 1000,
    lastFailureAtMs: 1000,
  });
});

test('permanent rejection is terminal locally and never consumes retry delays', async () => {
  let attempts = 0;
  const runtime = createNonTelegramSourceRuntime({
    providerType: 'ctrader_source',
    client: {
      async send() {
        attempts += 1;
        throw new PermanentSourceDeliveryError('HTTP_REJECTED', 403);
      },
    },
    retryDelaysMs: [10, 20],
    sleep: async () => { throw new Error('must not sleep'); },
    nowMs: () => 2000,
  });

  await assert.rejects(
    () => runtime.deliver(native('ctrader_source', 'ct-1')),
    (error) => error instanceof PermanentSourceDeliveryError && error.status === 403,
  );
  assert.equal(attempts, 1);
  assert.equal(runtime.status().permanentFailures, 1);
  assert.equal(runtime.status().status, 'degraded');
});

test('retry exhaustion is scoped to one runtime and reports sanitized degraded health', async () => {
  const secretText = 'response-body-must-not-leak';
  const runtime = createNonTelegramSourceRuntime({
    providerType: 'custom_signed_api',
    client: {
      async send() {
        throw new RetryableSourceDeliveryError('NETWORK_ERROR');
      },
      secretText,
    },
    retryDelaysMs: [1],
    sleep: async () => {},
    nowMs: () => 3000,
  });

  await assert.rejects(() => runtime.deliver(native('custom_signed_api', 'custom-1')), RetryableSourceDeliveryError);
  const status = runtime.status();
  assert.equal(status.status, 'degraded');
  assert.equal(status.deliveryAttempts, 2);
  assert.equal(status.retryableFailures, 2);
  assert.equal(JSON.stringify(status).includes(secretText), false);
});

test('a blocked retry in runtime A does not block runtime B', async () => {
  let releaseA;
  let aAttempts = 0;
  const a = createNonTelegramSourceRuntime({
    providerType: 'mt5_source_bridge',
    client: {
      async send() {
        aAttempts += 1;
        if (aAttempts === 1) throw new RetryableSourceDeliveryError('NETWORK_ERROR');
        return { ok: true, duplicate: false };
      },
    },
    retryDelaysMs: [1],
    sleep: () => new Promise((resolve) => { releaseA = resolve; }),
    nowMs: () => 4000,
  });
  const b = createNonTelegramSourceRuntime({
    providerType: 'custom_signed_api',
    client: { async send() { return { ok: true, duplicate: false, eventId: 'b-event' }; } },
    retryDelaysMs: [1],
    sleep: async () => {},
    nowMs: () => 4000,
  });

  const pendingA = a.deliver(native('mt5_source_bridge', 'a-event'));
  await Promise.resolve();
  const resultB = await b.deliver(native('custom_signed_api', 'b-event'));

  assert.equal(resultB.ok, true);
  assert.equal(b.status().deliverySuccesses, 1);
  assert.equal(a.status().deliverySuccesses, 0);
  releaseA();
  await pendingA;
});

test('runtime rejects provider mismatch before client delivery and duplicate success stays healthy', async () => {
  let sends = 0;
  const runtime = createNonTelegramSourceRuntime({
    providerType: 'custom_signed_api',
    client: {
      async send() {
        sends += 1;
        return { ok: true, duplicate: true, eventId: 'evt-existing' };
      },
    },
    nowMs: () => 5000,
  });

  await assert.rejects(
    () => runtime.deliver(native('mt5_source_bridge', 'wrong-provider')),
    /SOURCE_RUNTIME_PROVIDER_MISMATCH/,
  );
  assert.equal(sends, 0);

  const duplicate = await runtime.deliver(native('custom_signed_api', 'custom-2'));
  assert.equal(duplicate.duplicate, true);
  assert.equal(runtime.status().status, 'healthy');
  assert.equal(runtime.status().deliverySuccesses, 1);
});
