import { createMtprotoRecoveryStore } from './recovery_store.js';
import { createMtprotoContainerLifecycleService } from './container_lifecycle_service.js';
import { createMtprotoRecoverySupervisor } from './recovery_supervisor.js';

function validateEnvironment(env = {}, { persistenceRuntime = null } = {}) {
  const missing = [];
  if (!persistenceRuntime) missing.push('TRADING_PERSISTENCE_RUNTIME');
  if (!String(env.TRADING_MASTER_KEY || '').trim()) missing.push('TRADING_MASTER_KEY');
  if (!env.MTPROTO_CONTAINER_NAMESPACE) missing.push('MTPROTO_CONTAINER_NAMESPACE');
  if (missing.length) throw new Error(`MTPROTO_RECOVERY_CONFIG_MISSING:${missing.join(',')}`);
}

function defaultLifecycleFactory({ sourceRepository, namespace, env }) {
  return createMtprotoContainerLifecycleService({
    sourceRepository,
    namespace,
    masterKey: env.TRADING_MASTER_KEY,
    internalSourceUrl: env.MTPROTO_INTERNAL_SOURCE_URL,
    internalSourceToken: env.INTERNAL_SOURCE_TRANSPORT_TOKEN,
  });
}

export function createMtprotoRecoveryRuntime({
  storeFactory = createMtprotoRecoveryStore,
  lifecycleFactory = defaultLifecycleFactory,
  supervisorFactory = createMtprotoRecoverySupervisor,
} = {}) {
  return async function runMtprotoRecovery(env = {}, { persistenceRuntime = null } = {}) {
    validateEnvironment(env, { persistenceRuntime });

    const sourceRepository = persistenceRuntime?.sourceConnections || null;
    if (!sourceRepository) throw new Error('MTPROTO_RECOVERY_SOURCE_STORE_UNAVAILABLE');
    const store = storeFactory(sourceRepository);
    const lifecycle = lifecycleFactory({
      sourceRepository,
      namespace: env.MTPROTO_CONTAINER_NAMESPACE,
      env,
    });
    const supervisor = supervisorFactory({ lifecycle, store });
    return supervisor.run();
  };
}
