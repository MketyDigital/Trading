import test from 'node:test';
import assert from 'node:assert/strict';
import { createMtprotoRecoveryRuntime } from '../src/sources/mtproto/recovery_runtime.js';

test('runtime composes the Trading source repository, lifecycle service and supervisor', async () => {
  const seen = {};
  const sourceRepository = { marker: 'postgres-source-repository' };
  const namespace = { marker: 'namespace' };
  const store = { marker: 'store' };
  const lifecycle = { marker: 'lifecycle' };
  const supervisor = { async run() { return { checked: 2, restarted: 1 }; } };

  const runtime = createMtprotoRecoveryRuntime({
    storeFactory: (value) => { seen.sourceRepository = value; return store; },
    lifecycleFactory: (args) => { seen.lifecycleArgs = args; return lifecycle; },
    supervisorFactory: (args) => { seen.supervisorArgs = args; return supervisor; },
  });
  const env = {
    TRADING_MASTER_KEY: 'master',
    MTPROTO_CONTAINER_NAMESPACE: namespace,
  };

  const result = await runtime(env, { persistenceRuntime: { sourceConnections: sourceRepository } });

  assert.deepEqual(result, { checked: 2, restarted: 1 });
  assert.equal(seen.sourceRepository, sourceRepository);
  assert.deepEqual(seen.lifecycleArgs, { sourceRepository, namespace, env });
  assert.deepEqual(seen.supervisorArgs, { lifecycle, store });
});

test('runtime fails closed by configuration name before constructing recovery dependencies', async () => {
  const runtime = createMtprotoRecoveryRuntime();

  await assert.rejects(
    runtime({}),
    /TRADING_PERSISTENCE_RUNTIME|TRADING_MASTER_KEY|MTPROTO_CONTAINER_NAMESPACE/,
  );
});

test('storage runtime uses the source repository without constructing Supabase', async () => {
  const sourceRepository = { marker: 'd1-source-repository' };
  const namespace = { marker: 'namespace' };
  let lifecycleArgs;
  const runtime = createMtprotoRecoveryRuntime({
    storeFactory: (repository) => { assert.equal(repository, sourceRepository); return { marker: 'store' }; },
    lifecycleFactory: (args) => { lifecycleArgs = args; return { marker: 'lifecycle' }; },
    supervisorFactory: () => ({ async run() { return { checked: 0, restarted: 0 }; } }),
  });

  const result = await runtime({
    TRADING_MASTER_KEY: 'master',
    MTPROTO_CONTAINER_NAMESPACE: namespace,
  }, { persistenceRuntime: { sourceConnections: sourceRepository } });

  assert.deepEqual(result, { checked: 0, restarted: 0 });
  assert.deepEqual(lifecycleArgs, { sourceRepository, namespace,
    env: { TRADING_MASTER_KEY: 'master', MTPROTO_CONTAINER_NAMESPACE: namespace } });
});
