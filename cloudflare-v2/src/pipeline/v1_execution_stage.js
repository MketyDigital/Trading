import { createProductionExecutionDependencies } from '../execution/production_execution_deps_unified.js';
import { createSafeSimulationExecutionDependencies } from '../execution/safe_simulation_execution_deps.js';
import { executeProductionPlan } from '../execution/production_execution_coordinator.js';
import { createProductionBindingRepairRecorder } from '../execution/production_binding_repair_recorder.js';
import {
  resolveBrokerExecutionRuntimeControl,
  resolveTradingAccessRuntimeControl,
  resolveLiveBrokerExecutionRuntimeControl,
} from '../persistence/supabase_runtime_control_store.js';

function enabled(value) { return ['1', 'true', 'yes', 'on'].includes(String(value ?? '').trim().toLowerCase()); }
function executionTransportMode(env = {}) { return String(env.TRADING_EXECUTION_TRANSPORT_MODE ?? 'real').trim().toLowerCase() === 'simulation' ? 'simulation' : 'real'; }
function sanitizeAction(action = {}) {
  if (!action || typeof action !== 'object' || Array.isArray(action)) return null;
  const { simulated: _simulated, transportMode: _transportMode, ...trusted } = action;
  return trusted;
}
function trustedReadyPlans(simulation = {}) {
  return (Array.isArray(simulation?.accounts) ? simulation.accounts : [])
    .filter((account) => account?.status === 'READY')
    .map((account) => {
      const actions = (Array.isArray(account?.actions) ? account.actions : []).map(sanitizeAction).filter(Boolean);
      return {
        accountId: String(account?.accountId || '').trim(),
        groupId: account?.groupId == null ? null : String(account.groupId),
        actions,
        ...(Number.isFinite(Number(account?.currentRiskUsd)) ? { currentRiskUsd: Number(account.currentRiskUsd) } : {}),
        ...(Number.isFinite(Number(account?.dailyPnlPct)) ? { dailyPnlPct: Number(account.dailyPnlPct) } : {}),
        ...(Number.isFinite(Number(account?.openExposureLots)) ? { openExposureLots: Number(account.openExposureLots) } : {}),
      };
    }).filter((plan) => plan.accountId && plan.actions.length > 0);
}
function withTransportMode(value, transportMode) { return transportMode === 'simulation' ? { ...value, transportMode: 'simulation' } : value; }
function summary(status, { executionEnabled = false, blocked = 0, transportMode = 'real' } = {}) {
  return withTransportMode({ executionEnabled, status, accounts: [], succeeded: 0, failed: 0, blocked }, transportMode);
}

async function defaultTradingAccessResolver({ env, supabase }) {
  if (!supabase?.from) return { ok: true, enabled: enabled(env.TRADING_ACCESS_ENABLED), bootstrapFallback: true };
  return resolveTradingAccessRuntimeControl({ supabase });
}
async function defaultLiveBrokerResolver({ supabase }) {
  if (!supabase?.from) return { ok: true, enabled: false, bootstrapFallback: true };
  return resolveLiveBrokerExecutionRuntimeControl({ supabase });
}

export async function runV1ProductionExecutionStage({
  env = {}, supabase, result, simulation,
  executionDepsFactory = createProductionExecutionDependencies,
  safeSimulationDepsFactory = createSafeSimulationExecutionDependencies,
  bindingRepairRecorderFactory = createProductionBindingRepairRecorder,
  executeProductionFn = executeProductionPlan,
  tradingAccessControlResolver = defaultTradingAccessResolver,
  brokerExecutionControlResolver = resolveBrokerExecutionRuntimeControl,
  liveBrokerExecutionControlResolver = defaultLiveBrokerResolver,
} = {}) {
  if (!result?.ok || result?.duplicate) return null;
  const transportMode = executionTransportMode(env);

  let tradingAccess;
  try { tradingAccess = await tradingAccessControlResolver({ env, supabase }); }
  catch { tradingAccess = { ok: false, enabled: false }; }
  if (!tradingAccess?.ok) return summary('TRADING_RUNTIME_CONTROL_UNAVAILABLE', { transportMode });
  if (tradingAccess.enabled !== true) return summary('TRADING_ACCESS_DISABLED', { transportMode });

  const accountPlans = trustedReadyPlans(simulation);
  if (simulation?.status !== 'SIMULATED' || accountPlans.length === 0) return summary('NOT_EXECUTABLE', { transportMode });

  let runtimeControl;
  try { runtimeControl = await brokerExecutionControlResolver({ env, supabase }); }
  catch { runtimeControl = { ok: false, enabled: false }; }
  if (!runtimeControl?.ok) return summary('BROKER_RUNTIME_CONTROL_UNAVAILABLE', { blocked: accountPlans.length, transportMode });
  if (runtimeControl.enabled !== true) return summary('BROKER_OWNER_SWITCH_OFF', { blocked: accountPlans.length, transportMode });

  let liveControl;
  try { liveControl = await liveBrokerExecutionControlResolver({ env, supabase }); }
  catch { liveControl = { ok: false, enabled: false }; }
  if (!liveControl?.ok) return summary('LIVE_RUNTIME_CONTROL_UNAVAILABLE', { blocked: accountPlans.length, transportMode });

  const workspaceId = String(result?.event?.workspace_hint || '').trim();
  const tradingEventId = String(result?.eventId || '').trim();
  if (!workspaceId || !tradingEventId) return summary('NOT_EXECUTABLE', { transportMode });

  const selectedFactory = transportMode === 'simulation' ? safeSimulationDepsFactory : executionDepsFactory;
  const dependencies = await selectedFactory({ env, supabase, workspaceId, tradingEventId });
  const bindingRepairRecorder = dependencies?.bindingRepairRecorder || bindingRepairRecorderFactory({ supabase, workspaceId, tradingEventId });
  const execution = await executeProductionFn({
    workspaceId,
    eventId: tradingEventId,
    accountPlans,
    brokerExecutionEnabled: true,
    liveBrokerExecutionEnabled: liveControl.enabled === true,
  }, { ...dependencies, bindingRepairRecorder });
  return withTransportMode(execution, transportMode);
}
