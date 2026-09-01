import {
  buildAcceptanceScenario,
  runAcceptanceScenario,
  validateAcceptanceEnvironment,
} from './v1_acceptance_harness.js';

const DEFAULT_SCENARIOS = [
  'complete_signal',
  'duplicate',
  'invalid_signature',
  'stale_timestamp',
];
const ALLOWED_SCENARIOS = new Set([
  'complete_signal',
  'duplicate',
  'fast_entry',
  'pending_order',
  'ambiguous',
  'move_be',
  'close_half',
  'cancel_pending',
  'kill_switch',
  'invalid_signature',
  'stale_timestamp',
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

function validateSimulationEnvelope(body, label) {
  if (body?.ok !== true || body?.duplicate === true) {
    return `${label} response must confirm a new successful event`;
  }
  const simulation = body?.simulation;
  if (!simulation || simulation.status !== 'SIMULATED' || simulation.executionEnabled !== false) {
    return `${label} response must include simulation.status=SIMULATED with executionEnabled=false`;
  }
  return null;
}

function validateScenarioSemantics(scenario, outcome) {
  const body = outcome?.result?.response?.body;

  if (scenario.name === 'duplicate') {
    if (body?.ok !== true || body?.duplicate !== true) {
      return 'duplicate response must confirm ok=true and duplicate=true';
    }
    return null;
  }

  if (scenario.name === 'kill_switch') {
    const envelopeError = validateSimulationEnvelope(body, 'kill-switch');
    if (envelopeError) return envelopeError;

    const accounts = Array.isArray(body.simulation.accounts) ? body.simulation.accounts : [];
    const blocked = accounts.filter((account) =>
      account?.status === 'BLOCKED' &&
      Array.isArray(account?.policy?.reasons) &&
      account.policy.reasons.includes('KILL_SWITCH')
    );
    if (blocked.length === 0) {
      return 'kill-switch simulation must include a BLOCKED account with KILL_SWITCH policy reason';
    }
    if (blocked.some((account) => Array.isArray(account?.actions) && account.actions.length > 0)) {
      return 'kill-switch blocked account must emit zero actions';
    }
    if (accounts.some((account) => account?.status === 'READY')) {
      return 'kill-switch simulation must not include a READY account';
    }
    return null;
  }

  if (scenario.name !== 'complete_signal') return null;

  const envelopeError = validateSimulationEnvelope(body, 'complete signal');
  if (envelopeError) return envelopeError;

  const accounts = Array.isArray(body.simulation.accounts) ? body.simulation.accounts : [];
  const readyAccounts = accounts.filter((account) => account?.status === 'READY');
  if (readyAccounts.length === 0) {
    return 'complete signal simulation must include at least one READY account';
  }

  const actions = readyAccounts.flatMap((account) => Array.isArray(account?.actions) ? account.actions : []);
  if (actions.length === 0 || actions.some((action) => action?.simulated !== true)) {
    return 'complete signal simulation must include simulated=true execution actions';
  }

  return null;
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

      const semanticError = validateScenarioSemantics(scenario, outcome);
      if (semanticError) {
        logger?.error?.(`V1 acceptance semantic failure for ${scenario.name}: ${semanticError}`);
        return {
          ok: false,
          exitCode: 1,
          failedScenario: scenario.name,
          semanticError,
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
