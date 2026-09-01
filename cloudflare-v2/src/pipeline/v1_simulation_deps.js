function parseJsonConfig(value, label) {
  if (!value) return {};
  try {
    const parsed = JSON.parse(String(value));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    throw new Error(`${label} must be valid JSON`);
  }
}

function internalHeaders(env) {
  const token = String(env?.TRADE_STATE_INTERNAL_TOKEN || '');
  if (!token) throw new Error('TRADE_STATE_INTERNAL_TOKEN is not configured');
  return { 'content-type': 'application/json', 'x-mkety-internal-token': token };
}

function createTradeStateClient(env, workspaceId) {
  const namespace = env?.TRADE_STATE_NAMESPACE;
  if (!namespace?.idFromName || !namespace?.get) throw new Error('TRADE_STATE_NAMESPACE is not configured');
  const stub = namespace.get(namespace.idFromName(String(workspaceId)));
  const headers = internalHeaders(env);

  async function call(path, method, payload) {
    const response = await stub.fetch(`https://trade-state.internal${path}`, {
      method,
      headers,
      ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(`Trade State request failed (${response.status}): ${body?.error || 'unknown error'}`);
    return body;
  }

  return {
    stateCoordinator: {
      correlate: (event, interpretation, nowMs) => call('/correlate', 'POST', { event, interpretation, nowMs }),
    },
    stateStore: {
      putGroup: (group) => call('/groups', 'POST', group),
    },
  };
}

function canonicalSymbol(intent = {}) {
  return String(intent?.symbol?.canonical || intent?.symbol || '').toUpperCase();
}

export async function createV1SimulationDependencies({ env = {}, supabase, event = {} } = {}) {
  if (!supabase?.from) throw new Error('Supabase client is required for simulation');
  const workspaceId = String(event?.workspace_hint || '');
  if (!workspaceId) throw new Error('authenticated workspace is required for simulation');

  const state = createTradeStateClient(env, workspaceId);
  const instruments = parseJsonConfig(env.TRADING_V1_SIMULATION_INSTRUMENTS, 'TRADING_V1_SIMULATION_INSTRUMENTS');
  const prices = parseJsonConfig(env.TRADING_V1_SIMULATION_PRICES, 'TRADING_V1_SIMULATION_PRICES');
  const exposures = parseJsonConfig(env.TRADING_V1_SIMULATION_EXPOSURES, 'TRADING_V1_SIMULATION_EXPOSURES');

  return {
    ...state,
    async accountProvider() {
      const { data, error } = await supabase
        .from('trade_accounts')
        .select('*')
        .eq('workspace_id', workspaceId)
        .eq('is_active', true);
      if (error) throw new Error(`failed to load simulation accounts: ${error.message || 'database error'}`);
      return data || [];
    },
    async instrumentProvider(_account, intent) {
      const symbol = canonicalSymbol(intent);
      const instrument = instruments[symbol];
      if (!instrument || typeof instrument !== 'object') {
        throw new Error(`simulation instrument metadata is not configured for ${symbol || 'UNKNOWN'}`);
      }
      return { canonical: symbol, ...instrument };
    },
    async marketPriceProvider(_account, intent) {
      const symbol = canonicalSymbol(intent);
      const price = Number(prices[symbol]);
      return Number.isFinite(price) ? price : undefined;
    },
    async exposureProvider(account) {
      const configured = exposures[String(account?.id || '')];
      return configured && typeof configured === 'object' ? configured : {};
    },
  };
}
