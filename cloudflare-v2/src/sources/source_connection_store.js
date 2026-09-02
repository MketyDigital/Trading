import { normalizeProviderRecord } from './provider_registry.js';

const SOURCE_SELECT = [
  'id',
  'workspace_id',
  'source_type',
  'source_instance_id',
  'display_name',
  'is_active',
  'source_family',
  'provider_type',
  'is_default',
  'priority',
  'external_identity',
  'config',
  'health_status',
  'last_heartbeat_at',
  'last_event_at',
  'last_connected_at',
  'last_disconnected_at',
  'restart_count',
  'last_error_code',
].join(',');

function normalize(row) {
  if (!row) return null;
  const core = normalizeProviderRecord(row);
  return {
    ...core,
    sourceType: row.source_type ?? null,
    sourceInstanceId: row.source_instance_id ?? null,
    displayName: row.display_name ?? null,
    externalIdentity: row.external_identity ?? null,
    config: row.config || {},
    health: {
      status: row.health_status || (core.enabled ? 'STARTING' : 'DISABLED'),
      lastHeartbeatAt: row.last_heartbeat_at ?? null,
      lastEventAt: row.last_event_at ?? null,
      lastConnectedAt: row.last_connected_at ?? null,
      lastDisconnectedAt: row.last_disconnected_at ?? null,
      restartCount: Number(row.restart_count || 0),
      lastErrorCode: row.last_error_code ?? null,
    },
  };
}

function sortSources(a, b) {
  if (a.isDefault !== b.isDefault) return a.isDefault ? -1 : 1;
  if (a.priority !== b.priority) return a.priority - b.priority;
  return String(a.id).localeCompare(String(b.id));
}

export function createSourceConnectionStore(supabase) {
  if (!supabase?.from && !supabase?.rpc) {
    throw new TypeError('Supabase client is required');
  }

  return {
    async listEnabledSources(workspaceId) {
      if (!workspaceId) return [];
      const { data, error } = await supabase
        .from('source_connections')
        .select(SOURCE_SELECT)
        .eq('workspace_id', String(workspaceId))
        .eq('is_active', true)
        .order('priority', { ascending: true });

      if (error) throw new Error(error.message || 'failed to list source connections');
      return (data || []).map(normalize).sort(sortSources);
    },

    async getSourceById(sourceId) {
      if (!sourceId) return null;
      const { data, error } = await supabase
        .from('source_connections')
        .select(SOURCE_SELECT)
        .eq('id', String(sourceId))
        .maybeSingle();

      if (error) throw new Error(error.message || 'failed to load source connection');
      return normalize(data);
    },

    async setDefaultSource(workspaceId, sourceFamily, sourceId) {
      if (!workspaceId || !sourceFamily || !sourceId) {
        throw new Error('Workspace, source family and source id are required');
      }
      if (!supabase?.rpc) throw new TypeError('Supabase RPC client is required');

      const { data, error } = await supabase.rpc('trading_set_default_source', {
        p_workspace_id: String(workspaceId),
        p_source_family: String(sourceFamily),
        p_source_id: String(sourceId),
      });

      if (error) throw new Error(error.message || 'failed to set default source');
      if (!data) throw new Error('default source update returned no source');
      return data.provider_type ? normalize(data) : data;
    },

    async disableSource(sourceId) {
      if (!sourceId) throw new Error('Source id is required');
      const { data, error } = await supabase
        .from('source_connections')
        .update({ is_active: false, is_default: false })
        .eq('id', String(sourceId))
        .select(SOURCE_SELECT)
        .maybeSingle();

      if (error) throw new Error(error.message || 'failed to disable source connection');
      return normalize(data);
    },
  };
}
