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
      throw new Error(`unexpected payload ${message.payloadType}`);
    },
  };
}

test('bootstraps demo cTrader session, account rights and live account symbol catalog before execution is available', async () => {
  const session = fakeSession();
  const runtime = await createCTraderRuntime({
    environment: 'demo',
    clientId: 'client-id',
    clientSecret: 'client-secret',
    accessToken: 'access-token',
    accountId: 77,
    sessionFactory: ({ endpoint }) => {
      assert.equal(endpoint, 'wss://demo.ctraderapi.com:5036');
      return session;
    },
    deliveryStore: { reserve: async () => ({ ok: true }), complete: async () => {}, fail: async () => {} },
  });

  assert.deepEqual(session.calls.slice(0, 2), ['open', ['account-auth', 77, 'access-token']]);
  assert.equal(runtime.account.canOpenTrades, true);
  assert.equal(runtime.account.accountType, 'HEDGED');
  assert.equal(runtime.catalog.length, 1);
  assert.equal(runtime.catalog[0].canonical, 'XAUUSD');
  assert.equal(runtime.ready, true);
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
