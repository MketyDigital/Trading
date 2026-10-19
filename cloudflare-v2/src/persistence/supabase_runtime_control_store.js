const CONTROL_KEYS = Object.freeze({
  tradingAccess: 'trading_access_enabled',
  brokerExecution: 'broker_execution_enabled',
  liveBrokerExecution: 'live_broker_execution_enabled',
});

function unavailable(reason = 'RUNTIME_CONTROL_UNAVAILABLE') {
  return { ok: false, enabled: false, reason };
}

function publicControl(data) {
  if (!data) return unavailable();
  return {
    ok: true,
    enabled: data.enabled === true,
    updatedAt: data.updated_at || null,
    updatedBy: data.updated_by || null,
  };
}

export function createTradingRuntimeControlStore(supabase) {
  if (!supabase?.from) throw new TypeError('Supabase client is required');

  async function getControl(controlKey) {
    const { data, error } = await supabase
      .from('trading_runtime_controls')
      .select('control_key,enabled,updated_at,updated_by')
      .eq('control_key', controlKey)
      .maybeSingle();
    if (error || !data) return unavailable();
    return publicControl(data);
  }

  async function setControl(controlKey, enabled, { updatedBy = 'mkety-admin' } = {}) {
    const row = {
      control_key: controlKey,
      enabled: enabled === true,
      updated_by: String(updatedBy || 'mkety-admin'),
      updated_at: new Date().toISOString(),
    };
    const { data, error } = await supabase
      .from('trading_runtime_controls')
      .upsert(row, { onConflict: 'control_key' })
      .select('control_key,enabled,updated_at,updated_by')
      .maybeSingle();
    if (error || !data) throw new Error('RUNTIME_CONTROL_UPDATE_FAILED');
    return publicControl(data);
  }

  async function getExecutionControls() {
    try {
      const keys = Object.values(CONTROL_KEYS);
      const { data, error } = await supabase
        .from('trading_runtime_controls')
        .select('control_key,enabled,updated_at,updated_by')
        .in('control_key', keys);
      if (error) throw error;
      const byKey = new Map((data || []).map((row) => [String(row.control_key), publicControl(row)]));
      return {
        tradingAccess: byKey.get(CONTROL_KEYS.tradingAccess) || unavailable(),
        brokerExecution: byKey.get(CONTROL_KEYS.brokerExecution) || unavailable(),
        liveBrokerExecution: byKey.get(CONTROL_KEYS.liveBrokerExecution) || unavailable(),
      };
    } catch {
      return { tradingAccess: unavailable(), brokerExecution: unavailable(), liveBrokerExecution: unavailable() };
    }
  }

  return {
    getExecutionControls,
    getTradingAccessEnabled() {
      return getControl(CONTROL_KEYS.tradingAccess);
    },
    setTradingAccessEnabled(enabled, options) {
      return setControl(CONTROL_KEYS.tradingAccess, enabled, options);
    },
    getBrokerExecutionEnabled() {
      return getControl(CONTROL_KEYS.brokerExecution);
    },
    setBrokerExecutionEnabled(enabled, options) {
      return setControl(CONTROL_KEYS.brokerExecution, enabled, options);
    },
    getLiveBrokerExecutionEnabled() {
      return getControl(CONTROL_KEYS.liveBrokerExecution);
    },
    setLiveBrokerExecutionEnabled(enabled, options) {
      return setControl(CONTROL_KEYS.liveBrokerExecution, enabled, options);
    },
  };
}

async function resolveControl(supabase, getter, runtimeControls = null) {
  try {
    const store = runtimeControls || createTradingRuntimeControlStore(supabase);
    return await store[getter]();
  } catch {
    return unavailable();
  }
}

export function resolveTradingAccessRuntimeControl({ supabase, runtimeControls } = {}) {
  return resolveControl(supabase, 'getTradingAccessEnabled', runtimeControls);
}

export function resolveBrokerExecutionRuntimeControl({ supabase, runtimeControls } = {}) {
  return resolveControl(supabase, 'getBrokerExecutionEnabled', runtimeControls);
}

export function resolveLiveBrokerExecutionRuntimeControl({ supabase, runtimeControls } = {}) {
  return resolveControl(supabase, 'getLiveBrokerExecutionEnabled', runtimeControls);
}
