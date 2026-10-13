import test from 'node:test';
import assert from 'node:assert/strict';
import { correlateTradingEvent } from '../src/correlation/trade_correlator.js';
import { orchestrateTradingEventSimulation } from '../src/pipeline/v1_orchestrator.js';
import { buildMachinePlan } from '../src/pipeline/machine_plan.js';

test('bare Delete and Cancel use the Close correlation path and target pending orders only', async () => {
  const pendingGroup = {
    id: 'pending-order-group',
    tradeAccountId: 'acct-1',
    workspaceId: 'workspace-1',
    sourceInstanceId: 'listener-1',
    sourceEventIds: ['evt-pending-origin'],
    symbol: 'EURUSD',
    side: 'BUY',
    orderType: 'LIMIT',
    status: 'PENDING',
    updatedAt: 1000,
    legs: [{ legId: 'pending-leg', targetIndex: 1, status: 'PENDING', brokerOrderId: 'broker-order-1', lots: 0.03 }],
  };

  for (const text of ['Delete', 'Cancel']) {
    const event = {
      external_event_id: `evt-${text.toLowerCase()}`,
      workspace_hint: 'workspace-1',
      source: { instance_id: 'listener-1' },
      thread: {},
      text,
    };
    const interpretation = buildMachinePlan(event);
    assert.equal(interpretation.status, 'MANAGEMENT', text);
    assert.equal(interpretation.management.type, 'CANCEL_PENDING', text);

    const result = await orchestrateTradingEventSimulation({
      event,
      interpretation,
      eventId: `db-${text.toLowerCase()}`,
      nowMs: 3000,
    }, {
      stateCoordinator: {
        correlate: async (sourceEvent, intent, nowMs) => correlateTradingEvent({
          event: sourceEvent, interpretation: intent, activeGroups: [pendingGroup], nowMs,
        }),
      },
      stateStore: {
        getGroup: async (id) => id === pendingGroup.id ? structuredClone(pendingGroup) : null,
        putGroup: async (group) => group,
      },
      accountProvider: async () => [{
        id: 'acct-1',
        execution_enabled: true,
        sizingMode: 'FIXED_LOTS',
        fixedLots: 0.03,
        safety_policy: { enabled: true, killSwitch: false, allowedSymbols: ['EURUSD'], maxLotsPerTrade: 1 },
      }],
      instrumentProvider: async () => { throw new Error('pending cancellation must not require market metadata'); },
    });

    assert.equal(result.status, 'SIMULATED', text);
    assert.equal(result.correlation.reason, 'ONLY_ACTIVE_GROUP', text);
    assert.deepEqual(result.accounts[0].actions, [{
      type: 'CANCEL_PENDING', legId: 'pending-leg', targetIndex: 1,
      brokerOrderId: 'broker-order-1', symbol: 'EURUSD', simulated: true,
    }], text);
  }
});
