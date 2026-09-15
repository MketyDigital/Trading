import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateBreakEvenEligibility } from '../src/execution/break_even_safety.js';
import { buildManagementActions } from '../src/execution/position_group.js';
import { executeProductionPlan } from '../src/execution/production_execution_coordinator.js';

test('break-even is blocked for a BUY until market has moved above entry', () => {
  assert.deepEqual(evaluateBreakEvenEligibility({ side: 'BUY', entryPrice: 4306.45, marketPrice: 4305.90 }), {
    allowed: false,
    reason: 'BREAK_EVEN_NOT_ELIGIBLE_YET',
    side: 'BUY',
    entryPrice: 4306.45,
    marketPrice: 4305.90,
  });
  assert.equal(evaluateBreakEvenEligibility({ side: 'BUY', entryPrice: 4306.45, marketPrice: 4306.46 }).allowed, true);
});

test('break-even is blocked for a SELL until market has moved below entry', () => {
  assert.equal(evaluateBreakEvenEligibility({ side: 'SELL', entryPrice: 4306.45, marketPrice: 4306.80 }).allowed, false);
  assert.equal(evaluateBreakEvenEligibility({ side: 'SELL', entryPrice: 4306.45, marketPrice: 4306.40 }).allowed, true);
});

test('break-even context is unavailable when side, entry or live trigger price is missing', () => {
  assert.equal(evaluateBreakEvenEligibility({ side: 'BUY', entryPrice: null, marketPrice: 4307 }).reason, 'BREAK_EVEN_CONTEXT_UNAVAILABLE');
  assert.equal(evaluateBreakEvenEligibility({ side: 'BUY', entryPrice: 4306.45, marketPrice: null }).reason, 'BREAK_EVEN_CONTEXT_UNAVAILABLE');
  assert.equal(evaluateBreakEvenEligibility({ side: 'HOLD', entryPrice: 4306.45, marketPrice: 4307 }).reason, 'BREAK_EVEN_CONTEXT_UNAVAILABLE');
});

test('MOVE_SL_TO_BE actions carry the semantic metadata required for broker preflight', () => {
  const actions = buildManagementActions({
    id: 'g1', symbol: 'XAUUSD', side: 'BUY', entryPrice: 4306.45,
    legs: [{ legId: 'leg-1', targetIndex: 1, lots: 0.01, status: 'OPEN', brokerPositionId: 'p1' }],
  }, { type: 'MOVE_SL_TO_BE' });

  assert.deepEqual(actions, [{
    type: 'MODIFY_POSITION',
    managementType: 'MOVE_SL_TO_BE',
    legId: 'leg-1',
    targetIndex: 1,
    brokerPositionId: 'p1',
    symbol: 'XAUUSD',
    side: 'BUY',
    entryPrice: 4306.45,
    stopLoss: 4306.45,
  }]);
});

test('broker-aware BE no-op is blocked before dispatch rather than becoming a broker failure', async () => {
  let dispatchCalls = 0;
  const result = await executeProductionPlan({
    workspaceId: 'ws1',
    eventId: 'evt1',
    brokerExecutionEnabled: true,
    accountPlans: [{
      accountId: 'acct1', groupId: 'g1',
      actions: [{ type: 'MODIFY_POSITION', managementType: 'MOVE_SL_TO_BE', legId: 'leg-1', symbol: 'XAUUSD', side: 'BUY', entryPrice: 4306.45, stopLoss: 4306.45 }],
    }],
  }, {
    accountLoader: async () => ({ id: 'acct1', workspace_id: 'ws1', environment: 'demo', is_active: true, execution_enabled: true, safety_policy: { enabled: true, killSwitch: false } }),
    riskMaterializer: async () => ({ allowed: false, reason: 'BREAK_EVEN_NOT_ELIGIBLE_YET' }),
    dispatchAction: async () => { dispatchCalls += 1; return { ok: true }; },
  });

  assert.equal(dispatchCalls, 0);
  assert.equal(result.status, 'BLOCKED');
  assert.equal(result.failed, 0);
  assert.equal(result.accounts[0].status, 'BLOCKED');
  assert.equal(result.accounts[0].reason, 'ACCOUNT_POLICY_BLOCKED');
  assert.equal(result.accounts[0].blockReason, 'BREAK_EVEN_NOT_ELIGIBLE_YET');
});
