function text(value) { return String(value ?? '').trim(); }

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
        if (!['demo', 'practice'].includes(environment)) { skipped++; continue; }
        const snapshot = await readStatus({ account, lifecycle: row });
        if (!snapshot || snapshot.status === 'UNRESOLVED' || snapshot.isLive !== false
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
