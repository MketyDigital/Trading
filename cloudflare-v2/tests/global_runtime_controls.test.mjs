import test from 'node:test';
import assert from 'node:assert/strict';

import { handleMketyAdminAccessCodesRequest } from '../src/http/v1_mkety_admin_access_codes.js';
import { renderMketyAdminAccessCodesPage } from '../src/dashboard_mkety_admin_access_codes.js';
import { runV1ProductionExecutionStage } from '../src/pipeline/v1_execution_stage.js';

const adminEnv = { MKETY_TRADING_ADMIN_SECRET: 'admin-secret' };

function runtimeStoreState({ trading = true, broker = true } = {}) {
  let tradingEnabled = trading;
  let brokerEnabled = broker;
  return {
    async getTradingAccessEnabled() { return { ok: true, enabled: tradingEnabled, updatedAt: null, updatedBy: 'test' }; },
    async setTradingAccessEnabled(next) { tradingEnabled = next === true; return { ok: true, enabled: tradingEnabled, updatedAt: null, updatedBy: 'test' }; },
    async getBrokerExecutionEnabled() { return { ok: true, enabled: brokerEnabled, updatedAt: null, updatedBy: 'test' }; },
    async setBrokerExecutionEnabled(next) { brokerEnabled = next === true; return { ok: true, enabled: brokerEnabled, updatedAt: null, updatedBy: 'test' }; },
  };
}

test('staff runtime API reads both persisted global switches and effective broker state', async () => {
  const response = await handleMketyAdminAccessCodesRequest(new Request('https://trade.mkety.com/api/v1/mkety-admin/runtime-controls', {
    headers: { 'X-Mkety-Admin-Secret': 'admin-secret' },
  }), adminEnv, { store: {}, runtimeStore: runtimeStoreState({ trading: false, broker: true }) });

  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.tradingAccessEnabled, false);
  assert.equal(body.brokerExecutionEnabled, true);
  assert.equal(body.effectiveBrokerExecutionEnabled, false);
});

test('staff runtime API can update trading access independently without redeploy', async () => {
  const runtimeStore = runtimeStoreState({ trading: true, broker: true });
  const response = await handleMketyAdminAccessCodesRequest(new Request('https://trade.mkety.com/api/v1/mkety-admin/runtime-controls', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', 'X-Mkety-Admin-Secret': 'admin-secret' },
    body: JSON.stringify({ tradingAccessEnabled: false }),
  }), adminEnv, { store: {}, runtimeStore });

  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.tradingAccessEnabled, false);
  assert.equal(body.brokerExecutionEnabled, true);
  assert.equal(body.effectiveBrokerExecutionEnabled, false);
});

test('execution stage obeys persisted global trading switch rather than deployment TRADING_ACCESS_ENABLED', async () => {
  let brokerResolverCalled = false;
  const execution = await runV1ProductionExecutionStage({
    env: { TRADING_ACCESS_ENABLED: 'true' },
    supabase: { from() {} },
    result: { ok: true, duplicate: false, eventId: 'event-1', event: { workspace_hint: 'workspace-1' } },
    simulation: { status: 'SIMULATED', accounts: [{ accountId: 'account-1', status: 'READY', actions: [{ type: 'OPEN_POSITION', symbol: 'XAUUSD' }] }] },
    tradingAccessControlResolver: async () => ({ ok: true, enabled: false }),
    brokerExecutionControlResolver: async () => { brokerResolverCalled = true; return { ok: true, enabled: true }; },
  });

  assert.equal(execution.executionEnabled, false);
  assert.equal(execution.status, 'TRADING_ACCESS_DISABLED');
  assert.equal(brokerResolverCalled, false);
});

test('staff frontend exposes simple persisted controls for trading system and broker execution', () => {
  const html = renderMketyAdminAccessCodesPage();
  assert.match(html, /Global runtime controls/i);
  assert.match(html, /Trading system/i);
  assert.match(html, /Turn trading system OFF/i);
  assert.match(html, /Turn trading system ON/i);
  assert.match(html, /Broker execution/i);
  assert.match(html, /tradingAccessEnabled/);
  assert.match(html, /brokerExecutionEnabled/);
  assert.doesNotMatch(html, /deployment capability must be available/i);
});
