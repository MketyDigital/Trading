const RECOVERY_SELECT = [
  'id',
  'workspace_id',
  'recovery_attempt_count',
  'recovery_next_attempt_at',
  'last_recovery_at',
  'last_recovery_error_code',
].join(',');

function normalize(row) {
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    recoveryAttemptCount: Number(row.recovery_attempt_count || 0),
    recoveryNextAttemptAt: row.recovery_next_attempt_at ?? null,
    lastRecoveryAt: row.last_recovery_at ?? null,
    lastRecoveryErrorCode: row.last_recovery_error_code ?? null,
  };
}

function toDatabasePatch(patch = {}) {
  const output = {};
  if (Object.hasOwn(patch, 'recoveryAttemptCount')) {
    output.recovery_attempt_count = Math.max(0, Number(patch.recoveryAttemptCount) || 0);
  }
  if (Object.hasOwn(patch, 'recoveryNextAttemptAt')) {
    output.recovery_next_attempt_at = patch.recoveryNextAttemptAt ?? null;
  }
  if (Object.hasOwn(patch, 'lastRecoveryAt')) {
    output.last_recovery_at = patch.lastRecoveryAt ?? null;
  }
  if (Object.hasOwn(patch, 'lastRecoveryErrorCode')) {
    output.last_recovery_error_code = patch.lastRecoveryErrorCode ?? null;
  }
  return output;
}

export function createMtprotoRecoveryStore(supabase) {
  if (!supabase?.from) throw new TypeError('Supabase client is required');

  return {
    async listRecoverableSources() {
      const { data, error } = await supabase
        .from('source_connections')
        .select(RECOVERY_SELECT)
        .eq('provider_type', 'cloudflare_container_mtproto')
        .eq('source_family', 'telegram')
        .eq('is_active', true)
        .order('id', { ascending: true });

      if (error) throw new Error(error.message || 'failed to list MTProto recovery sources');
      return (data || []).map(normalize);
    },

    async updateRecoveryState(workspaceId, sourceId, patch = {}) {
      const trustedWorkspaceId = String(workspaceId ?? '').trim();
      const trustedSourceId = String(sourceId ?? '').trim();
      if (!trustedWorkspaceId || !trustedSourceId) {
        throw new Error('MTProto recovery workspace and source are required');
      }

      const payload = toDatabasePatch(patch);
      if (Object.keys(payload).length === 0) return null;

      const { data, error } = await supabase
        .from('source_connections')
        .update(payload)
        .eq('workspace_id', trustedWorkspaceId)
        .eq('id', trustedSourceId)
        .eq('provider_type', 'cloudflare_container_mtproto')
        .eq('source_family', 'telegram')
        .eq('is_active', true)
        .select('id,workspace_id')
        .maybeSingle();

      if (error) throw new Error(error.message || 'failed to update MTProto recovery source');
      if (!data?.id || String(data.workspace_id) !== trustedWorkspaceId) {
        throw new Error('MTProto recovery source not available');
      }
      return { id: String(data.id), workspaceId: String(data.workspace_id) };
    },
  };
}
