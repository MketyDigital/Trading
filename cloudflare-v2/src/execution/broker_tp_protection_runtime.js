import { classifyBrokerTpFill } from './broker_tp_fill_detection.js';

function text(value) { return String(value ?? '').trim(); }
function accountPlatform(account = {}) { return text(account.platform).toLowerCase(); }
function accountEnvironment(account = {}) { return text(account.environment).toLowerCase(); }
function isTrue(value) { return value === true; }

function identityMatches(account, candidate, snapshot) {
  const environment = accountEnvironment(account);
  return Boolean(snapshot)
    && text(snapshot.accountId) === text(account.account_id ?? account.brokerAccountId)
    && text(snapshot.positionId) === text(candidate.brokerPositionId)
    && text(snapshot.environment).toLowerCase() === environment
    && snapshot.isLive === (environment === 'live');
}

/** Scan bounded open TP legs and hand only confirmed broker fills to orchestration. */
export function createBrokerTpProtectionRuntime({
  loadCandidates,
  loadSourceEvent,
  loadAccount,
  readPositionCloseStatus,
  recordManagementEvent,
  applyTargetHit,
  recordObservation = null,
  maxCandidates = 50,
  clock = Date.now,
} = {}) {
  for (const [name, fn] of Object.entries({ loadCandidates, loadSourceEvent, loadAccount, readPositionCloseStatus, recordManagementEvent, applyTargetHit })) {
    if (typeof fn !== 'function') throw new TypeError(`${name} is required`);
  }
  return async function run(env = {}) {
    if (env.BROKER_TP_PROTECTION_ENABLED === 'false') return { status: 'disabled', scanned: 0, confirmed: 0, applied: 0, skipped: 0 };
    const minute = Math.floor(Number(clock()) / 60000);
    const loadedCandidates = await loadCandidates({ limit: maxCandidates, pageSeed: minute });
    const candidatePool = (Array.isArray(loadedCandidates) ? loadedCandidates : []).sort((a, b) =>
      text(a.workspaceId).localeCompare(text(b.workspaceId))
      || text(a.tradeAccountId).localeCompare(text(b.tradeAccountId))
      || text(a.groupId).localeCompare(text(b.groupId))
      || Number(a.targetIndex || 0) - Number(b.targetIndex || 0));
    const nextByGroup = new Map();
    for (const candidate of candidatePool) {
      const key = `${candidate.workspaceId}:${candidate.tradeAccountId}:${candidate.groupId}`;
      if (!nextByGroup.has(key)) nextByGroup.set(key, candidate);
    }
    const nextCandidatePool = [...nextByGroup.values()];
    const pages = Math.max(1, Math.ceil(nextCandidatePool.length / maxCandidates));
    const start = (minute % pages) * maxCandidates;
    const candidates = nextCandidatePool.slice(start, start + maxCandidates);
    const groups = new Map();
    for (const candidate of candidates) {
      const key = `${candidate.workspaceId}:${candidate.tradeAccountId}:${candidate.groupId}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(candidate);
    }
    let confirmed = 0; let applied = 0; let skipped = 0; let failed = 0;
    const observe = async (details) => {
      if (typeof recordObservation !== 'function') return;
      try { await recordObservation(details); } catch {}
    };
    const groupBatches = [...groups.values()];
    const concurrency = 5;
    for (let offset = 0; offset < groupBatches.length; offset += concurrency) {
      const results = await Promise.all(groupBatches.slice(offset, offset + concurrency).map(async (batch) => {
        let groupConfirmed = 0; let groupApplied = 0; let groupSkipped = 0; let groupFailed = 0;
        for (const candidate of batch) {
      try {
        const account = await loadAccount(candidate.workspaceId, candidate.tradeAccountId);
        if (!account || text(account.workspace_id ?? account.workspaceId) !== candidate.workspaceId
          || text(account.id ?? account.accountId) !== candidate.tradeAccountId
          || !isTrue(account.is_active ?? account.isActive) || !isTrue(account.execution_enabled ?? account.executionEnabled)
          || (account.safety_policy ?? account.safetyPolicy)?.autoTpProtection !== true) { groupSkipped++; continue; }
        const platform = accountPlatform(account);
        const environment = accountEnvironment(account);
        if (!['mt5', 'ctrader'].includes(platform) || !['demo', 'live'].includes(environment)) { groupSkipped++; continue; }
        const snapshot = await readPositionCloseStatus({ account, candidate, nowMs: Number(clock()) });
        if (!identityMatches(account, candidate, snapshot)) {
          await observe({ candidate, account, snapshot, status: 'UNRESOLVED', reason: 'BROKER_SNAPSHOT_IDENTITY_MISMATCH', nowMs: Number(clock()) });
          groupSkipped++; continue;
        }
        const detection = classifyBrokerTpFill({ platform, leg: candidate, snapshot });
        await observe({ candidate, account, snapshot, status: detection.status, reason: detection.reason ?? null,
          dealIds: detection.dealIds ?? [], nowMs: Number(clock()) });
        if (detection.status !== 'TP_CONFIRMED') { groupSkipped++; continue; }
        const sourceEvent = await loadSourceEvent(candidate);
        if (!sourceEvent?.sourceId) { groupSkipped++; continue; }
        const event = await recordManagementEvent({ candidate, account, detection, sourceEvent, nowMs: Number(clock()) });
        if (!event?.eventId) { groupFailed++; continue; }
        groupConfirmed++;
        const outcome = await applyTargetHit({ candidate, account, detection, sourceEvent, event, nowMs: Number(clock()) });
        if (outcome?.execution?.status === 'SUCCEEDED' || outcome?.simulation?.status === 'SIMULATED') groupApplied++;
        else groupSkipped++;
      } catch (error) {
        await observe({ candidate, status: 'FAILED', reason: text(error?.code) || 'BROKER_TP_SCAN_FAILED', nowMs: Number(clock()) });
        groupFailed++;
      }
        }
        return { confirmed: groupConfirmed, applied: groupApplied, skipped: groupSkipped, failed: groupFailed };
      }));
      for (const result of results) {
        confirmed += result.confirmed; applied += result.applied; skipped += result.skipped; failed += result.failed;
      }
    }
    return { status: failed ? (confirmed ? 'partial' : 'failed') : 'ok', scanned: candidates.length, confirmed, applied, skipped, failed };
  };
}
