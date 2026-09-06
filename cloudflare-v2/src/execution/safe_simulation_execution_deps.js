import { createProductionExecutionDependencies } from './production_execution_deps.js';

function text(value) {
  return String(value ?? '').trim();
}

function simulatedId(prefix, action = {}, account = {}) {
  const raw = text(action.idempotencyKey) || `${text(account.id)}:${text(action.type)}:${text(action.symbol)}`;
  let hash = 2166136261;
  for (let index = 0; index < raw.length; index += 1) {
    hash ^= raw.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `${prefix}-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

function simulatedFillPrice(action = {}) {
  for (const candidate of [action.entry?.value, action.entryPrice, action.price, 2500]) {
    const numeric = Number(candidate);
    if (Number.isFinite(numeric) && numeric > 0) return numeric;
  }
  return 2500;
}

function noNetwork() {
  throw new Error('external network is disabled in safe execution simulation');
}

function mt5SimulationContext({ accountId, serverName } = {}) {
  return {
    baseUrl: 'https://simulation.invalid',
    commandUrl: 'https://simulation.invalid/v1/command',
    brokerAccount: {
      ok: true,
      account_id: text(accountId),
      server_name: text(serverName) || 'SIMULATION',
      simulation: true,
    },
    catalog: [
      {
        canonical: 'XAUUSD',
        platform: 'mt5',
        platformSymbol: 'XAUUSD',
        enabled: true,
        volumeMin: 0.01,
        volumeMax: 100,
        volumeStep: 0.01,
      },
    ],
    async marketPriceFor() {
      return 2500;
    },
  };
}

async function mt5SimulationExecutor(action = {}, options = {}) {
  return {
    ok: true,
    success: true,
    transportMode: 'simulation',
    brokerPositionId: simulatedId('sim-mt5-pos', action, { id: options.accountId }),
    brokerOrderId: simulatedId('sim-mt5-order', action, { id: options.accountId }),
    fillPrice: simulatedFillPrice(action),
  };
}

async function ctraderSimulationRuntime(options = {}) {
  return {
    environment: 'simulation',
    simulation: true,
    async execute(action = {}) {
      return {
        ok: true,
        success: true,
        transportMode: 'simulation',
        brokerPositionId: simulatedId('sim-ctrader-pos', action, { id: options.accountId }),
        brokerOrderId: simulatedId('sim-ctrader-order', action, { id: options.accountId }),
        fillPrice: simulatedFillPrice(action),
      };
    },
    async close() {},
  };
}

/**
 * Production-shaped execution dependencies with the provider transport boundary
 * replaced by deterministic no-network adapters. All account loading, durable
 * authority checks, policy/risk materialization, delivery persistence,
 * idempotency and state binding continue to use the production implementation.
 *
 * This factory is selected only by trusted server configuration in
 * v1_execution_stage.js. Request payloads cannot select it.
 */
export function createSafeSimulationExecutionDependencies(config = {}, overrides = {}) {
  const {
    fetchFn: _ignoredFetch,
    mt5ContextLoader: _ignoredMt5Context,
    mt5Executor: _ignoredMt5Executor,
    ctraderRuntimeFactory: _ignoredCTraderRuntime,
    ...safeOverrides
  } = overrides || {};

  return createProductionExecutionDependencies(config, {
    ...safeOverrides,
    fetchFn: noNetwork,
    mt5ContextLoader: async (options) => mt5SimulationContext(options),
    mt5Executor: mt5SimulationExecutor,
    ctraderRuntimeFactory: ctraderSimulationRuntime,
  });
}
