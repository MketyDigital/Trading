import test from 'node:test';
import assert from 'node:assert/strict';

import { handleV1EventsRequest } from '../src/http/v1_events.js';
import { buildV1LifecycleEvidence } from '../src/operations/v1_lifecycle_evidence.js';

function request() {
  return new Request('https://trade.test/api/v1/events', {
    method: 'POST',
    body: '{"external_event_id":"evt-1","text":"BUY XAUUSD NOW"}',
    headers: {
      'X-Mkety-Source-Id': 'src-1',
      'X-Mkety-Timestamp': '1',
      'X-Mkety-Signature': 'sig',
    },
  });
}

const event = {
  workspace_hint: 'ws-1',
  external_event_id: 'telegram:-100123:317',
  text: 'BUY XAUUSD NOW',
  source: { instance_id: 'source-instance-1' },
  thread: {},
  metadata: { source_revision_key: 'rev-a' },
};

const interpretation = {
  status: 'READY',
  source: 'ai',
  intent: {
    side: 'BUY',
    symbol: { canonical: 'XAUUSD' },
    orderType: 'MARKET',
    entry: { kind: 'MARKET' },
    takeProfits: [],
  },
  aiDiagnostics: {
    attempts: [{
      providerId: 'provider-1',
      providerType: 'openai',
      model: 'gpt-test',
      status: 'SUCCEEDED',
      latencyMs: 42,
      authorization: 'Bearer must-never-persist',
    }],
  },
};

function dependencies(overrides = {}) {
  return {
    supabaseFactory: async () => ({ from() {} }),
    storesFactory: () => ({ sourceStore: {}, eventStore: {} }),
    ingestFn: async () => ({ ok: true, duplicate: false, eventId: 'db-event-1', event, interpretation }),
    simulationDepsFactory: async () => ({}),
    orchestrateFn: async () => ({ status: 'NO_ACTION', executionEnabled: false, actions: [], accounts: [] }),
    executionStageFn: async () => ({ status: 'TRADING_ACCESS_DISABLED', executionEnabled: false }),
    destinationStoreFactory: () => ({}),
    destinationStageFn: async () => ({
      status: 'DELIVERED',
      succeeded: 1,
      failed: 0,
      rejected: 0,
      blocked: 0,
      outcomes: [{ destinationId: 'dest-1', status: 'SUCCEEDED' }],
    }),
    ...overrides,
  };
}

test('V1 lifecycle evidence is revision-aware and preserves sanitized AI diagnostics', () => {
  const rows = buildV1LifecycleEvidence({
    sourceId: 'src-1',
    result: { ok: true, duplicate: false, eventId: 'db-event-1', event, interpretation },
    destinations: { status: 'DELIVERED', succeeded: 1, failed: 0, outcomes: [] },
    simulation: { status: 'NO_ACTION', executionEnabled: false, actions: [] },
    execution: { status: 'TRADING_ACCESS_DISABLED', executionEnabled: false },
  });

  assert.ok(rows.length >= 4);
  assert.ok(rows.every((row) => row.workspaceId === 'ws-1'));
  assert.ok(rows.every((row) => row.correlationId === 'telegram:-100123:317'));
  assert.ok(rows.every((row) => row.evidenceKey.includes('rev-a')));

  const interpretationRow = rows.find((row) => row.stage === 'INTERPRETATION');
  assert.ok(interpretationRow);
  assert.equal(interpretationRow.status, 'SUCCEEDED');
  assert.equal(interpretationRow.details.source, 'ai');
  assert.equal(interpreterAttempt(interpreterAttemptDetails(interpretationRow)).providerType, 'openai');
  assert.equal(JSON.stringify(rows).includes('must-never-persist'), false);
});

function interpreterAttemptDetails(row) {
  return row.details.aiDiagnostics;
}

function interpreterAttempt(details) {
  return details.attempts[0];
}

test('V1 handler writes lifecycle evidence without changing trading or destination results', async () => {
  const appended = [];
  const response = await handleV1EventsRequest(request(), {
    TRADING_MASTER_KEY: 'master',
    BROKER_EXECUTION_ENABLED: 'false',
  }, dependencies({
    operationJournalStoreFactory: () => ({
      async append(row) {
        appended.push(structuredClone(row));
        return row;
      },
    }),
  }));

  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.destinations.status, 'DELIVERED');
  assert.equal(body.execution.status, 'TRADING_ACCESS_DISABLED');
  assert.ok(appended.some((row) => row.stage === 'INTERPRETATION'));
  assert.ok(appended.some((row) => row.stage === 'DESTINATION'));
  assert.ok(appended.some((row) => row.stage === 'BROKER_EXECUTION'));
});

test('journal persistence failure is observational only and cannot block or resend', async () => {
  let attempts = 0;
  let destinationCalls = 0;
  let executionCalls = 0;

  const response = await handleV1EventsRequest(request(), {
    TRADING_MASTER_KEY: 'master',
    BROKER_EXECUTION_ENABLED: 'false',
  }, dependencies({
    operationJournalStoreFactory: () => ({
      async append() {
        attempts += 1;
        throw new Error('journal unavailable');
      },
    }),
    destinationStageFn: async () => {
      destinationCalls += 1;
      return { status: 'DELIVERED', succeeded: 1, failed: 0, rejected: 0, blocked: 0, outcomes: [] };
    },
    executionStageFn: async () => {
      executionCalls += 1;
      return { status: 'TRADING_ACCESS_DISABLED', executionEnabled: false };
    },
  }));

  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.destinations.status, 'DELIVERED');
  assert.equal(body.execution.status, 'TRADING_ACCESS_DISABLED');
  assert.ok(attempts > 0);
  assert.equal(destinationCalls, 1);
  assert.equal(executionCalls, 1);
  assert.equal(JSON.stringify(body).includes('journal unavailable'), false);
});
