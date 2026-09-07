import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTraderMessage, buildSubscribeSpotsMessage } from '../src/adapters/ctrader_protocol.js';
import { CTraderMarketData } from '../src/adapters/ctrader_market_data.js';

test('builds official trader/account metadata request', () => {
  assert.deepEqual(buildTraderMessage({ clientMsgId: 't1', accountId: 77 }), {
    clientMsgId: 't1', payloadType: 2121, payload: { ctidTraderAccountId: 77 },
  });
});

test('loads light symbols then full symbol metadata into canonical catalog', async () => {
  const calls = [];
  const session = {
    nextClientMsgId(prefix) { return `${prefix}-${calls.length + 1}`; },
    async request(message) {
      calls.push(message);
      if (message.payloadType === 2114) return { payloadType: 2115, payload: { symbol: [
        { symbolId: 41, symbolName: 'EUR/USD', enabled: true },
        { symbolId: 42, symbolName: 'XAU/USD', enabled: true },
      ] } };
      if (message.payloadType === 2116) return { payloadType: 2117, payload: { symbol: [
        { symbolId: 41, digits: 5, pipPosition: 4, lotSize: 10000000, minVolume: 100000, maxVolume: 100000000, stepVolume: 100000, tradingMode: 0 },
        { symbolId: 42, digits: 2, pipPosition: 1, lotSize: 10000, minVolume: 100, maxVolume: 5000000, stepVolume: 100, tradingMode: 0 },
      ] } };
      throw new Error(`unexpected payload ${message.payloadType}`);
    },
  };
  const data = new CTraderMarketData({ session, accountId: 77 });
  const catalog = await data.loadCatalog();
  assert.equal(catalog.length, 2);
  assert.equal(catalog[0].canonical, 'EURUSD');
  assert.equal(catalog[0].protocolLotSize, 10000000);
  assert.equal(catalog[0].lotSizeUnits, 100000);
  assert.equal(catalog[1].canonical, 'XAUUSD');
  assert.deepEqual(calls.map((m) => m.payloadType), [2114, 2116]);
});

test('loads cTrader account type and trading access', async () => {
  const session = {
    nextClientMsgId() { return 'trader-1'; },
    async request(message) {
      assert.equal(message.payloadType, 2121);
      return { payloadType: 2122, payload: { trader: { ctidTraderAccountId: 77, accountType: 0, accessRights: 0, isLimitedRisk: false } } };
    },
  };
  const account = await new CTraderMarketData({ session, accountId: 77 }).loadAccount();
  assert.equal(account.accountType, 'HEDGED');
  assert.equal(account.accessRights, 'FULL_ACCESS');
  assert.equal(account.canOpenTrades, true);
});

test('subscribes to quotes and uses ask for BUY and bid for SELL', async () => {
  let subscription;
  const session = {
    nextClientMsgId() { return 'spot-1'; },
    async request(message) { subscription = message; return { payloadType: 2128, payload: { ctidTraderAccountId: 77 } }; },
  };
  const data = new CTraderMarketData({ session, accountId: 77 });
  data.catalog = [{ platformId: 42, platformSymbol: 'XAU/USD', canonical: 'XAUUSD', digits: 2 }];
  await data.subscribeQuotes([42]);
  data.handleSpotEvent({ payloadType: 2131, payload: { ctidTraderAccountId: 77, symbolId: 42, bid: 252612345, ask: 252632345, timestamp: 1700000000000 } });
  assert.deepEqual(subscription, buildSubscribeSpotsMessage({ clientMsgId: 'spot-1', accountId: 77, symbolIds: [42] }));
  assert.deepEqual(data.quoteFor(42), { bid: 2526.12, ask: 2526.32, timestamp: 1700000000000 });
  assert.equal(data.marketPriceFor('XAUUSD', 'BUY'), 2526.32);
  assert.equal(data.marketPriceFor('XAUUSD', 'SELL'), 2526.12);
});
