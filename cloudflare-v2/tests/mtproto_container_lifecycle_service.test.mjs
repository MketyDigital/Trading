import test from 'node:test';
import assert from 'node:assert/strict';

import { createMtprotoContainerLifecycleService } from '../src/sources/mtproto/container_lifecycle_service.js';

function namespaceRecorder() {
  const names = [];
  const calls = [];
  const stubs = new Map();
  return {
    names,
    calls,
    getByName(name) {
      names.push(name);
      if (!stubs.has(name)) {
        stubs.set(name, {
          async ensureStarted(input) {
            calls.push(['start', name, input]);
            return { running: true, status: 'HEALTHY', apiHash: 'must-not-leak' };
          },
          async restartRuntime(input) {
            calls.push(['restart', name, input]);
            return { running: true, status: 'HEALTHY', sessionString: 'must-not-leak' };
          },
          async stopRuntime() {
            calls.push(['stop', name]);
            return { running: false, status: 'DISABLED' };
          },
          async runtimeStatus() {
            calls.push(['status', name]);
            return {
              status: 'HEALTHY', running: true, connected: true,
              lastHeartbeatAt: '2026-09-02T00:00:00Z', lastEventAt: null, restartCount: 2,
              bootstrap: { apiHash: 'must-not-leak' }, provider_secret_ciphertext: 'must-not-leak',
            };
          },
        });
      }
      return stubs.get(name);
    },
  };
}

function resolved(workspaceId, sourceId, accountScope, marker) {
  return {
    identity: { workspaceId, sourceId, accountScope },
    bootstrap: {
      apiId: 123,
      apiHash: `hash-${marker}`,
      sessionString: `session-${marker}`,
      chatIds: [`chat-${marker}`],
      internalSourceUrl: 'https://trusted.example/api/v1/internal/source-event',
      internalSourceToken: `token-${marker}`,
    },
  };
}

test('start derives exact runtime and bootstrap server-side, ignoring caller bootstrap completely', async () => {
  const namespace = namespaceRecorder();
  const resolverCalls = [];
  const service = createMtprotoContainerLifecycleService({
    namespace,
    supabase: { from() {} },
    masterKey: 'master-key',
    internalSourceUrl: 'https://trusted.example/internal',
    internalSourceToken: 'trusted-token',
    bootstrapResolver: async (input) => {
      resolverCalls.push(input);
      return resolved('workspace-a', 'source-a', 'account-a', 'a');
    },
  });

  const result = await service.start({
    workspaceId: 'workspace-a',
    sourceId: 'source-a',
    bootstrap: { apiHash: 'attacker', sessionString: 'attacker' },
  });

  assert.deepEqual(result, { started: true, status: 'HEALTHY' });
  assert.equal(namespace.names[0], 'mtproto:workspace-a:account-a');
  assert.equal(resolverCalls.length, 1);
  assert.equal('bootstrap' in resolverCalls[0], false);
  assert.equal(namespace.calls[0][2].bootstrap.apiHash, 'hash-a');
  assert.equal(namespace.calls[0][2].bootstrap.sessionString, 'session-a');
});

test('different workspaces cannot share runtime names or bootstrap', async () => {
  const namespace = namespaceRecorder();
  const service = createMtprotoContainerLifecycleService({
    namespace,
    supabase: { from() {} },
    masterKey: 'master-key',
    internalSourceUrl: 'https://trusted.example/internal',
    internalSourceToken: 'trusted-token',
    bootstrapResolver: async ({ workspaceId, sourceId }) =>
      workspaceId === 'workspace-a'
        ? resolved(workspaceId, sourceId, 'account-a', 'a')
        : resolved(workspaceId, sourceId, 'account-b', 'b'),
  });

  await service.start({ workspaceId: 'workspace-a', sourceId: 'source-a' });
  await service.start({ workspaceId: 'workspace-b', sourceId: 'source-b' });

  assert.deepEqual(namespace.names, [
    'mtproto:workspace-a:account-a',
    'mtproto:workspace-b:account-b',
  ]);
  assert.equal(namespace.calls[0][2].bootstrap.apiHash, 'hash-a');
  assert.equal(namespace.calls[1][2].bootstrap.apiHash, 'hash-b');
});

test('restart reacquires bootstrap server-side instead of reusing caller or stale credentials', async () => {
  const namespace = namespaceRecorder();
  let version = 0;
  const service = createMtprotoContainerLifecycleService({
    namespace,
    supabase: { from() {} },
    masterKey: 'master-key',
    internalSourceUrl: 'https://trusted.example/internal',
    internalSourceToken: 'trusted-token',
    bootstrapResolver: async () => {
      version += 1;
      return resolved('workspace-a', 'source-a', 'account-a', version);
    },
  });

  await service.start({ workspaceId: 'workspace-a', sourceId: 'source-a' });
  await service.restart({
    workspaceId: 'workspace-a', sourceId: 'source-a',
    bootstrap: { apiHash: 'stale-caller-value' },
  });

  assert.equal(version, 2);
  assert.equal(namespace.calls[0][2].bootstrap.apiHash, 'hash-1');
  assert.equal(namespace.calls[1][2].bootstrap.apiHash, 'hash-2');
});

test('status resolves tenant identity server-side and returns only sanitized common health', async () => {
  const namespace = namespaceRecorder();
  const service = createMtprotoContainerLifecycleService({
    namespace,
    supabase: { from() {} },
    masterKey: 'master-key',
    internalSourceUrl: 'https://trusted.example/internal',
    internalSourceToken: 'trusted-token',
    bootstrapResolver: async () => resolved('workspace-a', 'source-a', 'account-a', 'a'),
  });

  const status = await service.status({ workspaceId: 'workspace-a', sourceId: 'source-a' });
  assert.deepEqual(status, {
    status: 'HEALTHY', running: true, connected: true,
    lastHeartbeatAt: '2026-09-02T00:00:00Z', lastEventAt: null, restartCount: 2,
  });
  assert.equal(JSON.stringify(status).includes('hash-'), false);
  assert.equal(JSON.stringify(status).includes('ciphertext'), false);
});
