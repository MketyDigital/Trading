import test from 'node:test';
import assert from 'node:assert/strict';
import { runV1SimulationAcceptanceCommand } from '../src/testing/v1_simulation_command.js';

function pendingResult(scenario) {
  return {
    ok: true,
    result: {
      scenario: scenario.name,
      externalEventId: scenario.event.external_event_id,
      response: {
        statusCode: 200,
        body: {
          ok: true,
          duplicate: false,
          simulation: {
            status: 'SIMULATED',
            executionEnabled: false,
            correlation: { status: 'NEW_GROUP' },
            accounts: [{
              accountId: 'account-1',
              status: 'READY',
              groupId: 'pending-group-1',
              actions: [{ type: 'OPEN_POSITION', orderType: 'LIMIT', targetIndex: 1, simulated: true }],
            }],
          },
        },
      },
    },
  };
}

function cancelResult(scenario, { groupId = 'pending-group-1', actionType = 'CANCEL_PENDING', reason = 'REPLY_TARGET' } = {}) {
  return {
    ok: true,
    result: {
      scenario: scenario.name,
      externalEventId: scenario.event.external_event_id,
      response: {
        statusCode: 200,
        body: {
          ok: true,
          duplicate: false,
          interpretation: { status: 'MANAGEMENT', management: { type: 'CANCEL_PENDING' } },
          simulation: {
            status: 'SIMULATED',
            executionEnabled: false,
            correlation: { status: 'MATCHED', reason, groupId },
            accounts: [{
              accountId: 'account-1',
              status: 'READY',
              groupId,
              actions: [{ type: actionType, legId: 'pending-leg-1', simulated: true }],
            }],
          },
        },
      },
    },
  };
}

test('pending_order followed by cancel_pending becomes exact reply-targeted same-group cancellation', async () => {
  const scenarios = [];
  const result = await runV1SimulationAcceptanceCommand({
    env: {
      TRADING_V1_ENDPOINT: 'https://trade.example.test/api/v1/events',
      TRADING_V1_SOURCE_ID: 'source-1',
      TRADING_V1_SOURCE_SECRET: 'secret',
      TRADING_V1_ACCEPTANCE_RUN_ID: 'run-pending',
      TRADING_V1_ACCEPTANCE_SCENARIOS: 'pending_order,cancel_pending',
    },
    logger: { log() {}, error() {} },
    scenarioRunner: async ({ scenario }) => {
      scenarios.push(scenario);
      return scenario.name === 'pending_order' ? pendingResult(scenario) : cancelResult(scenario);
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.exitCode, 0);
  assert.equal(scenarios[1].event.thread.reply_to_event_id, scenarios[0].event.external_event_id);
});

test('pending cancellation acceptance rejects wrong target group or non-cancel action', async () => {
  const wrongGroup = await runV1SimulationAcceptanceCommand({
    env: {
      TRADING_V1_ENDPOINT: 'https://trade.example.test/api/v1/events',
      TRADING_V1_SOURCE_ID: 'source-1',
      TRADING_V1_SOURCE_SECRET: 'secret',
      TRADING_V1_ACCEPTANCE_SCENARIOS: 'pending_order,cancel_pending',
    },
    logger: { log() {}, error() {} },
    scenarioRunner: async ({ scenario }) => scenario.name === 'pending_order'
      ? pendingResult(scenario)
      : cancelResult(scenario, { groupId: 'wrong-pending-group' }),
  });
  assert.equal(wrongGroup.ok, false);
  assert.equal(wrongGroup.failedScenario, 'cancel_pending');
  assert.match(wrongGroup.semanticError, /same group|pending|target/i);

  const wrongAction = await runV1SimulationAcceptanceCommand({
    env: {
      TRADING_V1_ENDPOINT: 'https://trade.example.test/api/v1/events',
      TRADING_V1_SOURCE_ID: 'source-1',
      TRADING_V1_SOURCE_SECRET: 'secret',
      TRADING_V1_ACCEPTANCE_SCENARIOS: 'pending_order,cancel_pending',
    },
    logger: { log() {}, error() {} },
    scenarioRunner: async ({ scenario }) => scenario.name === 'pending_order'
      ? pendingResult(scenario)
      : cancelResult(scenario, { actionType: 'CLOSE_POSITION' }),
  });
  assert.equal(wrongAction.ok, false);
  assert.equal(wrongAction.failedScenario, 'cancel_pending');
  assert.match(wrongAction.semanticError, /cancel_pending|cancel|action/i);
});
