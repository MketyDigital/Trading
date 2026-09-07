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

function killSwitchResult(scenario, overrides = {}) {
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
                accountId: 'account-kill',
                status: 'BLOCKED',
                policy: { allowed: false, reasons: ['KILL_SWITCH'] },
                actions: [],
                ...overrides,
              },
            ],
          },
        },
      },
    },
  };
}

function fastSequenceResult(scenario, { completionGroupId = 'group-fast' } = {}) {
  const completion = scenario.name === 'fast_completion';
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
            correlation: completion
              ? { status: 'MATCHED', reason: 'FAST_ENTRY_COMPLETION', groupId: completionGroupId }
              : { status: 'NEW_GROUP' },
            accounts: [
              {
                accountId: 'account-1',
                status: 'READY',
                groupId: completion ? completionGroupId : 'group-fast',
                actions: completion
                  ? [
                      { type: 'MODIFY_POSITION', targetIndex: 1, simulated: true },
                      { type: 'OPEN_POSITION', targetIndex: 2, simulated: true },
                      { type: 'OPEN_POSITION', targetIndex: 3, simulated: true },
                    ]
                  : [{ type: 'OPEN_POSITION', targetIndex: 1, simulated: true }],
              },
            ],
          },
        },
      },
    },
  };
}

function ambiguousNeedsReviewResult(scenario) {
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
          interpretation: { status: 'NEEDS_REVIEW', source: 'ai', reason: 'ambiguous' },
          simulation: {
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
      if (scenario.name === 'ambiguous') return ambiguousNeedsReviewResult(scenario);
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

test('kill-switch acceptance succeeds only for server-side blocked account with zero actions', async () => {
  const calls = [];
  const result = await runV1SimulationAcceptanceCommand({
    env: {
      TRADING_V1_ENDPOINT: 'https://trade.example.test/api/v1/events',
      TRADING_V1_SOURCE_ID: 'source-1',
      TRADING_V1_SOURCE_SECRET: 'secret',
      TRADING_V1_ACCEPTANCE_RUN_ID: 'run-kill',
      TRADING_V1_ACCEPTANCE_SCENARIOS: 'kill_switch',
    },
    logger: { log() {}, error() {} },
    scenarioRunner: async ({ scenario }) => {
      calls.push(scenario);
      return killSwitchResult(scenario);
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.exitCode, 0);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, 'kill_switch');
  assert.match(calls[0].event.text, /XAUUSD/);
  assert.equal(calls[0].event.metadata.acceptance_scenario, 'kill_switch');
});

test('kill-switch acceptance rejects any simulated execution action', async () => {
  const result = await runV1SimulationAcceptanceCommand({
    env: {
      TRADING_V1_ENDPOINT: 'https://trade.example.test/api/v1/events',
      TRADING_V1_SOURCE_ID: 'source-1',
      TRADING_V1_SOURCE_SECRET: 'secret',
      TRADING_V1_ACCEPTANCE_SCENARIOS: 'kill_switch',
    },
    logger: { log() {}, error() {} },
    scenarioRunner: async ({ scenario }) => killSwitchResult(scenario, {
      actions: [{ type: 'OPEN_POSITION', simulated: true }],
    }),
  });

  assert.equal(result.ok, false);
  assert.equal(result.exitCode, 1);
  assert.equal(result.failedScenario, 'kill_switch');
  assert.match(result.semanticError, /zero actions/i);
});

test('fast-entry completion acceptance proves one group is reused and only missing TP legs are opened', async () => {
  const calls = [];
  const result = await runV1SimulationAcceptanceCommand({
    env: {
      TRADING_V1_ENDPOINT: 'https://trade.example.test/api/v1/events',
      TRADING_V1_SOURCE_ID: 'source-1',
      TRADING_V1_SOURCE_SECRET: 'secret',
      TRADING_V1_ACCEPTANCE_RUN_ID: 'run-fast',
      TRADING_V1_ACCEPTANCE_SCENARIOS: 'fast_entry,fast_completion',
    },
    logger: { log() {}, error() {} },
    scenarioRunner: async ({ scenario }) => {
      calls.push(scenario);
      return fastSequenceResult(scenario);
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.exitCode, 0);
  assert.deepEqual(calls.map((scenario) => scenario.name), ['fast_entry', 'fast_completion']);
  assert.match(calls[0].event.text, /NOW/i);
  assert.match(calls[1].event.text, /TP/i);
  assert.notEqual(calls[0].event.external_event_id, calls[1].event.external_event_id);
});

test('fast-entry completion acceptance fails if the completed signal does not reuse the original group', async () => {
  const result = await runV1SimulationAcceptanceCommand({
    env: {
      TRADING_V1_ENDPOINT: 'https://trade.example.test/api/v1/events',
      TRADING_V1_SOURCE_ID: 'source-1',
      TRADING_V1_SOURCE_SECRET: 'secret',
      TRADING_V1_ACCEPTANCE_SCENARIOS: 'fast_entry,fast_completion',
    },
    logger: { log() {}, error() {} },
    scenarioRunner: async ({ scenario }) => scenario.name === 'fast_entry'
      ? fastSequenceResult(scenario)
      : fastSequenceResult(scenario, { completionGroupId: 'wrong-group' }),
  });

  assert.equal(result.ok, false);
  assert.equal(result.exitCode, 1);
  assert.equal(result.failedScenario, 'fast_completion');
  assert.match(result.semanticError, /same group|reuse/i);
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
