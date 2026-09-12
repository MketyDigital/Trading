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

  return {
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

async function resolveControl(supabase, getter) {
  try {
    const store = createTradingRuntimeControlStore(supabase);
    return await store[getter]();
  } catch {
    return unavailable();
  }
}

export function resolveTradingAccessRuntimeControl({ supabase } = {}) {
  return resolveControl(supabase, 'getTradingAccessEnabled');
}

export function resolveBrokerExecutionRuntimeControl({ supabase } = {}) {
  return resolveControl(supabase, 'getBrokerExecutionEnabled');
}

export function resolveLiveBrokerExecutionRuntimeControl({ supabase } = {}) {
  return resolveControl(supabase, 'getLiveBrokerExecutionEnabled');
}
