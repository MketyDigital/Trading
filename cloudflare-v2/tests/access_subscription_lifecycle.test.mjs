import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { createTradingAccessCodeStore } from '../src/persistence/supabase_access_code_store.js';

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
