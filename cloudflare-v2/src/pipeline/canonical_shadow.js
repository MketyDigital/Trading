import { interpretTradingEvent } from '../ai/trading_interpreter.js';

export async function buildCanonicalShadow(event, { aiRouter, aiTimeoutMs = 800 } = {}) {
  const interpreted = await interpretTradingEvent(event, { aiRouter, timeoutMs: aiTimeoutMs });
  return {
    ...interpreted,
    executionEnabled: false,
    actions: [],
  };
}
