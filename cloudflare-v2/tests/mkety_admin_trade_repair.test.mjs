import test from 'node:test';
import assert from 'node:assert/strict';
import { handleMketyAdminTradeRepairRequest } from '../src/http/v1_mkety_admin_trade_repair.js';

function req(body = {}, secret = 'admin') {
  return new Request('https://trade.mkety.com/api/v1/mkety-admin/trade-repair/group-1', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'X-Mkety-Admin-Secret': secret },
    body: JSON.stringify(body),
  });
}

test('trade repair endpoint requires owner secret', async () => {
  const response = await handleMketyAdminTradeRepairRequest(req({ workspaceId: 'ws', confirmLive: true }, 'bad'), { MKETY_TRADING_ADMIN_SECRET: 'admin' });
  assert.equal(response.status, 401);
});

test('trade repair endpoint requires explicit live confirmation', async () => {
  const response = await handleMketyAdminTradeRepairRequest(req({ workspaceId: 'ws' }), { MKETY_TRADING_ADMIN_SECRET: 'admin' });
  assert.equal(response.status, 409);
  assert.equal((await response.json()).reason, 'LIVE_CONFIRMATION_REQUIRED');
});

test('trade repair endpoint passes exact workspace and group to repair service', async () => {
  let received;
  const response = await handleMketyAdminTradeRepairRequest(req({ workspaceId: 'ws', confirmLive: true }), {
    MKETY_TRADING_ADMIN_SECRET: 'admin',
  }, {
    supabaseFactory: async () => ({ from() {} }),
    repairFn: async (input) => {
      received = input;
      return { ok: true, groupId: input.groupId };
    },
  });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).groupId, 'group-1');
  assert.equal(received.workspaceId, 'ws');
  assert.equal(received.groupId, 'group-1');
  assert.equal(received.confirmLive, true);
});
