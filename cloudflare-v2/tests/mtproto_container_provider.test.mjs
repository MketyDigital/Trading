import test from 'node:test';
import assert from 'node:assert/strict';

import { createContainerMtprotoProvider } from '../src/sources/mtproto/container_provider.js';

function source(overrides = {}) {
  return {
    id: 'src-container-1',
    workspaceId: 'ws-1',
    providerType: 'cloudflare_container_mtproto',
    sourceFamily: 'telegram',
    enabled: true,
    externalIdentity: 'telegram-account-42',
    ...overrides,
  };
}

function fakeNamespace() {
  const names = [];
  const calls = [];
  const stub = {
    async ensureStarted(input) {
      calls.push(['ensureStarted', input]);
      return { running: true, status: 'HEALTHY' };
    },
    async stopRuntime() {
      calls.push(['stopRuntime']);
      return { running: false, status: 'DISABLED' };
    },
    async restartRuntime(input) {
      calls.push(['restartRuntime', input]);
      return { running: true, status: 'STARTING' };
    },
    async runtimeStatus() {
      calls.push(['runtimeStatus']);
      return {
        running: true,
        status: 'HEALTHY',
        connected: true,
        lastHeartbeatAt: '2026-09-02T06:00:00.000Z',
        lastEventAt: '2026-09-02T05:59:59.000Z',
        restartCount: 2,
        apiHash: 'must-not-leak',
        sessionString: 'must-not-leak',
        secret: 'must-not-leak',
      };
    },
  };
  return {
    names,
    calls,
    binding: {
      getByName(name) {
        names.push(name);
        return stub;
      },
    },
  };
}

test('unconfigured or disabled container provider is inert', async () => {
  const fake = fakeNamespace();
  const provider = createContainerMtprotoProvider({ namespace: fake.binding });

  const unconfigured = await provider.start(source({ externalIdentity: null }));
  const disabled = await provider.start(source({ enabled: false }));

  assert.deepEqual(unconfigured, { started: false, status: 'UNCONFIGURED' });
  assert.deepEqual(disabled, { started: false, status: 'DISABLED' });
  assert.deepEqual(fake.names, []);
  assert.deepEqual(fake.calls, []);
});

test('one enabled Telegram session deterministically maps to one container instance', async () => {
  const fake = fakeNamespace();
  const provider = createContainerMtprotoProvider({ namespace: fake.binding });
  const bootstrap = { apiId: 12345, apiHash: 'private-hash', sessionString: 'private-session' };

  const first = await provider.start(source(), { bootstrap });
  const second = await provider.start(source(), { bootstrap });

  assert.equal(first.status, 'HEALTHY');
  assert.equal(second.status, 'HEALTHY');
  assert.deepEqual(fake.names, [
    'mtproto:ws-1:telegram-account-42',
    'mtproto:ws-1:telegram-account-42',
  ]);
  assert.equal(fake.calls.filter(([name]) => name === 'ensureStarted').length, 2);
});

test('restart is idempotent with respect to container identity', async () => {
  const fake = fakeNamespace();
  const provider = createContainerMtprotoProvider({ namespace: fake.binding });

  await provider.restart(source());
  await provider.restart(source());

  assert.deepEqual(new Set(fake.names), new Set(['mtproto:ws-1:telegram-account-42']));
  assert.equal(fake.calls.filter(([name]) => name === 'restartRuntime').length, 2);
});

test('status exposes common health fields and strips credentials/internal values', async () => {
  const fake = fakeNamespace();
  const provider = createContainerMtprotoProvider({ namespace: fake.binding });

  const status = await provider.status(source());

  assert.deepEqual(status, {
    status: 'HEALTHY',
    running: true,
    connected: true,
    lastHeartbeatAt: '2026-09-02T06:00:00.000Z',
    lastEventAt: '2026-09-02T05:59:59.000Z',
    restartCount: 2,
  });
  assert.equal(JSON.stringify(status).includes('must-not-leak'), false);
});

test('wrong provider type fails closed before touching a container binding', async () => {
  const fake = fakeNamespace();
  const provider = createContainerMtprotoProvider({ namespace: fake.binding });

  await assert.rejects(
    () => provider.start(source({ providerType: 'external_mtproto' })),
    /cloudflare container mtproto/i,
  );
  assert.deepEqual(fake.names, []);
});
