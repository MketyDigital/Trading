import test from 'node:test';
import assert from 'node:assert/strict';
import { VIPMembershipManager } from '../src/vip/vip_manager.js';

function fixture(vipStore) {
  const manager = new VIPMembershipManager({ from() { throw new Error('Supabase must not be used with an injected VIP repository'); } }, 'test-token', 'admin', 'vip', 'workspace-a', { vipStore });
  const calls = [];
  manager.telegramPost = async (method, payload) => { calls.push({ method, payload }); return method === 'createChatInviteLink' ? { result: { invite_link: 'https://t.me/+one-use' } } : { ok: true }; };
  return { manager, calls };
}

test('VIP manager uses injected repository for status, trial, and receipt submission', async () => {
  const writes = [];
  const store = {
    async getMembership(workspaceId, telegramId) { assert.equal(workspaceId, 'workspace-a'); assert.equal(telegramId, 73); return null; },
    async upsertMembership(row) { writes.push(row); return row; },
    async createDeposit(row) { writes.push(row); return { ...row, id: 'deposit-1' }; },
  };
  const { manager, calls } = fixture(store);
  await manager.sendSubscriptionStatus(73);
  await manager.processFreeTrialRequest(73, 'trader', 'Trader');
  await manager.processManualReceiptUpload({ photo: [{ file_id: 'small' }, { file_id: 'receipt' }] }, 73, 'trader');
  assert.equal(writes.length, 2);
  assert.equal(writes[0].trial_used, true);
  assert.equal(writes[1].receipt_photo_file_id, 'receipt');
  assert.ok(calls.some(({ method }) => method === 'sendPhoto'));
});

test('VIP cron lifecycle uses workspace-scoped repository methods', async () => {
  const observed = [];
  const store = {
    async listExpired(workspaceId, at) { observed.push(['expired', workspaceId, at]); return []; },
    async listExpiring(workspaceId, from, to) { observed.push(['expiring', workspaceId, from, to]); return []; },
  };
  const { manager } = fixture(store);
  await manager.processSubscriptionLifecycleCron();
  assert.equal(observed[0][0], 'expired');
  assert.equal(observed[0][1], 'workspace-a');
  assert.equal(observed.filter(([kind]) => kind === 'expiring').length, 2);
});
