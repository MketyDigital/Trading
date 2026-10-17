import test from 'node:test';
import assert from 'node:assert/strict';
import { createMtprotoRecoveryRuntime } from '../src/sources/mtproto/recovery_runtime.js';

test('runtime composes one Supabase client, tenant-scoped store, lifecycle service and supervisor', async () => {
  const seen = {};
  const supabase = { marker: 'supabase' };
  const namespace = { marker: 'namespace' };
  const store = { marker: 'store' };
  const lifecycle = { marker: 'lifecycle' };
  const supervisor = { async run() { return { checked: 2, restarted: 1 }; } };

  const runtime = createMtprotoRecoveryRuntime({
    supabaseFactory: async (env) => { seen.supabaseEnv = env; return supabase; },
    storeFactory: (value) => { seen.storeSupabase = value; return store; },
    lifecycleFactory: (args) => { seen.lifecycleArgs = args; return lifecycle; },
    supervisorFactory: (args) => { seen.supervisorArgs = args; return supervisor; },
  });
  const env = {
    SUPABASE_URL: 'https://example.supabase.co',
    SUPABASE_SERVICE_ROLE: 'secret',
    TRADING_MASTER_KEY: 'master',
    MTPROTO_CONTAINER_NAMESPACE: namespace,
  };

  const result = await runtime(env);

  assert.deepEqual(result, { checked: 2, restarted: 1 });
  assert.equal(seen.storeSupabase, supabase);
  assert.deepEqual(seen.lifecycleArgs, { supabase, sourceRepository: null, namespace, env });
  assert.deepEqual(seen.supervisorArgs, { lifecycle, store });
  assert.equal(seen.supabaseEnv, env);
});

test('runtime fails closed by configuration name before constructing recovery dependencies', async () => {
  let factoryCalls = 0;
  const runtime = createMtprotoRecoveryRuntime({
    supabaseFactory: async () => { factoryCalls += 1; return {}; },
  });

  await assert.rejects(
    runtime({}),
    /SUPABASE_URL|SUPABASE_SERVICE_ROLE|TRADING_MASTER_KEY|MTPROTO_CONTAINER_NAMESPACE/,
  );
  assert.equal(factoryCalls, 0);
});

test('storage runtime uses the source repository without constructing Supabase', async () => {
  let factoryCalls = 0;
  const sourceRepository = { marker: 'd1-source-repository' };
  const namespace = { marker: 'namespace' };
  let lifecycleArgs;
  const runtime = createMtprotoRecoveryRuntime({
    supabaseFactory: async () => { factoryCalls += 1; throw new Error('Supabase must not be used'); },
    storeFactory: (repository) => { assert.equal(repository, sourceRepository); return { marker: 'store' }; },
    lifecycleFactory: (args) => { lifecycleArgs = args; return { marker: 'lifecycle' }; },
    supervisorFactory: () => ({ async run() { return { checked: 0, restarted: 0 }; } }),
  });

  const result = await runtime({
    TRADING_MASTER_KEY: 'master',
    MTPROTO_CONTAINER_NAMESPACE: namespace,
  }, { persistenceRuntime: { sourceConnections: sourceRepository } });

  assert.deepEqual(result, { checked: 0, restarted: 0 });
  assert.equal(factoryCalls, 0);
  assert.deepEqual(lifecycleArgs, { supabase: null, sourceRepository, namespace,
    env: { TRADING_MASTER_KEY: 'master', MTPROTO_CONTAINER_NAMESPACE: namespace } });
});
