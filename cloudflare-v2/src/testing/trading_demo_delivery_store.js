import { createTradingPersistenceRuntime } from '../persistence/trading_persistence_runtime.js';

export function validateTradingDemoStorageEnvironment(env = {}) {
  const required = [
    'TRADING_PG_STAGING_DATABASE_URL',
    'TRADING_MASTER_KEY',
    'TRADING_WORKSPACE_ID',
    'TRADING_STORAGE_AUTHORITY_EPOCH',
  ];
  const missing = required.filter((key) => !String(env[key] ?? '').trim());
  if (String(env.TRADING_STORAGE_AUTHORITY || '').trim().toLowerCase() !== 'postgres') {
    missing.unshift('TRADING_STORAGE_AUTHORITY=postgres');
  }
  return { ok: missing.length === 0, missing };
}

export async function createTradingDemoDeliveryStore({ env = {}, destinationType, destinationRef, runtimeFactory = createTradingPersistenceRuntime } = {}) {
  const readiness = validateTradingDemoStorageEnvironment(env);
  if (!readiness.ok) throw new Error(`Missing Trading PostgreSQL demo configuration: ${readiness.missing.join(', ')}`);

  const runtime = await runtimeFactory({
    ...env,
    TRADING_STORAGE_AUTHORITY: 'postgres',
    TRADING_PG: { connectionString: env.TRADING_PG_STAGING_DATABASE_URL },
  });
  try {
    const deliveryStore = runtime.delivery({
      workspaceId: env.TRADING_WORKSPACE_ID,
      destinationType,
      destinationRef,
    });
    return { deliveryStore, close: () => runtime.close?.() };
  } catch (error) {
    await runtime.close?.();
    throw error;
  }
}
