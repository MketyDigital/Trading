import {
  buildAcceptanceScenario,
  runAcceptanceScenario,
  validateAcceptanceEnvironment,
} from './v1_acceptance_harness.js';

const DEFAULT_SCENARIOS = ['complete_signal', 'duplicate'];
const ALLOWED_SCENARIOS = new Set([
  'complete_signal',
  'duplicate',
  'fast_entry',
  'pending_order',
  'ambiguous',
  'move_be',
  'close_half',
  'cancel_pending',
]);
const SENSITIVE_KEY = /(secret|token|password|credential|authorization|api[_-]?key|signature)/i;

function sanitize(value) {
  if (Array.isArray(value)) return value.map(sanitize);
  if (!value || typeof value !== 'object') return value;
  const output = {};
  for (const [key, child] of Object.entries(value)) {
    if (SENSITIVE_KEY.test(key)) continue;
    output[key] = sanitize(child);
  }
  return output;
}

function parseScenarioNames(value) {
  const names = String(value || '')
    .split(',')
    .map((name) => name.trim().toLowerCase())
    .filter(Boolean);
  return names.length ? names : [...DEFAULT_SCENARIOS];
}

function buildScenarioSequence(names, runId) {
  const scenarios = [];
  let lastOriginal = null;

  for (const name of names) {
    if (!ALLOWED_SCENARIOS.has(name)) {
      throw new RangeError(`unsupported V1 simulation acceptance scenario: ${name}`);
    }

    if (name === 'duplicate') {
      if (!lastOriginal) throw new RangeError('duplicate scenario requires a prior non-duplicate scenario');
      scenarios.push(buildAcceptanceScenario('duplicate', { runId, duplicateOf: lastOriginal }));
      continue;
    }

    const scenario = buildAcceptanceScenario(name, { runId });
    scenarios.push(scenario);
    lastOriginal = scenario;
  }

  return scenarios;
}

export async function runV1SimulationAcceptanceCommand({
  env = {},
  logger = console,
  scenarioRunner = runAcceptanceScenario,
} = {}) {
  const readiness = validateAcceptanceEnvironment(env);
  if (!readiness.ok) {
    const message = `Missing V1 simulation acceptance configuration: ${readiness.missing.join(', ')}`;
    logger?.error?.(message);
    return { ok: false, exitCode: 1, error: message };
  }

  try {
    const runId = String(env.TRADING_V1_ACCEPTANCE_RUN_ID || `run-${Date.now()}`);
    const names = parseScenarioNames(env.TRADING_V1_ACCEPTANCE_SCENARIOS);
    const scenarios = buildScenarioSequence(names, runId);
    const results = [];

    for (const scenario of scenarios) {
      const outcome = await scenarioRunner({ env, scenario });
      const safeOutcome = sanitize(outcome);
      results.push(safeOutcome);
      logger?.log?.(JSON.stringify({ scenario: scenario.name, ...safeOutcome }));

      if (!outcome?.ok) {
        return {
          ok: false,
          exitCode: 1,
          failedScenario: scenario.name,
          results,
        };
      }
    }

    return { ok: true, exitCode: 0, runId, results };
  } catch (error) {
    const message = String(error?.message || 'V1 simulation acceptance failed');
    logger?.error?.(message);
    return { ok: false, exitCode: 1, error: message };
  }
}
