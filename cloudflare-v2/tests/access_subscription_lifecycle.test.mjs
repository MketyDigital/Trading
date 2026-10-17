import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { createTradingAccessCodeStore } from '../src/persistence/supabase_access_code_store.js';
import { authenticateLocalTradingAccessBearer, createLocalTradingBearer } from '../src/access/trading_access_codes.js';

const workspaceId = '11111111-1111-4111-8111-111111111111';
const subject = 'access-code:owner@example.com';

function sessionSupabase({ status = 'active', expiresAt = '2099-01-01T00:00:00.000Z' } = {}) {
  return {
    from(table) {
      const filters = {};
      return {
        select() { return this; },
        eq(column, value) { filters[column] = value; return this; },
        async maybeSingle() {
          if (table === 'trading_workspace_access') return { data: { id: workspaceId, display_name: 'Starpips Forex', owner_email: 'owner@example.com', trading_access_enabled: true, metadata: { accessCodeId: 'code-current', entitlements: { brokerModes: ['demo'], liveExecution: false } } }, error: null };
          if (table === 'trading_workspace_memberships') return { data: { workspace_id: workspaceId, zitadel_subject: subject, trading_role: 'owner', membership_enabled: true, metadata: { accessCodeId: 'code-current' } }, error: null };
          if (table === 'trading_access_codes') {
            assert.equal(filters.id, 'code-current');
            return { data: { id: 'code-current', workspace_id: workspaceId, product: 'trading', status, expires_at: expiresAt }, error: null };
          }
          throw new Error(`unexpected table ${table}`);
        },
      };
    },
  };
}

test('returning session is denied when the current workspace subscription is revoked', async () => {
  const store = createTradingAccessCodeStore(sessionSupabase({ status: 'revoked' }));
  const result = await store.restoreSession({ workspaceId, subject, accessCodeId: 'code-current' });
  assert.equal(result.ok, false);
  assert.equal(result.status, 403);
  assert.equal(result.reason, 'ACCESS_SUBSCRIPTION_REVOKED');
});

test('returning session is denied when the current workspace subscription is expired', async () => {
  const store = createTradingAccessCodeStore(sessionSupabase({ expiresAt: '2020-01-01T00:00:00.000Z' }));
  const result = await store.restoreSession({ workspaceId, subject, accessCodeId: 'code-current', now: new Date('2026-09-16T09:00:00Z') });
  assert.equal(result.ok, false);
  assert.equal(result.status, 403);
  assert.equal(result.reason, 'ACCESS_SUBSCRIPTION_EXPIRED');
});

test('local session validates access-code status through the selected repository without Supabase', async () => {
  const token = await createLocalTradingBearer({ workspaceId, subject, accessCodeId: 'code-current' }, 'session-secret');
  let lookupCount = 0;
  const result = await authenticateLocalTradingAccessBearer(new Request('https://trade.mkety.com', {
    headers: { Authorization: `Bearer ${token}` },
  }), { TRADING_ACCESS_CODE_SESSION_SECRET: 'session-secret' }, {
    accessCodeStore: {
      async getAccessCodeById(id) {
        lookupCount += 1;
        assert.equal(id, 'code-current');
        return { id, workspace_id: workspaceId, product: 'trading', status: 'active', expires_at: '2099-01-01T00:00:00.000Z' };
      },
    },
    workspaceAccess: { async updateWorkspace() { throw new Error('not expected for active code'); } },
  });
  assert.equal(result.ok, true);
  assert.equal(lookupCount, 1);
});

test('local session is denied for a revoked access code in the selected repository', async () => {
  const token = await createLocalTradingBearer({ workspaceId, subject, accessCodeId: 'code-current' }, 'session-secret');
  const result = await authenticateLocalTradingAccessBearer(new Request('https://trade.mkety.com', {
    headers: { Authorization: `Bearer ${token}` },
  }), { TRADING_ACCESS_CODE_SESSION_SECRET: 'session-secret' }, {
    accessCodeStore: { async getAccessCodeById(id) { return { id, workspace_id: workspaceId, product: 'trading', status: 'revoked' }; } },
    workspaceAccess: {},
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'ACCESS_SUBSCRIPTION_REVOKED');
});

test('storage-backed local session fails closed when the access-code repository is missing', async () => {
  const token = await createLocalTradingBearer({ workspaceId, subject, accessCodeId: 'code-current' }, 'session-secret');
  const result = await authenticateLocalTradingAccessBearer(new Request('https://trade.mkety.com', {
    headers: { Authorization: `Bearer ${token}` },
  }), { TRADING_ACCESS_CODE_SESSION_SECRET: 'session-secret' }, { workspaceAccess: {} });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'ACCESS_SUBSCRIPTION_LOOKUP_FAILED');
});

test('expired local session denies access and disables its workspace through the selected repository', async () => {
  const token = await createLocalTradingBearer({ workspaceId, subject, accessCodeId: 'code-current' }, 'session-secret');
  const updates = [];
  const result = await authenticateLocalTradingAccessBearer(new Request('https://trade.mkety.com', {
    headers: { Authorization: `Bearer ${token}` },
  }), { TRADING_ACCESS_CODE_SESSION_SECRET: 'session-secret' }, {
    now: new Date('2026-09-16T09:00:00Z'),
    accessCodeStore: { async getAccessCodeById(id) { return { id, workspace_id: workspaceId, product: 'trading', status: 'active', expires_at: '2020-01-01T00:00:00.000Z' }; } },
    workspaceAccess: { async updateWorkspace(...args) { updates.push(args); } },
  });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'ACCESS_SUBSCRIPTION_EXPIRED');
  assert.deepEqual(updates, [[workspaceId, { trading_access_enabled: false }]]);
});

test('subscription lifecycle migration locks revoke immediately and unlocks the same workspace on reissue', async () => {
  const sql = await readFile(new URL('../db/migrations/0037_subscription_access_lifecycle.sql', import.meta.url), 'utf8');
  assert.match(sql, /CREATE OR REPLACE FUNCTION public\.sync_trading_workspace_access_code_status/i);
  assert.match(sql, /CREATE TRIGGER trading_access_code_workspace_lock/i);
  assert.match(sql, /trading_access_enabled\s*=\s*false/i);
  assert.match(sql, /CREATE OR REPLACE FUNCTION public\.rotate_trading_access_code/i);
  assert.match(sql, /trading_access_enabled\s*=\s*true/i);
  assert.doesNotMatch(sql, /UPDATE\s+public\.trading_workspace_memberships[\s\S]*membership_enabled\s*=/i);
  assert.match(sql, /liveExecution[^\n]*false/i);
});
