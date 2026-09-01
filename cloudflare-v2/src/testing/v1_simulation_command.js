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
  'arbitrary_tp',
  'duplicate',
  'fast_entry',
  'fast_completion',
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

    if (name === 'fast_completion' && scenarios.at(-1)?.name !== 'fast_entry') {
      throw new RangeError('fast_completion scenario requires an immediately preceding fast_entry scenario');
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

function readyAccounts(body) {
  const accounts = Array.isArray(body?.simulation?.accounts) ? body.simulation.accounts : [];
  return accounts.filter((account) => account?.status === 'READY');
}

function validateFastCompletion(body, history) {
  const envelopeError = validateSimulationEnvelope(body, 'fast completion');
  if (envelopeError) return envelopeError;

  const prior = [...history].reverse().find((entry) => entry.scenario.name === 'fast_entry');
  if (!prior) return 'fast completion requires a prior fast-entry result';
  const priorBody = prior.outcome?.result?.response?.body;
  const priorEnvelopeError = validateSimulationEnvelope(priorBody, 'fast entry');
  if (priorEnvelopeError) return priorEnvelopeError;

  const priorReady = readyAccounts(priorBody);
  if (priorReady.length !== 1 || !priorReady[0]?.groupId) {
    return 'fast entry must establish exactly one READY group before completion';
  }
  const originalGroupId = String(priorReady[0].groupId);

  const correlation = body.simulation.correlation;
  if (correlation?.status !== 'MATCHED' || correlation?.reason !== 'FAST_ENTRY_COMPLETION') {
    return 'fast completion must prove FAST_ENTRY_COMPLETION correlation';
  }
  if (String(correlation.groupId || '') !== originalGroupId) {
    return 'fast completion must reuse the same group created by fast entry';
  }

  const completedReady = readyAccounts(body);
  if (completedReady.length !== 1 || String(completedReady[0]?.groupId || '') !== originalGroupId) {
    return 'fast completion READY account must reuse the same group created by fast entry';
  }

  const actions = Array.isArray(completedReady[0].actions) ? completedReady[0].actions : [];
  const actionTypes = actions.map((action) => action?.type);
  if (actionTypes.length !== 3 || actionTypes[0] !== 'MODIFY_POSITION' || actionTypes[1] !== 'OPEN_POSITION' || actionTypes[2] !== 'OPEN_POSITION') {
    return 'fast completion must modify TP1 and open only the two missing TP legs';
  }
  if (actions.some((action) => action?.simulated !== true)) {
    return 'fast completion actions must all be simulated=true';
  }
  if (Number(actions[0]?.targetIndex) !== 1 || Number(actions[1]?.targetIndex) !== 2 || Number(actions[2]?.targetIndex) !== 3) {
    return 'fast completion actions must preserve TP1/TP2/TP3 target ordering';
  }

  return null;
}

function validateArbitraryTp(body) {
  const envelopeError = validateSimulationEnvelope(body, 'arbitrary TP');
  if (envelopeError) return envelopeError;

  const accounts = readyAccounts(body);
  if (accounts.length === 0) {
    return 'arbitrary TP simulation must include at least one READY account';
  }

  for (const account of accounts) {
    const actions = Array.isArray(account?.actions) ? account.actions : [];
    if (actions.length !== 5) {
      return 'arbitrary TP simulation must preserve all five target actions';
    }
    if (actions.some((action) => action?.type !== 'OPEN_POSITION' || action?.simulated !== true)) {
      return 'arbitrary TP simulation must contain five simulated OPEN_POSITION target actions';
    }
    const indexes = actions.map((action) => Number(action?.targetIndex));
    if (!indexes.every((value, index) => value === index + 1)) {
      return 'arbitrary TP simulation must preserve five ordered target indexes 1 through 5';
    }
  }

  return null;
}

function validateAmbiguous(body) {
  if (body?.ok !== true || body?.duplicate === true) {
    return 'ambiguous response must confirm a new successful event';
  }
  if (body?.interpretation?.status !== 'NEEDS_REVIEW') {
    return 'ambiguous interpretation must remain NEEDS_REVIEW rather than becoming executable';
  }

  const simulation = body?.simulation;
  if (!simulation || simulation.status !== 'NEEDS_REVIEW' || simulation.executionEnabled !== false) {
    return 'ambiguous simulation must remain NEEDS_REVIEW with executionEnabled=false';
  }
  if (Array.isArray(simulation.actions) && simulation.actions.length > 0) {
    return 'ambiguous simulation must emit zero top-level actions';
  }

  const accounts = Array.isArray(simulation.accounts) ? simulation.accounts : [];
  if (accounts.some((account) => account?.status === 'READY')) {
    return 'ambiguous simulation must not include a READY account';
  }
  if (accounts.some((account) => Array.isArray(account?.actions) && account.actions.length > 0)) {
    return 'ambiguous simulation accounts must emit zero actions';
  }

  return null;
}

function validateScenarioSemantics(scenario, outcome, history = []) {
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

  if (scenario.name === 'fast_completion') {
    return validateFastCompletion(body, history);
  }

  if (scenario.name === 'arbitrary_tp') {
    return validateArbitraryTp(body);
  }

  if (scenario.name === 'ambiguous') {
    return validateAmbiguous(body);
  }

  if (scenario.name !== 'complete_signal') return null;

  const envelopeError = validateSimulationEnvelope(body, 'complete signal');
  if (envelopeError) return envelopeError;

  const accounts = readyAccounts(body);
  if (accounts.length === 0) {
    return 'complete signal simulation must include at least one READY account';
  }

  const actions = accounts.flatMap((account) => Array.isArray(account?.actions) ? account.actions : []);
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
    const history = [];

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

      const semanticError = validateScenarioSemantics(scenario, outcome, history);
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

      history.push({ scenario, outcome });
    }

    return { ok: true, exitCode: 0, runId, results };
  } catch (error) {
    const message = String(error?.message || 'V1 simulation acceptance failed');
    logger?.error?.(message);
    return { ok: false, exitCode: 1, error: message };
  }
}
