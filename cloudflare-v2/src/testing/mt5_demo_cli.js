import { probeMT5Demo, runMT5DemoOrderLifecycle } from './mt5_demo_acceptance.js';

const SECRET_KEY = /(secret|token|password|credential|authorization|api[_-]?key|signature)/i;

function sanitize(value) {
  if (Array.isArray(value)) return value.map(sanitize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, nested]) => [
      key,
      SECRET_KEY.test(key) ? '[REDACTED]' : sanitize(nested),
    ]));
  }
  return value;
}

export function resolveMT5DemoAcceptanceMode(env = {}) {
  const mode = String(env.MT5_DEMO_ACCEPTANCE_MODE || 'probe').trim().toLowerCase();
  if (!['probe', 'lifecycle'].includes(mode)) throw new Error(`Unsupported MT5 demo acceptance mode: ${mode}`);
  return mode;
}

export async function runMT5DemoAcceptanceFromEnv({
  env = {},
  deliveryStore,
  fetchFn = fetch,
  probeFn = probeMT5Demo,
  lifecycleFn = runMT5DemoOrderLifecycle,
} = {}) {
  const mode = resolveMT5DemoAcceptanceMode(env);
  if (mode === 'probe') {
    return { mode, result: sanitize(await probeFn({ env, fetchFn })) };
  }

  return {
    mode,
    result: sanitize(await lifecycleFn({ env, deliveryStore, fetchFn })),
  };
}
