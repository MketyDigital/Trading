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
  workspaceId,
  tradingEventId,
} = {}) {
  if (!supabase?.from) throw new TypeError('Supabase client is required');

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
        .select('*')
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
