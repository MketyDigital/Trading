function text(value) { return String(value ?? '').trim(); }

function epochMillis(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const parsed = Date.parse(String(value ?? ''));
  return Number.isFinite(parsed) ? parsed : null;
}

/** Read-only periodic order observation. Snapshot application only writes state and never dispatches broker commands. */
export function createPendingOrderLifecycleRuntime({
  loadCandidates,
  loadAccount,
  readStatus,
  applySnapshot,
  clock = Date.now,
} = {}) {
  for (const [name, fn] of Object.entries({ loadCandidates, loadAccount, readStatus, applySnapshot })) {
    if (typeof fn !== 'function') throw new TypeError(`${name} is required`);
  }
  return async function run(env = {}) {
    if (env.PENDING_ORDER_LIFECYCLE_SYNC_ENABLED !== 'true') return { status: 'disabled', scanned: 0, applied: 0 };
    const candidates = await loadCandidates();
    let applied = 0;
    let skipped = 0;
    for (const row of candidates || []) {
      try {
        const account = await loadAccount(row.workspaceId, row.tradeAccountId);
        if (!account || text(account.workspace_id ?? account.workspaceId) !== row.workspaceId) { skipped++; continue; }
        const environment = text(account.environment ?? account.server_name ?? account.serverName).toLowerCase();
        if (!['demo', 'practice', 'live'].includes(environment)) { skipped++; continue; }
        if (environment === 'live' && env.PENDING_ORDER_LIFECYCLE_LIVE_SYNC_ENABLED !== 'true') { skipped++; continue; }
        if (environment === 'live') {
          const syncAfter = epochMillis(env.PENDING_ORDER_LIFECYCLE_LIVE_SYNC_AFTER);
          const createdAt = epochMillis(row.createdAt);
          if (syncAfter == null || createdAt == null || createdAt < syncAfter) { skipped++; continue; }
        }
        const platform = text(account.platform).toLowerCase();
        const providerMode = text(account.provider_mode ?? account.providerMode).toLowerCase();
        if (platform === 'ctrader' && providerMode === 'ctrader_cbot' && environment !== 'live') { skipped++; continue; }
        if (environment === 'live' && platform === 'ctrader'
          && !['ctrader_oauth', 'ctrader_cbot'].includes(providerMode)) { skipped++; continue; }
        if (environment === 'live' && platform !== 'ctrader' && platform !== 'mt5') { skipped++; continue; }
        const snapshot = await readStatus({ account, lifecycle: row });
        if (!snapshot || snapshot.status === 'UNRESOLVED' || snapshot.isLive !== (environment === 'live')
          || text(snapshot.accountId) !== text(account.account_id ?? account.brokerAccountId)
          || text(snapshot.brokerOrderId) !== row.brokerOrderId
          || text(snapshot.environment).toLowerCase() !== environment) { skipped++; continue; }
        const result = await applySnapshot({
          workspaceId: row.workspaceId,
          groupId: row.groupId,
          legId: row.legId,
          tradeAccountId: row.tradeAccountId,
          brokerOrderId: row.brokerOrderId,
          snapshot: { ...snapshot, observedAt: Number(snapshot.observedAt) || Number(clock()) },
        });
        if (result?.outcome === 'APPLIED') applied++;
      } catch {
        skipped++;
      }
    }
    return { status: 'ok', scanned: (candidates || []).length, applied, skipped };
  };
}
