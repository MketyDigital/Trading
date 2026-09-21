import { evaluateAccountPolicy } from './account_policy.js';
import { applyProtectionValidationPolicy } from '../pipeline/protection_validation_policy.js';

function text(value) {
  return String(value ?? '').trim();
}

function optionalFiniteNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function safeMark(latencyTrace, name) {
  try { latencyTrace?.mark?.(name); } catch {}
}

function workspaceIdOf(account = {}) { return text(account.workspace_id ?? account.workspaceId); }
function accountIdOf(account = {}) { return text(account.id ?? account.accountId ?? account.account_id); }
function accountIsActive(account = {}) { return account.is_active === true || account.isActive === true; }
function accountExecutionEnabled(account = {}) { return account.execution_enabled === true || account.executionEnabled === true; }
function accountLiveExecutionEnabled(account = {}) { return account.live_execution_enabled === true || account.liveExecutionEnabled === true; }
function accountEnvironment(account = {}) { return text(account.environment).toLowerCase(); }
function accountSafetyPolicy(account = {}) {
  const policy = account.safety_policy ?? account.safetyPolicy;
  return policy && typeof policy === 'object' && !Array.isArray(policy) ? policy : { enabled: true, killSwitch: false };
}
function isRiskIncreasingAction(action = {}) { return String(action.type || '').toUpperCase() === 'OPEN_POSITION'; }
function actionRequiresStateBinding(action = {}) {
  return new Set(['OPEN_POSITION', 'MODIFY_POSITION', 'CLOSE_PARTIAL', 'CLOSE_POSITION', 'CANCEL_PENDING'])
    .has(String(action.type || '').toUpperCase());
}
function policyRequest(plan = {}, action = {}) {
  return { symbol: action.symbol, actionKind: isRiskIncreasingAction(action) ? 'INCREASE_RISK' : 'REDUCE_RISK', totalLots: action.lots, riskPercent: action.riskPercent ?? plan.riskPercent ?? plan?.risk?.riskPercent, currentDailyPnlPercent: plan.currentDailyPnlPercent, currentOpenRiskPercent: plan.currentOpenRiskPercent };
}
function mergePolicyRequest(plan, action, materialized = {}) {
  const supplied = materialized?.policyRequest ?? materialized?.policyContext ?? {};
  return { ...policyRequest(plan, action), ...supplied, symbol: action.symbol, actionKind: isRiskIncreasingAction(action) ? 'INCREASE_RISK' : 'REDUCE_RISK' };
}
function safeBrokerOutcome(action = {}, result = {}, skippedProtections = []) {
  const outcome = { status: result?.duplicate === true ? 'DUPLICATE' : 'SUCCEEDED', legId: action.legId ?? null, idempotencyKey: action.idempotencyKey ?? null };
  if (Array.isArray(skippedProtections) && skippedProtections.length) outcome.skippedProtections = skippedProtections.map((item) => ({ ...item }));
  if (result?.duplicate === true) outcome.duplicate = true;
  if (result?.reconciledClosed === true || result?.positionClosed === true) outcome.reconciledClosed = true;
  if (result?.brokerPositionId != null) outcome.brokerPositionId = String(result.brokerPositionId);
  if (result?.brokerOrderId != null) outcome.brokerOrderId = String(result.brokerOrderId);
  if (result?.brokerDealId != null) outcome.brokerDealId = String(result.brokerDealId);
  const fillPrice = optionalFiniteNumber(result?.fillPrice);
  if (fillPrice != null) outcome.fillPrice = fillPrice;
  for (const key of ['executedLots', 'volumeStepLots', 'minimumLots']) {
    const value = Number(result?.[key]); if (Number.isFinite(value) && value > 0) outcome[key] = value;
  }
  return outcome;
}
function hasBindableBrokerResult(result = {}) {
  return result?.brokerPositionId != null || result?.brokerOrderId != null || result?.brokerDealId != null || optionalFiniteNumber(result?.fillPrice) != null;
}
function blockedAccount(accountId, reason, extra = {}) { return { accountId: text(accountId), status: 'BLOCKED', reason, actions: [], ...extra }; }
function failedAccount(accountId, reason, outcomes = []) { return { accountId: text(accountId), status: 'FAILED', reason, actions: outcomes }; }
function summarize(accounts = [], executionEnabled = true) {
  const succeeded = accounts.filter((item) => item.status === 'SUCCEEDED').length;
  const partial = accounts.filter((item) => item.status === 'PARTIAL').length;
  const failed = accounts.filter((item) => item.status === 'FAILED').length;
  const blocked = accounts.filter((item) => item.status === 'BLOCKED').length;
  let status = 'SUCCEEDED';
  if (!executionEnabled) status = 'BROKER_EXECUTION_DISABLED';
  else if (failed > 0 && (succeeded > 0 || partial > 0)) status = 'PARTIAL_FAILURE';
  else if (failed > 0) status = 'FAILED';
  else if (partial > 0 || (blocked > 0 && succeeded > 0)) status = 'PARTIAL';
  else if (blocked > 0) status = 'BLOCKED';
  return { executionEnabled, status, accounts, succeeded, partial, failed, blocked };
}
function validateAccountAuthority(account, workspaceId, requestedAccountId) {
  if (!account) return blockedAccount(requestedAccountId, 'ACCOUNT_NOT_FOUND');
  if (workspaceIdOf(account) !== workspaceId) return blockedAccount(requestedAccountId, 'ACCOUNT_WORKSPACE_MISMATCH');
  if (accountIdOf(account) !== requestedAccountId) return blockedAccount(requestedAccountId, 'ACCOUNT_ID_MISMATCH');
  if (!accountIsActive(account)) return blockedAccount(requestedAccountId, 'ACCOUNT_INACTIVE');
  if (!accountExecutionEnabled(account)) return blockedAccount(requestedAccountId, 'ACCOUNT_EXECUTION_DISABLED');
  return null;
}
function validateLiveExecutionAuthority(account, requestedAccountId, { liveBrokerExecutionEnabled, liveBrokerExecutionControlAvailable } = {}) {
  if (typeof liveBrokerExecutionControlAvailable !== 'boolean') return null;
  const environment = accountEnvironment(account);
  if (environment === 'demo') return null;
  if (environment !== 'live') return blockedAccount(requestedAccountId, 'ACCOUNT_ENVIRONMENT_INVALID');
  if (liveBrokerExecutionControlAvailable !== true) return blockedAccount(requestedAccountId, 'LIVE_BROKER_RUNTIME_CONTROL_UNAVAILABLE');
  if (liveBrokerExecutionEnabled !== true) return blockedAccount(requestedAccountId, 'LIVE_BROKER_EXECUTION_DISABLED');
  if (!accountLiveExecutionEnabled(account)) return blockedAccount(requestedAccountId, 'ACCOUNT_LIVE_EXECUTION_DISABLED');
  return null;
}
async function bindOpenFailure({ stateBinder, workspaceId, eventId, accountId, groupId, action, failureCode }) {
  if (typeof stateBinder !== 'function' || !isRiskIncreasingAction(action) || !groupId || !action?.legId) return;
  try { await stateBinder({ workspaceId, eventId, accountId, groupId, legId: action.legId, actionType: 'OPEN_POSITION', status: 'FAILED', failureCode: text(failureCode) || 'BROKER_DISPATCH_FAILED' }); } catch {}
}

async function runAccountPlan({ workspaceId, eventId, plan, accountLoader, authorityLoader, snapshotLoader, riskMaterializer, dispatchAction, stateBinder, bindingRepairRecorder, latencyTrace, liveBrokerExecutionEnabled, liveBrokerExecutionControlAvailable }) {
  const requestedAccountId = text(plan?.accountId);
  if (!requestedAccountId) return blockedAccount('', 'ACCOUNT_ID_REQUIRED');
  let account;
  try { account = await accountLoader(workspaceId, requestedAccountId); } catch { return failedAccount(requestedAccountId, 'ACCOUNT_LOAD_FAILED'); }
  const initialAuthorityBlock = validateAccountAuthority(account, workspaceId, requestedAccountId); if (initialAuthorityBlock) return initialAuthorityBlock;
  const initialLiveBlock = validateLiveExecutionAuthority(account, requestedAccountId, { liveBrokerExecutionEnabled, liveBrokerExecutionControlAvailable }); if (initialLiveBlock) return initialLiveBlock;
  const actions = Array.isArray(plan?.actions) ? plan.actions : [];
  if (actions.length === 0) return blockedAccount(requestedAccountId, 'ACCOUNT_ACTIONS_REQUIRED');
  const outcomes = [];

  for (const action of actions) {
    let currentAccount = account;
    let executionAuthority = null;
    if (typeof authorityLoader === 'function') {
      try {
        executionAuthority = await authorityLoader({ workspaceId, tradingEventId: eventId, accountId: requestedAccountId });
        currentAccount = executionAuthority?.account || null;
      } catch (error) {
        if (error?.code === 'EXECUTION_AUTHORITY_REVOKED') return blockedAccount(requestedAccountId, 'EXECUTION_AUTHORITY_REVOKED');
        return failedAccount(requestedAccountId, 'EXECUTION_AUTHORITY_LOAD_FAILED', outcomes);
      }
      const currentAuthorityBlock = validateAccountAuthority(currentAccount, workspaceId, requestedAccountId); if (currentAuthorityBlock) return currentAuthorityBlock;
      const currentLiveBlock = validateLiveExecutionAuthority(currentAccount, requestedAccountId, { liveBrokerExecutionEnabled, liveBrokerExecutionControlAvailable }); if (currentLiveBlock) return currentLiveBlock;
    }

    let snapshot = null;
    if (typeof snapshotLoader === 'function') {
      try { snapshot = await snapshotLoader({ workspaceId, eventId, sourceId: executionAuthority?.source?.id ?? null, account: currentAccount, action, plan }) ?? null; } catch { snapshot = null; }
    }

    let executableAction = action;
    let materialized = null;
    if (typeof riskMaterializer === 'function') {
      try { materialized = await riskMaterializer({ workspaceId, eventId, groupId: plan?.groupId ?? null, account: currentAccount, action, plan, snapshot }); }
      catch (error) { outcomes.push({ status: 'BLOCKED', legId: action?.legId ?? null, idempotencyKey: action?.idempotencyKey ?? null, reason: error?.code || 'BROKER_RISK_CONTEXT_UNAVAILABLE' }); continue; }
      if (materialized?.allowed === false) { outcomes.push({ status: 'BLOCKED', legId: action?.legId ?? null, idempotencyKey: action?.idempotencyKey ?? null, reason: materialized.reason || 'BROKER_RISK_BLOCKED' }); continue; }
      if (materialized?.action && typeof materialized.action === 'object') executableAction = materialized.action;
    }

    const safetyPolicy = accountSafetyPolicy(currentAccount);
    const protection = applyProtectionValidationPolicy(executableAction, safetyPolicy);
    if (!protection.allowed) { outcomes.push({ status: 'BLOCKED', legId: executableAction?.legId ?? null, idempotencyKey: executableAction?.idempotencyKey ?? null, reason: protection.reason || 'INVALID_PROTECTION_GEOMETRY' }); continue; }
    executableAction = protection.action;
    const policy = evaluateAccountPolicy(safetyPolicy, mergePolicyRequest(plan, executableAction, materialized));
    if (!policy.allowed) {
      if (policy.reasons?.includes('KILL_SWITCH')) return blockedAccount(requestedAccountId, 'ACCOUNT_POLICY_BLOCKED', { policy });
      outcomes.push({ status: 'BLOCKED', legId: executableAction?.legId ?? null, idempotencyKey: executableAction?.idempotencyKey ?? null, policy }); continue;
    }

    let result;
    try {
      safeMark(latencyTrace, 'BROKER_SEND');
      result = await dispatchAction({ workspaceId, eventId, groupId: plan?.groupId ?? null, account: currentAccount, action: executableAction, risk: materialized?.risk ?? null, snapshot });
      safeMark(latencyTrace, 'BROKER_ACK');
      if (result?.blocked === true) { outcomes.push({ status: 'BLOCKED', legId: executableAction?.legId ?? null, idempotencyKey: executableAction?.idempotencyKey ?? null, reason: result?.code || result?.reason || 'BROKER_ACTION_BLOCKED' }); continue; }
      if (result?.ok === false || result?.success === false) {
        await bindOpenFailure({ stateBinder, workspaceId, eventId, accountId: requestedAccountId, groupId: plan?.groupId ?? null, action: executableAction, failureCode: result?.errorCode || result?.code || 'BROKER_DISPATCH_FAILED' });
        outcomes.push({ status: 'FAILED', legId: executableAction?.legId ?? null, idempotencyKey: executableAction?.idempotencyKey ?? null, reason: result?.errorCode || result?.code || 'BROKER_DISPATCH_FAILED' }); continue;
      }
    } catch (error) {
      await bindOpenFailure({ stateBinder, workspaceId, eventId, accountId: requestedAccountId, groupId: plan?.groupId ?? null, action: executableAction, failureCode: error?.code || 'BROKER_DISPATCH_FAILED' });
      outcomes.push({ status: 'FAILED', legId: executableAction?.legId ?? null, idempotencyKey: executableAction?.idempotencyKey ?? null, reason: error?.code || 'BROKER_DISPATCH_FAILED' }); continue;
    }

    const shouldBindState = result?.duplicate !== true && typeof stateBinder === 'function' && (hasBindableBrokerResult(result) || actionRequiresStateBinding(executableAction));
    if (shouldBindState) {
      try {
        const brokerPositionId = result?.brokerPositionId ?? null;
        const brokerOrderId = result?.brokerOrderId ?? null;
        const desiredStopLoss = optionalFiniteNumber(executableAction?.stopLoss);
        const desiredTakeProfit = optionalFiniteNumber(executableAction?.takeProfit);
        await stateBinder({
          workspaceId, eventId, accountId: requestedAccountId, groupId: plan?.groupId ?? null, legId: executableAction?.legId ?? null,
          actionType: executableAction?.type ?? null,
          status: result?.reconciledClosed === true || result?.positionClosed === true
            ? 'CLOSED'
            : brokerPositionId != null ? 'OPEN' : brokerOrderId != null ? 'PENDING' : null,
          brokerPositionId, brokerOrderId, brokerDealId: result?.brokerDealId ?? null,
          fillPrice: optionalFiniteNumber(result?.fillPrice),
          executedLots: Number.isFinite(Number(result?.executedLots)) ? Number(result.executedLots) : Number(executableAction?.lots),
          volumeStepLots: Number.isFinite(Number(result?.volumeStepLots)) ? Number(result.volumeStepLots) : null,
          minimumLots: Number.isFinite(Number(result?.minimumLots)) ? Number(result.minimumLots) : null,
          ...(desiredStopLoss != null ? { stopLoss: desiredStopLoss } : {}),
          ...(desiredTakeProfit != null ? { takeProfit: desiredTakeProfit } : {}),
          ...(executableAction?.clearStopLoss === true ? { clearStopLoss: true } : {}),
          ...(executableAction?.clearTakeProfit === true ? { clearTakeProfit: true } : {}),
        });
      } catch {
        if (typeof bindingRepairRecorder === 'function') { try { await bindingRepairRecorder({ workspaceId, eventId, accountId: requestedAccountId, groupId: plan?.groupId ?? null, legId: executableAction?.legId ?? null, idempotencyKey: executableAction?.idempotencyKey ?? null }); } catch {} }
        outcomes.push({ status: 'FAILED', legId: executableAction?.legId ?? null, idempotencyKey: executableAction?.idempotencyKey ?? null, reason: 'STATE_BIND_FAILED' }); continue;
      }
    }
    outcomes.push(safeBrokerOutcome(executableAction, result, protection.skipped));
  }

  const failed = outcomes.some((item) => item.status === 'FAILED');
  const succeeded = outcomes.some((item) => item.status === 'SUCCEEDED' || item.status === 'DUPLICATE');
  const blocked = outcomes.find((item) => item.status === 'BLOCKED');
  if (failed) return failedAccount(requestedAccountId, 'ACCOUNT_ACTION_FAILED', outcomes);
  if (!succeeded && blocked) return blockedAccount(requestedAccountId, 'ACCOUNT_POLICY_BLOCKED', { ...(blocked.policy ? { policy: blocked.policy } : {}), ...(blocked.reason ? { blockReason: blocked.reason } : {}) });
  if (succeeded && blocked) {
    return {
      accountId: requestedAccountId,
      status: 'PARTIAL',
      reason: 'ACCOUNT_ACTION_PARTIALLY_BLOCKED',
      groupId: plan?.groupId ?? null,
      actions: outcomes,
    };
  }
  return { accountId: requestedAccountId, status: 'SUCCEEDED', groupId: plan?.groupId ?? null, actions: outcomes };
}

export async function executeProductionPlan({ workspaceId, eventId = null, accountPlans = [], brokerExecutionEnabled = false, liveBrokerExecutionEnabled, liveBrokerExecutionControlAvailable } = {}, { accountLoader, authorityLoader, snapshotLoader, riskMaterializer, dispatchAction, stateBinder, bindingRepairRecorder, latencyTrace, finalizeExecutionBatch } = {}) {
  const trustedWorkspaceId = text(workspaceId);
  if (!trustedWorkspaceId) throw new TypeError('workspaceId is required');
  if (!Array.isArray(accountPlans)) throw new TypeError('accountPlans must be an array');
  if (brokerExecutionEnabled !== true) return summarize(accountPlans.map((plan) => blockedAccount(plan?.accountId, 'BROKER_EXECUTION_DISABLED')), false);
  if (typeof accountLoader !== 'function') throw new TypeError('accountLoader is required');
  if (typeof dispatchAction !== 'function') throw new TypeError('dispatchAction is required');
  try {
    const accounts = await Promise.all(accountPlans.map((plan) => runAccountPlan({ workspaceId: trustedWorkspaceId, eventId, plan, accountLoader, authorityLoader, snapshotLoader, riskMaterializer, dispatchAction, stateBinder, bindingRepairRecorder, latencyTrace, liveBrokerExecutionEnabled, liveBrokerExecutionControlAvailable })));
    return summarize(accounts, true);
  } finally {
    if (typeof finalizeExecutionBatch === 'function') { try { await finalizeExecutionBatch(); } catch {} }
  }
}
