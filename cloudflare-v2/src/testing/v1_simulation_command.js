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
  'thread_move_be',
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

function isReplyManagementScenario(name) {
  return name === 'move_be' || name === 'close_half';
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

    if (isReplyManagementScenario(name) && scenarios.at(-1)?.name !== 'complete_signal') {
      throw new RangeError(`${name} scenario requires an immediately preceding complete_signal scenario`);
    }

    if (name === 'thread_move_be' && scenarios.at(-1)?.name !== 'complete_signal') {
      throw new RangeError('thread_move_be scenario requires an immediately preceding complete_signal scenario');
    }

    if (name === 'cancel_pending' && scenarios.at(-1)?.name !== 'pending_order') {
      throw new RangeError('cancel_pending scenario requires an immediately preceding pending_order scenario');
    }

    const scenario = buildAcceptanceScenario(name, { runId });
    if (isReplyManagementScenario(name)) {
      scenario.event.thread.reply_to_event_id = scenarios.at(-1).event.external_event_id;
    }
    if (name === 'thread_move_be') {
      const threadId = `${runId}:thread-management`;
      scenarios.at(-1).event.thread.thread_id = threadId;
      scenario.event.thread.thread_id = threadId;
    }
    if (name === 'cancel_pending') {
      scenario.event.thread.reply_to_event_id = scenarios.at(-1).event.external_event_id;
    }
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

function priorCompleteGroup(history, label) {
  const prior = history.at(-1);
  if (!prior || prior.scenario.name !== 'complete_signal') {
    return { error: `${label} requires the immediately preceding complete signal` };
  }
  const priorBody = prior.outcome?.result?.response?.body;
  const envelopeError = validateSimulationEnvelope(priorBody, 'prior complete signal');
  if (envelopeError) return { error: envelopeError };
  const accounts = readyAccounts(priorBody);
  if (accounts.length !== 1 || !accounts[0]?.groupId) {
    return { error: `${label} requires exactly one READY group from the prior complete signal` };
  }
  return { groupId: String(accounts[0].groupId) };
}

function priorPendingGroup(history) {
  const prior = history.at(-1);
  if (!prior || prior.scenario.name !== 'pending_order') {
    return { error: 'pending cancellation requires the immediately preceding pending order' };
  }
  const body = prior.outcome?.result?.response?.body;
  const envelopeError = validateSimulationEnvelope(body, 'prior pending order');
  if (envelopeError) return { error: envelopeError };
  const accounts = readyAccounts(body);
  if (accounts.length !== 1 || !accounts[0]?.groupId) {
    return { error: 'pending cancellation requires exactly one READY group from the prior pending order' };
  }
  const actions = Array.isArray(accounts[0].actions) ? accounts[0].actions : [];
  if (actions.length === 0 || actions.some((action) => action?.type !== 'OPEN_POSITION' || String(action?.orderType || '').toUpperCase() === 'MARKET')) {
    return { error: 'prior pending order must contain one or more non-market OPEN_POSITION actions' };
  }
  return { groupId: String(accounts[0].groupId) };
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

function validateManagementActions(body, groupId, scenarioName, label) {
  const accounts = readyAccounts(body);
  if (accounts.length !== 1 || String(accounts[0]?.groupId || '') !== groupId) {
    return `${label} READY account must reuse the same group established by the prior complete signal`;
  }
  const actions = Array.isArray(accounts[0].actions) ? accounts[0].actions : [];
  if (actions.length === 0 || actions.some((action) => action?.simulated !== true)) {
    return `${label} must emit one or more simulated risk-reducing actions`;
  }
  if (scenarioName === 'move_be' || scenarioName === 'thread_move_be') {
    if (actions.some((action) => action?.type !== 'MODIFY_POSITION')) {
      return `${scenarioName} management actions must all be MODIFY_POSITION`;
    }
  } else if (scenarioName === 'close_half') {
    if (actions.some((action) => action?.type !== 'CLOSE_PARTIAL' || Number(action?.fraction) !== 0.5)) {
      return 'close_half management actions must all be CLOSE_PARTIAL with fraction 0.5';
    }
  }
  return null;
}

function validateReplyManagement(scenario, body, history) {
  const label = scenario.name === 'move_be' ? 'break-even reply management' : 'partial-close reply management';
  const envelopeError = validateSimulationEnvelope(body, label);
  if (envelopeError) return envelopeError;
  if (body?.interpretation?.status !== 'MANAGEMENT') {
    return 'reply management interpretation must remain MANAGEMENT';
  }

  const prior = priorCompleteGroup(history, 'reply management');
  if (prior.error) return prior.error;

  const correlation = body?.simulation?.correlation;
  if (correlation?.status !== 'MATCHED' || correlation?.reason !== 'REPLY_TARGET') {
    return 'reply management must prove REPLY_TARGET correlation';
  }
  if (String(correlation.groupId || '') !== prior.groupId) {
    return 'reply management must target the same group established by the prior complete signal';
  }

  return validateManagementActions(body, prior.groupId, scenario.name, 'reply management');
}

function validateThreadManagement(scenario, body, history) {
  const envelopeError = validateSimulationEnvelope(body, 'thread break-even management');
  if (envelopeError) return envelopeError;
  if (body?.interpretation?.status !== 'MANAGEMENT') {
    return 'thread management interpretation must remain MANAGEMENT';
  }

  const prior = priorCompleteGroup(history, 'thread management');
  if (prior.error) return prior.error;

  const correlation = body?.simulation?.correlation;
  if (correlation?.status !== 'MATCHED' || correlation?.reason !== 'THREAD_TARGET') {
    return 'thread management must prove THREAD_TARGET correlation';
  }
  if (String(correlation.groupId || '') !== prior.groupId) {
    return 'thread management must target the same group established by the prior complete signal';
  }

  return validateManagementActions(body, prior.groupId, scenario.name, 'thread management');
}

function validatePendingCancellation(body, history) {
  const envelopeError = validateSimulationEnvelope(body, 'pending cancellation');
  if (envelopeError) return envelopeError;
  if (body?.interpretation?.status !== 'MANAGEMENT' || body?.interpretation?.management?.type !== 'CANCEL_PENDING') {
    return 'pending cancellation interpretation must remain MANAGEMENT/CANCEL_PENDING';
  }

  const prior = priorPendingGroup(history);
  if (prior.error) return prior.error;

  const correlation = body?.simulation?.correlation;
  if (correlation?.status !== 'MATCHED' || correlation?.reason !== 'REPLY_TARGET') {
    return 'pending cancellation must prove REPLY_TARGET correlation';
  }
  if (String(correlation.groupId || '') !== prior.groupId) {
    return 'pending cancellation must target the same group established by the prior pending order';
  }

  const accounts = readyAccounts(body);
  if (accounts.length !== 1 || String(accounts[0]?.groupId || '') !== prior.groupId) {
    return 'pending cancellation READY account must reuse the same pending group';
  }
  const actions = Array.isArray(accounts[0].actions) ? accounts[0].actions : [];
  if (actions.length === 0 || actions.some((action) => action?.type !== 'CANCEL_PENDING' || action?.simulated !== true)) {
    return 'pending cancellation actions must all be simulated CANCEL_PENDING actions';
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

  if (isReplyManagementScenario(scenario.name)) {
    return validateReplyManagement(scenario, body, history);
  }

  if (scenario.name === 'thread_move_be') {
    return validateThreadManagement(scenario, body, history);
  }

  if (scenario.name === 'cancel_pending') {
    return validatePendingCancellation(body, history);
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
