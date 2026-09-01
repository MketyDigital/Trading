import test from 'node:test';
import assert from 'node:assert/strict';
import { runV1SimulationAcceptanceCommand } from '../src/testing/v1_simulation_command.js';

function ambiguityResult(scenario, { unsafe = false } = {}) {
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
          interpretation: unsafe
            ? { status: 'READY', source: 'ai', intent: { side: 'BUY' } }
            : { status: 'NEEDS_REVIEW', source: 'ai', reason: 'AI interpretation failed closed' },
          simulation: unsafe
            ? {
                status: 'SIMULATED',
                executionEnabled: false,
                accounts: [{
                  accountId: 'account-1',
                  status: 'READY',
                  actions: [{ type: 'OPEN_POSITION', simulated: true }],
                }],
              }
            : {
                status: 'NEEDS_REVIEW',
                executionEnabled: false,
                actions: [],
                accounts: [],
              },
        },
      },
    },
  };
}

test('ambiguous signed acceptance passes only when AI ambiguity remains NEEDS_REVIEW and action-free', async () => {
  const result = await runV1SimulationAcceptanceCommand({
    env: {
      TRADING_V1_ENDPOINT: 'https://trade.example.test/api/v1/events',
      TRADING_V1_SOURCE_ID: 'source-1',
      TRADING_V1_SOURCE_SECRET: 'secret',
      TRADING_V1_ACCEPTANCE_SCENARIOS: 'ambiguous',
    },
    logger: { log() {}, error() {} },
    scenarioRunner: async ({ scenario }) => ambiguityResult(scenario),
  });

  assert.equal(result.ok, true);
  assert.equal(result.exitCode, 0);
});

test('ambiguous signed acceptance rejects accidental AI execution even when HTTP and simulation report success', async () => {
  const result = await runV1SimulationAcceptanceCommand({
    env: {
      TRADING_V1_ENDPOINT: 'https://trade.example.test/api/v1/events',
      TRADING_V1_SOURCE_ID: 'source-1',
      TRADING_V1_SOURCE_SECRET: 'secret',
      TRADING_V1_ACCEPTANCE_SCENARIOS: 'ambiguous',
    },
    logger: { log() {}, error() {} },
    scenarioRunner: async ({ scenario }) => ambiguityResult(scenario, { unsafe: true }),
  });

  assert.equal(result.ok, false);
  assert.equal(result.exitCode, 1);
  assert.equal(result.failedScenario, 'ambiguous');
  assert.match(result.semanticError, /needs_review|action|ready|ambiguous/i);
});
