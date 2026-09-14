import { repairExecutionBindings } from './execution_binding_repair.js';
import { createProductionExecutionDependencies } from './production_execution_deps.js';
import { defaultDestinationRetrySupabaseFactory } from './destination_retry_production.js';
import { createProductionTradeStateBinder } from '../state/production_trade_state_binder.js';

export function createProductionBindingRepairRuntime({
  supabaseFactory = defaultDestinationRetrySupabaseFactory,
  executionDepsFactory = createProductionExecutionDependencies,
} = {}) {
  return async function runProductionBindingRepair(env = {}, _ctx = {}) {
    const supabase = await supabaseFactory(env);

    return repairExecutionBindings({
      supabase,
      stateBinder: async (binding) => {
        if (executionDepsFactory === createProductionExecutionDependencies) {
          const binder = createProductionTradeStateBinder({
            env,
            workspaceId: binding.workspaceId,
          });
          await binder(binding);
          return;
        }

        const deps = await executionDepsFactory({
          env,
          supabase,
          workspaceId: binding.workspaceId,
          tradingEventId: binding.eventId,
        });
        if (!deps || typeof deps.stateBinder !== 'function') {
          throw new Error('production state binder unavailable');
        }
        await deps.stateBinder(binding);
      },
    });
  };
}

export const runScheduledBindingRepairs = createProductionBindingRepairRuntime();
