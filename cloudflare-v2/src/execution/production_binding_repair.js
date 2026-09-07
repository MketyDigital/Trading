import { repairExecutionBindings } from './execution_binding_repair.js';
import { createProductionExecutionDependencies } from './production_execution_deps.js';
import { defaultDestinationRetrySupabaseFactory } from './destination_retry_production.js';

export function createProductionBindingRepairRuntime({
  supabaseFactory = defaultDestinationRetrySupabaseFactory,
  executionDepsFactory = createProductionExecutionDependencies,
} = {}) {
  return async function runProductionBindingRepair(env = {}, _ctx = {}) {
    const supabase = await supabaseFactory(env);

    return repairExecutionBindings({
      supabase,
      stateBinder: async (binding) => {
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
