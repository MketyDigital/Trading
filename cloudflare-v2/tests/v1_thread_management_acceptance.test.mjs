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
              groupId: 'thread-group-1',
              actions: [{ type: 'OPEN_POSITION', targetIndex: 1, simulated: true }],
            }],
          },
        },
      },
    },
  };
}

function threadManagementResult(scenario, { reason = 'THREAD_TARGET', groupId = 'thread-group-1' } = {}) {
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
          interpretation: { status: 'MANAGEMENT', management: { type: 'MOVE_SL_TO_BE' } },
          simulation: {
            status: 'SIMULATED',
            executionEnabled: false,
            correlation: { status: 'MATCHED', reason, groupId },
            accounts: [{
              accountId: 'account-1',
              status: 'READY',
              groupId,
              actions: [{ type: 'MODIFY_POSITION', legId: 'leg-1', simulated: true }],
            }],
          },
        },
      },
    },
  };
}

test('thread_move_be shares deterministic thread with prior signal and does not use reply targeting', async () => {
  const scenarios = [];
  const result = await runV1SimulationAcceptanceCommand({
    env: {
      TRADING_V1_ENDPOINT: 'https://trade.example.test/api/v1/events',
      TRADING_V1_SOURCE_ID: 'source-1',
      TRADING_V1_SOURCE_SECRET: 'secret',
      TRADING_V1_ACCEPTANCE_RUN_ID: 'run-thread',
      TRADING_V1_ACCEPTANCE_SCENARIOS: 'complete_signal,thread_move_be',
    },
    logger: { log() {}, error() {} },
    scenarioRunner: async ({ scenario }) => {
      scenarios.push(scenario);
      return scenario.name === 'complete_signal' ? completeResult(scenario) : threadManagementResult(scenario);
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.exitCode, 0);
  assert.equal(scenarios[0].event.thread.thread_id, scenarios[1].event.thread.thread_id);
  assert.equal(Boolean(scenarios[0].event.thread.thread_id), true);
  assert.equal(scenarios[1].event.thread.reply_to_event_id, undefined);
});

test('thread_move_be rejects reply correlation or wrong-group reuse', async () => {
  const wrongReason = await runV1SimulationAcceptanceCommand({
    env: {
      TRADING_V1_ENDPOINT: 'https://trade.example.test/api/v1/events',
      TRADING_V1_SOURCE_ID: 'source-1',
      TRADING_V1_SOURCE_SECRET: 'secret',
      TRADING_V1_ACCEPTANCE_SCENARIOS: 'complete_signal,thread_move_be',
    },
    logger: { log() {}, error() {} },
    scenarioRunner: async ({ scenario }) => scenario.name === 'complete_signal'
      ? completeResult(scenario)
      : threadManagementResult(scenario, { reason: 'REPLY_TARGET' }),
  });
  assert.equal(wrongReason.ok, false);
  assert.equal(wrongReason.failedScenario, 'thread_move_be');
  assert.match(wrongReason.semanticError, /thread_target|thread/i);

  const wrongGroup = await runV1SimulationAcceptanceCommand({
    env: {
      TRADING_V1_ENDPOINT: 'https://trade.example.test/api/v1/events',
      TRADING_V1_SOURCE_ID: 'source-1',
      TRADING_V1_SOURCE_SECRET: 'secret',
      TRADING_V1_ACCEPTANCE_SCENARIOS: 'complete_signal,thread_move_be',
    },
    logger: { log() {}, error() {} },
    scenarioRunner: async ({ scenario }) => scenario.name === 'complete_signal'
      ? completeResult(scenario)
      : threadManagementResult(scenario, { groupId: 'wrong-thread-group' }),
  });
  assert.equal(wrongGroup.ok, false);
  assert.equal(wrongGroup.failedScenario, 'thread_move_be');
  assert.match(wrongGroup.semanticError, /same group|thread/i);
});
