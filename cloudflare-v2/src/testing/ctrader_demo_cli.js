import {
  probeCTraderDemo,
  runCTraderDemoOrderLifecycle,
} from './ctrader_demo_acceptance.js';

const SENSITIVE_KEY = /(secret|token|password|credential|authorization|api[_-]?key|signature)/i;

function redactSensitive(value) {
  if (Array.isArray(value)) return value.map(redactSensitive);
  if (!value || typeof value !== 'object') return value;

  const output = {};
  for (const [key, child] of Object.entries(value)) {
    output[key] = SENSITIVE_KEY.test(key) ? '[REDACTED]' : redactSensitive(child);
  }
  return output;
}

export function resolveCTraderDemoAcceptanceMode(env = {}) {
  const mode = String(env.CTRADER_DEMO_ACCEPTANCE_MODE || 'probe').trim().toLowerCase();
  if (!['probe', 'lifecycle'].includes(mode)) {
    throw new RangeError('CTRADER_DEMO_ACCEPTANCE_MODE must be probe or lifecycle');
  }
  return mode;
}

export async function runCTraderDemoAcceptanceFromEnv({
  env = {},
  probe = probeCTraderDemo,
  lifecycle = runCTraderDemoOrderLifecycle,
  ...dependencies
} = {}) {
  const mode = resolveCTraderDemoAcceptanceMode(env);
  const result = mode === 'probe'
    ? await probe({ env, ...dependencies })
    : await lifecycle({ env, ...dependencies });

  return {
    mode,
    result: redactSensitive(result),
  };
}
