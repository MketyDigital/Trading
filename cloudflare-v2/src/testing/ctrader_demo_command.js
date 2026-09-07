import { createClient } from '@supabase/supabase-js';
import { SupabaseDeliveryStore } from '../persistence/supabase_delivery_store.js';

const REQUIRED_SERVER_ENV = [
  'SUPABASE_URL',
  'TRADING_WORKSPACE_ID',
];

function resolveSupabaseServiceRole(env = {}) {
  return String(
    env.SUPABASE_SERVICE_ROLE
    ?? env.SUPABASE_SERVICE_ROLE_KEY
    ?? env.SUPABASE_SERVICE_KEY
    ?? '',
  ).trim();
}

export function validateCTraderDemoCommandEnvironment(env = {}) {
  const missing = REQUIRED_SERVER_ENV.filter((name) => String(env[name] ?? '').trim() === '');
  const serviceRoleConfigured = resolveSupabaseServiceRole(env) !== '';
  if (!serviceRoleConfigured) missing.splice(1, 0, 'SUPABASE_SERVICE_ROLE');

  return {
    ok: missing.length === 0,
    missing,
    configured: [
      ...REQUIRED_SERVER_ENV.filter((name) => !missing.includes(name)),
      ...(serviceRoleConfigured ? ['SUPABASE_SERVICE_ROLE'] : []),
    ],
  };
}

export function buildCTraderDemoCommandDependencies({
  env = {},
  createClientFn = createClient,
} = {}) {
  const readiness = validateCTraderDemoCommandEnvironment(env);
  if (!readiness.ok) {
    throw new Error(`Missing cTrader demo command configuration: ${readiness.missing.join(', ')}`);
  }

  const supabase = createClientFn(
    env.SUPABASE_URL,
    resolveSupabaseServiceRole(env),
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    },
  );

  return {
    deliveryStore: new SupabaseDeliveryStore(supabase, {
      workspaceId: env.TRADING_WORKSPACE_ID,
      destinationType: 'ctrader',
      destinationRef: `demo:${String(env.CTRADER_ACCOUNT_ID ?? '')}`,
    }),
  };
}
