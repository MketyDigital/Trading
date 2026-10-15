import test from 'node:test';
import assert from 'node:assert/strict';
import { createOrphanSignalRecoveryRuntime, defaultCandidateLoader } from '../src/sources/orphan_signal_recovery_runtime.js';

const now = Date.parse('2026-10-15T12:30:00Z');

function completeSignal(overrides = {}) {
  return {
    id: 'event-1', workspace_id: 'workspace-1', source_connection_id: 'source-1', processing_status: 'READY',
    external_event_id: 'telegram:-100:80', source_external_id: '-100',
    occurred_at: new Date(now - 125_000).toISOString(), received_at: new Date(now - 125_000).toISOString(),
    raw_text: 'GBPAUD SELL', structured_payload: {}, thread: {}, metadata: {},
    canonical_intent: {
      symbol: { canonical: 'GBPAUD' }, side: 'SELL', entry: { kind: 'PRICE', value: 1.91715 },
      stopLoss: 1.92252, takeProfits: [1.91122, 1.90569, 1.90096], incomplete: false,
    },
    ...overrides,
  };
}

const enabledControls = async () => ({
  tradingAccess: { ok: true, enabled: true },
  brokerExecution: { ok: true, enabled: true },
});

test('re-enqueues an orphan complete signal only through its original source identity', async () => {
  const queued = [];
  const runtime = createOrphanSignalRecoveryRuntime({
    clock: () => now,
    supabaseFactory: async () => ({}),
    candidateLoader: async () => [completeSignal()],
    controlLoader: enabledControls,
    brokerRouteMatcher: async () => true,
    groupMatcher: async () => false,
    enqueueFn: async (_env, source, event) => queued.push({ source, event }),
  });

  const result = await runtime({ SOURCE_EVENT_QUEUE: { send() {} } });
  assert.deepEqual(result, { status: 'COMPLETED', scanned: 1, enqueued: 1, skipped: 0, failed: 0 });
  assert.equal(queued[0].source.id, 'source-1');
  assert.equal(queued[0].event.external_event_id, 'telegram:-100:80');
  assert.equal(queued[0].event.text, 'GBPAUD SELL');
});

test('never re-enqueues a signal that already has a position group', async () => {
  let queued = 0;
  const runtime = createOrphanSignalRecoveryRuntime({
    clock: () => now,
    supabaseFactory: async () => ({}),
    candidateLoader: async () => [completeSignal()],
    controlLoader: enabledControls,
    brokerRouteMatcher: async () => true,
    groupMatcher: async () => true,
    enqueueFn: async () => { queued += 1; },
  });

  const result = await runtime({ SOURCE_EVENT_QUEUE: { send() {} } });
  assert.equal(result.enqueued, 0);
  assert.equal(result.skipped, 1);
  assert.equal(queued, 0);
});

test('fails closed for incomplete, management, stale, and non-retry-window events', async () => {
  const candidates = [
    completeSignal({ id: 'incomplete', canonical_intent: { ...completeSignal().canonical_intent, incomplete: true } }),
    completeSignal({ id: 'management', processing_status: 'MANAGEMENT' }),
    completeSignal({ id: 'stale', received_at: new Date(now - 22 * 60_000).toISOString() }),
    completeSignal({ id: 'stale-source', occurred_at: new Date(now - 22 * 60_000).toISOString() }),
    completeSignal({ id: 'too-young', received_at: new Date(now - 90_000).toISOString(), occurred_at: new Date(now - 90_000).toISOString() }),
  ];
  let queued = 0;
  const runtime = createOrphanSignalRecoveryRuntime({
    clock: () => now,
    supabaseFactory: async () => ({}),
    candidateLoader: async () => candidates,
    controlLoader: enabledControls,
    brokerRouteMatcher: async () => true,
    groupMatcher: async () => false,
    enqueueFn: async () => { queued += 1; },
  });

  const result = await runtime({ SOURCE_EVENT_QUEUE: { send() {} } });
  assert.deepEqual(result, { status: 'COMPLETED', scanned: 5, enqueued: 0, skipped: 5, failed: 0 });
  assert.equal(queued, 0);
});

test('one candidate failure cannot prevent a sibling orphan from being re-enqueued', async () => {
  const queued = [];
  const runtime = createOrphanSignalRecoveryRuntime({
    clock: () => now,
    supabaseFactory: async () => ({}),
    candidateLoader: async () => [completeSignal({ id: 'bad' }), completeSignal({ id: 'good', external_event_id: 'telegram:-100:81' })],
    controlLoader: enabledControls,
    brokerRouteMatcher: async () => true,
    groupMatcher: async () => false,
    enqueueFn: async (_env, _source, event) => {
      if (event.external_event_id.endsWith(':80')) throw new Error('queue unavailable');
      queued.push(event.external_event_id);
    },
  });

  const result = await runtime({ SOURCE_EVENT_QUEUE: { send() {} } });
  assert.equal(result.enqueued, 1);
  assert.equal(result.failed, 1);
  assert.deepEqual(queued, ['telegram:-100:81']);
});

test('never re-enqueues a source that has no active broker-account route', async () => {
  let queued = 0;
  const runtime = createOrphanSignalRecoveryRuntime({
    clock: () => now,
    supabaseFactory: async () => ({}),
    candidateLoader: async () => [completeSignal()],
    controlLoader: enabledControls,
    brokerRouteMatcher: async () => false,
    groupMatcher: async () => false,
    enqueueFn: async () => { queued += 1; },
  });

  const result = await runtime({ SOURCE_EVENT_QUEUE: { send() {} } });
  assert.equal(result.enqueued, 0);
  assert.equal(result.skipped, 1);
  assert.equal(queued, 0);
});

test('fails closed before loading candidates when an execution control is disabled or unavailable', async () => {
  for (const [expected, controls] of [
    ['CONTROL_BLOCKED', {
      tradingAccess: { ok: true, enabled: true },
      brokerExecution: { ok: true, enabled: false },
    }],
    ['CONTROL_UNAVAILABLE', {
      tradingAccess: { ok: true, enabled: true },
      brokerExecution: { ok: false, enabled: false },
    }],
  ]) {
    let loaded = 0;
    const runtime = createOrphanSignalRecoveryRuntime({
      supabaseFactory: async () => ({}),
      controlLoader: async () => controls,
      candidateLoader: async () => { loaded += 1; return [completeSignal()]; },
    });
    assert.equal((await runtime({ SOURCE_EVENT_QUEUE: { send() {} } })).status, expected);
    assert.equal(loaded, 0);
  }
});

test('candidate loading advances one bounded durable keyset page instead of using shifting offsets', async () => {
  const allRows = Array.from({ length: 201 }, (_, index) => completeSignal({ id: `event-${index}` }));
  const stored = { last_received_at: allRows[49].received_at, last_event_id: 'event-49' };
  const filters = [];
  const supabase = {
    from(table) {
      if (table === 'orphan_signal_recovery_cursors') {
        const cursorQuery = {
          select() { return cursorQuery; }, eq() { return cursorQuery; },
          maybeSingle() { return Promise.resolve({ data: stored, error: null }); },
        };
        return cursorQuery;
      }
      const query = {
        select() { return query; },
        eq() { return query; }, gte() { return query; }, lte() { return query; },
        order() { return query; },
        or(value) { filters.push(value); return query; },
        limit(value) {
          const start = Number(stored.last_event_id.split('-').at(-1)) + 1;
          return Promise.resolve({ data: allRows.slice(start, start + value), error: null });
        },
      };
      return query;
    },
  };
  const loaded = await defaultCandidateLoader({ supabase, nowMs: now });
  assert.equal(loaded.cursorManaged, true);
  assert.equal(loaded.candidates.length, 50);
  assert.equal(loaded.candidates[0].id, 'event-50');
  assert.match(filters[0], /received_at\.gt\..+id\.gt\.event-49/);
});

test('durable cursor commits only through rows before the first transient failure', async () => {
  const saved = [];
  const runtime = createOrphanSignalRecoveryRuntime({
    clock: () => now,
    supabaseFactory: async () => ({}),
    controlLoader: enabledControls,
    candidateLoader: async () => ({
      cursorManaged: true,
      candidates: [
        completeSignal({ id: 'done', external_event_id: 'telegram:-100:79' }),
        completeSignal({ id: 'retry', external_event_id: 'telegram:-100:80' }),
        completeSignal({ id: 'sibling', external_event_id: 'telegram:-100:81' }),
      ],
    }),
    brokerRouteMatcher: async () => true,
    groupMatcher: async () => false,
    enqueueFn: async (_env, _source, event) => {
      if (event.external_event_id.endsWith(':80')) throw new Error('temporary queue failure');
    },
    cursorSaver: async ({ candidate }) => saved.push(candidate.id),
  });
  const result = await runtime({ SOURCE_EVENT_QUEUE: { send() {} } });
  assert.equal(result.enqueued, 2);
  assert.equal(result.failed, 1);
  assert.deepEqual(saved, ['done']);
});
