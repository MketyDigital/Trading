import test from 'node:test';
import assert from 'node:assert/strict';
import { runV1SimulationAcceptanceCommand } from '../src/testing/v1_simulation_command.js';

function simulatedCompleteResult(scenario) {
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
            accounts: [
              {
                accountId: 'account-1',
                status: 'READY',
                actions: [{ type: 'OPEN_POSITION', simulated: true }],
              },
            ],
          },
        },
      },
    },
  };
}

test('V1 simulation command defaults to valid signal, exact duplicate, invalid signature and stale timestamp', async () => {
  const calls = [];
  const lines = [];

  const result = await runV1SimulationAcceptanceCommand({
    env: {
      TRADING_V1_ENDPOINT: 'https://trade.example.test/api/v1/events',
      TRADING_V1_SOURCE_ID: 'source-1',
      TRADING_V1_SOURCE_SECRET: 'secret-never-print',
      TRADING_V1_ACCEPTANCE_RUN_ID: 'run-42',
    },
    logger: { log: (line) => lines.push(String(line)), error: (line) => lines.push(String(line)) },
    scenarioRunner: async ({ scenario }) => {
      calls.push(scenario);
      if (scenario.name === 'duplicate') {
        return { ok: true, result: { scenario: 'duplicate', externalEventId: scenario.event.external_event_id, response: { statusCode: 200, body: { ok: true, duplicate: true } } } };
      }
      if (scenario.expectedStatus) {
        return { ok: true, result: { scenario: scenario.name, expectedStatus: scenario.expectedStatus, expectedRejection: true, response: { statusCode: scenario.expectedStatus, body: { rejected: true } } } };
      }
      return simulatedCompleteResult(scenario);
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.exitCode, 0);
  assert.deepEqual(calls.map((scenario) => scenario.name), [
    'complete_signal',
    'duplicate',
    'invalid_signature',
    'stale_timestamp',
  ]);
  assert.equal(calls[1].event.external_event_id, calls[0].event.external_event_id);
  assert.equal(calls[2].expectedStatus, 401);
  assert.equal(calls[3].expectedStatus, 401);
  assert.match(lines.join('\n'), /complete_signal/);
  assert.match(lines.join('\n'), /duplicate/);
  assert.match(lines.join('\n'), /invalid_signature/);
  assert.match(lines.join('\n'), /stale_timestamp/);
  assert.doesNotMatch(lines.join('\n'), /secret-never-print/);
});

test('V1 simulation command accepts explicit non-broker scenario matrix including expected security rejection', async () => {
  const names = [];
  const result = await runV1SimulationAcceptanceCommand({
    env: {
      TRADING_V1_ENDPOINT: 'https://trade.example.test/api/v1/events',
      TRADING_V1_SOURCE_ID: 'source-1',
      TRADING_V1_SOURCE_SECRET: 'secret',
      TRADING_V1_ACCEPTANCE_RUN_ID: 'run-99',
      TRADING_V1_ACCEPTANCE_SCENARIOS: 'complete_signal,fast_entry,pending_order,ambiguous,invalid_signature,stale_timestamp',
    },
    logger: { log() {}, error() {} },
    scenarioRunner: async ({ scenario }) => {
      names.push(scenario.name);
      if (scenario.name === 'complete_signal') return simulatedCompleteResult(scenario);
      return { ok: true, result: { scenario: scenario.name, externalEventId: scenario.event.external_event_id, response: { statusCode: scenario.expectedStatus || 200, body: {} } } };
    },
  });

  assert.equal(result.ok, true);
  assert.deepEqual(names, [
    'complete_signal',
    'fast_entry',
    'pending_order',
    'ambiguous',
    'invalid_signature',
    'stale_timestamp',
  ]);
  assert.equal(names.includes('lifecycle'), false);
});

test('complete signal acceptance fails if HTTP succeeds without real simulation semantics', async () => {
  const result = await runV1SimulationAcceptanceCommand({
    env: {
      TRADING_V1_ENDPOINT: 'https://trade.example.test/api/v1/events',
      TRADING_V1_SOURCE_ID: 'source-1',
      TRADING_V1_SOURCE_SECRET: 'secret',
      TRADING_V1_ACCEPTANCE_SCENARIOS: 'complete_signal',
    },
    logger: { log() {}, error() {} },
    scenarioRunner: async ({ scenario }) => ({
      ok: true,
      result: {
        scenario: scenario.name,
        response: { statusCode: 200, body: { ok: true } },
      },
    }),
  });

  assert.equal(result.ok, false);
  assert.equal(result.exitCode, 1);
  assert.equal(result.failedScenario, 'complete_signal');
  assert.match(result.semanticError, /simulation/i);
});

test('duplicate acceptance fails if HTTP succeeds without duplicate=true', async () => {
  const result = await runV1SimulationAcceptanceCommand({
    env: {
      TRADING_V1_ENDPOINT: 'https://trade.example.test/api/v1/events',
      TRADING_V1_SOURCE_ID: 'source-1',
      TRADING_V1_SOURCE_SECRET: 'secret',
      TRADING_V1_ACCEPTANCE_SCENARIOS: 'complete_signal,duplicate',
    },
    logger: { log() {}, error() {} },
    scenarioRunner: async ({ scenario }) => {
      if (scenario.name === 'complete_signal') return simulatedCompleteResult(scenario);
      return {
        ok: true,
        result: {
          scenario: scenario.name,
          response: { statusCode: 200, body: { ok: true, duplicate: false } },
        },
      };
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.exitCode, 1);
  assert.equal(result.failedScenario, 'duplicate');
  assert.match(result.semanticError, /duplicate/i);
});

test('V1 simulation command fails closed on missing config or failed HTTP scenario', async () => {
  let calls = 0;
  const missingLines = [];
  const missing = await runV1SimulationAcceptanceCommand({
    env: { TRADING_V1_SOURCE_SECRET: 'secret-value' },
    logger: { log() {}, error: (line) => missingLines.push(String(line)) },
    scenarioRunner: async () => { calls += 1; return { ok: true }; },
  });

  assert.equal(missing.ok, false);
  assert.equal(missing.exitCode, 1);
  assert.equal(calls, 0);
  assert.match(missingLines.join('\n'), /TRADING_V1_ENDPOINT/);
  assert.doesNotMatch(missingLines.join('\n'), /secret-value/);

  const failed = await runV1SimulationAcceptanceCommand({
    env: {
      TRADING_V1_ENDPOINT: 'https://trade.example.test/api/v1/events',
      TRADING_V1_SOURCE_ID: 'source-1',
      TRADING_V1_SOURCE_SECRET: 'secret',
      TRADING_V1_ACCEPTANCE_SCENARIOS: 'complete_signal,fast_entry',
    },
    logger: { log() {}, error() {} },
    scenarioRunner: async ({ scenario }) => {
      calls += 1;
      return scenario.name === 'complete_signal'
        ? { ok: false, result: { scenario: scenario.name, response: { statusCode: 500, body: { error: 'blocked' } } } }
        : { ok: true, result: { scenario: scenario.name, response: { statusCode: 200, body: {} } } };
    },
  });

  assert.equal(failed.ok, false);
  assert.equal(failed.exitCode, 1);
  assert.equal(failed.failedScenario, 'complete_signal');
});
