import test from 'node:test';
import assert from 'node:assert/strict';
import { CTraderJsonSession } from '../src/adapters/ctrader_session.js';

class FakeSocket {
  constructor() {
    this.readyState = 0;
    this.sent = [];
    this.listeners = new Map();
    this.onSend = null;
  }
  addEventListener(type, handler) {
    const list = this.listeners.get(type) || [];
    list.push(handler);
    this.listeners.set(type, list);
  }
  removeEventListener(type, handler) {
    const list = this.listeners.get(type) || [];
    this.listeners.set(type, list.filter((item) => item !== handler));
  }
  emit(type, event = {}) {
    for (const handler of this.listeners.get(type) || []) handler(event);
  }
  open() {
    this.readyState = 1;
    this.emit('open', {});
  }
  send(raw) {
    const parsed = JSON.parse(raw);
    this.sent.push(parsed);
    if (this.onSend) this.onSend(parsed, this);
  }
  message(payload) {
    this.emit('message', { data: JSON.stringify(payload) });
  }
  close() {
    this.readyState = 3;
    this.emit('close', {});
  }
}

test('authenticates application before account and correlates responses by clientMsgId', async () => {
  const socket = new FakeSocket();
  socket.onSend = (message, ws) => {
    if (message.payloadType === 2100) queueMicrotask(() => ws.message({ clientMsgId: message.clientMsgId, payloadType: 2101, payload: {} }));
    if (message.payloadType === 2102) queueMicrotask(() => ws.message({ clientMsgId: message.clientMsgId, payloadType: 2103, payload: { ctidTraderAccountId: 123 } }));
  };

  const session = new CTraderJsonSession({
    endpoint: 'wss://demo.ctraderapi.com:5036',
    clientId: 'client',
    clientSecret: 'secret',
    socketFactory: () => socket,
    heartbeatScheduler: () => 1,
    heartbeatCanceller: () => {},
  });

  const opening = session.open();
  socket.open();
  await opening;
  await session.authenticateAccount(123, 'access-token');

  assert.equal(socket.sent[0].payloadType, 2100);
  assert.equal(socket.sent[1].payloadType, 2102);
  assert.equal(session.isApplicationAuthenticated, true);
  assert.equal(session.authenticatedAccounts.has(123), true);
});

test('sends heartbeat payload 51 through the configured scheduler', async () => {
  const socket = new FakeSocket();
  let heartbeatFn;
  socket.onSend = (message, ws) => {
    if (message.payloadType === 2100) queueMicrotask(() => ws.message({ clientMsgId: message.clientMsgId, payloadType: 2101, payload: {} }));
  };
  const session = new CTraderJsonSession({
    endpoint: 'wss://demo.ctraderapi.com:5036', clientId: 'c', clientSecret: 's', socketFactory: () => socket,
    heartbeatScheduler: (fn) => { heartbeatFn = fn; return 1; }, heartbeatCanceller: () => {},
  });
  const opening = session.open();
  socket.open();
  await opening;
  heartbeatFn();
  assert.equal(socket.sent.at(-1).payloadType, 51);
});

test('resolves execution requests from ProtoOAExecutionEvent and rejects broker errors', async () => {
  const socket = new FakeSocket();
  socket.onSend = (message, ws) => {
    if (message.payloadType === 2100) queueMicrotask(() => ws.message({ clientMsgId: message.clientMsgId, payloadType: 2101, payload: {} }));
    if (message.payloadType === 2106) queueMicrotask(() => ws.message({ clientMsgId: message.clientMsgId, payloadType: 2126, payload: { executionType: 3, position: { positionId: 456 } } }));
    if (message.payloadType === 2110) queueMicrotask(() => ws.message({ clientMsgId: message.clientMsgId, payloadType: 2142, payload: { errorCode: 'INVALID_REQUEST', description: 'bad stop' } }));
  };
  const session = new CTraderJsonSession({
    endpoint: 'wss://demo.ctraderapi.com:5036', clientId: 'c', clientSecret: 's', socketFactory: () => socket,
    heartbeatScheduler: () => 1, heartbeatCanceller: () => {},
  });
  const opening = session.open(); socket.open(); await opening;

  const execution = await session.request({ clientMsgId: 'order-1', payloadType: 2106, payload: {} }, { successPayloadTypes: [2126] });
  assert.equal(execution.payload.position.positionId, 456);

  await assert.rejects(
    session.request({ clientMsgId: 'amend-1', payloadType: 2110, payload: {} }, { successPayloadTypes: [2126] }),
    /INVALID_REQUEST.*bad stop/
  );
});

test('waitForEvent consumes an already-buffered fill so fast server events cannot be missed', async () => {
  const session = new CTraderJsonSession({
    endpoint: 'wss://demo.ctraderapi.com:5036', clientId: 'c', clientSecret: 's',
    socketFactory: () => new FakeSocket(), heartbeatScheduler: () => 1, heartbeatCanceller: () => {},
  });
  session.handleMessage({ data: JSON.stringify({
    payloadType: 2126,
    payload: { executionType: 3, order: { orderId: 1001 }, position: { positionId: 456 } },
  }) });
  const event = await session.waitForEvent(
    (message) => message.payloadType === 2126 && message.payload?.order?.orderId === 1001 && message.payload?.executionType === 3,
    { timeoutMs: 50 }
  );
  assert.equal(event.payload.position.positionId, 456);
});

test('waitForEvent resolves future server fill events that do not carry clientMsgId', async () => {
  const session = new CTraderJsonSession({
    endpoint: 'wss://demo.ctraderapi.com:5036', clientId: 'c', clientSecret: 's',
    socketFactory: () => new FakeSocket(), heartbeatScheduler: () => 1, heartbeatCanceller: () => {},
  });
  const waiting = session.waitForEvent(
    (message) => message.payloadType === 2126 && message.payload?.deal?.orderId === 1002,
    { timeoutMs: 100 }
  );
  queueMicrotask(() => session.handleMessage({ data: JSON.stringify({
    payloadType: 2126,
    payload: { executionType: 3, deal: { orderId: 1002, positionId: 457 }, position: { positionId: 457 } },
  }) }));
  const event = await waiting;
  assert.equal(event.payload.position.positionId, 457);
});

test('fails requests and event waiters when socket closes instead of leaving trading commands unresolved', async () => {
  const socket = new FakeSocket();
  socket.onSend = (message, ws) => {
    if (message.payloadType === 2100) queueMicrotask(() => ws.message({ clientMsgId: message.clientMsgId, payloadType: 2101, payload: {} }));
  };
  const session = new CTraderJsonSession({
    endpoint: 'wss://demo.ctraderapi.com:5036', clientId: 'c', clientSecret: 's', socketFactory: () => socket,
    heartbeatScheduler: () => 1, heartbeatCanceller: () => {}, requestTimeoutMs: 1000,
  });
  const opening = session.open(); socket.open(); await opening;
  const pending = session.request({ clientMsgId: 'close-me', payloadType: 2111, payload: {} }, { successPayloadTypes: [2126] });
  const waiter = session.waitForEvent(() => false, { timeoutMs: 1000 });
  socket.close();
  await assert.rejects(pending, /connection closed/i);
  await assert.rejects(waiter, /connection closed/i);
});
