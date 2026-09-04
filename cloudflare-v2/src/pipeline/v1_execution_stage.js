import { createProductionExecutionDependencies } from '../execution/production_execution_deps.js';
import { executeProductionPlan } from '../execution/production_execution_coordinator.js';
import { createProductionBindingRepairRecorder } from '../execution/production_binding_repair_recorder.js';

function enabled(value) {
  return ['1', 'true', 'yes', 'on'].includes(String(value ?? '').trim().toLowerCase());
}

function sanitizeAction(action = {}) {
  if (!action || typeof action !== 'object' || Array.isArray(action)) return null;
  const { simulated: _simulated, ...trusted } = action;
  return trusted;
}

function trustedReadyPlans(simulation = {}) {
  return (Array.isArray(simulation?.accounts) ? simulation.accounts : [])
    .filter((account) => account?.status === 'READY')
    .map((account) => {
      const actions = (Array.isArray(account?.actions) ? account.actions : [])
        .map(sanitizeAction)
        .filter(Boolean);
      return {
        accountId: String(account?.accountId || '').trim(),
        groupId: account?.groupId == null ? null : String(account.groupId),
        actions,
        ...(Number.isFinite(Number(account?.currentRiskUsd)) ? { currentRiskUsd: Number(account.currentRiskUsd) } : {}),
        ...(Number.isFinite(Number(account?.dailyPnlPct)) ? { dailyPnlPct: Number(account.dailyPnlPct) } : {}),
        ...(Number.isFinite(Number(account?.openExposureLots)) ? { openExposureLots: Number(account.openExposureLots) } : {}),
      };
    })
    .filter((plan) => plan.accountId && plan.actions.length > 0);
}

function summary(status, { executionEnabled = false, blocked = 0 } = {}) {
  return {
    executionEnabled,
    status,
    accounts: [],
    succeeded: 0,
    failed: 0,
    blocked,
  };
}

export async function runV1ProductionExecutionStage({
  env = {},
  supabase,
  result,
  simulation,
  executionDepsFactory = createProductionExecutionDependencies,
  bindingRepairRecorderFactory = createProductionBindingRepairRecorder,
  executeProductionFn = executeProductionPlan,
} = {}) {
  if (!result?.ok || result?.duplicate) {
    return null;
  }

  if (!enabled(env.TRADING_ACCESS_ENABLED)) {
    return summary('TRADING_ACCESS_DISABLED');
  }

  const accountPlans = trustedReadyPlans(simulation);

  if (!enabled(env.BROKER_EXECUTION_ENABLED)) {
    return summary('BROKER_EXECUTION_DISABLED', { blocked: accountPlans.length });
  }

  if (simulation?.status !== 'SIMULATED' || accountPlans.length === 0) {
    return summary('NOT_EXECUTABLE');
  }

  const workspaceId = String(result?.event?.workspace_hint || '').trim();
  const tradingEventId = String(result?.eventId || '').trim();
  if (!workspaceId || !tradingEventId) {
    return summary('NOT_EXECUTABLE');
  }

  const dependencies = await executionDepsFactory({ env, supabase, workspaceId, tradingEventId });
  const bindingRepairRecorder = dependencies?.bindingRepairRecorder || bindingRepairRecorderFactory({
    supabase,
    workspaceId,
    tradingEventId,
  });

  return executeProductionFn({
    workspaceId,
    eventId: tradingEventId,
    accountPlans,
    brokerExecutionEnabled: true,
  }, {
    ...dependencies,
    bindingRepairRecorder,
  });
}
