import test from 'node:test';
import assert from 'node:assert/strict';

import { createLocalTradingBearer } from '../src/access/trading_access_codes.js';
import { authorizeV1AdminRequest } from '../src/http/v1_admin.js';

const workspaceId = '11111111-1111-4111-8111-111111111111';
const subject = 'access-code:owner@example.com';

function workspaceSupabase() {
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
              display_name: 'Starpips Forex',
              owner_email: 'owner@example.com',
              trading_access_enabled: true,
              metadata: {
                accessCodeProvisioned: true,
                accessCodeId: 'code-new',
                entitlements: {
                  brokerModes: ['demo'],
                  sourceTypes: ['telegram', 'tradingview'],
                  destinations: ['broker_account', 'telegram', 'audit_only'],
                  liveExecution: false,
                  tradingExecutionDestination: true,
                  telegramDestination: true,
                },
              },
            },
            error: null,
          };
        },
      };
    },
  };
}

test('superseded local bearer is rejected immediately at the V1 admin boundary', async () => {
  const token = await createLocalTradingBearer({
    subject,
    workspaceId,
    access: 'owner',
    accessCodeId: 'code-old',
  }, 'super-secret', 1_800_000_000);

  const request = new Request('https://trade.mkety.com/api/v1/admin/workspace', {
    headers: {
      Authorization: `Bearer ${token}`,
      'X-Mkety-Workspace-Id': workspaceId,
    },
  });

  const result = await authorizeV1AdminRequest(request, {
    TRADING_ACCESS_CODE_SESSION_ENABLED: 'true',
    TRADING_ACCESS_CODE_SESSION_SECRET: 'super-secret',
  }, {
    supabase: workspaceSupabase(),
    resolveHostnameFn: async () => ({ ok: true, kind: 'canonical' }),
    membershipStoreFactory: () => ({
      getMembership: async () => ({
        enabled: true,
        workspaceId,
        subject,
        role: 'owner',
        metadata: { accessCodeId: 'code-new' },
      }),
    }),
  });

  assert.equal(result.ok, false);
  assert.equal(result.status, 401);
  assert.equal(result.reason, 'ACCESS_SESSION_SUPERSEDED');
});

test('current locally bound bearer continues to authorize the same workspace', async () => {
  const token = await createLocalTradingBearer({
    subject,
    workspaceId,
    access: 'owner',
    accessCodeId: 'code-new',
  }, 'super-secret', 1_800_000_000);

  const request = new Request('https://trade.mkety.com/api/v1/admin/workspace', {
    headers: {
      Authorization: `Bearer ${token}`,
      'X-Mkety-Workspace-Id': workspaceId,
    },
  });

  const result = await authorizeV1AdminRequest(request, {
    TRADING_ACCESS_CODE_SESSION_ENABLED: 'true',
    TRADING_ACCESS_CODE_SESSION_SECRET: 'super-secret',
  }, {
    supabase: workspaceSupabase(),
    resolveHostnameFn: async () => ({ ok: true, kind: 'canonical' }),
    membershipStoreFactory: () => ({
      getMembership: async () => ({
        enabled: true,
        workspaceId,
        subject,
        role: 'owner',
        metadata: { accessCodeId: 'code-new' },
      }),
    }),
  });

  assert.equal(result.ok, true);
  assert.equal(result.workspace.id, workspaceId);
});
