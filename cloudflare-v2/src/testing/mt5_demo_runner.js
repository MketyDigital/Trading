import { buildMT5DemoCommandDependencies, validateMT5DemoCommandEnvironment } from './mt5_demo_command.js';
import { runMT5DemoAcceptanceFromEnv } from './mt5_demo_cli.js';

function safeErrorMessage(error) {
  const message = String(error?.message || 'MT5 demo acceptance failed');
  return message
    .replace(/https?:\/\/[^\s]+/gi, '[REDACTED_URL]')
    .replace(/(secret|token|password|credential|authorization|api[_-]?key|signature)\s*[:=]\s*[^\s,;]+/gi, '$1=[REDACTED]');
}

export async function runMT5DemoCommand({
  env = {},
  logger = console,
  dependencyBuilder = buildMT5DemoCommandDependencies,
  acceptanceRunner = runMT5DemoAcceptanceFromEnv,
} = {}) {
  const mode = String(env.MT5_DEMO_ACCEPTANCE_MODE || 'probe').trim().toLowerCase();

  try {
    let dependencies = {};
    if (mode === 'lifecycle') {
      const readiness = validateMT5DemoCommandEnvironment(env);
      if (!readiness.ok) {
        const message = `Missing MT5 demo command configuration: ${readiness.missing.join(', ')}`;
        logger?.error?.(message);
        return { ok: false, exitCode: 1, error: message };
      }
      dependencies = dependencyBuilder({ env });
    }

    const output = await acceptanceRunner({ env, ...dependencies });
    logger?.log?.(JSON.stringify(output));
    return { ok: true, exitCode: 0, output };
  } catch (error) {
    const message = safeErrorMessage(error);
    logger?.error?.(message);
    return { ok: false, exitCode: 1, error: message };
  }
}
