import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createMketyAdminAccessCodePlan,
  createMketyAdminAccessCodeStore,
} from '../src/http/v1_mkety_admin_access_codes.js';

const workspaceId = '11111111-1111-4111-8111-111111111111';

test('reissue delegates rotation to one database RPC and does not issue direct table writes', async () => {
  const calls = [];
  const supabase = {
    from(table) {
      calls.push({ type: 'from', table });
      throw new Error(`direct table access is forbidden during reissue: ${table}`);
    },
    async rpc(name, args) {
      calls.push({ type: 'rpc', name, args });
      return {
        data: {
          id: 'code-new',
          workspace_id: workspaceId,
          workspace_display_name: 'Starpips Forex',
          owner_email: 'owner@example.com',
          owner_name: 'Owner',
          status: 'active',
          max_redemptions: 1,
          redeemed_count: 0,
          expires_at: '2026-09-22T00:00:00.000Z',
          entitlements: { brokerModes: ['demo'], liveExecution: false },
          metadata: { createdBy: 'mkety-admin-api' },
          created_at: '2026-09-15T00:00:00.000Z',
        },
        error: null,
      };
    },
  };

  const plan = await createMketyAdminAccessCodePlan({
    code: 'TRD-MKETY-ROTATE-ATOMIC',
    ownerEmail: 'owner@example.com',
    ownerName: 'Owner',
    workspaceName: 'Starpips Forex',
    workspaceId,
    expiresAt: '2026-09-22T00:00:00.000Z',
  });

  const store = createMketyAdminAccessCodeStore(supabase);
  const row = await store.createAccessCode(plan);

  assert.equal(row.id, 'code-new');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].type, 'rpc');
  assert.equal(calls[0].name, 'rotate_trading_access_code');
  assert.equal(calls[0].args.p_workspace_id, workspaceId);
  assert.equal(calls[0].args.p_owner_email, 'owner@example.com');
  assert.equal(calls[0].args.p_code_hash, plan.record.code_hash);
  assert.equal(calls[0].args.p_entitlements.liveExecution, false);
});

test('failed rotation RPC surfaces an error without any worker-side compensating write', async () => {
  const calls = [];
  const supabase = {
    from(table) {
      calls.push({ type: 'from', table });
      throw new Error(`unexpected direct table write: ${table}`);
    },
    async rpc(name, args) {
      calls.push({ type: 'rpc', name, args });
      return { data: null, error: { message: 'ACCESS_CODE_REISSUE_WORKSPACE_NOT_FOUND' } };
    },
  };

  const plan = await createMketyAdminAccessCodePlan({
    ownerEmail: 'owner@example.com',
    workspaceName: 'Starpips Forex',
    workspaceId,
  });
  const store = createMketyAdminAccessCodeStore(supabase);

  await assert.rejects(() => store.createAccessCode(plan), /ACCESS_CODE_REISSUE_WORKSPACE_NOT_FOUND/);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].type, 'rpc');
});
