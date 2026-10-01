function text(value) {
  return String(value ?? '').trim();
}

function normalizeIds(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => text(item)).filter(Boolean))];
}

export function desiredTelegramFeedIds(providerType, config = {}) {
  const provider = text(providerType);
  if (provider === 'external_mtproto') {
    if ((text(config.chat_acceptance_mode) || 'allowlist') === 'all_visible') return null;
    return normalizeIds(config.allowed_chat_ids ?? []);
  }
  if (['cloudflare_container_mtproto', 'cloudflare_do_mtproto'].includes(provider)) {
    return normalizeIds(config.chat_ids ?? []);
  }
  if (provider === 'telegram_bot_api') {
    return normalizeIds(config.allowed_chat_ids ?? config.chat_ids ?? []);
  }
  return null;
}

export async function reconcileTelegramSourceFeeds(supabase, workspaceId, sourceId, providerType, config = {}) {
  if (!supabase?.from) throw new TypeError('Supabase client is required');
  const workspace = text(workspaceId);
  const source = text(sourceId);
  if (!workspace || !source) throw new Error('SOURCE_FEED_RECONCILE_FAILED');

  const desired = desiredTelegramFeedIds(providerType, config);
  if (desired === null) return { reconciled: false, desired: null };

  if (desired.length) {
    const rows = desired.map((providerFeedId) => ({
      workspace_id: workspace,
      source_connection_id: source,
      provider_feed_id: providerFeedId,
      feed_type: 'telegram_chat',
      is_active: true,
      updated_at: new Date().toISOString(),
    }));
    const { error } = await supabase.from('source_feeds').upsert(rows, {
      onConflict: 'workspace_id,source_connection_id,provider_feed_id',
    });
    if (error) throw new Error('SOURCE_FEED_RECONCILE_FAILED');
  }

  const { data: existing, error: readError } = await supabase
    .from('source_feeds')
    .select('id,provider_feed_id,is_active')
    .eq('workspace_id', workspace)
    .eq('source_connection_id', source);
  if (readError) throw new Error('SOURCE_FEED_RECONCILE_FAILED');

  const wanted = new Set(desired);
  const deactivate = (existing || [])
    .filter((row) => !wanted.has(text(row.provider_feed_id)))
    .map((row) => row.id)
    .filter(Boolean);
  if (deactivate.length) {
    const { error } = await supabase.from('source_feeds')
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq('workspace_id', workspace)
      .in('id', deactivate);
    if (error) throw new Error('SOURCE_FEED_RECONCILE_FAILED');
  }

  return { reconciled: true, desired };
}
