import test from 'node:test';
import assert from 'node:assert/strict';
import { expandFollowerPlans, followerGroupId, scaleFollowerAction } from '../src/followers/account_follower_fanout.js';

test('follower fanout clones parent plans once with an isolated group and idempotency namespace', () => {
  const plans = [{
    accountId: 'parent',
    groupId: 'event:parent',
    actions: [{ type: 'OPEN_POSITION', legId: 'leg-1', lots: 0.2, idempotencyKey: 'event:parent:open' }],
  }];
  const links = [{ followerAccountId: 'follower', parentAccountId: 'parent', lotMultiplier: 0.5 }];
  const expanded = expandFollowerPlans(plans, links);
  assert.equal(expanded.length, 2);
  assert.equal(expanded[1].accountId, 'follower');
  assert.equal(expanded[1].copiedFromAccountId, 'parent');
  assert.equal(expanded[1].groupId, followerGroupId('event:parent', 'follower'));
  assert.equal(expanded[1].actions[0].lots, 0.1);
  assert.notEqual(expanded[1].actions[0].idempotencyKey, plans[0].actions[0].idempotencyKey);
});

test('follower fanout is deterministic and does not duplicate a follower when parent links repeat', () => {
  const plans = [{ accountId: 'parent', groupId: 'g', actions: [{ type: 'MODIFY_POSITION', legId: 'l', stopLoss: 10 }] }];
  const links = [
    { followerAccountId: 'follower', parentAccountId: 'parent', lotMultiplier: 1 },
    { followerAccountId: 'follower', parentAccountId: 'parent', lotMultiplier: 1 },
  ];
  assert.equal(expandFollowerPlans(plans, links).length, 2);
});

test('lot scaling never changes protective prices and rejects invalid multipliers', () => {
  const action = { type: 'OPEN_POSITION', lots: 0.2, stopLoss: 10, takeProfit: 20 };
  assert.deepEqual(scaleFollowerAction(action, { followerAccountId: 'follower', lotMultiplier: 2 }), { ...action, lots: 0.4 });
  assert.throws(() => scaleFollowerAction(action, { followerAccountId: 'follower', lotMultiplier: 0 }), /LOT_MULTIPLIER_INVALID/);
});
