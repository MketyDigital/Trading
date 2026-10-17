import { createMtprotoRecoveryStore } from './recovery_store.js';
import { createMtprotoContainerLifecycleService } from './container_lifecycle_service.js';
import { createMtprotoRecoverySupervisor } from './recovery_supervisor.js';

function serviceRole(env = {}) {
  return String(
    env.SUPABASE_SERVICE_ROLE
      || env.SUPABASE_SERVICE_ROLE_KEY
      || env.SUPABASE_SECRET_KEY
      || '',
  ).trim();
}

function validateEnvironment(env = {}, { persistenceRuntime = null } = {}) {
  const missing = [];
  if (!persistenceRuntime && !String(env.SUPABASE_URL || '').trim()) missing.push('SUPABASE_URL');
  if (!persistenceRuntime && !serviceRole(env)) missing.push('SUPABASE_SERVICE_ROLE');
  if (!String(env.TRADING_MASTER_KEY || '').trim()) missing.push('TRADING_MASTER_KEY');
  if (!env.MTPROTO_CONTAINER_NAMESPACE) missing.push('MTPROTO_CONTAINER_NAMESPACE');
  if (missing.length) throw new Error(`MTPROTO_RECOVERY_CONFIG_MISSING:${missing.join(',')}`);
}

async function defaultSupabaseFactory(env) {
  const { createClient } = await import('@supabase/supabase-js');
  return createClient(String(env.SUPABASE_URL).trim(), serviceRole(env), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function defaultLifecycleFactory({ supabase, sourceRepository, namespace, env }) {
  return createMtprotoContainerLifecycleService({
    supabase,
    sourceRepository,
    namespace,
    masterKey: env.TRADING_MASTER_KEY,
    internalSourceUrl: env.MTPROTO_INTERNAL_SOURCE_URL,
    internalSourceToken: env.INTERNAL_SOURCE_TRANSPORT_TOKEN,
  });
}

export function createMtprotoRecoveryRuntime({
  supabaseFactory = defaultSupabaseFactory,
  storeFactory = createMtprotoRecoveryStore,
  lifecycleFactory = defaultLifecycleFactory,
  supervisorFactory = createMtprotoRecoverySupervisor,
} = {}) {
  return async function runMtprotoRecovery(env = {}, { persistenceRuntime = null } = {}) {
    validateEnvironment(env, { persistenceRuntime });

    const supabase = persistenceRuntime ? null : await supabaseFactory(env);
    const sourceRepository = persistenceRuntime?.sourceConnections || null;
    const store = storeFactory(sourceRepository || supabase);
    const lifecycle = lifecycleFactory({
      supabase,
      sourceRepository,
      namespace: env.MTPROTO_CONTAINER_NAMESPACE,
      env,
    });
    const supervisor = supervisorFactory({ lifecycle, store });
    return supervisor.run();
  };
}
