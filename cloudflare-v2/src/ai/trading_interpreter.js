import { buildMachinePlan } from '../pipeline/machine_plan.js';
import { normalizeSymbol, normalizeOrderIntent } from '../normalization/trading_normalizer.js';
import { recoverKnownNaturalLanguageSignal } from './relaxed_signal_recovery.js';

const INTERPRETER_PROMPT = `Return JSON only. Classify the trading message into one of: NEW_SIGNAL, MANAGEMENT, NON_ACTIONABLE. For NEW_SIGNAL use fields: side BUY|SELL, symbol, order_type MARKET|LIMIT|STOP|STOP_LIMIT, entry (number, {min,max}, or null for current market), stop_loss (number|null), take_profits (number array), fast_entry (boolean). Never invent missing numeric prices. If uncertain return {"event_type":"NON_ACTIONABLE"}.`;

function parseJson(text) {
  const cleaned = String(text ?? '').replace(/```(?:json)?/gi, '').replace(/```/g, '').trim();
  return JSON.parse(cleaned);
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function normalizeEntry(value) {
  if (value === null || value === undefined) return { kind: 'MARKET' };
  if (Number.isFinite(Number(value))) return { kind: 'PRICE', value: Number(value) };
  if (typeof value === 'object' && Number.isFinite(Number(value.min)) && Number.isFinite(Number(value.max))) {
    const min = Number(value.min);
    const max = Number(value.max);
    return { kind: 'RANGE', min: Math.min(min, max), max: Math.max(min, max) };
  }
  throw new TypeError('invalid AI entry');
}

function validationReference(intent) {
  if (intent.entry?.kind === 'PRICE') return intent.entry.value;
  if (intent.entry?.kind === 'RANGE') return intent.side === 'BUY' ? intent.entry.max : intent.entry.min;
  return null;
}

function validateGeometry(intent) {
  const reference = validationReference(intent);
  if (reference == null || !Number.isFinite(Number(reference))) return { ok: true };
  const ref = Number(reference);
  if (intent.stopLoss != null) {
    if (intent.side === 'BUY' && !(intent.stopLoss < ref)) return { ok: false, reason: 'invalid BUY stop geometry' };
    if (intent.side === 'SELL' && !(intent.stopLoss > ref)) return { ok: false, reason: 'invalid SELL stop geometry' };
  }
  for (const target of intent.takeProfits || []) {
    if (intent.side === 'BUY' && !(target > ref)) return { ok: false, reason: 'invalid BUY target geometry' };
    if (intent.side === 'SELL' && !(target < ref)) return { ok: false, reason: 'invalid SELL target geometry' };
  }
  return { ok: true };
}

function normalizeAiSignal(payload) {
  if (payload?.event_type !== 'NEW_SIGNAL') throw new TypeError('unsupported AI event type');
  const order = normalizeOrderIntent(`${payload.side || ''} ${payload.order_type || ''}`);
  if (!order.side || !['MARKET', 'LIMIT', 'STOP', 'STOP_LIMIT'].includes(order.orderType)) throw new TypeError('invalid side or order type');
  const symbolSource = String(payload.symbol || '').trim();
  if (!symbolSource) throw new TypeError('symbol required');
  const takeProfits = Array.isArray(payload.take_profits)
    ? payload.take_profits.map(Number).filter(Number.isFinite)
    : [];
  const intent = {
    side: order.side,
    orderType: order.orderType,
    symbol: normalizeSymbol(symbolSource),
    entry: normalizeEntry(payload.entry),
    stopLoss: numberOrNull(payload.stop_loss),
    takeProfits,
    fastEntry: Boolean(payload.fast_entry),
    incomplete: Boolean(payload.fast_entry) || numberOrNull(payload.stop_loss) == null || takeProfits.length === 0,
  };
  const geometry = validateGeometry(intent);
  if (!geometry.ok) throw new RangeError(geometry.reason);
  return intent;
}

export async function interpretTradingEvent(event = {}, {
  aiRouter,
  aiRouterFactory,
  timeoutMs = 1200,
  systemPrompt = INTERPRETER_PROMPT,
} = {}) {
  const deterministic = buildMachinePlan(event);
  if (deterministic.status !== 'NEEDS_INTERPRETATION') {
    if (deterministic.status === 'READY' && deterministic.intent?.incomplete) {
      const recovered = recoverKnownNaturalLanguageSignal(event.text);
      if (recovered) return { status: 'READY', source: 'deterministic_relaxed', intent: recovered };
      if (deterministic.intent?.fastEntry) return { ...deterministic, source: 'deterministic' };
    } else {
      return { ...deterministic, source: 'deterministic' };
    }
  }

  const relaxedIntent = recoverKnownNaturalLanguageSignal(event.text);
  if (relaxedIntent) {
    return { status: 'READY', source: 'deterministic_relaxed', intent: relaxedIntent };
  }

  let resolvedAiRouter = aiRouter;
  if (!resolvedAiRouter && typeof aiRouterFactory === 'function') {
    try {
      resolvedAiRouter = await aiRouterFactory();
    } catch {
      return { status: 'NEEDS_REVIEW', source: 'ai', reason: 'AI interpreter unavailable' };
    }
  }

  if (!resolvedAiRouter?.processSignal) {
    return { status: 'NEEDS_REVIEW', source: 'none', reason: 'AI interpreter unavailable' };
  }

  let ai;
  try {
    ai = await resolvedAiRouter.processSignal(String(event.text ?? ''), systemPrompt, {
      timeoutMs,
      purpose: 'ambiguity_ai',
    });
  } catch {
    return { status: 'NEEDS_REVIEW', source: 'ai', reason: 'AI interpretation failed' };
  }

  if (!ai?.success) {
    return { status: 'NEEDS_REVIEW', source: 'ai', reason: ai?.error || 'AI interpretation failed' };
  }

  try {
    const payload = parseJson(ai.text);
    if (payload.event_type !== 'NEW_SIGNAL') {
      return { status: 'NEEDS_REVIEW', source: 'ai', reason: 'unsupported AI event type' };
    }
    const intent = normalizeAiSignal(payload);
    return {
      status: 'READY',
      source: 'ai',
      intent,
      ai: { provider: ai.provider ?? null, model: ai.model ?? null },
    };
  } catch (error) {
    return { status: 'NEEDS_REVIEW', source: 'ai', reason: error.message || 'invalid AI output' };
  }
}
