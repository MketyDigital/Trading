export function createTradingRuntimeControlStore(supabase) {
  if (!supabase?.from) throw new TypeError('Supabase client is required');

  return {
    async getBrokerExecutionEnabled() {
      const { data, error } = await supabase
        .from('trading_runtime_controls')
        .select('control_key,enabled,updated_at,updated_by')
        .eq('control_key', 'broker_execution_enabled')
        .maybeSingle();
      if (error || !data) return { ok: false, enabled: false, reason: 'RUNTIME_CONTROL_UNAVAILABLE' };
      return { ok: true, enabled: data.enabled === true, updatedAt: data.updated_at || null, updatedBy: data.updated_by || null };
    },

    async setBrokerExecutionEnabled(enabled, { updatedBy = 'mkety-admin' } = {}) {
      const row = {
        control_key: 'broker_execution_enabled',
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
      return { ok: true, enabled: data.enabled === true, updatedAt: data.updated_at || null, updatedBy: data.updated_by || null };
    },
  };
}

export async function resolveBrokerExecutionRuntimeControl({ supabase } = {}) {
  try {
    const store = createTradingRuntimeControlStore(supabase);
    return await store.getBrokerExecutionEnabled();
  } catch {
    return { ok: false, enabled: false, reason: 'RUNTIME_CONTROL_UNAVAILABLE' };
  }
}
