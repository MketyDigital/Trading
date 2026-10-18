import { createTradingDemoDeliveryStore, validateTradingDemoStorageEnvironment } from './trading_demo_delivery_store.js';

export function validateMT5DemoCommandEnvironment(env = {}) {
  const result = validateTradingDemoStorageEnvironment(env);
  return { ...result, configured: result.ok ? ['TRADING_STORAGE_AUTHORITY', 'TRADING_PG_STAGING_DATABASE_URL', 'TRADING_MASTER_KEY', 'TRADING_WORKSPACE_ID'] : [] };
}

export async function buildMT5DemoCommandDependencies({ env = {}, runtimeFactory } = {}) {
  return createTradingDemoDeliveryStore({
    env,
    runtimeFactory,
    destinationType: 'mt5',
    destinationRef: `demo:${String(env.MT5_ACCOUNT_ID ?? '')}`,
  });
}
