import test from 'node:test';
import assert from 'node:assert/strict';

import { handleTradingAccessCodeRedeemRequest } from '../src/http/v1_access_codes.js';
import { renderEnterpriseTradingPortal } from '../src/dashboard_enterprise_portal.js';
import { runV1ProductionExecutionStage } from '../src/pipeline/v1_execution_stage.js';
import { handleMketyAdminAccessCodesRequest } from '../src/http/v1_mkety_admin_access_codes.js';

const workspaceId = '11111111-1111-4111-8111-111111111111';
const sessionSecret = 'test-session-secret';

function restoredOwner() {
  return {
    ok: true,
    workspace: { id: workspaceId, name: 'Ace Trading Desk', owner_email: 'owner@example.com' },
    membership: { subject: 'access-code:owner@example.com', role: 'owner', enabled: true },
    entitlements: { tradingExecutionDestination: true, telegramDestination: true, liveExecution: false, brokerModes: ['demo'] },
  };
}

function readySimulation() {
  return {
    status: 'SIMULATED',
    accounts: [{ accountId: 'account-1', status: 'READY', actions: [{ type: 'OPEN_POSITION', symbol: 'XAUUSD' }] }],
  };
}

const ingestResult = {
  ok: true,
  duplicate: false,
  eventId: 'event-1',
  event: { workspace_hint: workspaceId },
};

test('access-code onboarding issues an HttpOnly refresh cookie for returning owner access', async () => {
  const response = await handleTradingAccessCodeRedeemRequest(new Request('https://trade.mkety.com/api/v1/access/redeem', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code: 'TRD-MKETY-TEST', ownerEmail: 'owner@example.com' }),
  }), {
    TRADING_ACCESS_CODE_REDEMPTION_ENABLED: 'true',
    TRADING_ACCESS_CODE_SESSION_SECRET: sessionSecret,
  }, {
    nowSec: 1800000000,
    supabaseFactory: async () => ({ from() {} }),
    storeFactory: () => ({ redeem: async () => restoredOwner() }),
  });

  assert.equal(response.status, 200);
  const cookie = response.headers.get('Set-Cookie') || '';
  assert.match(cookie, /mkety_trading_refresh=/);
  assert.match(cookie, /HttpOnly/i);
  assert.match(cookie, /Secure/i);
  assert.match(cookie, /SameSite=Lax/i);
});

test('returning owner can renew a short bearer from refresh cookie without repeating onboarding details', async () => {
  const response = await handleTradingAccessCodeRedeemRequest(new Request('https://trade.mkety.com/api/v1/access/session', {
    method: 'POST',
    headers: { Cookie: 'mkety_trading_refresh=opaque-test-refresh' },
  }), {
    TRADING_ACCESS_CODE_SESSION_SECRET: sessionSecret,
  }, {
    nowSec: 1800000000,
    refreshVerifier: async () => ({ ok: true, workspaceId, subject: 'access-code:owner@example.com' }),
    supabaseFactory: async () => ({ from() {} }),
    storeFactory: () => ({ restoreSession: async () => restoredOwner() }),
  });

  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.equal(body.mode, 'returning_session');
  assert.equal(body.workspace.id, workspaceId);
  assert.equal(typeof body.bearer, 'string');
});

test('logout clears the refresh cookie', async () => {
  const response = await handleTradingAccessCodeRedeemRequest(new Request('https://trade.mkety.com/api/v1/access/logout', { method: 'POST' }), {
    TRADING_ACCESS_CODE_SESSION_SECRET: sessionSecret,
  });
  assert.equal(response.status, 200);
  assert.match(response.headers.get('Set-Cookie') || '', /mkety_trading_refresh=;/);
  assert.match(response.headers.get('Set-Cookie') || '', /Max-Age=0/i);
});

test('enterprise portal attempts returning-session restoration automatically before showing onboarding', () => {
  const html = renderEnterpriseTradingPortal({ TRADING_ACCESS_ENABLED: 'true', BROKER_EXECUTION_ENABLED: 'true' });
  assert.match(html, /\/api\/v1\/access\/session/);
  assert.match(html, /credentials\s*:\s*['"]include['"]/);
  assert.match(html, /\/api\/v1\/access\/logout/);
});

test('broker execution fails closed when persisted Mkety owner switch is OFF even if deployment capability is ON', async () => {
  let executed = false;
  const execution = await runV1ProductionExecutionStage({
    env: { TRADING_ACCESS_ENABLED: 'true', BROKER_EXECUTION_ENABLED: 'true' },
    supabase: { from() {} },
    result: ingestResult,
    simulation: readySimulation(),
    brokerExecutionControlResolver: async () => ({ ok: true, enabled: false }),
    executeProductionFn: async () => { executed = true; return { status: 'SUCCEEDED' }; },
  });
  assert.equal(executed, false);
  assert.equal(execution.executionEnabled, false);
  assert.equal(execution.status, 'BROKER_OWNER_SWITCH_OFF');
});

test('broker execution fails closed when persisted runtime control cannot be read', async () => {
  const execution = await runV1ProductionExecutionStage({
    env: { TRADING_ACCESS_ENABLED: 'true', BROKER_EXECUTION_ENABLED: 'true' },
    supabase: { from() {} },
    result: ingestResult,
    simulation: readySimulation(),
    brokerExecutionControlResolver: async () => ({ ok: false, reason: 'RUNTIME_CONTROL_UNAVAILABLE' }),
  });
  assert.equal(execution.executionEnabled, false);
  assert.equal(execution.status, 'BROKER_RUNTIME_CONTROL_UNAVAILABLE');
});

test('Mkety admin can read and update the broker owner switch through the secret-guarded admin API', async () => {
  let enabled = false;
  const runtimeStore = {
    async getBrokerExecutionEnabled() { return { enabled }; },
    async setBrokerExecutionEnabled(next) { enabled = Boolean(next); return { enabled }; },
  };

  const read = await handleMketyAdminAccessCodesRequest(new Request('https://trade.mkety.com/api/v1/mkety-admin/runtime-controls', {
    headers: { 'X-Mkety-Admin-Secret': 'admin-secret' },
  }), { MKETY_TRADING_ADMIN_SECRET: 'admin-secret' }, { store: {}, runtimeStore });
  assert.equal(read.status, 200);
  assert.equal((await read.json()).brokerExecutionEnabled, false);

  const update = await handleMketyAdminAccessCodesRequest(new Request('https://trade.mkety.com/api/v1/mkety-admin/runtime-controls', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', 'X-Mkety-Admin-Secret': 'admin-secret' },
    body: JSON.stringify({ brokerExecutionEnabled: true }),
  }), { MKETY_TRADING_ADMIN_SECRET: 'admin-secret' }, { store: {}, runtimeStore });
  assert.equal(update.status, 200);
  assert.equal((await update.json()).brokerExecutionEnabled, true);
});
