function present(value) {
  if (value == null) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  return true;
}

function enabled(value) {
  return ['1', 'true', 'yes', 'on'].includes(String(value ?? '').trim().toLowerCase());
}

function hasServiceRole(env = {}) {
  return present(env.SUPABASE_SERVICE_ROLE) ||
    present(env.SUPABASE_SERVICE_ROLE_KEY) ||
    present(env.SUPABASE_SERVICE_KEY);
}

const OPTIONAL_KEYS = [
  'ZITADEL_PROJECT_ID',
  'ZITADEL_TRADING_ROLE',
  'TRADING_V1_AI_TIMEOUT_MS',
  'TRADING_V1_SIMULATION_EXPOSURES',
];

export function validateStagingReadiness(
  env = {},
  { requireSimulation = false, requireMtprotoContainer = false } = {},
) {
  const missing = [];

  if (!present(env.SUPABASE_URL)) missing.push('SUPABASE_URL');
  if (!hasServiceRole(env)) missing.push('SUPABASE_SERVICE_ROLE');
  if (!present(env.TRADING_MASTER_KEY)) missing.push('TRADING_MASTER_KEY');
  if (!present(env.ZITADEL_ISSUER)) missing.push('ZITADEL_ISSUER');
  if (!present(env.ZITADEL_AUDIENCE)) missing.push('ZITADEL_AUDIENCE');
  if (!present(env.ZITADEL_JWKS_URL)) missing.push('ZITADEL_JWKS_URL');

  if (requireSimulation) {
    if (!present(env.TRADE_STATE_INTERNAL_TOKEN)) missing.push('TRADE_STATE_INTERNAL_TOKEN');
    if (!present(env.TRADE_STATE_NAMESPACE)) missing.push('TRADE_STATE_NAMESPACE');
    if (!present(env.TRADING_V1_SIMULATION_INSTRUMENTS)) missing.push('TRADING_V1_SIMULATION_INSTRUMENTS');
    if (!present(env.TRADING_V1_SIMULATION_PRICES)) missing.push('TRADING_V1_SIMULATION_PRICES');
  }

  if (requireMtprotoContainer) {
    if (!present(env.MTPROTO_CONTAINER_NAMESPACE)) missing.push('MTPROTO_CONTAINER_NAMESPACE');
    if (!present(env.MTPROTO_INTERNAL_SOURCE_URL)) missing.push('MTPROTO_INTERNAL_SOURCE_URL');
    if (!present(env.INTERNAL_SOURCE_TRANSPORT_TOKEN)) missing.push('INTERNAL_SOURCE_TRANSPORT_TOKEN');
    if (!present(env.SOURCE_EVENT_QUEUE)) missing.push('SOURCE_EVENT_QUEUE');
  }

  return {
    ready: missing.length === 0,
    missing,
    optionalMissing: OPTIONAL_KEYS.filter((key) => !present(env[key])),
    features: {
      simulationRequested: Boolean(requireSimulation),
      mtprotoContainerRequested: Boolean(requireMtprotoContainer),
      simulationEnabled: enabled(env.TRADING_V1_SIMULATION),
      shadowEnabled: enabled(env.TRADING_V1_SHADOW),
    },
  };
}
