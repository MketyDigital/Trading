const MEMBERSHIP_SELECT = 'id,workspace_id,zitadel_subject,trading_role,membership_enabled,metadata,created_at,updated_at';

function normalizeMembership(data, { includeTimestamps = false } = {}) {
  if (!data) return null;
  const result = {
    id: data.id,
    workspaceId: String(data.workspace_id),
    subject: String(data.zitadel_subject),
    role: String(data.trading_role),
    enabled: Boolean(data.membership_enabled),
    metadata: data.metadata && typeof data.metadata === 'object' ? data.metadata : {},
  };
  if (includeTimestamps) {
    result.createdAt = data.created_at ?? null;
    result.updatedAt = data.updated_at ?? null;
  }
  return result;
}

function nowIso() {
  return new Date().toISOString();
}

export function createTradingMembershipStore(supabase) {
  if (!supabase?.from) throw new Error('TRADING_MEMBERSHIP_STORE_UNAVAILABLE');

  return {
    async getMembership(workspaceId, subject) {
      const { data, error } = await supabase
        .from('trading_workspace_memberships')
        .select('id,workspace_id,zitadel_subject,trading_role,membership_enabled,metadata')
        .eq('workspace_id', String(workspaceId))
        .eq('zitadel_subject', String(subject))
        .maybeSingle();

      if (error) throw new Error('TRADING_MEMBERSHIP_LOOKUP_FAILED');
      return normalizeMembership(data);
    },

    async listMemberships(workspaceId) {
      const { data, error } = await supabase
        .from('trading_workspace_memberships')
        .select(MEMBERSHIP_SELECT)
        .eq('workspace_id', String(workspaceId))
        .order('created_at', { ascending: true });
      if (error) throw new Error('TRADING_MEMBERSHIP_LIST_FAILED');
      return (data || []).map((item) => normalizeMembership(item, { includeTimestamps: true }));
    },

    async upsertMembership(workspaceId, subject, role) {
      const { data, error } = await supabase
        .from('trading_workspace_memberships')
        .upsert({
          workspace_id: String(workspaceId),
          zitadel_subject: String(subject),
          trading_role: String(role),
          membership_enabled: true,
          updated_at: nowIso(),
        }, { onConflict: 'workspace_id,zitadel_subject' })
        .select(MEMBERSHIP_SELECT)
        .maybeSingle();
      if (error) throw new Error('TRADING_MEMBERSHIP_UPSERT_FAILED');
      return normalizeMembership(data, { includeTimestamps: true });
    },

    async setMembershipRole(workspaceId, subject, role) {
      const { data, error } = await supabase
        .from('trading_workspace_memberships')
        .update({ trading_role: String(role), updated_at: nowIso() })
        .eq('workspace_id', String(workspaceId))
        .eq('zitadel_subject', String(subject))
        .select(MEMBERSHIP_SELECT)
        .maybeSingle();
      if (error) throw new Error('TRADING_MEMBERSHIP_ROLE_UPDATE_FAILED');
      return normalizeMembership(data, { includeTimestamps: true });
    },

    async setMembershipEnabled(workspaceId, subject, enabled) {
      const { data, error } = await supabase
        .from('trading_workspace_memberships')
        .update({ membership_enabled: Boolean(enabled), updated_at: nowIso() })
        .eq('workspace_id', String(workspaceId))
        .eq('zitadel_subject', String(subject))
        .select(MEMBERSHIP_SELECT)
        .maybeSingle();
      if (error) throw new Error('TRADING_MEMBERSHIP_STATE_UPDATE_FAILED');
      return normalizeMembership(data, { includeTimestamps: true });
    },

    async countEnabledOwners(workspaceId) {
      const { count, error } = await supabase
        .from('trading_workspace_memberships')
        .select('id', { count: 'exact', head: true })
        .eq('workspace_id', String(workspaceId))
        .eq('trading_role', 'owner')
        .eq('membership_enabled', true);
      if (error) throw new Error('TRADING_OWNER_COUNT_FAILED');
      return Number(count || 0);
    },
  };
}
