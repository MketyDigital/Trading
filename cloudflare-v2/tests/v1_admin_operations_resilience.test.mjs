import test from 'node:test';
import assert from 'node:assert/strict';

import { createAdminOperationsStore } from '../src/http/v1_admin_operations.js';

function emptySupabase() {
  return {
    from() {
      const chain = {
        options: {},
        select(_columns, options = {}) { chain.options = options; return chain; },
        eq() { return chain; },
        in() { return chain; },
        lte() { return chain; },
        order() { return chain; },
        limit() { return chain; },
        then(resolve, reject) {
          const result = chain.options?.head === true
            ? { data: null, count: 0, error: null }
            : { data: [], count: null, error: null };
          return Promise.resolve(result).then(resolve, reject);
        },
      };
      return chain;
    },
  };
}

test('operations snapshot adds exact-workspace secret-free resilience counters and latency percentiles', async () => {
  let requestedWorkspaceId;
  const resilienceMetricsSource = {
    async snapshot(workspaceId) {
      requestedWorkspaceId = workspaceId;
      return {
        workspaceId: 'ws-1',
        fallbackCounts: {
          ambiguityAiReview: 4,
          destinationAiFallback: 9,
        },
        retryRate: 0.125,
        uncertainRate: 0.025,
        latencyMs: {
          sourceToBrokerSend: { p50: 120, p95: 340, p99: 510 },
          brokerRoundTrip: { p50: 55, p95: 140, p99: 210 },
          sourceToDestinationAck: { p50: 160, p95: 430, p99: 680 },
        },
        token: 'must-never-leak',
        api_key: 'must-never-leak-either',
        nested: { credential: 'must-never-leak' },
      };
    },
  };

  const store = createAdminOperationsStore(emptySupabase(), {
    nowFn: () => new Date('2026-09-03T14:00:00.000Z'),
    resilienceMetricsSource,
  });
  const result = await store.snapshot('ws-1');

  assert.equal(requestedWorkspaceId, 'ws-1');
  assert.deepEqual(result.resilience, {
    available: true,
    fallbackCounts: {
      ambiguityAiReview: 4,
      destinationAiFallback: 9,
    },
    retryRate: 0.125,
    uncertainRate: 0.025,
    latencyMs: {
      sourceToBrokerSend: { p50: 120, p95: 340, p99: 510 },
      brokerRoundTrip: { p50: 55, p95: 140, p99: 210 },
      sourceToDestinationAck: { p50: 160, p95: 430, p99: 680 },
    },
  });
  assert.doesNotMatch(JSON.stringify(result), /must-never-leak/);
});

test('resilience metrics are workspace-authoritative and a scope mismatch fails closed', async () => {
  const store = createAdminOperationsStore(emptySupabase(), {
    resilienceMetricsSource: {
      async snapshot() {
        return {
          workspaceId: 'ws-2',
          fallbackCounts: { ambiguityAiReview: 1, destinationAiFallback: 1 },
          retryRate: 0,
          uncertainRate: 0,
          latencyMs: {},
        };
      },
    },
  });

  await assert.rejects(() => store.snapshot('ws-1'), /workspace scope mismatch/i);
});

test('metrics source outage is non-authoritative and reports unavailable without failing durable operations snapshot', async () => {
  const store = createAdminOperationsStore(emptySupabase(), {
    resilienceMetricsSource: {
      async snapshot() {
        throw new Error('metrics backend unavailable');
      },
    },
  });

  const result = await store.snapshot('ws-1');
  assert.equal(result.workspaceId, 'ws-1');
  assert.deepEqual(result.resilience, { available: false });
  assert.deepEqual(result.deliveries.counts, {
    PENDING: 0,
    SUCCEEDED: 0,
    RETRYABLE: 0,
    UNCERTAIN: 0,
    FAILED: 0,
  });
});

test('missing metrics source is additive-only and reports unavailable', async () => {
  const store = createAdminOperationsStore(emptySupabase());
  const result = await store.snapshot('ws-1');
  assert.deepEqual(result.resilience, { available: false });
});
