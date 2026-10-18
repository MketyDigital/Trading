function text(value) {
  return String(value ?? '').trim();
}

function authorityError(message, code = 'EXECUTION_AUTHORITY_REVOKED') {
  const error = new Error(String(message));
  error.code = code;
  return error;
}

async function exactSingle(query, unavailableMessage) {
  const { data, error } = await query.maybeSingle();
  if (error) throw authorityError(unavailableMessage, 'EXECUTION_AUTHORITY_UNAVAILABLE');
  return data || null;
}

export function createProductionExecutionAuthorityLoader({
  supabase,
  persistenceRuntime = null,
  workspaceId,
  tradingEventId,
} = {}) {
  if (!supabase?.from && !persistenceRuntime) throw new TypeError('Trading persistence is required');

  const boundWorkspaceId = text(workspaceId);
  const boundTradingEventId = text(tradingEventId);
  if (!boundWorkspaceId) throw new TypeError('workspaceId is required');
  if (!boundTradingEventId) throw new TypeError('tradingEventId is required');

  return async function authorityLoader({
    workspaceId: requestedWorkspaceId,
    tradingEventId: requestedTradingEventId,
    accountId,
  } = {}) {
    if (text(requestedWorkspaceId) !== boundWorkspaceId) {
      throw authorityError('execution authority workspace mismatch');
    }
    if (text(requestedTradingEventId) !== boundTradingEventId) {
      throw authorityError('execution authority event mismatch');
    }

    const accountRef = text(accountId);
    if (!accountRef) throw authorityError('execution account authority unavailable');

    if (persistenceRuntime?.ingest?.eventStore && persistenceRuntime?.sourceConnections && persistenceRuntime?.workspaceAccess && persistenceRuntime?.accounts) {
      const event = await persistenceRuntime.ingest.eventStore.getById(boundWorkspaceId, boundTradingEventId);
      const [source, workspace, account] = await Promise.all([
        event?.source_connection_id ? persistenceRuntime.sourceConnections.getSource(boundWorkspaceId, event.source_connection_id) : null,
        persistenceRuntime.workspaceAccess.getWorkspace(boundWorkspaceId),
        persistenceRuntime.accounts.getAccount(boundWorkspaceId, accountRef),
      ]);
      const active = value => value === true || Number(value) === 1;
      if (!event || text(event.workspace_id) !== boundWorkspaceId) throw authorityError('execution event workspace authority unavailable');
      if (!source || text(source.workspace_id) !== boundWorkspaceId) throw authorityError('execution source authority unavailable');
      if (!active(source.is_active)) throw authorityError('execution source inactive');
      if (!workspace) throw authorityError('execution workspace authority unavailable');
      if (!active(workspace.trading_access_enabled)) throw authorityError('execution workspace entitlement disabled');
      if (!account || text(account.workspace_id) !== boundWorkspaceId) throw authorityError('execution account authority unavailable');
      if (!active(account.is_active)) throw authorityError('execution account inactive');
      if (!active(account.execution_enabled)) throw authorityError('execution account execution disabled');
      return { event, source, workspace, account };
    }

    const event = await exactSingle(
      supabase
        .from('trading_events')
        .select('id,workspace_id,source_connection_id')
        .eq('id', boundTradingEventId)
        .eq('workspace_id', boundWorkspaceId),
      'execution event authority unavailable',
    );
    if (!event || text(event.workspace_id) !== boundWorkspaceId) {
      throw authorityError('execution event workspace authority unavailable');
    }

    const sourceId = text(event.source_connection_id);
    if (!sourceId) throw authorityError('execution source authority unavailable');
    const source = await exactSingle(
      supabase
        .from('source_connections')
        .select('id,workspace_id,is_active')
        .eq('id', sourceId)
        .eq('workspace_id', boundWorkspaceId),
      'execution source authority unavailable',
    );
    if (!source) throw authorityError('execution source authority unavailable');
    if (text(source.workspace_id) !== boundWorkspaceId) {
      throw authorityError('execution source workspace authority unavailable');
    }
    if (source.is_active !== true) throw authorityError('execution source inactive');

    const workspace = await exactSingle(
      supabase
        .from('trading_workspace_access')
        .select('id,trading_access_enabled')
        .eq('id', boundWorkspaceId),
      'execution workspace authority unavailable',
    );
    if (!workspace) throw authorityError('execution workspace authority unavailable');
    if (workspace.trading_access_enabled !== true) {
      throw authorityError('execution workspace entitlement disabled');
    }

    const account = await exactSingle(
      supabase
        .from('trade_accounts')
        .select('id,workspace_id,is_active,execution_enabled,live_execution_enabled,safety_policy')
        .eq('workspace_id', boundWorkspaceId)
        .eq('id', accountRef),
      'execution account authority unavailable',
    );
    if (!account) throw authorityError('execution account authority unavailable');
    if (text(account.workspace_id) !== boundWorkspaceId) {
      throw authorityError('execution account workspace authority unavailable');
    }
    if (account.is_active !== true) throw authorityError('execution account inactive');
    if (account.execution_enabled !== true) {
      throw authorityError('execution account execution disabled');
    }

    return { event, source, workspace, account };
  };
}
