import test from 'node:test';
import assert from 'node:assert/strict';
import { runV1SimulationAcceptanceCommand } from '../src/testing/v1_simulation_command.js';

function arbitraryTpResult(scenario, { targetIndexes = [1, 2, 3, 4, 5] } = {}) {
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
              groupId: 'group-arbitrary',
              actions: targetIndexes.map((targetIndex) => ({
                type: 'OPEN_POSITION',
                targetIndex,
                simulated: true,
              })),
            }],
          },
        },
      },
    },
  };
}

test('arbitrary-TP acceptance requires all five ordered targets to survive signed Worker simulation', async () => {
  const calls = [];
  const result = await runV1SimulationAcceptanceCommand({
    env: {
      TRADING_V1_ENDPOINT: 'https://trade.example.test/api/v1/events',
      TRADING_V1_SOURCE_ID: 'source-1',
      TRADING_V1_SOURCE_SECRET: 'secret',
      TRADING_V1_ACCEPTANCE_RUN_ID: 'run-5tp',
      TRADING_V1_ACCEPTANCE_SCENARIOS: 'arbitrary_tp',
    },
    logger: { log() {}, error() {} },
    scenarioRunner: async ({ scenario }) => {
      calls.push(scenario);
      return arbitraryTpResult(scenario);
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.exitCode, 0);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, 'arbitrary_tp');
  assert.match(calls[0].event.text, /TP\s*5|2550/i);
});

test('arbitrary-TP acceptance fails if a target is dropped or reordered', async () => {
  const result = await runV1SimulationAcceptanceCommand({
    env: {
      TRADING_V1_ENDPOINT: 'https://trade.example.test/api/v1/events',
      TRADING_V1_SOURCE_ID: 'source-1',
      TRADING_V1_SOURCE_SECRET: 'secret',
      TRADING_V1_ACCEPTANCE_SCENARIOS: 'arbitrary_tp',
    },
    logger: { log() {}, error() {} },
    scenarioRunner: async ({ scenario }) => arbitraryTpResult(scenario, { targetIndexes: [1, 2, 4, 5] }),
  });

  assert.equal(result.ok, false);
  assert.equal(result.exitCode, 1);
  assert.equal(result.failedScenario, 'arbitrary_tp');
  assert.match(result.semanticError, /five|target|ordered/i);
});
