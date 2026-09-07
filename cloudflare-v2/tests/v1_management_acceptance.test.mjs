import test from 'node:test';
import assert from 'node:assert/strict';
import { runV1SimulationAcceptanceCommand } from '../src/testing/v1_simulation_command.js';

function completeResult(scenario) {
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
              groupId: 'group-1',
              actions: [{ type: 'OPEN_POSITION', targetIndex: 1, simulated: true }],
            }],
          },
        },
      },
    },
  };
}

function managementResult(scenario, { groupId = 'group-1', reason = 'REPLY_TARGET', actionType = 'MODIFY_POSITION' } = {}) {
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
          interpretation: { status: 'MANAGEMENT', management: { type: scenario.name === 'close_half' ? 'CLOSE_PARTIAL' : 'MOVE_SL_TO_BE' } },
          simulation: {
            status: 'SIMULATED',
            executionEnabled: false,
            correlation: { status: 'MATCHED', reason, groupId },
            accounts: [{
              accountId: 'account-1',
              status: 'READY',
              groupId,
              actions: [{
                type: actionType,
                legId: 'leg-1',
                fraction: scenario.name === 'close_half' ? 0.5 : undefined,
                simulated: true,
              }],
            }],
          },
        },
      },
    },
  };
}

test('complete signal followed by move_be becomes an exact reply-targeted same-group management sequence', async () => {
  const scenarios = [];
  const result = await runV1SimulationAcceptanceCommand({
    env: {
      TRADING_V1_ENDPOINT: 'https://trade.example.test/api/v1/events',
      TRADING_V1_SOURCE_ID: 'source-1',
      TRADING_V1_SOURCE_SECRET: 'secret',
      TRADING_V1_ACCEPTANCE_RUN_ID: 'run-management',
      TRADING_V1_ACCEPTANCE_SCENARIOS: 'complete_signal,move_be',
    },
    logger: { log() {}, error() {} },
    scenarioRunner: async ({ scenario }) => {
      scenarios.push(scenario);
      if (scenario.name === 'complete_signal') return completeResult(scenario);
      return managementResult(scenario);
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.exitCode, 0);
  assert.equal(scenarios[1].event.thread.reply_to_event_id, scenarios[0].event.external_event_id);
});

test('reply management acceptance rejects wrong-group or non-risk-reducing semantics even when HTTP succeeds', async () => {
  const wrongGroup = await runV1SimulationAcceptanceCommand({
    env: {
      TRADING_V1_ENDPOINT: 'https://trade.example.test/api/v1/events',
      TRADING_V1_SOURCE_ID: 'source-1',
      TRADING_V1_SOURCE_SECRET: 'secret',
      TRADING_V1_ACCEPTANCE_SCENARIOS: 'complete_signal,move_be',
    },
    logger: { log() {}, error() {} },
    scenarioRunner: async ({ scenario }) => scenario.name === 'complete_signal'
      ? completeResult(scenario)
      : managementResult(scenario, { groupId: 'wrong-group' }),
  });

  assert.equal(wrongGroup.ok, false);
  assert.equal(wrongGroup.failedScenario, 'move_be');
  assert.match(wrongGroup.semanticError, /same group|reply|target/i);

  const wrongAction = await runV1SimulationAcceptanceCommand({
    env: {
      TRADING_V1_ENDPOINT: 'https://trade.example.test/api/v1/events',
      TRADING_V1_SOURCE_ID: 'source-1',
      TRADING_V1_SOURCE_SECRET: 'secret',
      TRADING_V1_ACCEPTANCE_SCENARIOS: 'complete_signal,close_half',
    },
    logger: { log() {}, error() {} },
    scenarioRunner: async ({ scenario }) => scenario.name === 'complete_signal'
      ? completeResult(scenario)
      : managementResult(scenario, { actionType: 'OPEN_POSITION' }),
  });

  assert.equal(wrongAction.ok, false);
  assert.equal(wrongAction.failedScenario, 'close_half');
  assert.match(wrongAction.semanticError, /close_partial|risk|management|action/i);
});
