import test from 'node:test';
import assert from 'node:assert/strict';
import { CTraderJsonSession } from '../src/adapters/ctrader_session.js';
import { executeCTraderAction } from '../src/adapters/ctrader_executor_v2.js';

const symbol = {
  platform: 'ctrader', platformId: 41, platformSymbol: 'XAU/USD', canonical: 'XAUUSD', aliases: ['GOLD'],
  digits: 2, tickSize: 0.01, protocolLotSize: 10000, minVolume: 100, maxVolume: 100000000, stepVolume: 100,
};

class FakeSocket {
  constructor({ readyState = 1, throwOnSend = null } = {}) {
    this.readyState = readyState;
    this.throwOnSend = throwOnSend;
    this.sent = [];
    this.listeners = new Map();
  }
  addEventListener(type, handler) {
    const list = this.listeners.get(type) || [];
    list.push(handler);
    this.listeners.set(type, list);
  }
  emit(type, event = {}) {
    for (const handler of this.listeners.get(type) || []) handler(event);
  }
  send(raw) {
    if (this.throwOnSend) throw this.throwOnSend;
    this.sent.push(JSON.parse(raw));
  }
}

function makeSession(socket, requestTimeoutMs = 10) {
  const session = new CTraderJsonSession({
    endpoint: 'wss://demo.ctraderapi.com:5036',
    clientId: 'client',
    clientSecret: 'secret',
    socketFactory: () => socket,
    heartbeatScheduler: () => 1,
    heartbeatCanceller: () => {},
    requestTimeoutMs,
  });
  session.socket = socket;
  return session;
}

function classifiedStore() {
  const state = { completed: [], retryable: [], uncertain: [], failed: [] };
  return {
    state,
    reserve: async () => ({ ok: true, duplicate: false }),
    complete: async (key, result) => state.completed.push({ key, result }),
    markRetryable: async (key, failure, options) => state.retryable.push({ key, failure, options }),
    markUncertain: async (key, failure) => state.uncertain.push({ key, failure }),
    fail: async (key, failure) => state.failed.push({ key, failure }),
  };
}

function ctraderAction(idempotencyKey) {
  return {
    type: 'OPEN_POSITION', side: 'BUY', orderType: 'LIMIT', symbol: 'XAUUSD',
    entry: { kind: 'PRICE', value: 2520 }, lots: 0.01,
    idempotencyKey,
  };
}

test('request rejected before socket send is classified RETRYABLE and transmits no bytes', async () => {
  const socket = new FakeSocket({ readyState: 0 });
  const session = makeSession(socket);

  await assert.rejects(
    session.request({ clientMsgId: 'not-sent', payloadType: 2106, payload: {} }),
    (error) => {
      assert.equal(error.deliveryFailureClass, 'RETRYABLE');
      assert.equal(error.code, 'CTRADER_NOT_SENT');
      return true;
    },
  );
  assert.equal(socket.sent.length, 0);
});

test('request timeout after successful socket send is classified UNCERTAIN', async () => {
  const socket = new FakeSocket();
  const session = makeSession(socket, 5);

  await assert.rejects(
    session.request({ clientMsgId: 'sent-timeout', payloadType: 2106, payload: {} }, { timeoutMs: 5 }),
    (error) => {
      assert.equal(error.deliveryFailureClass, 'UNCERTAIN');
      assert.equal(error.code, 'CTRADER_POST_SEND_TIMEOUT');
      return true;
    },
  );
  assert.equal(socket.sent.length, 1);
});

test('connection close with an already-sent pending request is classified UNCERTAIN', async () => {
  const socket = new FakeSocket();
  const session = makeSession(socket, 1000);
  const pending = session.request({ clientMsgId: 'sent-close', payloadType: 2106, payload: {} }, { timeoutMs: 1000 });
  assert.equal(socket.sent.length, 1);
  session.handleConnectionClosed('network lost');

  await assert.rejects(pending, (error) => {
    assert.equal(error.deliveryFailureClass, 'UNCERTAIN');
    assert.equal(error.code, 'CTRADER_POST_SEND_CONNECTION_LOST');
    return true;
  });
});

test('deterministic cTrader broker rejection is classified TERMINAL', async () => {
  const socket = new FakeSocket();
  const session = makeSession(socket, 100);
  const pending = session.request({ clientMsgId: 'broker-reject', payloadType: 2106, payload: {} }, { successPayloadTypes: [2126] });
  session.handleMessage({ data: JSON.stringify({
    clientMsgId: 'broker-reject', payloadType: 2142,
    payload: { errorCode: 'INVALID_REQUEST', description: 'bad stop' },
  }) });

  await assert.rejects(pending, (error) => {
    assert.equal(error.deliveryFailureClass, 'TERMINAL');
    assert.equal(error.code, 'INVALID_REQUEST');
    return true;
  });
});

test('executor persists safe pre-send failure as RETRYABLE without retrying inline', async () => {
  const store = classifiedStore();
  let calls = 0;
  const error = Object.assign(new Error('not sent'), { deliveryFailureClass: 'RETRYABLE', code: 'CTRADER_NOT_SENT' });

  await assert.rejects(() => executeCTraderAction(ctraderAction('retry-safe'), {
    session: { request: async () => { calls += 1; throw error; } },
    accountId: 77, catalog: [symbol], deliveryStore: store,
  }), /not sent/);

  assert.equal(calls, 1);
  assert.equal(store.state.retryable.length, 1);
  assert.equal(store.state.uncertain.length, 0);
  assert.equal(store.state.failed.length, 0);
  assert.equal(store.state.retryable[0].failure.code, 'CTRADER_NOT_SENT');
});

test('executor persists post-send ambiguity as UNCERTAIN and never retries inline', async () => {
  const store = classifiedStore();
  let calls = 0;
  const error = Object.assign(new Error('response unknown'), { deliveryFailureClass: 'UNCERTAIN', code: 'CTRADER_POST_SEND_TIMEOUT' });

  await assert.rejects(() => executeCTraderAction(ctraderAction('uncertain-send'), {
    session: { request: async () => { calls += 1; throw error; } },
    accountId: 77, catalog: [symbol], deliveryStore: store,
  }), /response unknown/);

  assert.equal(calls, 1);
  assert.equal(store.state.retryable.length, 0);
  assert.equal(store.state.uncertain.length, 1);
  assert.equal(store.state.failed.length, 0);
  assert.equal(store.state.uncertain[0].failure.code, 'CTRADER_POST_SEND_TIMEOUT');
});

test('accepted market order followed by fill wait timeout becomes UNCERTAIN even when waiter throws generic Error', async () => {
  const store = classifiedStore();
  let requestCalls = 0;
  await assert.rejects(() => executeCTraderAction({
    type: 'OPEN_POSITION', side: 'BUY', orderType: 'MARKET', symbol: 'XAUUSD', entry: { kind: 'MARKET' },
    lots: 0.01, idempotencyKey: 'accepted-no-fill',
  }, {
    session: {
      request: async () => {
        requestCalls += 1;
        return { payloadType: 2126, payload: { executionType: 2, order: { orderId: 909, clientOrderId: 'accepted-no-fill' } } };
      },
      waitForEvent: async () => { throw new Error('cTrader event wait timed out'); },
    },
    accountId: 77, catalog: [symbol], deliveryStore: store,
  }), /event wait timed out/i);

  assert.equal(requestCalls, 1);
  assert.equal(store.state.uncertain.length, 1);
  assert.equal(store.state.retryable.length, 0);
  assert.equal(store.state.failed.length, 0);
  assert.equal(store.state.uncertain[0].failure.code, 'CTRADER_FILL_STATUS_UNCERTAIN');
});

test('deterministic broker rejection remains terminal FAILED', async () => {
  const store = classifiedStore();
  const error = Object.assign(new Error('bad request'), { deliveryFailureClass: 'TERMINAL', code: 'INVALID_REQUEST' });

  await assert.rejects(() => executeCTraderAction(ctraderAction('terminal-reject'), {
    session: { request: async () => { throw error; } },
    accountId: 77, catalog: [symbol], deliveryStore: store,
  }), /bad request/);

  assert.equal(store.state.failed.length, 1);
  assert.equal(store.state.retryable.length, 0);
  assert.equal(store.state.uncertain.length, 0);
  assert.equal(store.state.failed[0].failure.code, 'INVALID_REQUEST');
});
