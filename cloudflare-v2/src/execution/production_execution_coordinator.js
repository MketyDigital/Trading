import { evaluateAccountPolicy } from './account_policy.js';

function text(value) {
  return String(value ?? '').trim();
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
    lots: action.lots,
    riskPercent: action.riskPercent ?? plan.riskPercent ?? plan?.risk?.riskPercent,
    currentDailyPnlPercent: plan.currentDailyPnlPercent,
    currentOpenRiskPercent: plan.currentOpenRiskPercent,
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

async function runAccountPlan({ workspaceId, eventId, plan, accountLoader, dispatchAction, stateBinder }) {
  const requestedAccountId = text(plan?.accountId);
  if (!requestedAccountId) return blockedAccount('', 'ACCOUNT_ID_REQUIRED');

  let account;
  try {
    account = await accountLoader(workspaceId, requestedAccountId);
  } catch {
    return failedAccount(requestedAccountId, 'ACCOUNT_LOAD_FAILED');
  }

  if (!account) return blockedAccount(requestedAccountId, 'ACCOUNT_NOT_FOUND');
  if (workspaceIdOf(account) !== workspaceId) {
    return blockedAccount(requestedAccountId, 'ACCOUNT_WORKSPACE_MISMATCH');
  }
  if (accountIdOf(account) !== requestedAccountId) {
    return blockedAccount(requestedAccountId, 'ACCOUNT_ID_MISMATCH');
  }
  if (!accountIsActive(account)) return blockedAccount(requestedAccountId, 'ACCOUNT_INACTIVE');
  if (!accountExecutionEnabled(account)) return blockedAccount(requestedAccountId, 'ACCOUNT_EXECUTION_DISABLED');

  const actions = Array.isArray(plan?.actions) ? plan.actions : [];
  if (actions.length === 0) return blockedAccount(requestedAccountId, 'ACCOUNT_ACTIONS_REQUIRED');

  const safetyPolicy = accountSafetyPolicy(account);
  const outcomes = [];

  for (const action of actions) {
    const policy = evaluateAccountPolicy(safetyPolicy, policyRequest(plan, action));
    if (!policy.allowed) {
      if (policy.reasons?.includes('KILL_SWITCH')) {
        return blockedAccount(requestedAccountId, 'ACCOUNT_POLICY_BLOCKED', { policy });
      }
      outcomes.push({
        status: 'BLOCKED',
        legId: action?.legId ?? null,
        idempotencyKey: action?.idempotencyKey ?? null,
        policy,
      });
      continue;
    }

    let result;
    try {
      result = await dispatchAction({
        workspaceId,
        eventId,
        groupId: plan?.groupId ?? null,
        account,
        action,
      });
      if (result?.ok === false || result?.success === false) {
        outcomes.push({
          status: 'FAILED',
          legId: action?.legId ?? null,
          idempotencyKey: action?.idempotencyKey ?? null,
          reason: 'BROKER_DISPATCH_FAILED',
        });
        continue;
      }
    } catch {
      outcomes.push({
        status: 'FAILED',
        legId: action?.legId ?? null,
        idempotencyKey: action?.idempotencyKey ?? null,
        reason: 'BROKER_DISPATCH_FAILED',
      });
      continue;
    }

    if (result?.duplicate !== true && hasBindableBrokerResult(result) && typeof stateBinder === 'function') {
      try {
        await stateBinder({
          workspaceId,
          eventId,
          accountId: requestedAccountId,
          groupId: plan?.groupId ?? null,
          legId: action?.legId ?? null,
          brokerPositionId: result?.brokerPositionId ?? null,
          brokerOrderId: result?.brokerOrderId ?? null,
          brokerDealId: result?.brokerDealId ?? null,
          fillPrice: Number.isFinite(Number(result?.fillPrice)) ? Number(result.fillPrice) : null,
        });
      } catch {
        outcomes.push({
          status: 'FAILED',
          legId: action?.legId ?? null,
          idempotencyKey: action?.idempotencyKey ?? null,
          reason: 'STATE_BIND_FAILED',
        });
        continue;
      }
    }

    outcomes.push(safeBrokerOutcome(action, result));
  }

  const failed = outcomes.some((item) => item.status === 'FAILED');
  const succeeded = outcomes.some((item) => item.status === 'SUCCEEDED' || item.status === 'DUPLICATE');
  const blocked = outcomes.find((item) => item.status === 'BLOCKED');

  if (failed) return failedAccount(requestedAccountId, 'ACCOUNT_ACTION_FAILED', outcomes);
  if (!succeeded && blocked) {
    return blockedAccount(requestedAccountId, 'ACCOUNT_POLICY_BLOCKED', {
      policy: blocked.policy,
    });
  }

  return {
    accountId: requestedAccountId,
    status: 'SUCCEEDED',
    groupId: plan?.groupId ?? null,
    actions: outcomes,
  };
}

export async function executeProductionPlan({
  workspaceId,
  eventId = null,
  accountPlans = [],
  brokerExecutionEnabled = false,
} = {}, {
  accountLoader,
  dispatchAction,
  stateBinder,
} = {}) {
  const trustedWorkspaceId = text(workspaceId);
  if (!trustedWorkspaceId) throw new TypeError('workspaceId is required');
  if (!Array.isArray(accountPlans)) throw new TypeError('accountPlans must be an array');

  // The Worker-wide broker master fuse is deliberately the first broker-capable
  // decision. When it is off, no account lookup, delivery reservation, state
  // mutation, destination dependency, or broker adapter may be reached.
  if (brokerExecutionEnabled !== true) {
    const accounts = accountPlans.map((plan) => blockedAccount(plan?.accountId, 'BROKER_EXECUTION_DISABLED'));
    return summarize(accounts, false);
  }

  if (typeof accountLoader !== 'function') throw new TypeError('accountLoader is required');
  if (typeof dispatchAction !== 'function') throw new TypeError('dispatchAction is required');

  const accounts = await Promise.all(accountPlans.map((plan) => runAccountPlan({
    workspaceId: trustedWorkspaceId,
    eventId,
    plan,
    accountLoader,
    dispatchAction,
    stateBinder,
  })));

  return summarize(accounts, true);
}
