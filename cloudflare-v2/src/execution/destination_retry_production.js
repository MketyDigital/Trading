import { createDestinationRetryRuntime } from './destination_retry_runtime.js';
import {
  createClaimedDeliveryStore,
  listDueDestinationRetries,
} from './destination_retry_composition.js';
import { createSupabaseDeliveryStore } from '../persistence/supabase_delivery_store.js';
import { createProductionExecutionDependencies } from './production_execution_deps.js';
import { executeProductionPlan } from './production_execution_coordinator.js';
import { resolveBrokerExecutionRuntimeControl } from '../persistence/supabase_runtime_control_store.js';

function text(value) {
  return String(value ?? '').trim();
}

function enabled(value) {
  return ['1', 'true', 'yes', 'on'].includes(text(value).toLowerCase());
}

function accessDisabledSummary() {
  return {
    status: 'TRADING_ACCESS_DISABLED',
    scanned: 0,
    claimed: 0,
    dispatched: 0,
    succeeded: 0,
    failed: 0,
  };
}

async function defaultSupabaseFactory(env = {}) {
  const url = text(env.SUPABASE_URL);
  const key = text(
    env.SUPABASE_SERVICE_ROLE ||
    env.SUPABASE_SERVICE_ROLE_KEY ||
    env.SUPABASE_SERVICE_KEY,
  );
  if (!url || !key) throw new Error('Supabase service credentials are not configured');
  const { createClient } = await import('@supabase/supabase-js');
  return createClient(url, key);
}

function storeKey(delivery = {}) {
  return `${text(delivery.workspace_id)}\u0000${text(delivery.idempotency_key)}`;
}

function assertRetryAuthority(delivery = {}) {
  const payload = delivery.request_payload;
  const accountId = text(payload?.accountId);
  const expectedDestinationRef = `trade-account:${accountId}`;
  if (!accountId || text(delivery.destination_ref) !== expectedDestinationRef) {
    throw new Error('destination retry account authority mismatch');
  }
  if (text(payload?.destinationType).toLowerCase() !== text(delivery.destination_type).toLowerCase()) {
    throw new Error('destination retry platform authority mismatch');
  }
  return payload;
}

function exactClaimedStoreFactory({ baseStore, claimedStore, delivery }) {
  return (_supabase, options = {}) => {
    if (text(options.workspaceId) !== text(delivery.workspace_id)) {
      throw new Error('claimed retry workspace store mismatch');
    }
    if (text(options.destinationType).toLowerCase() !== text(delivery.destination_type).toLowerCase()) {
      throw new Error('claimed retry destination type store mismatch');
    }
    if (text(options.destinationRef) !== text(delivery.destination_ref)) {
      throw new Error('claimed retry destination ref store mismatch');
    }
    if (text(options.tradingEventId) !== text(delivery.trading_event_id)) {
      throw new Error('claimed retry trading event store mismatch');
    }
    if (!baseStore || !claimedStore) throw new Error('claimed retry store is unavailable');
    return claimedStore;
  };
}

async function terminalFail(baseStore, delivery, code) {
  await baseStore.fail(delivery.idempotency_key, { code });
  return { status: 'FAILED' };
}

async function markRetryableFailure(baseStore, delivery, failure, { now, retryDelayMs }) {
  if (typeof baseStore.markRetryable !== 'function') {
    await baseStore.fail(delivery.idempotency_key, { code: failure.code });
    return;
  }
  await baseStore.markRetryable(delivery.idempotency_key, failure, {
    nextAttemptAt: new Date(new Date(now).getTime() + retryDelayMs).toISOString(),
  });
}

async function retrySetupFailure(baseStore, delivery, error, { now, retryDelayMs }) {
  return markRetryableFailure(baseStore, delivery, {
    code: 'RETRY_SETUP_FAILED',
    message: error instanceof Error ? error.message : String(error),
  }, { now, retryDelayMs });
}

async function reconcileCoordinatorFailure(baseStore, delivery, accountResult, { now, retryDelayMs }) {
  let durable = null;
  if (typeof baseStore.find === 'function') {
    try {
      durable = await baseStore.find(delivery.idempotency_key);
    } catch {
      durable = null;
    }
  }

  const durableStatus = text(durable?.status).toUpperCase();
  if (durableStatus === 'SUCCEEDED') {
    // Broker truth is already terminal; a separate binding-repair path owns any
    // post-broker Trade State failure and this retry must never resend.
    return { status: 'SUCCEEDED' };
  }
  if (['RETRYABLE', 'UNCERTAIN', 'FAILED'].includes(durableStatus)) {
    // The broker adapter already classified and persisted the outcome. Preserve
    // that durable truth rather than overwriting it at the wrapper layer.
    return { status: 'FAILED' };
  }

  // No adapter-owned terminal/retry classification exists. This means the
  // coordinator failed before durable broker outcome persistence (authority
  // reload, credential/context creation, runtime initialization, etc.). Return
  // the claimed row to the retry schedule instead of leaving it PENDING.
  await markRetryableFailure(baseStore, delivery, {
    code: 'RETRY_EXECUTION_FAILED_BEFORE_DURABLE_OUTCOME',
    message: text(accountResult?.reason) || 'retry execution failed before durable broker outcome',
  }, { now, retryDelayMs });
  return { status: 'FAILED' };
}

export function createProductionDestinationRetryRuntime({
  supabaseFactory = defaultSupabaseFactory,
  listDueFn = listDueDestinationRetries,
  deliveryStoreFactory = createSupabaseDeliveryStore,
  executionDepsFactory = createProductionExecutionDependencies,
  executeProductionFn = executeProductionPlan,
  brokerExecutionControlResolver = resolveBrokerExecutionRuntimeControl,
  batchLimit = 10,
  leaseMs = 30000,
  maxAttempts = 5,
  retryDelayMs = 15000,
} = {}) {
  if (typeof supabaseFactory !== 'function') throw new TypeError('supabaseFactory is required');
  if (typeof listDueFn !== 'function') throw new TypeError('listDueFn is required');
  if (typeof deliveryStoreFactory !== 'function') throw new TypeError('deliveryStoreFactory is required');
  if (typeof executionDepsFactory !== 'function') throw new TypeError('executionDepsFactory is required');
  if (typeof executeProductionFn !== 'function') throw new TypeError('executeProductionFn is required');

  const safeRetryDelayMs = Math.max(1000, Math.min(300000, Math.trunc(Number(retryDelayMs) || 15000)));

  return async function runProductionDestinationRetry(env = {}, options = {}) {
    if (!enabled(env.TRADING_ACCESS_ENABLED)) return accessDisabledSummary();

    // Per-invocation store map prevents claims from leaking between scheduled runs.
    const stores = new Map();

    const runtime = createDestinationRetryRuntime({
      supabaseFactory,
      brokerExecutionControlResolver,
      batchLimit,
      leaseMs,
      listDueFn: ({ supabase, now, limit }) => listDueFn({
        supabase,
        now,
        limit,
        maxAttempts,
      }),
      claimFn: async ({ supabase, delivery, now, leaseUntil }) => {
        const baseStore = deliveryStoreFactory(supabase, {
          workspaceId: delivery.workspace_id,
          destinationType: delivery.destination_type,
          destinationRef: delivery.destination_ref,
          tradingEventId: delivery.trading_event_id || null,
        });
        stores.set(storeKey(delivery), baseStore);
        const claim = await baseStore.claimRetry(delivery.idempotency_key, { now, leaseUntil });
        if (claim?.claimed && claim.row) stores.set(storeKey(claim.row), baseStore);
        return claim;
      },
      recoverFn: async ({ supabase, delivery, now }) => {
        const baseStore = stores.get(storeKey(delivery));
        if (!baseStore) throw new Error('claimed destination delivery store is unavailable');

        let payload;
        try {
          payload = assertRetryAuthority(delivery);
        } catch {
          return terminalFail(baseStore, delivery, 'RETRY_AUTHORITY_MISMATCH');
        }

        const claimedStore = createClaimedDeliveryStore(baseStore, delivery);
        const deliveryStoreOverride = exactClaimedStoreFactory({ baseStore, claimedStore, delivery });

        let deps;
        let result;
        try {
          deps = await executionDepsFactory({
            env,
            supabase,
            workspaceId: delivery.workspace_id,
            tradingEventId: delivery.trading_event_id || null,
          }, {
            deliveryStoreFactory: deliveryStoreOverride,
          });

          result = await executeProductionFn({
            workspaceId: delivery.workspace_id,
            eventId: delivery.trading_event_id || null,
            accountPlans: [{
              accountId: payload.accountId,
              groupId: payload.groupId,
              actions: [payload.action],
            }],
            brokerExecutionEnabled: true,
          }, deps);
        } catch (error) {
          await retrySetupFailure(baseStore, delivery, error, { now, retryDelayMs: safeRetryDelayMs });
          return { status: 'FAILED' };
        }

        const accountResult = Array.isArray(result?.accounts) ? result.accounts[0] : null;
        if (!accountResult) {
          await retrySetupFailure(baseStore, delivery, new Error('retry execution returned no account result'), { now, retryDelayMs: safeRetryDelayMs });
          return { status: 'FAILED' };
        }

        if (accountResult.status === 'BLOCKED') {
          if (accountResult.blockReason === 'BROKER_RISK_CONTEXT_UNAVAILABLE') {
            await markRetryableFailure(baseStore, delivery, {
              code: 'RETRY_RISK_CONTEXT_UNAVAILABLE',
              message: 'authoritative broker risk context is temporarily unavailable',
            }, { now, retryDelayMs: safeRetryDelayMs });
            return { status: 'FAILED' };
          }
          return terminalFail(baseStore, delivery, 'RETRY_EXECUTION_AUTHORITY_REVOKED');
        }

        if (accountResult.status === 'FAILED' && accountResult.reason === 'ACCOUNT_LOAD_FAILED') {
          await retrySetupFailure(baseStore, delivery, new Error('retry account reload failed'), { now, retryDelayMs: safeRetryDelayMs });
          return { status: 'FAILED' };
        }

        if (accountResult.status === 'SUCCEEDED') return { status: 'SUCCEEDED' };
        return reconcileCoordinatorFailure(baseStore, delivery, accountResult, {
          now,
          retryDelayMs: safeRetryDelayMs,
        });
      },
    });

    return runtime(env, options);
  };
}

export { defaultSupabaseFactory as defaultDestinationRetrySupabaseFactory };
