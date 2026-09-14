import test from 'node:test';
import assert from 'node:assert/strict';

import { discoverCTraderAccounts } from '../src/http/v1_admin_connections.js';

function sessionFor(environment) {
  let sequence = 0;
  return {
    async open() {},
    close() {},
    nextClientMsgId(prefix = 'msg') { sequence += 1; return `${prefix}-${sequence}`; },
    async authenticateAccount(accountId, accessToken) {
      assert.equal(environment, 'demo');
      assert.equal(accountId, 48685071);
      assert.equal(accessToken, 'access-token');
    },
    async request(message) {
      if (message.payloadType === 2149) {
        return {
          payloadType: 2150,
          payload: {
            ctidTraderAccount: environment === 'demo'
              ? [{ ctidTraderAccountId: 48685071, isLive: false, traderLogin: 2551456, brokerTitleShort: 'Deriv' }]
              : [],
          },
        };
      }
      if (message.payloadType === 2114) {
        return {
          payloadType: 2115,
          payload: {
            symbol: [
              { symbolId: 41, symbolName: 'XAU/USD', enabled: true },
              { symbolId: 75, symbolName: 'Volatility 75 (1s) Index', enabled: true },
            ],
          },
        };
      }
      if (message.payloadType === 2116) {
        return {
          payloadType: 2117,
          payload: {
            symbol: [
              { symbolId: 41, symbolName: 'XAU/USD', digits: 2, lotSize: 10000, minVolume: 100, maxVolume: 100000000, stepVolume: 100 },
              { symbolId: 75, symbolName: 'Volatility 75 (1s) Index', digits: 2, lotSize: 10000, minVolume: 100, maxVolume: 100000000, stepVolume: 100 },
            ],
          },
        };
      }
      throw new Error(`unexpected payload ${message.payloadType}`);
    },
  };
}

test('cTrader OAuth discovery returns the authenticated broker symbol catalog for generic routing', async () => {
  const accounts = await discoverCTraderAccounts('access-token', {
    CTRADER_CLIENT_ID: 'client-id',
    CTRADER_CLIENT_SECRET: 'client-secret',
  }, {
    sessionFactory: (environment) => sessionFor(environment),
  });

  assert.equal(accounts.length, 1);
  assert.equal(accounts[0].ctidTraderAccountId, '48685071');
  assert.ok(Array.isArray(accounts[0].symbolCatalog));
  assert.ok(accounts[0].symbolCatalog.length >= 2);
  assert.equal(accounts[0].symbolCatalog.some((row) => row.canonical === 'XAUUSD'), true);
  assert.equal(accounts[0].symbolCatalog.some((row) => row.canonical === 'DERIV:VOLATILITY_75_1S'), true);
});
