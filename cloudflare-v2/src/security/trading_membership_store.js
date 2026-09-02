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
      if (!data) return null;

      return {
        id: data.id,
        workspaceId: String(data.workspace_id),
        subject: String(data.zitadel_subject),
        role: String(data.trading_role),
        enabled: Boolean(data.membership_enabled),
        metadata: data.metadata && typeof data.metadata === 'object' ? data.metadata : {},
      };
    },
  };
}
