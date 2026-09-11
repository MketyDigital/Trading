import test from 'node:test';
import assert from 'node:assert/strict';

import { createProductionExecutionDependencies } from '../src/execution/production_execution_deps_unified.js';

function account() {
  return {
    id: 'acct-mt5-risk', workspace_id: 'ws-a', platform: 'mt5', provider_mode: 'mt5_connector',
    account_id: '50123456', server_name: 'Broker-Demo', environment: 'demo',
    sizing_mode: 'RISK_PERCENT', risk_percent: 1,
    provider_config: {
      status: 'connected',
      symbolCatalog: [{
        platformSymbol: 'XAUUSD.r', canonical: 'XAUUSD', aliases: ['GOLD'], tradable: true,
        minLots: 0.01, maxLots: 100, stepLots: 0.01, tickSize: 0.01, tickValueLoss: 1.2, digits: 2,
      }],
    },
    credential_ciphertext: 'connector-cipher', is_active: true, execution_enabled: true,
    safety_policy: { killSwitch: false },
  };
}

test('risk-percent MT5 connector revalidates against fresh account equity, symbol economics and tick over outbound gateway', async () => {
  const requests = [];
  const deps = createProductionExecutionDependencies({
    env: { TRADING_MASTER_KEY: 'master' },
    supabase: { from() { throw new Error('unexpected DB query'); } },
    workspaceId: 'ws-a', tradingEventId: 'event-1',
  }, {
    decryptCredentialsFn: async (kind) => {
      assert.equal(kind, 'mt5_connector');
      return { gatewayUrl: 'https://gateway.example:25345', controlSecret: 'control-secret' };
    },
    deliveryStoreFactory: () => ({ reserve() {}, complete() {}, fail() {} }),
    fetchFn: async (url, options) => {
      requests.push({ url, options });
      assert.equal(options.headers.Authorization, 'Bearer control-secret');
      if (url.endsWith('/v1/mt5-connections/acct-mt5-risk')) {
        return new Response(JSON.stringify({
          ok: true, online: true, accountRowId: 'acct-mt5-risk',
          identity: {
            accountNumber: '50123456', serverName: 'Broker-Demo', isLive: false,
            symbols: [{
              platformSymbol: 'XAUUSD.r', canonical: 'XAUUSD', aliases: ['GOLD'], tradable: true,
              minLots: 0.01, maxLots: 100, stepLots: 0.01, tickSize: 0.01, tickValueLoss: 1.2, digits: 2,
            }],
          },
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      assert.match(url, /\/v1\/mt5-context\/acct-mt5-risk\?symbol=XAUUSD\.r$/);
      return new Response(JSON.stringify({
        ok: true, accountRowId: 'acct-mt5-risk',
        context: {
          account: { accountNumber: '50123456', serverName: 'Broker-Demo', balance: 10000, equity: 10000 },
          symbol: {
            platformSymbol: 'XAUUSD.r', minLots: 0.01, maxLots: 100, stepLots: 0.01,
            tickSize: 0.01, tickValueLoss: 1.2, tickValue: 1.2, digits: 2,
          },
          tick: { ask: 2500.5, bid: 2500.4, last: 2500.45 },
        },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    },
  });

  const action = {
    type: 'OPEN_POSITION', symbol: 'GOLD', side: 'BUY', orderType: 'MARKET', lots: 0.01,
    stopLoss: 2499.5, idempotencyKey: 'event-1:acct-mt5-risk:1',
  };
  const result = await deps.riskMaterializer({ workspaceId: 'ws-a', account: account(), action });

  assert.equal(result.allowed, true);
  assert.equal(result.action.lots, 0.01);
  assert.equal(result.risk != null, true);
  assert.equal(result.risk.riskAmount, 100);
  assert.equal(requests.length, 2);
});
