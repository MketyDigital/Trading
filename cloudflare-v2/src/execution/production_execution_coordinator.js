import { evaluateAccountPolicy } from './account_policy.js';

function text(value) {
  return String(value ?? '').trim();
}

function safeMark(latencyTrace, name) {
  try {
    latencyTrace?.mark?.(name);
  } catch {
    // Telemetry is observational only and must never control broker execution.
  }
}

function workspaceIdOf(account = {}) {
  return text(account.workspace_id ?? account.workspaceId);
}

function accountIdOf(account = {}) {
  return text(account.id ?? account.accountId ?? account.account_id);
}

function accountIsActive(account = {}) {
  return account.is_active === true || account.isActive === true;
}

function accountExecutionEnabled(account = {}) {
  return account.execution_enabled === true || account.executionEnabled === true;
}

function accountLiveExecutionEnabled(account = {}) {
  return account.live_execution_enabled === true || account.liveExecutionEnabled === true;
}

function accountEnvironment(account = {}) {
  return text(account.environment).toLowerCase();
}

function accountSafetyPolicy(account = {}) {
  const policy = account.safety_policy ?? account.safetyPolicy;
  return policy && typeof policy === 'object' && !Array.isArray(policy)
    ? policy
    : { enabled: true, killSwitch: false };
}

function isRiskIncreasingAction(action = {}) {
  return String(action.type || '').toUpperCase() === 'OPEN_POSITION';
}

function policyRequest(plan = {}, action = {}) {
  return {
    symbol: action.symbol,
    actionKind: isRiskIncreasingAction(action) ? 'INCREASE_RISK' : 'REDUCE_RISK',
    totalLots: action.lots,
    riskPercent: action.riskPercent ?? plan.riskPercent ?? plan?.risk?.riskPercent,
    currentDailyPnlPercent: plan.currentDailyPnlPercent,
    currentOpenRiskPercent: plan.currentOpenRiskPercent,
  };
}

function mergePolicyRequest(plan, action, materialized = {}) {
  const supplied = materialized?.policyRequest ?? materialized?.policyContext ?? {};
  return {
    ...policyRequest(plan, action),
    ...supplied,
    symbol: action.symbol,
    actionKind: isRiskIncreasingAction(action) ? 'INCREASE_RISK' : 'REDUCE_RISK',
  };
}

function safeBrokerOutcome(action = {}, result = {}) {
  const outcome = {
    status: result?.duplicate === true ? 'DUPLICATE' : 'SUCCEEDED',
    legId: action.legId ?? null,
    idempotencyKey: action.idempotencyKey ?? null,
  };
  if (result?.duplicate === true) outcome.duplicate = true;
  if (result?.brokerPositionId != null) outcome.brokerPositionId = String(result.brokerPositionId);
  if (result?.brokerOrderId != null) outcome.brokerOrderId = String(result.brokerOrderId);
  if (result?.brokerDealId != null) outcome.brokerDealId = String(result.brokerDealId);
  const fillPrice = Number(result?.fillPrice);
  if (Number.isFinite(fillPrice)) outcome.fillPrice = fillPrice;
  return outcome;
}

function hasBindableBrokerResult(result = {}) {
  return result?.brokerPositionId != null ||
    result?.brokerOrderId != null ||
    result?.brokerDealId != null ||
    Number.isFinite(Number(result?.fillPrice));
}

function blockedAccount(accountId, reason, extra = {}) {
  return {
    accountId: text(accountId),
    status: 'BLOCKED',
    reason,
    actions: [],
    ...extra,
  };
}

function failedAccount(accountId, reason, outcomes = []) {
  return {
    accountId: text(accountId),
    status: 'FAILED',
    reason,
    actions: outcomes,
  };
}

function summarize(accounts = [], executionEnabled = true) {
  const succeeded = accounts.filter((item) => item.status === 'SUCCEEDED').length;
  const failed = accounts.filter((item) => item.status === 'FAILED').length;
  const blocked = accounts.filter((item) => item.status === 'BLOCKED').length;

  let status = 'SUCCEEDED';
  if (!executionEnabled) status = 'BROKER_EXECUTION_DISABLED';
  else if (failed > 0 && succeeded > 0) status = 'PARTIAL_FAILURE';
  else if (failed > 0) status = 'FAILED';
  else if (blocked > 0 && succeeded > 0) status = 'PARTIAL';
  else if (blocked > 0) status = 'BLOCKED';

  return { executionEnabled, status, accounts, succeeded, failed, blocked };
}

function validateAccountAuthority(account, workspaceId, requestedAccountId) {
  if (!account) return blockedAccount(requestedAccountId, 'ACCOUNT_NOT_FOUND');
  if (workspaceIdOf(account) !== workspaceId) {
    return blockedAccount(requestedAccountId, 'ACCOUNT_WORKSPACE_MISMATCH');
  }
  if (accountIdOf(account) !== requestedAccountId) {
    return blockedAccount(requestedAccountId, 'ACCOUNT_ID_MISMATCH');
  }
  if (!accountIsActive(account)) return blockedAccount(requestedAccountId, 'ACCOUNT_INACTIVE');
  if (!accountExecutionEnabled(account)) return blockedAccount(requestedAccountId, 'ACCOUNT_EXECUTION_DISABLED');
  return null;
}

function validateLiveExecutionAuthority(account, requestedAccountId, {
  liveBrokerExecutionEnabled,
  liveBrokerExecutionControlAvailable,
} = {}) {
  // Legacy/unit callers that do not supply the global live-control contract keep
  // their existing behavior. Production execution always supplies it.
  if (typeof liveBrokerExecutionControlAvailable !== 'boolean') return null;

  const environment = accountEnvironment(account);
  if (environment === 'demo') return null;
  if (environment !== 'live') return blockedAccount(requestedAccountId, 'ACCOUNT_ENVIRONMENT_INVALID');
  if (liveBrokerExecutionControlAvailable !== true) {
    return blockedAccount(requestedAccountId, 'LIVE_BROKER_RUNTIME_CONTROL_UNAVAILABLE');
  }
  if (liveBrokerExecutionEnabled !== true) {
    return blockedAccount(requestedAccountId, 'LIVE_BROKER_EXECUTION_DISABLED');
  }
  if (!accountLiveExecutionEnabled(account)) {
    return blockedAccount(requestedAccountId, 'ACCOUNT_LIVE_EXECUTION_DISABLED');
  }
  return null;
}

async function runAccountPlan({
  workspaceId,
  eventId,
  plan,
  accountLoader,
  authorityLoader,
  snapshotLoader,
  riskMaterializer,
  dispatchAction,
  stateBinder,
  bindingRepairRecorder,
  latencyTrace,
  liveBrokerExecutionEnabled,
  liveBrokerExecutionControlAvailable,
}) {
  const requestedAccountId = text(plan?.accountId);
  if (!requestedAccountId) return blockedAccount('', 'ACCOUNT_ID_REQUIRED');

  let account;
  try {
    account = await accountLoader(workspaceId, requestedAccountId);
  } catch {
    return failedAccount(requestedAccountId, 'ACCOUNT_LOAD_FAILED');
  }

  const initialAuthorityBlock = validateAccountAuthority(account, workspaceId, requestedAccountId);
  if (initialAuthorityBlock) return initialAuthorityBlock;
  const initialLiveBlock = validateLiveExecutionAuthority(account, requestedAccountId, {
    liveBrokerExecutionEnabled,
    liveBrokerExecutionControlAvailable,
  });
  if (initialLiveBlock) return initialLiveBlock;

  const actions = Array.isArray(plan?.actions) ? plan.actions : [];
  if (actions.length === 0) return blockedAccount(requestedAccountId, 'ACCOUNT_ACTIONS_REQUIRED');

  const outcomes = [];

  for (const action of actions) {
    let currentAccount = account;
    let executionAuthority = null;
    if (typeof authorityLoader === 'function') {
      try {
        executionAuthority = await authorityLoader({
          workspaceId,
          tradingEventId: eventId,
          accountId: requestedAccountId,
        });
        currentAccount = executionAuthority?.account || null;
      } catch (error) {
        if (error?.code === 'EXECUTION_AUTHORITY_REVOKED') {
          return blockedAccount(requestedAccountId, 'EXECUTION_AUTHORITY_REVOKED');
        }
        return failedAccount(requestedAccountId, 'EXECUTION_AUTHORITY_LOAD_FAILED', outcomes);
      }

      const currentAuthorityBlock = validateAccountAuthority(currentAccount, workspaceId, requestedAccountId);
      if (currentAuthorityBlock) return currentAuthorityBlock;
      const currentLiveBlock = validateLiveExecutionAuthority(currentAccount, requestedAccountId, {
        liveBrokerExecutionEnabled,
        liveBrokerExecutionControlAvailable,
      });
      if (currentLiveBlock) return currentLiveBlock;
    }

    let snapshot = null;
    if (typeof snapshotLoader === 'function') {
      try {
        snapshot = await snapshotLoader({
          workspaceId,
          eventId,
          sourceId: executionAuthority?.source?.id ?? null,
          account: currentAccount,
          action,
          plan,
        }) ?? null;
      } catch {
        snapshot = null;
      }
    }

    let executableAction = action;
    let materialized = null;
    if (typeof riskMaterializer === 'function') {
      try {
        materialized = await riskMaterializer({
          workspaceId,
          eventId,
          groupId: plan?.groupId ?? null,
          account: currentAccount,
          action,
          plan,
          snapshot,
        });
      } catch (error) {
        outcomes.push({
          status: 'BLOCKED',
          legId: action?.legId ?? null,
          idempotencyKey: action?.idempotencyKey ?? null,
          reason: error?.code || 'BROKER_RISK_CONTEXT_UNAVAILABLE',
        });
        continue;
      }
      if (materialized?.allowed === false) {
        outcomes.push({
          status: 'BLOCKED',
          legId: action?.legId ?? null,
          idempotencyKey: action?.idempotencyKey ?? null,
          reason: materialized.reason || 'BROKER_RISK_BLOCKED',
        });
        continue;
      }
      if (materialized?.action && typeof materialized.action === 'object') executableAction = materialized.action;
    }

    const safetyPolicy = accountSafetyPolicy(currentAccount);
    const finalPolicyRequest = mergePolicyRequest(plan, executableAction, materialized);
    const policy = evaluateAccountPolicy(safetyPolicy, finalPolicyRequest);
    if (!policy.allowed) {
      if (policy.reasons?.includes('KILL_SWITCH')) {
        return blockedAccount(requestedAccountId, 'ACCOUNT_POLICY_BLOCKED', { policy });
      }
      outcomes.push({
        status: 'BLOCKED',
        legId: executableAction?.legId ?? null,
        idempotencyKey: executableAction?.idempotencyKey ?? null,
        policy,
      });
      continue;
    }

    let result;
    try {
      safeMark(latencyTrace, 'BROKER_SEND');
      result = await dispatchAction({
        workspaceId,
        eventId,
        groupId: plan?.groupId ?? null,
        account: currentAccount,
        action: executableAction,
        risk: materialized?.risk ?? null,
        snapshot,
      });
      safeMark(latencyTrace, 'BROKER_ACK');
      if (result?.ok === false || result?.success === false) {
        outcomes.push({ status: 'FAILED', legId: executableAction?.legId ?? null, idempotencyKey: executableAction?.idempotencyKey ?? null, reason: 'BROKER_DISPATCH_FAILED' });
        continue;
      }
    } catch {
      outcomes.push({ status: 'FAILED', legId: executableAction?.legId ?? null, idempotencyKey: executableAction?.idempotencyKey ?? null, reason: 'BROKER_DISPATCH_FAILED' });
      continue;
    }

    if (result?.duplicate !== true && hasBindableBrokerResult(result) && typeof stateBinder === 'function') {
      try {
        await stateBinder({
          workspaceId, eventId, accountId: requestedAccountId, groupId: plan?.groupId ?? null,
          legId: executableAction?.legId ?? null, brokerPositionId: result?.brokerPositionId ?? null,
          brokerOrderId: result?.brokerOrderId ?? null, brokerDealId: result?.brokerDealId ?? null,
          fillPrice: Number.isFinite(Number(result?.fillPrice)) ? Number(result.fillPrice) : null,
        });
      } catch {
        if (typeof bindingRepairRecorder === 'function') {
          try {
            await bindingRepairRecorder({
              workspaceId, eventId, accountId: requestedAccountId, groupId: plan?.groupId ?? null,
              legId: executableAction?.legId ?? null, idempotencyKey: executableAction?.idempotencyKey ?? null,
            });
          } catch {}
        }
        outcomes.push({ status: 'FAILED', legId: executableAction?.legId ?? null, idempotencyKey: executableAction?.idempotencyKey ?? null, reason: 'STATE_BIND_FAILED' });
        continue;
      }
    }

    outcomes.push(safeBrokerOutcome(executableAction, result));
  }

  const failed = outcomes.some((item) => item.status === 'FAILED');
  const succeeded = outcomes.some((item) => item.status === 'SUCCEEDED' || item.status === 'DUPLICATE');
  const blocked = outcomes.find((item) => item.status === 'BLOCKED');

  if (failed) return failedAccount(requestedAccountId, 'ACCOUNT_ACTION_FAILED', outcomes);
  if (!succeeded && blocked) {
    return blockedAccount(requestedAccountId, 'ACCOUNT_POLICY_BLOCKED', {
      ...(blocked.policy ? { policy: blocked.policy } : {}),
      ...(blocked.reason ? { blockReason: blocked.reason } : {}),
    });
  }

  return { accountId: requestedAccountId, status: 'SUCCEEDED', groupId: plan?.groupId ?? null, actions: outcomes };
}

export async function executeProductionPlan({
  workspaceId,
  eventId = null,
  accountPlans = [],
  brokerExecutionEnabled = false,
  liveBrokerExecutionEnabled,
  liveBrokerExecutionControlAvailable,
} = {}, {
  accountLoader,
  authorityLoader,
  snapshotLoader,
  riskMaterializer,
  dispatchAction,
  stateBinder,
  bindingRepairRecorder,
  latencyTrace,
  finalizeExecutionBatch,
} = {}) {
  const trustedWorkspaceId = text(workspaceId);
  if (!trustedWorkspaceId) throw new TypeError('workspaceId is required');
  if (!Array.isArray(accountPlans)) throw new TypeError('accountPlans must be an array');

  if (brokerExecutionEnabled !== true) {
    const accounts = accountPlans.map((plan) => blockedAccount(plan?.accountId, 'BROKER_EXECUTION_DISABLED'));
    return summarize(accounts, false);
  }

  if (typeof accountLoader !== 'function') throw new TypeError('accountLoader is required');
  if (typeof dispatchAction !== 'function') throw new TypeError('dispatchAction is required');

  try {
    const accounts = await Promise.all(accountPlans.map((plan) => runAccountPlan({
      workspaceId: trustedWorkspaceId,
      eventId,
      plan,
      accountLoader,
      authorityLoader,
      snapshotLoader,
      riskMaterializer,
      dispatchAction,
      stateBinder,
      bindingRepairRecorder,
      latencyTrace,
      liveBrokerExecutionEnabled,
      liveBrokerExecutionControlAvailable,
    })));
    return summarize(accounts, true);
  } finally {
    if (typeof finalizeExecutionBatch === 'function') {
      try { await finalizeExecutionBatch(); } catch {}
    }
  }
}
