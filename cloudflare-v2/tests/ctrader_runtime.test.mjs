import test from 'node:test';
import assert from 'node:assert/strict';
import { createCTraderRuntime } from '../src/adapters/ctrader_runtime.js';

function fakeSession() {
  const calls = [];
  return {
    calls,
    nextClientMsgId(prefix) { return `${prefix}-1`; },
    async open() { calls.push('open'); return this; },
    async authenticateAccount(accountId, token) { calls.push(['account-auth', Number(accountId), token]); },
    async request(message) {
      calls.push(['request', message.payloadType]);
      if (message.payloadType === 2121) {
        return { payloadType: 2122, payload: { trader: { ctidTraderAccountId: 77, accountType: 0, accessRights: 0 } } };
      }
      if (message.payloadType === 2114) {
        return { payloadType: 2115, payload: { symbol: [{ symbolId: 41, symbolName: 'XAU/USD', enabled: true }] } };
      }
      if (message.payloadType === 2116) {
        return { payloadType: 2117, payload: { symbol: [{ symbolId: 41, symbolName: 'XAU/USD', digits: 2, lotSize: 10000, minVolume: 100, maxVolume: 100000000, stepVolume: 100 }] } };
      }
      if (message.payloadType === 2127) {
        return { payloadType: 2128, payload: { ctidTraderAccountId: 77 } };
      }
      throw new Error(`unexpected payload ${message.payloadType}`);
    },
    async waitForEvent(predicate) {
      const event = {
        payloadType: 2131,
        payload: {
          ctidTraderAccountId: 77,
          symbolId: 41,
          bid: 430590000,
          ask: 430610000,
          timestamp: 1700000000000,
        },
      };
      assert.equal(predicate(event), true);
      return event;
    },
  };
}

function runtimeOptions(session) {
  return {
    environment: 'demo',
    clientId: 'client-id',
    clientSecret: 'client-secret',
    accessToken: 'access-token',
    accountId: 77,
    sessionFactory: () => session,
    deliveryStore: { reserve: async () => ({ ok: true }), complete: async () => {}, fail: async () => {} },
  };
}

function beAction() {
  return {
    type: 'MODIFY_POSITION',
    managementType: 'MOVE_SL_TO_BE',
    brokerPositionId: '136564456',
    symbol: 'XAUUSD',
    side: 'BUY',
    entryPrice: 4306.45,
    stopLoss: 4306.45,
    idempotencyKey: 'be-1',
  };
}

test('bootstraps demo cTrader session, account rights and live account symbol catalog before execution is available', async () => {
  const session = fakeSession();
  const runtime = await createCTraderRuntime({
    ...runtimeOptions(session),
    sessionFactory: ({ endpoint }) => {
      assert.equal(endpoint, 'wss://demo.ctraderapi.com:5036');
      return session;
    },
  });

  assert.deepEqual(session.calls.slice(0, 2), ['open', ['account-auth', 77, 'access-token']]);
  assert.equal(runtime.account.canOpenTrades, true);
  assert.equal(runtime.account.accountType, 'HEDGED');
  assert.equal(runtime.catalog.length, 1);
  assert.equal(runtime.catalog[0].canonical, 'XAUUSD');
  assert.equal(runtime.ready, true);
});

test('cTrader BE command is safely blocked before dispatch when stop-trigger price has not crossed entry', async () => {
  const session = fakeSession();
  const runtime = await createCTraderRuntime(runtimeOptions(session));

  const result = await runtime.execute(beAction());

  assert.deepEqual(result, {
    ok: false,
    blocked: true,
    code: 'BREAK_EVEN_NOT_ELIGIBLE_YET',
    entryPrice: 4306.45,
    marketPrice: 4305.9,
  });
  assert.equal(session.calls.some((call) => Array.isArray(call) && call[1] === 2127), true);
});

test('cTrader BE ignores a stale profitable cached quote and waits for a fresh stop-trigger quote', async () => {
  const session = fakeSession();
  const runtime = await createCTraderRuntime(runtimeOptions(session));
  runtime.marketData.quotes.set(41, { bid: 9999, ask: 10000, timestamp: 1 });

  const result = await runtime.execute(beAction());

  assert.equal(result.blocked, true);
  assert.equal(result.code, 'BREAK_EVEN_NOT_ELIGIBLE_YET');
  assert.equal(result.marketPrice, 4305.9);
});

test('cTrader BE fails closed as context-unavailable when no fresh quote can be obtained', async () => {
  const session = fakeSession();
  session.waitForEvent = async () => { throw new Error('quote timeout'); };
  const runtime = await createCTraderRuntime(runtimeOptions(session));

  const result = await runtime.execute(beAction());

  assert.equal(result.blocked, true);
  assert.equal(result.code, 'BREAK_EVEN_CONTEXT_UNAVAILABLE');
});

test('fails closed when cTrader account is close-only/no-trading', async () => {
  const session = fakeSession();
  session.request = async (message) => {
    if (message.payloadType === 2121) {
      return { payloadType: 2122, payload: { trader: { ctidTraderAccountId: 77, accountType: 0, accessRights: 1 } } };
    }
    throw new Error('catalog must not load for non-trading account');
  };

  await assert.rejects(() => createCTraderRuntime({
    clientId: 'client-id', clientSecret: 'client-secret', accessToken: 'access-token', accountId: 77,
    sessionFactory: () => session,
    deliveryStore: { reserve: async () => ({ ok: true }), complete: async () => {}, fail: async () => {} },
  }), /does not allow opening trades/i);
});

test('live environment requires an explicit runtime opt-in', async () => {
  await assert.rejects(() => createCTraderRuntime({
    environment: 'live', clientId: 'client-id', clientSecret: 'client-secret', accessToken: 'access-token', accountId: 77,
    sessionFactory: () => fakeSession(),
    deliveryStore: { reserve: async () => ({ ok: true }), complete: async () => {}, fail: async () => {} },
  }), /live cTrader runtime is disabled/i);
});
