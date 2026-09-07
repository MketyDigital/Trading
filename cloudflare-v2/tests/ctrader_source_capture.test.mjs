import test from 'node:test';
import assert from 'node:assert/strict';
import { createCTraderSourceCapture } from '../src/sources/nontelegram/ctrader_source_capture.js';

class FakeSession {
  constructor() {
    this.handlers = new Set();
  }
  subscribeEvents(handler) {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }
  emit(message) {
    for (const handler of [...this.handlers]) handler(message);
  }
}

function executionEvent({ accountId = 42, dealId = 9001, timestamp = 1770000000000, executionType = 3 } = {}) {
  return {
    payloadType: 2126,
    payload: {
      ctidTraderAccountId: accountId,
      executionType,
      deal: {
        dealId,
        executionTimestamp: timestamp,
        positionId: 501,
        volume: 1000,
        executionPrice: 235012,
        tradeSide: 1,
      },
      order: { orderId: 7001, symbolId: 11, orderType: 1 },
      position: { positionId: 501, tradeSide: 1 },
    },
  };
}

test('captures only exact-account cTrader execution deals into the isolated source runtime', async () => {
  const session = new FakeSession();
  const delivered = [];
  const runtime = { deliver: async (input) => { delivered.push(input); return { ok: true }; } };
  const capture = createCTraderSourceCapture({ session, runtime, accountId: 42 });
  capture.start();

  session.emit(executionEvent());
  await capture.drain();

  assert.equal(delivered.length, 1);
  assert.deepEqual(delivered[0], {
    providerType: 'ctrader_source',
    nativeEventId: '9001',
    occurredAt: new Date(1770000000000).toISOString(),
    structuredPayload: {
      execution_type: 3,
      deal: executionEvent().payload.deal,
      order: executionEvent().payload.order,
      position: executionEvent().payload.position,
    },
    metadata: { native_payload_type: 2126 },
  });
});

test('ignores unrelated payloads, malformed executions and events from another cTrader account', async () => {
  const session = new FakeSession();
  let deliveries = 0;
  const capture = createCTraderSourceCapture({
    session,
    runtime: { deliver: async () => { deliveries += 1; return { ok: true }; } },
    accountId: 42,
  });
  capture.start();

  session.emit({ payloadType: 51, payload: {} });
  session.emit(executionEvent({ accountId: 99 }));
  session.emit({ payloadType: 2126, payload: { ctidTraderAccountId: 42, executionType: 3, deal: { executionTimestamp: 1770000000000 } } });
  session.emit({ payloadType: 2126, payload: { ctidTraderAccountId: 42, executionType: 3, deal: { dealId: 1 } } });
  await capture.drain();

  assert.equal(deliveries, 0);
  const status = capture.status();
  assert.equal(status.observedEvents, 4);
  assert.equal(status.ignoredEvents, 4);
  assert.equal(status.deliveredEvents, 0);
});

test('serializes deliveries inside one capture so native event ordering is preserved', async () => {
  const session = new FakeSession();
  let releaseFirst;
  const firstBlocked = new Promise((resolve) => { releaseFirst = resolve; });
  const started = [];
  const finished = [];
  const runtime = {
    deliver: async (input) => {
      started.push(input.nativeEventId);
      if (input.nativeEventId === '1') await firstBlocked;
      finished.push(input.nativeEventId);
      return { ok: true };
    },
  };
  const capture = createCTraderSourceCapture({ session, runtime, accountId: 42 });
  capture.start();

  session.emit(executionEvent({ dealId: 1, timestamp: 1770000000001 }));
  session.emit(executionEvent({ dealId: 2, timestamp: 1770000000002 }));
  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual(started, ['1']);

  releaseFirst();
  await capture.drain();
  assert.deepEqual(started, ['1', '2']);
  assert.deepEqual(finished, ['1', '2']);
});

test('delivery failure is capture-local, degrades only that capture and does not stop its next event', async () => {
  const session = new FakeSession();
  const attempted = [];
  const capture = createCTraderSourceCapture({
    session,
    runtime: {
      deliver: async (input) => {
        attempted.push(input.nativeEventId);
        if (input.nativeEventId === '1') throw new Error('source-local downstream failure');
        return { ok: true };
      },
    },
    accountId: 42,
  });
  capture.start();

  session.emit(executionEvent({ dealId: 1, timestamp: 1770000000001 }));
  session.emit(executionEvent({ dealId: 2, timestamp: 1770000000002 }));
  await capture.drain();

  assert.deepEqual(attempted, ['1', '2']);
  assert.equal(capture.status().failedEvents, 1);
  assert.equal(capture.status().deliveredEvents, 1);
  assert.equal(capture.status().status, 'healthy');
});

test('blocked capture A cannot delay capture B even when both observe the same session', async () => {
  const session = new FakeSession();
  let releaseA;
  const blockedA = new Promise((resolve) => { releaseA = resolve; });
  let bDelivered = false;

  const a = createCTraderSourceCapture({
    session,
    runtime: { deliver: async () => { await blockedA; return { ok: true }; } },
    accountId: 42,
  });
  const b = createCTraderSourceCapture({
    session,
    runtime: { deliver: async () => { bDelivered = true; return { ok: true }; } },
    accountId: 99,
  });
  a.start();
  b.start();

  session.emit(executionEvent({ accountId: 42, dealId: 1 }));
  session.emit(executionEvent({ accountId: 99, dealId: 2 }));
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();

  assert.equal(bDelivered, true);
  assert.equal(a.status().deliveredEvents, 0);
  assert.equal(b.status().deliveredEvents, 1);

  releaseA();
  await Promise.all([a.drain(), b.drain()]);
});

test('start and stop are idempotent and status never exposes account credentials or runtime internals', async () => {
  const session = new FakeSession();
  let deliveries = 0;
  const capture = createCTraderSourceCapture({
    session,
    runtime: { deliver: async () => { deliveries += 1; return { ok: true }; } },
    accountId: 42,
  });

  capture.start();
  capture.start();
  session.emit(executionEvent());
  await capture.drain();
  assert.equal(deliveries, 1);

  capture.stop();
  capture.stop();
  session.emit(executionEvent({ dealId: 2 }));
  await capture.drain();
  assert.equal(deliveries, 1);

  const serialized = JSON.stringify(capture.status()).toLowerCase();
  assert.equal(serialized.includes('secret'), false);
  assert.equal(serialized.includes('token'), false);
  assert.equal(serialized.includes('password'), false);
  assert.equal(serialized.includes('credential'), false);
  assert.equal(serialized.includes('accountid'), false);
});
