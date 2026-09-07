import test from 'node:test';
import assert from 'node:assert/strict';

import {
  normalizeTradingAccessCode,
  validateTradingAccessCodeRecord,
  createLocalTradingBearer,
  verifyLocalTradingBearer,
} from '../src/access/trading_access_codes.js';
import { handleTradingAccessCodeRedeemRequest } from '../src/http/v1_access_codes.js';
import { authorizeV1AdminRequest } from '../src/http/v1_admin.js';

const fixedNow = new Date('2026-09-07T12:00:00.000Z');
const workspaceId = '11111111-1111-4111-8111-111111111111';

function validRecord(overrides = {}) {
  return {
    id: 'code-1',
    code_hash: 'hash',
    product: 'trading',
    status: 'active',
    workspace_id: workspaceId,
    workspace_display_name: 'Ace Trading Desk',
    owner_email: 'owner@example.com',
    owner_name: 'Owner Example',
    role: 'owner',
    entitlements: {
      customSubdomain: true,
      customHostname: false,
      sourceTypes: ['telegram', 'tradingview'],
      brokerModes: ['demo'],
      liveExecution: false,
      maxTeamMembers: 1,
    },
    max_redemptions: 1,
    redeemed_count: 0,
    expires_at: '2026-09-08T12:00:00.000Z',
    ...overrides,
  };
}

function fakeWorkspaceSupabase() {
  return {
    from(table) {
      assert.equal(table, 'trading_workspace_access');
      return {
        select() { return this; },
        eq() { return this; },
        async maybeSingle() {
          return {
            data: {
              id: workspaceId,
              display_name: 'Ace Trading Desk',
              owner_email: 'owner@example.com',
              trading_access_enabled: true,
              created_at: '2026-09-07T12:00:00.000Z',
              updated_at: '2026-09-07T12:00:00.000Z',
            },
            error: null,
          };
        },
      };
    },
  };
}

test('normalizes Trading Enterprise access codes without changing their authority', () => {
  assert.equal(normalizeTradingAccessCode(' trd-mkty  -  8f7k '), 'TRD-MKTY-8F7K');
});

test('valid access-code record produces an owner onboarding plan and safe entitlements', () => {
  const result = validateTradingAccessCodeRecord(validRecord(), fixedNow);
  assert.equal(result.ok, true);
  assert.equal(result.workspace.id, workspaceId);
  assert.equal(result.membership.role, 'owner');
  assert.deepEqual(result.entitlements.brokerModes, ['demo']);
  assert.equal(result.entitlements.liveExecution, false);
});

test('invalid access-code records fail closed', () => {
  assert.equal(validateTradingAccessCodeRecord(null, fixedNow).reason, 'ACCESS_CODE_NOT_FOUND');
  assert.equal(validateTradingAccessCodeRecord(validRecord({ product: 'academy' }), fixedNow).reason, 'ACCESS_CODE_WRONG_PRODUCT');
  assert.equal(validateTradingAccessCodeRecord(validRecord({ status: 'disabled' }), fixedNow).reason, 'ACCESS_CODE_NOT_ACTIVE');
  assert.equal(validateTradingAccessCodeRecord(validRecord({ redeemed_count: 1 }), fixedNow).reason, 'ACCESS_CODE_REDEMPTION_LIMIT_REACHED');
  assert.equal(validateTradingAccessCodeRecord(validRecord({ expires_at: '2026-09-06T12:00:00.000Z' }), fixedNow).reason, 'ACCESS_CODE_EXPIRED');
});

test('local Trading bearer verifies only for exact workspace and configured secret', async () => {
  const token = await createLocalTradingBearer({
    subject: 'access-code:owner@example.com',
    workspaceId,
    access: 'owner',
  }, 'super-secret', 1799313600);

  const accepted = await verifyLocalTradingBearer(token, 'super-secret', {
    requestedWorkspaceId: workspaceId,
    nowSec: 1799313601,
  });
  assert.equal(accepted.ok, true);
  assert.equal(accepted.subject, 'access-code:owner@example.com');
  assert.equal(accepted.workspaceId, workspaceId);
  assert.equal(accepted.access, 'owner');

  const rejected = await verifyLocalTradingBearer(token, 'super-secret', {
    requestedWorkspaceId: '22222222-2222-4222-8222-222222222222',
    nowSec: 1799313601,
  });
  assert.equal(rejected.ok, false);
  assert.equal(rejected.reason, 'WORKSPACE_ASSERTION_MISMATCH');
});

test('local Trading bearer satisfies existing admin boundary for the same workspace only', async () => {
  const token = await createLocalTradingBearer({
    subject: 'access-code:owner@example.com',
    workspaceId,
    access: 'owner',
  }, 'super-secret', 1799313600);
  const request = new Request('https://trade.mkety.com/api/v1/admin/workspace', {
    headers: {
      Authorization: `Bearer ${token}`,
      'X-Mkety-Workspace-Id': workspaceId,
    },
  });

  const authorized = await authorizeV1AdminRequest(request, {
    TRADING_ACCESS_CODE_SESSION_ENABLED: 'true',
    TRADING_ACCESS_CODE_SESSION_SECRET: 'super-secret',
  }, {
    supabase: fakeWorkspaceSupabase(),
    resolveHostnameFn: async () => ({ ok: true, kind: 'canonical' }),
    membershipStoreFactory: () => ({
      getMembership: async () => ({
        enabled: true,
        workspaceId,
        subject: 'access-code:owner@example.com',
        role: 'owner',
      }),
    }),
  });

  assert.equal(authorized.ok, true);
  assert.equal(authorized.auth.subject, 'access-code:owner@example.com');
  assert.equal(authorized.membership.role, 'owner');

  const wrongWorkspace = new Request('https://trade.mkety.com/api/v1/admin/workspace', {
    headers: {
      Authorization: `Bearer ${token}`,
      'X-Mkety-Workspace-Id': '22222222-2222-4222-8222-222222222222',
    },
  });
  const rejected = await authorizeV1AdminRequest(wrongWorkspace, {
    TRADING_ACCESS_CODE_SESSION_ENABLED: 'true',
    TRADING_ACCESS_CODE_SESSION_SECRET: 'super-secret',
  }, {
    supabase: fakeWorkspaceSupabase(),
    resolveHostnameFn: async () => ({ ok: true, kind: 'canonical' }),
  });
  assert.equal(rejected.ok, false);
  assert.equal(rejected.reason, 'WORKSPACE_ASSERTION_MISMATCH');
});

test('redeem endpoint is fail-closed unless access-code onboarding is explicitly enabled', async () => {
  const response = await handleTradingAccessCodeRedeemRequest(new Request('https://trade.mkety.com/api/v1/access/redeem', {
    method: 'POST',
    body: JSON.stringify({ code: 'TRD-MKTY-8F7K', ownerEmail: 'owner@example.com' }),
  }), {}, {
    storeFactory: () => ({ redeem: async () => { throw new Error('store must not be called'); } }),
  });
  assert.equal(response.status, 503);
  assert.equal((await response.json()).reason, 'ACCESS_CODE_REDEMPTION_DISABLED');
});

test('redeem endpoint returns workspace, owner membership and local bearer without enabling broker execution', async () => {
  let redeemed = false;
  const response = await handleTradingAccessCodeRedeemRequest(new Request('https://trade.mkety.com/api/v1/access/redeem', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      code: 'TRD-MKTY-8F7K',
      ownerEmail: 'owner@example.com',
      ownerName: 'Owner Example',
      workspaceName: 'Ace Trading Desk',
    }),
  }), {
    TRADING_ACCESS_CODE_REDEMPTION_ENABLED: 'true',
    TRADING_ACCESS_CODE_SESSION_SECRET: 'super-secret',
  }, {
    now: fixedNow,
    nowSec: 1799313600,
    storeFactory: () => ({
      redeem: async (payload) => {
        redeemed = true;
        assert.equal(payload.normalizedCode, 'TRD-MKTY-8F7K');
        assert.equal(payload.ownerEmail, 'owner@example.com');
        return validateTradingAccessCodeRecord(validRecord(), fixedNow);
      },
    }),
  });

  assert.equal(redeemed, true);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.equal(body.mode, 'access_code_onboarding');
  assert.equal(body.workspace.id, workspaceId);
  assert.equal(body.membership.role, 'owner');
  assert.equal(body.entitlements.liveExecution, false);
  assert.equal(body.brokerExecutionEnabled, false);
  assert.equal(typeof body.bearer, 'string');

  const verified = await verifyLocalTradingBearer(body.bearer, 'super-secret', {
    requestedWorkspaceId: body.workspace.id,
    nowSec: 1799313601,
  });
  assert.equal(verified.ok, true);
});

test('access-code migration creates hashed code and redemption audit tables with service-role-only access', async () => {
  const migration = await import('node:fs/promises').then((fs) => fs.readFile(new URL('../db/migrations/0014_trading_access_code_onboarding.sql', import.meta.url), 'utf8'));
  assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.trading_access_codes/);
  assert.match(migration, /code_hash TEXT NOT NULL UNIQUE/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.trading_access_code_redemptions/);
  assert.match(migration, /ALTER TABLE public\.trading_access_codes ENABLE ROW LEVEL SECURITY/);
  assert.match(migration, /REVOKE ALL PRIVILEGES ON TABLE public\.trading_access_codes FROM anon/);
  assert.match(migration, /GRANT ALL PRIVILEGES ON TABLE public\.trading_access_codes TO service_role/);
});
