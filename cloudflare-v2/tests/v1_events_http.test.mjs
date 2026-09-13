import test from 'node:test';
import assert from 'node:assert/strict';

import { handleV1EventsRequest } from '../src/http/v1_events.js';

function request(body = '{}') {
  return new Request('https://trade.test/api/v1/events', {
    method: 'POST',
    body,
    headers: {
      'Content-Type': 'application/json',
      'X-Mkety-Source-Id': 'src-1',
      'X-Mkety-Timestamp': '1',
      'X-Mkety-Signature': 'sig',
    },
  });
}

function successfulIngest(overrides = {}) {
  return {
    ok: true,
    duplicate: false,
    eventId: 'db-event-1',
    event: {
      workspace_hint: 'ws-1',
      external_event_id: 'evt-1',
      source: { instance_id: 'src-1' },
      thread: {},
    },
    interpretation: {
      status: 'READY',
      intent: { side: 'BUY', symbol: { canonical: 'XAUUSD' } },
    },
    ...overrides,
  };
}

test('rejects non-POST methods and missing source authentication headers', async () => {
  const getResponse = await handleV1EventsRequest(new Request('https://trade.test/api/v1/events'), {}, {});
  assert.equal(getResponse.status, 405);

  const authResponse = await handleV1EventsRequest(new Request('https://trade.test/api/v1/events', {
    method: 'POST',
    body: '{}',
  }), { TRADING_MASTER_KEY: 'master' }, {});
  assert.equal(authResponse.status, 401);
});

test('passes exact raw body and signed source headers into persistent ingest pipeline', async () => {
  const raw = '{"text":"BUY XAUUSD"}';
  let ingestInput;
  const response = await handleV1EventsRequest(request(raw), { TRADING_MASTER_KEY: 'master' }, {
    supabaseFactory: async () => ({ from() {} }),
    storesFactory: () => ({ sourceStore: {}, eventStore: {} }),
    ingestFn: async (input) => {
      ingestInput = input;
      return { ok: true, duplicate: true, eventId: 'existing' };
    },
  });

  assert.equal(response.status, 200);
  assert.equal(ingestInput.rawBody, raw);
  assert.equal(ingestInput.sourceId, 'src-1');
  assert.equal(ingestInput.timestamp, '1');
  assert.equal(ingestInput.signature, 'sig');
});

test('defaults ambiguity AI interpretation timeout to 12 seconds when unset', async () => {
  let ingestDeps;
  const response = await handleV1EventsRequest(request(), { TRADING_MASTER_KEY: 'master' }, {
    supabaseFactory: async () => ({}),
    storesFactory: () => ({ sourceStore: {}, eventStore: {} }),
    ingestFn: async (_input, deps) => {
      ingestDeps = deps;
      return { ok: true, duplicate: true, eventId: 'existing' };
    },
  });

  assert.equal(response.status, 200);
  assert.equal(ingestDeps.interpretationTimeoutMs, 12000);
});

test('successful non-duplicate interpreted event enters orchestration', async () => {
  const event = { workspace_hint: 'ws-1', external_event_id: 'evt-10', source: { instance_id: 'src-1' }, thread: {} };
  const interpretation = { status: 'READY', intent: { side: 'BUY', symbol: { canonical: 'XAUUSD' } } };
  let depsBuilt = 0;
  let orchestrationInput;
  const response = await handleV1EventsRequest(request(), {
    TRADING_MASTER_KEY: 'master',
    TRADING_V1_SIMULATION: 'true',
  }, {
    supabaseFactory: async () => ({ from() {} }),
    storesFactory: () => ({ sourceStore: {}, eventStore: {} }),
    ingestFn: async () => ({ ok: true, duplicate: false, eventId: 'db-event-10', event, interpretation }),
    simulationDepsFactory: async () => { depsBuilt += 1; return { safe: true }; },
    orchestrateFn: async (input, deps) => {
      orchestrationInput = { input, deps };
      return { status: 'SIMULATED', executionEnabled: false, actions: [], accounts: [] };
    },
  });
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(depsBuilt, 1);
  assert.equal(orchestrationInput.input.eventId, 'db-event-10');
  assert.equal(orchestrationInput.input.event, event);
  assert.equal(orchestrationInput.input.interpretation, interpretation);
  assert.deepEqual(orchestrationInput.deps, { safe: true });
  assert.equal(body.simulation.status, 'SIMULATED');
  assert.equal(body.simulation.executionEnabled, false);
  assert.deepEqual(body.simulation.actions, []);
});

test('accepted events always enter orchestration even when simulation mode is disabled', async () => {
  let depsBuilt = 0;
  let orchestrationInput;
  const event = { workspace_hint: 'ws-1', external_event_id: 'evt-production-path', source: { instance_id: 'src-1' }, thread: {} };
  const interpretation = { status: 'READY', intent: { side: 'BUY', symbol: { canonical: 'XAUUSD' } } };
  const req = new Request('https://trade.test/api/v1/events', {
    method: 'POST',
    body: '{"external_event_id":"evt-production-path","text":"BUY XAUUSD 2500"}',
    headers: {
      'X-Mkety-Source-Id': 'src-1',
      'X-Mkety-Timestamp': '1',
      'X-Mkety-Signature': 'sig',
    },
  });

  const response = await handleV1EventsRequest(req, {
    TRADING_MASTER_KEY: 'master',
    TRADING_V1_SIMULATION: 'false',
  }, {
    supabaseFactory: async () => ({ from() {} }),
    storesFactory: () => ({ sourceStore: {}, eventStore: {} }),
    ingestFn: async () => ({ ok: true, duplicate: false, eventId: 'db-event-production', event, interpretation }),
    simulationDepsFactory: async () => {
      depsBuilt += 1;
      return { executionPath: 'production-capable' };
    },
    orchestrateFn: async (input, deps) => {
      orchestrationInput = { input, deps };
      return { status: 'PROCESSED', executionEnabled: true, actions: [{ accountId: 'acct-test' }], accounts: [] };
    },
  });

  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(depsBuilt, 1);
  assert.equal(orchestrationInput.input.eventId, 'db-event-production');
  assert.equal(orchestrationInput.input.event, event);
  assert.equal(orchestrationInput.input.interpretation, interpretation);
  assert.deepEqual(orchestrationInput.deps, { executionPath: 'production-capable' });
  assert.equal(body.simulation.status, 'PROCESSED');
  assert.equal(body.simulation.executionEnabled, true);
  assert.equal(body.simulation.actions.length, 1);
  assert.equal(body.execution.status, 'NOT_EXECUTABLE');
  assert.equal(body.execution.executionEnabled, false);
});

test('duplicate or rejected ingress never enters orchestration', async () => {
  for (const ingestResult of [
    { ok: true, duplicate: true, eventId: 'existing' },
    { ok: false, status: 401, reason: 'INVALID_SIGNATURE' },
  ]) {
    let called = false;
    const req = new Request('https://trade.test/api/v1/events', {
      method: 'POST', body: '{}', headers: {
        'X-Mkety-Source-Id': 'src-1', 'X-Mkety-Timestamp': '1', 'X-Mkety-Signature': 'sig',
      },
    });
    const response = await handleV1EventsRequest(req, {
      TRADING_MASTER_KEY: 'master', TRADING_V1_SIMULATION: 'true',
    }, {
      supabaseFactory: async () => ({}), storesFactory: () => ({ sourceStore: {}, eventStore: {} }),
      ingestFn: async () => ingestResult,
      simulationDepsFactory: async () => { called = true; return {}; },
      orchestrateFn: async () => { called = true; return {}; },
    });
    assert.equal(called, false);
    assert.equal(response.status, ingestResult.ok ? 200 : 401);
  }
});

test('recovery marker cannot orchestrate duplicate unless ingest rehydrated persisted event', async () => {
  let called = false;
  const response = await handleV1EventsRequest(request(), { TRADING_MASTER_KEY: 'master' }, {
    supabaseFactory: async () => ({}), storesFactory: () => ({ sourceStore: {}, eventStore: {} }),
    ingestFn: async () => ({ ok: true, duplicate: true, recoveryReady: false, eventId: 'existing' }),
    simulationDepsFactory: async () => { called = true; return {}; },
    orchestrateFn: async () => { called = true; return {}; },
    orchestrateDuplicates: true,
  });
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.duplicate, true);
  assert.equal(called, false);
});

test('recovery marker orchestrates duplicate only when persisted recovery context is ready', async () => {
  let called = false;
  const recovered = successfulIngest({ duplicate: true, recoveryReady: true });
  const response = await handleV1EventsRequest(request(), { TRADING_MASTER_KEY: 'master' }, {
    supabaseFactory: async () => ({}), storesFactory: () => ({ sourceStore: {}, eventStore: {} }),
    ingestFn: async () => recovered,
    simulationDepsFactory: async () => ({ safe: true }),
    orchestrateFn: async () => { called = true; return { status: 'SIMULATED', accounts: [] }; },
    orchestrateDuplicates: true,
  });
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.duplicate, true);
  assert.equal(called, true);
});

test('simulation planning failure is fail-closed diagnostics and cannot turn ingress into live execution', async () => {
  let executionCalls = 0;
  const response = await handleV1EventsRequest(request(), { TRADING_MASTER_KEY: 'master' }, {
    supabaseFactory: async () => ({}), storesFactory: () => ({ sourceStore: {}, eventStore: {} }),
    ingestFn: async () => successfulIngest(),
    simulationDepsFactory: async () => { throw new Error('simulation context unavailable'); },
    executeProductionFn: async () => { executionCalls += 1; return {}; },
  });
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.simulation.status, 'BLOCKED');
  assert.equal(body.execution.status, 'NOT_EXECUTABLE');
  assert.equal(executionCalls, 0);
});

test('preserves ingest authorization and validation status codes', async () => {
  for (const ingestResult of [
    { ok: false, status: 401, reason: 'INVALID_SIGNATURE' },
    { ok: false, status: 404, reason: 'SOURCE_NOT_FOUND' },
    { ok: false, status: 400, reason: 'INVALID_EVENT' },
  ]) {
    const response = await handleV1EventsRequest(request(), { TRADING_MASTER_KEY: 'master' }, {
      supabaseFactory: async () => ({}), storesFactory: () => ({ sourceStore: {}, eventStore: {} }),
      ingestFn: async () => ingestResult,
    });
    assert.equal(response.status, ingestResult.status);
    assert.equal((await response.json()).reason, ingestResult.reason);
  }
});

test('fails closed when required server-side encryption configuration is absent', async () => {
  const response = await handleV1EventsRequest(request(), {}, {
    supabaseFactory: async () => ({ from() {} }),
  });
  assert.equal(response.status, 503);
});
