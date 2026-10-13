import test from 'node:test';
import assert from 'node:assert/strict';
import { correlateTradingEvent } from '../src/correlation/trade_correlator.js';

test('broker TP management event remains bound to its trade account when broker position ids overlap', () => {
  const activeGroups = ['acct-a', 'acct-b'].map((tradeAccountId) => ({
    id: `group-${tradeAccountId}`, workspaceId: 'workspace-1', tradeAccountId,
    sourceInstanceId: 'source-1', symbol: 'EURUSD', side: 'BUY', status: 'OPEN',
    legs: [{ brokerPositionId: '7001', brokerOrderId: null, status: 'OPEN' }],
  }));
  const result = correlateTradingEvent({
    event: { workspace_hint: 'workspace-1', source: { instance_id: 'source-1' } },
    interpretation: { status: 'MANAGEMENT', management: {
      type: 'TARGET_HIT', brokerPositionId: '7001', tradeAccountId: 'acct-b', targetIndex: 1,
    } },
    activeGroups, nowMs: Date.now(),
  });
  assert.deepEqual(result, { status: 'MATCHED', reason: 'BROKER_IDENTITY_TARGET', groupId: 'group-acct-b' });
});
