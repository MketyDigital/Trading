import test from 'node:test';
import assert from 'node:assert/strict';

import { validateProductionRiskAction } from '../src/execution/production_risk_authority.js';

const account = {
  sizing_mode: 'FIXED_LOT',
};

for (const action of [
  { type: 'MODIFY_POSITION', brokerPositionId: 'p1', symbol: 'XAUUSD', stopLoss: 4300 },
  { type: 'MODIFY_POSITION', brokerPositionId: 'p1', symbol: 'XAUUSD', takeProfit: 4400 },
  { type: 'CANCEL_PENDING', brokerOrderId: 'o1', symbol: 'XAUUSD' },
]) {
  test(`${action.type} without lots remains a permitted risk-reducing action`, () => {
    const result = validateProductionRiskAction({
      account,
      action,
      exposure: { currentDailyPnlPercent: 0, currentOpenRiskPercent: 0 },
    });

    assert.equal(result.allowed, true);
    assert.deepEqual(result.action, action);
    assert.equal(result.policyContext.totalLots, 0);
    assert.equal(result.risk, null);
  });
}

test('OPEN_POSITION still requires a positive lot quantity', () => {
  assert.throws(
    () => validateProductionRiskAction({
      account,
      action: { type: 'OPEN_POSITION', symbol: 'XAUUSD', side: 'BUY' },
    }),
    /lots must be positive/,
  );
});
