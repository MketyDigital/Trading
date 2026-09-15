import test from 'node:test';
import assert from 'node:assert/strict';

import { createProductionExecutionDependencies as createLegacyDeps } from '../src/execution/production_execution_deps.js';
import { createProductionExecutionDependencies as createUnifiedDeps } from '../src/execution/production_execution_deps_unified.js';

function supabaseStub() {
  return { from() { throw new Error('unexpected DB query'); } };
}

function ctraderAccount() {
  return {
    id: 'acct-c', workspace_id: 'ws-a', platform: 'ctrader', environment: 'demo',
    account_id: '48685071', sizing_mode: 'FIXED_LOTS', fixed_lots: 0.01,
    is_active: true, execution_enabled: true,
    safety_policy: { enabled: true, killSwitch: false, maxDailyLossPercent: 3, maxOpenRiskPercent: 5 },
  };
}

test('risk-reducing cTrader close does not depend on unavailable dynamic exposure context', async () => {
  let exposureCalls = 0;
  const deps = createLegacyDeps({
    env: { TRADING_MASTER_KEY: 'master' }, supabase: supabaseStub(), workspaceId: 'ws-a', tradingEventId: 'event-close',
  }, {
    exposureLoader: async () => { exposureCalls += 1; throw new Error('exposure unavailable'); },
    deliveryStoreFactory: () => ({ reserve() {}, complete() {}, fail() {} }),
  });

  const result = await deps.riskMaterializer({
    workspaceId: 'ws-a',
    account: ctraderAccount(),
    action: { type: 'CLOSE_POSITION', symbol: 'GBPUSD', brokerPositionId: '136560498', lots: 0.01 },
  });

  assert.equal(exposureCalls, 0);
  assert.equal(result.allowed, true);
});

test('risk-increasing OPEN still fails closed when dynamic exposure context is unavailable', async () => {
  let exposureCalls = 0;
  const deps = createLegacyDeps({
    env: { TRADING_MASTER_KEY: 'master' }, supabase: supabaseStub(), workspaceId: 'ws-a', tradingEventId: 'event-open',
  }, {
    exposureLoader: async () => { exposureCalls += 1; throw new Error('exposure unavailable'); },
    deliveryStoreFactory: () => ({ reserve() {}, complete() {}, fail() {} }),
  });

  await assert.rejects(() => deps.riskMaterializer({
    workspaceId: 'ws-a',
    account: ctraderAccount(),
    action: { type: 'OPEN_POSITION', symbol: 'GBPUSD', side: 'BUY', orderType: 'MARKET', lots: 0.01 },
  }), /exposure unavailable/);
  assert.equal(exposureCalls, 1);
});

function mt5Account() {
  return {
    id: 'acct-m', workspace_id: 'ws-a', platform: 'mt5', provider_mode: 'mt5_connector',
    account_id: '213921698', server_name: 'Deriv-Demo', environment: 'demo', sizing_mode: 'FIXED_LOTS',
    provider_config: {
      status: 'connected',
      symbolCatalog: [{ platformSymbol: 'XAUUSD', canonical: 'XAUUSD', aliases: ['GOLD'], tradable: true, minLots: 0.01, maxLots: 100, stepLots: 0.01, tickSize: 0.01, digits: 2 }],
    },
    credential_ciphertext: 'cipher', is_active: true, execution_enabled: true,
    safety_policy: { enabled: true, killSwitch: false, maxDailyLossPercent: 3, maxOpenRiskPercent: 5 },
  };
}

test('MT5 BE uses fresh broker market context without dynamic exposure dependency', async () => {
  let exposureCalls = 0;
  const fetchFn = async (url) => {
    if (url.endsWith('/v1/mt5-connections/acct-m')) {
      return new Response(JSON.stringify({
        ok: true, online: true, accountRowId: 'acct-m',
        identity: { accountNumber: '213921698', serverName: 'Deriv-Demo', isLive: false, symbols: mt5Account().provider_config.symbolCatalog },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    return new Response(JSON.stringify({
      ok: true, accountRowId: 'acct-m',
      context: {
        account: { accountNumber: '213921698', serverName: 'Deriv-Demo' },
        symbol: { platformSymbol: 'XAUUSD', minLots: 0.01, maxLots: 100, stepLots: 0.01, tickSize: 0.01, digits: 2 },
        tick: { bid: 4307, ask: 4307.2, last: 4307.1 },
      },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };

  const deps = createUnifiedDeps({
    env: { TRADING_MASTER_KEY: 'master' }, supabase: supabaseStub(), workspaceId: 'ws-a', tradingEventId: 'event-be',
  }, {
    exposureLoader: async () => { exposureCalls += 1; throw new Error('exposure unavailable'); },
    decryptCredentialsFn: async () => ({ gatewayUrl: 'https://gateway.example:25345', controlSecret: 'secret' }),
    deliveryStoreFactory: () => ({ reserve() {}, complete() {}, fail() {} }),
    fetchFn,
  });

  const result = await deps.riskMaterializer({
    workspaceId: 'ws-a', account: mt5Account(),
    action: {
      type: 'MODIFY_POSITION', managementType: 'MOVE_SL_TO_BE', brokerPositionId: '5700448668',
      symbol: 'XAUUSD', side: 'BUY', entryPrice: 4306.45, stopLoss: 4306.45,
    },
  });

  assert.equal(exposureCalls, 0);
  assert.equal(result.allowed, true);
});
