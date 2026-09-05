import test from 'node:test';
import assert from 'node:assert/strict';
import { handleV1EventsRequest } from '../src/http/v1_events.js';

test('rejects non-POST methods and missing source authentication headers', async () => {
  const get = await handleV1EventsRequest(new Request('https://trade.test/api/v1/events'), {}, {});
  assert.equal(get.status, 405);

  const missing = await handleV1EventsRequest(new Request('https://trade.test/api/v1/events', {
    method: 'POST', body: '{}', headers: { 'Content-Type': 'application/json' },
  }), {}, {});
  assert.equal(missing.status, 401);
});

test('passes exact raw body and signed source headers into persistent ingest pipeline', async () => {
  let captured;
  let aiFactoryCall;
  const rawBody = '{"external_event_id":"tv-1","text":"BUY GOLD NOW"}';
  const request = new Request('https://trade.test/api/v1/events', {
    method: 'POST', body: rawBody,
    headers: {
      'Content-Type': 'application/json',
      'X-Mkety-Source-Id': 'src-1',
      'X-Mkety-Timestamp': '1700000000000',
      'X-Mkety-Signature': 'v1=abc',
    },
  });
  const aiCircuitBreaker = { canAttempt() {}, recordFailure() {}, recordSuccess() {} };
  const supabase = { from() {} };

  const response = await handleV1EventsRequest(request, { TRADING_MASTER_KEY: 'master' }, {
    supabaseFactory: async () => supabase,
    storesFactory: () => ({ sourceStore: {}, eventStore: {} }),
    aiCircuitBreaker,
    workspaceAiFactory: async (...args) => {
      aiFactoryCall = args;
      return { processSignal() {} };
    },
    ingestFn: async (input, dependencies) => {
      captured = { input, dependencies };
      await dependencies.aiRouterFactory({ source: { workspace_id: 'ws-authenticated' } });
      return { ok: true, duplicate: false, eventId: 'evt-1', interpretation: { status: 'READY' } };
    },
  });

  assert.equal(response.status, 200);
  assert.equal(captured.input.rawBody, rawBody);
  assert.equal(captured.input.sourceId, 'src-1');
  assert.equal(captured.input.timestamp, '1700000000000');
  assert.equal(captured.input.signature, 'v1=abc');
  assert.equal(typeof captured.dependencies.aiRouterFactory, 'function');
  assert.equal(aiFactoryCall[0], supabase);
  assert.equal(aiFactoryCall[1], 'ws-authenticated');
  assert.equal(aiFactoryCall[2].masterKey, 'master');
  assert.equal(aiFactoryCall[2].circuitBreaker, aiCircuitBreaker);
  const body = await response.json();
  assert.equal(body.eventId, 'evt-1');
  assert.equal(body.simulation, undefined);
});

test('simulation flag orchestrates only a successful non-duplicate interpreted event', async () => {
  let orchestrationInput;
  let depsBuilt = 0;
  const request = new Request('https://trade.test/api/v1/events', {
    method: 'POST', body: '{"external_event_id":"evt-10","text":"BUY XAUUSD 2500"}', headers: {
      'X-Mkety-Source-Id': 'src-1', 'X-Mkety-Timestamp': '1', 'X-Mkety-Signature': 'sig',
    },
  });
  const event = { workspace_hint: 'ws-1', external_event_id: 'evt-10', source: { instance_id: 'src-1' }, thread: {} };
  const interpretation = { status: 'READY', intent: { side: 'BUY', symbol: { canonical: 'XAUUSD' } } };
  const response = await handleV1EventsRequest(request, {
    TRADING_MASTER_KEY: 'master', TRADING_V1_SIMULATION: 'true',
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
  const request = new Request('https://trade.test/api/v1/events', {
    method: 'POST',
    body: '{"external_event_id":"evt-production-path","text":"BUY XAUUSD 2500"}',
    headers: {
      'X-Mkety-Source-Id': 'src-1',
      'X-Mkety-Timestamp': '1',
      'X-Mkety-Signature': 'sig',
    },
  });

  const response = await handleV1EventsRequest(request, {
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
});

test('duplicate or rejected ingress never enters orchestration', async () => {
  for (const ingestResult of [
    { ok: true, duplicate: true, eventId: 'existing' },
    { ok: false, status: 401, reason: 'INVALID_SIGNATURE' },
  ]) {
    let called = false;
    const request = new Request('https://trade.test/api/v1/events', {
      method: 'POST', body: '{}', headers: {
        'X-Mkety-Source-Id': 'src-1', 'X-Mkety-Timestamp': '1', 'X-Mkety-Signature': 'sig',
      },
    });
    const response = await handleV1EventsRequest(request, {
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

test('simulation planning failure is fail-closed diagnostics and cannot turn ingress into live execution', async () => {
  const request = new Request('https://trade.test/api/v1/events', {
    method: 'POST', body: '{}', headers: {
      'X-Mkety-Source-Id': 'src-1', 'X-Mkety-Timestamp': '1', 'X-Mkety-Signature': 'sig',
    },
  });
  const response = await handleV1EventsRequest(request, {
    TRADING_MASTER_KEY: 'master', TRADING_V1_SIMULATION: 'true',
  }, {
    supabaseFactory: async () => ({}), storesFactory: () => ({ sourceStore: {}, eventStore: {} }),
    ingestFn: async () => ({ ok: true, duplicate: false, eventId: 'e1', event: {}, interpretation: { status: 'READY' } }),
    simulationDepsFactory: async () => { throw new Error('simulation context unavailable'); },
  });
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.simulation.status, 'BLOCKED');
  assert.equal(body.simulation.executionEnabled, false);
  assert.deepEqual(body.simulation.actions, []);
  assert.match(body.simulation.error, /simulation context unavailable/i);
});

test('preserves ingest authorization and validation status codes', async () => {
  const request = new Request('https://trade.test/api/v1/events', {
    method: 'POST', body: '{}', headers: {
      'X-Mkety-Source-Id': 'src-1', 'X-Mkety-Timestamp': '1', 'X-Mkety-Signature': 'bad',
    },
  });
  const response = await handleV1EventsRequest(request, { TRADING_MASTER_KEY: 'master' }, {
    supabaseFactory: async () => ({}), storesFactory: () => ({ sourceStore: {}, eventStore: {} }),
    ingestFn: async () => ({ ok: false, status: 401, reason: 'INVALID_SIGNATURE' }),
  });
  assert.equal(response.status, 401);
  assert.equal((await response.json()).reason, 'INVALID_SIGNATURE');
});

test('fails closed when required server-side encryption configuration is absent', async () => {
  const request = new Request('https://trade.test/api/v1/events', {
    method: 'POST', body: '{}', headers: {
      'X-Mkety-Source-Id': 'src-1', 'X-Mkety-Timestamp': '1', 'X-Mkety-Signature': 'sig',
    },
  });
  const response = await handleV1EventsRequest(request, {}, {});
  assert.equal(response.status, 503);
  assert.equal((await response.json()).reason, 'TRADING_MASTER_KEY_NOT_CONFIGURED');
});
