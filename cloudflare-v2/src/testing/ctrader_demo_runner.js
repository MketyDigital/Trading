import { buildCTraderDemoCommandDependencies, validateCTraderDemoCommandEnvironment } from './ctrader_demo_command.js';
import { runCTraderDemoAcceptanceFromEnv } from './ctrader_demo_cli.js';

function safeErrorMessage(error) {
  const message = String(error?.message || 'cTrader demo acceptance failed');
  return message
    .replace(/https?:\/\/[^\s]+/gi, '[REDACTED_URL]')
    .replace(/(secret|token|password|credential|authorization|api[_-]?key|signature)\s*[:=]\s*[^\s,;]+/gi, '$1=[REDACTED]');
}

export async function runCTraderDemoCommand({
  env = {},
  logger = console,
  dependencyBuilder = buildCTraderDemoCommandDependencies,
  acceptanceRunner = runCTraderDemoAcceptanceFromEnv,
} = {}) {
  const readiness = validateCTraderDemoCommandEnvironment(env);
  if (!readiness.ok) {
    const message = `Missing cTrader demo command configuration: ${readiness.missing.join(', ')}`;
    logger?.error?.(message);
    return { ok: false, exitCode: 1, error: message };
  }

  try {
    const dependencies = dependencyBuilder({ env });
    const output = await acceptanceRunner({ env, ...dependencies });
    logger?.log?.(JSON.stringify(output));
    return { ok: true, exitCode: 0, output };
  } catch (error) {
    const message = safeErrorMessage(error);
    logger?.error?.(message);
    return { ok: false, exitCode: 1, error: message };
  }
}
