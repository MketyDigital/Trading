function text(value) {
  return String(value ?? '').trim();
}

function safeObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function normalizeFeedRow(row = {}) {
  return {
    id: text(row.id),
    workspaceId: text(row.workspace_id ?? row.workspaceId),
    sourceConnectionId: text(row.source_connection_id ?? row.sourceConnectionId),
    providerFeedId: text(row.provider_feed_id ?? row.providerFeedId),
    displayName: text(row.display_name ?? row.displayName) || null,
    feedType: text(row.feed_type ?? row.feedType) || 'telegram_chat',
    isActive: (row.is_active ?? row.isActive) === true,
    metadata: safeObject(row.metadata),
  };
}

export function createSourceFeedStore(supabase) {
  if (!supabase?.from) throw new TypeError('Supabase client is required');

  return {
    async findActiveFeed(workspaceId, sourceConnectionId, providerFeedId) {
      const workspace = text(workspaceId);
      const connection = text(sourceConnectionId);
      const providerId = text(providerFeedId);
      if (!workspace || !connection || !providerId) return null;

      const { data, error } = await supabase
        .from('source_feeds')
        .select('id,workspace_id,source_connection_id,provider_feed_id,display_name,feed_type,is_active,metadata')
        .eq('workspace_id', workspace)
        .eq('source_connection_id', connection)
        .eq('provider_feed_id', providerId)
        .eq('is_active', true)
        .maybeSingle();
      if (error) throw new Error('SOURCE_FEED_LOOKUP_FAILED');
      return data ? normalizeFeedRow(data) : null;
    },

    async listFeeds(workspaceId, sourceConnectionId) {
      const workspace = text(workspaceId);
      const connection = text(sourceConnectionId);
      if (!workspace || !connection) return [];
      const { data, error } = await supabase
        .from('source_feeds')
        .select('id,workspace_id,source_connection_id,provider_feed_id,display_name,feed_type,is_active,metadata')
        .eq('workspace_id', workspace)
        .eq('source_connection_id', connection)
        .order('created_at', { ascending: true });
      if (error) throw new Error('SOURCE_FEED_LIST_FAILED');
      return (data || []).map(normalizeFeedRow);
    },

    async upsertAllowedFeeds(workspaceId, sourceConnectionId, providerFeedIds, { feedType = 'telegram_chat' } = {}) {
      const workspace = text(workspaceId);
      const connection = text(sourceConnectionId);
      const ids = [...new Set((Array.isArray(providerFeedIds) ? providerFeedIds : [])
        .map(text)
        .filter(Boolean))];
      if (!workspace || !connection || !ids.length) return [];

      const rows = ids.map((providerFeedId) => ({
        workspace_id: workspace,
        source_connection_id: connection,
        provider_feed_id: providerFeedId,
        feed_type: text(feedType) || 'telegram_chat',
        is_active: true,
        updated_at: new Date().toISOString(),
      }));
      const { data, error } = await supabase
        .from('source_feeds')
        .upsert(rows, { onConflict: 'workspace_id,source_connection_id,provider_feed_id' })
        .select('id,workspace_id,source_connection_id,provider_feed_id,display_name,feed_type,is_active,metadata');
      if (error) throw new Error('SOURCE_FEED_UPSERT_FAILED');
      return (data || []).map(normalizeFeedRow);
    },
  };
}

export function providerFeedIdFromEvent(event = {}) {
  const metadata = safeObject(event.metadata);
  const nativeIdentity = safeObject(metadata.native_identity ?? metadata.nativeIdentity);
  return text(
    nativeIdentity.chat_id
    ?? nativeIdentity.chatId
    ?? metadata.telegram_chat_id
    ?? metadata.telegramChatId
    ?? metadata.chat_id
    ?? metadata.chatId
    ?? event.chat_id
    ?? event.chatId,
  ) || null;
}
