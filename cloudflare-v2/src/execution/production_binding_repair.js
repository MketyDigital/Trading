import { repairExecutionBindings } from './execution_binding_repair.js';
import { createProductionExecutionDependencies } from './production_execution_deps.js';
import { createSupabaseClient } from '../persistence/supabase_rest.js';

function createSupabaseFromEnv(env = {}) {
  return createSupabaseClient({
    url: env.SUPABASE_URL,
    serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY
      || env.SUPABASE_SERVICE_ROLE
      || env.SUPABASE_SERVICE_KEY,
  });
}

export function createProductionBindingRepairRuntime({
  supabaseFactory = async (env) => createSupabaseFromEnv(env),
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
