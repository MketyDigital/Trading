import test from 'node:test';
import assert from 'node:assert/strict';
import { createMtprotoRecoverySupervisor } from '../src/sources/mtproto/recovery_supervisor.js';

function source(overrides = {}) {
  return {
    id: 'source-a',
    workspaceId: 'workspace-a',
    recoveryAttemptCount: 0,
    recoveryNextAttemptAt: null,
    ...overrides,
  };
}

function createHarness({ sources, statuses = {}, restartResults = {}, now = '2026-09-02T09:30:00.000Z' }) {
  const restarts = [];
  const updates = [];
  const lifecycle = {
    async status({ workspaceId, sourceId }) {
      const key = `${workspaceId}:${sourceId}`;
      const value = statuses[key];
      if (value instanceof Error) throw value;
      return value || { status: 'HEALTHY', running: true, connected: true };
    },
    async restart(request) {
      restarts.push(request);
      const key = `${request.workspaceId}:${request.sourceId}`;
      const value = restartResults[key];
      if (value instanceof Error) throw value;
      return value || { restarted: true, status: 'STARTING' };
    },
  };
  const store = {
    async listRecoverableSources() { return sources; },
    async updateRecoveryState(workspaceId, sourceId, patch) {
      updates.push({ workspaceId, sourceId, patch });
    },
  };
  const supervisor = createMtprotoRecoverySupervisor({
    lifecycle,
    store,
    now: () => new Date(now),
    maxAttempts: 3,
    baseBackoffMs: 1000,
    maxBackoffMs: 8000,
  });
  return { supervisor, restarts, updates };
}

test('healthy runtime resets only its own durable recovery state and does not restart', async () => {
  const { supervisor, restarts, updates } = createHarness({
    sources: [source({ recoveryAttemptCount: 2, recoveryNextAttemptAt: '2026-09-02T09:31:00.000Z' })],
  });

  const result = await supervisor.run();

  assert.equal(result.checked, 1);
  assert.equal(result.restarted, 0);
  assert.deepEqual(restarts, []);
  assert.deepEqual(updates, [{
    workspaceId: 'workspace-a',
    sourceId: 'source-a',
    patch: { recoveryAttemptCount: 0, recoveryNextAttemptAt: null, lastRecoveryErrorCode: null },
  }]);
});

test('degraded runtime restarts exact tenant source without caller bootstrap and clears recovery state on success', async () => {
  const { supervisor, restarts, updates } = createHarness({
    sources: [source()],
    statuses: {
      'workspace-a:source-a': { status: 'DEGRADED', running: false, connected: false },
    },
  });

  const result = await supervisor.run();

  assert.equal(result.restarted, 1);
  assert.deepEqual(restarts, [{ workspaceId: 'workspace-a', sourceId: 'source-a' }]);
  assert.deepEqual(updates, [{
    workspaceId: 'workspace-a',
    sourceId: 'source-a',
    patch: {
      recoveryAttemptCount: 0,
      recoveryNextAttemptAt: null,
      lastRecoveryAt: '2026-09-02T09:30:00.000Z',
      lastRecoveryErrorCode: null,
    },
  }]);
});

test('failed recovery persists bounded backoff and does not block another workspace', async () => {
  const { supervisor, restarts, updates } = createHarness({
    sources: [
      source({ id: 'source-a', workspaceId: 'workspace-a' }),
      source({ id: 'source-b', workspaceId: 'workspace-b' }),
    ],
    statuses: {
      'workspace-a:source-a': { status: 'ERROR', running: false, connected: false },
      'workspace-b:source-b': { status: 'DEGRADED', running: false, connected: false },
    },
    restartResults: {
      'workspace-a:source-a': new Error('container failed'),
      'workspace-b:source-b': { restarted: true, status: 'STARTING' },
    },
  });

  const result = await supervisor.run();

  assert.equal(result.failed, 1);
  assert.equal(result.restarted, 1);
  assert.deepEqual(restarts, [
    { workspaceId: 'workspace-a', sourceId: 'source-a' },
    { workspaceId: 'workspace-b', sourceId: 'source-b' },
  ]);
  assert.deepEqual(updates[0], {
    workspaceId: 'workspace-a',
    sourceId: 'source-a',
    patch: {
      recoveryAttemptCount: 1,
      recoveryNextAttemptAt: '2026-09-02T09:30:01.000Z',
      lastRecoveryAt: '2026-09-02T09:30:00.000Z',
      lastRecoveryErrorCode: 'MTPROTO_RECOVERY_FAILED',
    },
  });
  assert.equal(updates[1].workspaceId, 'workspace-b');
  assert.equal(updates[1].sourceId, 'source-b');
  assert.equal(updates[1].patch.recoveryAttemptCount, 0);
});

test('backoff and exhausted sources are skipped durably without touching runtime', async () => {
  const { supervisor, restarts } = createHarness({
    sources: [
      source({ id: 'backoff', recoveryAttemptCount: 1, recoveryNextAttemptAt: '2026-09-02T09:30:10.000Z' }),
      source({ id: 'exhausted', recoveryAttemptCount: 3, recoveryNextAttemptAt: null }),
    ],
    statuses: {
      'workspace-a:backoff': { status: 'ERROR', running: false, connected: false },
      'workspace-a:exhausted': { status: 'ERROR', running: false, connected: false },
    },
  });

  const result = await supervisor.run();

  assert.equal(result.backoff, 1);
  assert.equal(result.exhausted, 1);
  assert.deepEqual(restarts, []);
});
