import { createProductionExecutionDependencies } from '../execution/production_execution_deps_unified.js';
import { createSafeSimulationExecutionDependencies } from '../execution/safe_simulation_execution_deps.js';
import { executeProductionPlan } from '../execution/production_execution_coordinator.js';
import { createProductionBindingRepairRecorder } from '../execution/production_binding_repair_recorder.js';
import { createProductionTradeStateBinder } from '../state/production_trade_state_binder.js';
import {
  resolveBrokerExecutionRuntimeControl,
  resolveLiveBrokerExecutionRuntimeControl,
  resolveTradingAccessRuntimeControl,
} from '../persistence/supabase_runtime_control_store.js';

function executionTransportMode(env = {}) {
  return String(env.TRADING_EXECUTION_TRANSPORT_MODE ?? 'real').trim().toLowerCase() === 'simulation'
    ? 'simulation'
    : 'real';
}

function sanitizeAction(action = {}) {
  if (!action || typeof action !== 'object' || Array.isArray(action)) return null;
  const { simulated: _simulated, transportMode: _transportMode, ...trusted } = action;
  return trusted;
}

function withDurableActionIdentity(action, { result, accountId, groupId, index } = {}) {
  if (!action) return null;
  if (String(action.idempotencyKey || '').trim()) return action;
  const sourceEventId = String(result?.event?.external_event_id || result?.eventId || '').trim();
  const group = String(groupId || '').trim();
  const account = String(accountId || '').trim();
  const actionType = String(action.type || 'ACTION').trim().toUpperCase();
  const leg = String(action.legId || action.brokerPositionId || action.brokerOrderId || `index-${Number(index) + 1}`).trim();
  if (!sourceEventId || !account || !group) return action;
  return {
    ...action,
    idempotencyKey: `${group}:event:${sourceEventId}:account:${account}:${actionType}:${leg}:${Number(index) + 1}`,
  };
}

function trustedReadyPlans(simulation = {}, result = {}) {
  return (Array.isArray(simulation?.accounts) ? simulation.accounts : [])
    .filter((account) => account?.status === 'READY')
    .map((account) => {
      const accountId = String(account?.accountId || '').trim();
      const groupId = account?.groupId == null ? null : String(account.groupId);
      const actions = (Array.isArray(account?.actions) ? account.actions : [])
        .map(sanitizeAction)
        .map((action, index) => withDurableActionIdentity(action, { result, accountId, groupId, index }))
        .filter(Boolean);
      return {
        accountId,
        groupId,
        actions,
        ...(Number.isFinite(Number(account?.currentRiskUsd)) ? { currentRiskUsd: Number(account.currentRiskUsd) } : {}),
        ...(Number.isFinite(Number(account?.dailyPnlPct)) ? { dailyPnlPct: Number(account.dailyPnlPct) } : {}),
        ...(Number.isFinite(Number(account?.openExposureLots)) ? { openExposureLots: Number(account.openExposureLots) } : {}),
      };
    })
    .filter((plan) => plan.accountId && plan.actions.length > 0);
}

function withTransportMode(value, transportMode) {
  return transportMode === 'simulation'
    ? { ...value, transportMode: 'simulation' }
    : value;
}

function summary(status, { executionEnabled = false, blocked = 0, transportMode = 'real' } = {}) {
  return withTransportMode({
    executionEnabled,
    status,
    accounts: [],
    succeeded: 0,
    failed: 0,
    blocked,
  }, transportMode);
}

async function resolveRuntimeControl(resolver, { env, supabase }, unavailableReason) {
  try {
    return await resolver({ env, supabase });
  } catch {
    return { ok: false, enabled: false, reason: unavailableReason };
  }
}

export async function runV1ProductionExecutionStage({
  env = {},
  supabase,
  result,
  simulation,
  executionDepsFactory = createProductionExecutionDependencies,
  safeSimulationDepsFactory = createSafeSimulationExecutionDependencies,
  bindingRepairRecorderFactory = createProductionBindingRepairRecorder,
  executeProductionFn = executeProductionPlan,
  tradingAccessControlResolver = resolveTradingAccessRuntimeControl,
  brokerExecutionControlResolver = resolveBrokerExecutionRuntimeControl,
  liveBrokerExecutionControlResolver = resolveLiveBrokerExecutionRuntimeControl,
} = {}) {
  if (!result?.ok || result?.duplicate) {
    return null;
  }

  const transportMode = executionTransportMode(env);
  const accountPlans = trustedReadyPlans(simulation, result);

  if (simulation?.status !== 'SIMULATED' || accountPlans.length === 0) {
    return summary('NOT_EXECUTABLE', { transportMode });
  }

  const tradingAccessControl = await resolveRuntimeControl(
    tradingAccessControlResolver,
    { env, supabase },
    'TRADING_RUNTIME_CONTROL_UNAVAILABLE',
  );
  if (!tradingAccessControl?.ok) {
    return summary('TRADING_RUNTIME_CONTROL_UNAVAILABLE', { blocked: accountPlans.length, transportMode });
  }
  if (tradingAccessControl.enabled !== true) {
    return summary('TRADING_ACCESS_DISABLED', { blocked: accountPlans.length, transportMode });
  }

  const brokerExecutionControl = await resolveRuntimeControl(
    brokerExecutionControlResolver,
    { env, supabase },
    'RUNTIME_CONTROL_UNAVAILABLE',
  );
  if (!brokerExecutionControl?.ok) {
    return summary('BROKER_RUNTIME_CONTROL_UNAVAILABLE', { blocked: accountPlans.length, transportMode });
  }
  if (brokerExecutionControl.enabled !== true) {
    return summary('BROKER_OWNER_SWITCH_OFF', { blocked: accountPlans.length, transportMode });
  }

  const liveBrokerExecutionControl = await resolveRuntimeControl(
    liveBrokerExecutionControlResolver,
    { env, supabase },
    'LIVE_BROKER_RUNTIME_CONTROL_UNAVAILABLE',
  );

  const workspaceId = String(result?.event?.workspace_hint || '').trim();
  const tradingEventId = String(result?.eventId || '').trim();
  if (!workspaceId || !tradingEventId) {
    return summary('NOT_EXECUTABLE', { transportMode });
  }

  const selectedFactory = transportMode === 'simulation'
    ? safeSimulationDepsFactory
    : executionDepsFactory;

  const dependencies = await selectedFactory({ env, supabase, workspaceId, tradingEventId });
  const bindingRepairRecorder = dependencies?.bindingRepairRecorder || bindingRepairRecorderFactory({
    supabase,
    workspaceId,
    tradingEventId,
  });
  const stateBinder = transportMode === 'real' && executionDepsFactory === createProductionExecutionDependencies
    ? createProductionTradeStateBinder({ env, supabase, workspaceId })
    : dependencies?.stateBinder;

  const execution = await executeProductionFn({
    workspaceId,
    eventId: tradingEventId,
    accountPlans,
    brokerExecutionEnabled: true,
    liveBrokerExecutionEnabled: liveBrokerExecutionControl?.ok === true && liveBrokerExecutionControl.enabled === true,
    liveBrokerExecutionControlAvailable: liveBrokerExecutionControl?.ok === true,
  }, {
    ...dependencies,
    stateBinder,
    bindingRepairRecorder,
  });

  return withTransportMode(execution, transportMode);
}
