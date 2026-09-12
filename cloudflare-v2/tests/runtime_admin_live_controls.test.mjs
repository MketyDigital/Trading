import test from 'node:test';
import assert from 'node:assert/strict';

import { handleMketyAdminAccessCodesRequest } from '../src/http/v1_mkety_admin_access_codes.js';
import { handleAuthorizedV1AdminAccountsRequest } from '../src/http/v1_admin_accounts.js';
import { withEnterpriseLiveExecutionControls } from '../src/dashboard_live_execution_controls.js';

function runtimeStore(seed = {}) {
  const state = { trading: seed.trading ?? true, broker: seed.broker ?? true, live: seed.live ?? false };
  return {
    state,
    async getTradingAccessEnabled() { return { ok: true, enabled: state.trading }; },
    async setTradingAccessEnabled(v) { state.trading = Boolean(v); return { ok: true, enabled: state.trading }; },
    async getBrokerExecutionEnabled() { return { ok: true, enabled: state.broker }; },
    async setBrokerExecutionEnabled(v) { state.broker = Boolean(v); return { ok: true, enabled: state.broker }; },
    async getLiveBrokerExecutionEnabled() { return { ok: true, enabled: state.live }; },
    async setLiveBrokerExecutionEnabled(v) { state.live = Boolean(v); return { ok: true, enabled: state.live }; },
  };
}

const auth = { workspace: { id: 'ws-1' }, membership: { role: 'owner' } };

test('staff admin reads and partially updates all three DB runtime controls', async () => {
  const store = runtimeStore();
  const env = { MKETY_TRADING_ADMIN_SECRET: 'secret' };
  const headers = { 'X-Mkety-Admin-Secret': 'secret' };
  const first = await handleMketyAdminAccessCodesRequest(new Request('https://trade.mkety.com/api/v1/mkety-admin/runtime-controls', { headers }), env, { store: {}, runtimeStore: store });
  const before = await first.json();
  assert.equal(before.tradingAccessEnabled, true);
  assert.equal(before.brokerExecutionEnabled, true);
  assert.equal(before.liveBrokerExecutionEnabled, false);
  assert.equal(before.effectiveLiveBrokerExecutionEnabled, false);

  const patch = await handleMketyAdminAccessCodesRequest(new Request('https://trade.mkety.com/api/v1/mkety-admin/runtime-controls', {
    method: 'PATCH', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ liveBrokerExecutionEnabled: true }),
  }), env, { store: {}, runtimeStore: store });
  assert.equal(patch.status, 200);
  const after = await patch.json();
  assert.equal(after.liveBrokerExecutionEnabled, true);
  assert.equal(after.effectiveLiveBrokerExecutionEnabled, true);
  assert.equal(store.state.trading, true);
  assert.equal(store.state.broker, true);
});

test('per-account live switch cannot arm demo and can arm verified live account', async () => {
  let row = { id: 'a1', workspace_id: 'ws-1', environment: 'demo', live_execution_enabled: false };
  const accountStore = {
    async setLiveExecutionEnabled(_ws, _id, enabled) {
      if (enabled && row.environment !== 'live') { const e = new Error('LIVE_EXECUTION_REQUIRES_LIVE_ACCOUNT'); e.code = 'LIVE_EXECUTION_REQUIRES_LIVE_ACCOUNT'; throw e; }
      row = { ...row, live_execution_enabled: enabled }; return row;
    },
  };
  const demo = await handleAuthorizedV1AdminAccountsRequest(new Request('https://trade.mkety.com/api/v1/admin/accounts/a1/live-execution', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: true }),
  }), auth, { accountStore });
  assert.equal(demo.status, 409);
  assert.equal((await demo.json()).reason, 'LIVE_EXECUTION_REQUIRES_LIVE_ACCOUNT');

  row = { ...row, environment: 'live' };
  const live = await handleAuthorizedV1AdminAccountsRequest(new Request('https://trade.mkety.com/api/v1/admin/accounts/a1/live-execution', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: true }),
  }), auth, { accountStore });
  assert.equal(live.status, 200);
  assert.equal((await live.json()).account.liveExecutionEnabled, true);
});

test('enterprise portal enhancement exposes one-click live control and confirmation', () => {
  const html = withEnterpriseLiveExecutionControls('<html><body></body></html>');
  assert.match(html, /data-account-live/);
  assert.match(html, /\/live-execution/);
  assert.match(html, /confirm\(/);
  assert.match(html, /DEMO accounts never need this switch/);
});
