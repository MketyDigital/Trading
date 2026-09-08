import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createMketyAdminAccessCodePlan,
  handleMketyAdminAccessCodesRequest,
} from '../src/http/v1_mkety_admin_access_codes.js';
import { hashTradingAccessCode, normalizeTradingAccessCode } from '../src/access/trading_access_codes.js';

const fixedNow = new Date('2026-09-08T00:00:00.000Z');

function fakeStore() {
  const calls = [];
  return {
    calls,
    async createAccessCode(plan) {
      calls.push({ operation: 'create', plan });
      return {
        id: 'code-row-1',
        workspace_id: plan.workspace.id,
        workspace_display_name: plan.workspace.displayName,
        owner_email: plan.owner.email,
        owner_name: plan.owner.name,
        status: 'active',
        max_redemptions: plan.maxRedemptions,
        redeemed_count: 0,
        expires_at: plan.expiresAt,
        entitlements: plan.entitlements,
        metadata: plan.metadata,
        created_at: fixedNow.toISOString(),
      };
    },
    async listAccessCodes() {
      return [{
        id: 'code-row-1',
        workspace_id: 'workspace-1',
        workspace_display_name: 'Starpips Trading',
        owner_email: 'owner@example.com',
        owner_name: 'Owner Example',
        status: 'active',
        max_redemptions: 1,
        redeemed_count: 0,
        expires_at: '2026-09-15T00:00:00.000Z',
        entitlements: { liveExecution: false, brokerModes: ['demo'] },
        metadata: { label: 'first code' },
        created_at: fixedNow.toISOString(),
      }];
    },
    async revokeAccessCode(accessCodeId) {
      calls.push({ operation: 'revoke', accessCodeId });
      if (accessCodeId !== 'code-row-1') return null;
      return {
        id: 'code-row-1',
        workspace_id: 'workspace-1',
        workspace_display_name: 'Starpips Trading',
        owner_email: 'owner@example.com',
        owner_name: 'Owner Example',
        status: 'revoked',
        max_redemptions: 1,
        redeemed_count: 0,
        expires_at: '2026-09-15T00:00:00.000Z',
        entitlements: { liveExecution: false, brokerModes: ['demo'] },
        metadata: { label: 'first code' },
        created_at: fixedNow.toISOString(),
        updated_at: fixedNow.toISOString(),
      };
    },
  };
}

test('Mkety admin access-code plan stores only hash authority and returns the plain code once', async () => {
  const plan = await createMketyAdminAccessCodePlan({
    code: ' trd mkety launch 001 ',
    ownerEmail: 'OWNER@EXAMPLE.COM',
    ownerName: 'Owner Example',
    workspaceName: 'Starpips Trading',
    expiresAt: '2026-09-15T00:00:00.000Z',
    entitlements: { sourceTypes: ['telegram'], brokerModes: ['demo'], liveExecution: true },
  }, { now: fixedNow, randomUUID: () => 'workspace-1' });

  assert.equal(plan.ok, true);
  assert.equal(plan.plainCode, 'TRDMKETYLAUNCH001');
  assert.equal(plan.record.code_hash, await hashTradingAccessCode('TRDMKETYLAUNCH001'));
  assert.equal(plan.record.code, undefined);
  assert.equal(plan.record.rawCode, undefined);
  assert.equal(plan.entitlements.liveExecution, false, 'admin code creation must not grant live execution by default');
  assert.deepEqual(plan.entitlements.brokerModes, ['demo']);
});

test('Mkety admin access-code creation requires Mkety admin secret and never exposes code hashes', async () => {
  const store = fakeStore();
  const denied = await handleMketyAdminAccessCodesRequest(new Request('https://trade.mkety.com/api/v1/mkety-admin/access-codes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ownerEmail: 'owner@example.com', workspaceName: 'Starpips Trading' }),
  }), { MKETY_TRADING_ADMIN_SECRET: 'admin-secret' }, { store, now: fixedNow, randomUUID: () => 'workspace-1' });
  assert.equal(denied.status, 401);

  const response = await handleMketyAdminAccessCodesRequest(new Request('https://trade.mkety.com/api/v1/mkety-admin/access-codes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer admin-secret' },
    body: JSON.stringify({
      code: 'TRD-MKETY-OWNER-001',
      ownerEmail: 'owner@example.com',
      ownerName: 'Owner Example',
      workspaceName: 'Starpips Trading',
      expiresAt: '2026-09-15T00:00:00.000Z',
    }),
  }), { MKETY_TRADING_ADMIN_SECRET: 'admin-secret' }, { store, now: fixedNow, randomUUID: () => 'workspace-1' });

  assert.equal(response.status, 201);
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.equal(body.accessCode.plainCode, 'TRD-MKETY-OWNER-001');
  assert.equal(body.accessCode.codeHash, undefined);
  assert.equal(body.accessCode.workspaceId, 'workspace-1');
  assert.equal(store.calls[0].plan.record.code_hash, await hashTradingAccessCode(normalizeTradingAccessCode('TRD-MKETY-OWNER-001')));
});

test('Mkety admin access-code list does not reveal hashes or plain codes', async () => {
  const response = await handleMketyAdminAccessCodesRequest(new Request('https://trade.mkety.com/api/v1/mkety-admin/access-codes', {
    method: 'GET',
    headers: { 'X-Mkety-Admin-Secret': 'admin-secret' },
  }), { MKETY_TRADING_ADMIN_SECRET: 'admin-secret' }, { store: fakeStore(), now: fixedNow });

  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.equal(body.accessCodes[0].workspaceDisplayName, 'Starpips Trading');
  assert.equal(body.accessCodes[0].plainCode, undefined);
  assert.equal(body.accessCodes[0].codeHash, undefined);
});

test('Mkety admin can revoke an access code without exposing hash or plain code', async () => {
  const store = fakeStore();
  const response = await handleMketyAdminAccessCodesRequest(new Request('https://trade.mkety.com/api/v1/mkety-admin/access-codes/code-row-1/revoke', {
    method: 'POST',
    headers: { 'X-Mkety-Admin-Secret': 'admin-secret' },
  }), { MKETY_TRADING_ADMIN_SECRET: 'admin-secret' }, { store, now: fixedNow });

  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.equal(body.accessCode.id, 'code-row-1');
  assert.equal(body.accessCode.status, 'revoked');
  assert.equal(body.accessCode.plainCode, undefined);
  assert.equal(body.accessCode.codeHash, undefined);
  assert.deepEqual(store.calls.at(-1), { operation: 'revoke', accessCodeId: 'code-row-1' });
});
