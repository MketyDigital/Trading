import { buildMachinePlan } from '../pipeline/machine_plan.js';
import { validateCanonicalSignalIntent } from '../pipeline/signal_intent_validator.js';
import { normalizeSymbol, normalizeOrderIntent } from '../normalization/trading_normalizer.js';
import { normalizeCurrentMarketAliases } from '../normalization/current_market_aliases.js';
import { recoverKnownNaturalLanguageSignal, recoverMaterialSignalFallback } from './relaxed_signal_recovery.js';

const INTERPRETER_PROMPT = `Return JSON only. Classify the trading message into one of: NEW_SIGNAL, MANAGEMENT, NON_ACTIONABLE. For NEW_SIGNAL use fields: side BUY|SELL, symbol, order_type MARKET|LIMIT|STOP|STOP_LIMIT, entry (number, {min,max}, or null for current market), stop_loss (number|null), take_profits (number array), fast_entry (boolean). Never invent missing numeric prices. If uncertain return {"event_type":"NON_ACTIONABLE"}.`;
const NATURAL_LANGUAGE_RECOVERY_MARKER = /\b(?:AROUND|NEAR|ABOUT|PROTECT|PROTECTION|RISK|OBJECTIVE|OBJECTIVES|AIM|AIMS|TARGET|TARGETS|SETUP|LOOKS?|GOOD|HERE|UNDER|ABOVE|BELOW|THEN|LET\s+IT\s+RUN)\b/i;
const EXPLICIT_SIGNAL_STRUCTURE = /\b(?:ENTRY(?:\s+(?:PRICE|ZONE))?|SL|S\s*\/\s*L|STOP\s+LOSS|TP(?:[1-9]\d*)?|T\s*\/\s*P|TAKE\s+PROFIT|MARKET|NOW|CMP|CURRENT\s+(?:MARKET|MKT|PRICE))\b/i;

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

function normalizeAiSignal(payload) {
  if (payload?.event_type !== 'NEW_SIGNAL') throw new TypeError('unsupported AI event type');
  const order = normalizeOrderIntent(`${payload.side || ''} ${payload.order_type || ''}`);
  if (!order.side || !['MARKET', 'LIMIT', 'STOP', 'STOP_LIMIT'].includes(order.orderType)) throw new TypeError('invalid side or order type');
  const symbolSource = String(payload.symbol || '').trim();
  if (!symbolSource) throw new TypeError('symbol required');
  const takeProfits = Array.isArray(payload.take_profits)
    ? payload.take_profits.map(Number).filter(Number.isFinite)
    : [];
  return {
    side: order.side,
    orderType: order.orderType,
    symbol: normalizeSymbol(symbolSource),
    entry: normalizeEntry(payload.entry),
    stopLoss: numberOrNull(payload.stop_loss),
    takeProfits,
    fastEntry: Boolean(payload.fast_entry),
    incomplete: Boolean(payload.fast_entry) || numberOrNull(payload.stop_loss) == null || takeProfits.length === 0,
  };
}

function realWorldManagementAlias(text) {
  const upper = String(text ?? '').trim().toUpperCase().replace(/\s+/g, ' ');
  if (/^STOPPED\s+(?:OUT\s+)?AT\s+(?:BE|BREAK\s*EVEN|BREAKEVEN)\b/.test(upper)) {
    return {
      status: 'NO_ACTION',
      source: 'deterministic',
      reason: 'INFORMATIONAL_MANAGEMENT',
      information: { type: 'POSITION_STOPPED_AT_BREAK_EVEN' },
    };
  }
  if (/^(?:SL|STOP)\s+(?:IS\s+)?(?:AT|TO)\s+(?:BE|BREAK\s*EVEN|BREAKEVEN)(?:\s+NOW)?[!.]*$/.test(upper)) {
    return { status: 'MANAGEMENT', source: 'deterministic', management: { type: 'MOVE_SL_TO_BE' } };
  }
  return null;
}

function aiContext(ai, { error = null } = {}) {
  if (!ai || typeof ai !== 'object') return null;
  const context = {
    provider: ai.provider ?? null,
    model: ai.model ?? null,
    diagnostics: Array.isArray(ai.diagnostics) ? ai.diagnostics : [],
  };
  if (error) context.error = error;
  return context;
}

function deterministicFallback(event, reason, detail = null, ai = null) {
  const intent = recoverMaterialSignalFallback(event?.text);
  const aiMeta = aiContext(ai, { error: detail || reason });
  if (!intent) {
    return {
      status: 'NEEDS_REVIEW',
      source: 'fallback',
      reason: detail || reason,
      ...(aiMeta ? { ai: aiMeta } : {}),
    };
  }
  return {
    status: 'READY',
    source: 'deterministic_fallback',
    intent,
    fallback: { reason, detail: detail || null },
    ...(aiMeta ? { ai: aiMeta } : {}),
  };
}

function trustIncompleteMachinePlan(text, intent = {}) {
  if (intent.fastEntry) return true;
  const source = String(text ?? '');
  if (NATURAL_LANGUAGE_RECOVERY_MARKER.test(source)) return false;
  if (EXPLICIT_SIGNAL_STRUCTURE.test(source)) return true;
  return intent?.entry?.kind === 'PRICE' || intent?.entry?.kind === 'RANGE';
}

export async function interpretTradingEvent(event = {}, {
  aiRouter,
  aiRouterFactory,
  timeoutMs = 12000,
  systemPrompt = INTERPRETER_PROMPT,
} = {}) {
  const realWorldAlias = realWorldManagementAlias(event.text);
  if (realWorldAlias) return realWorldAlias;

  const deterministicText = normalizeCurrentMarketAliases(event.text);
  const deterministicEvent = deterministicText === String(event.text ?? '')
    ? event
    : { ...event, text: deterministicText };
  const deterministic = buildMachinePlan(deterministicEvent);
  if (deterministic.status !== 'NEEDS_INTERPRETATION') {
    if (deterministic.status === 'READY' && deterministic.intent?.incomplete) {
      const recovered = recoverKnownNaturalLanguageSignal(deterministicText);
      if (recovered) return { status: 'READY', source: 'deterministic_relaxed', intent: recovered };
      if (trustIncompleteMachinePlan(deterministicText, deterministic.intent)) {
        return { ...deterministic, source: 'deterministic' };
      }
    } else {
      return { ...deterministic, source: 'deterministic' };
    }
  }

  const relaxedIntent = recoverKnownNaturalLanguageSignal(deterministicText);
  if (relaxedIntent) {
    return { status: 'READY', source: 'deterministic_relaxed', intent: relaxedIntent };
  }

  let resolvedAiRouter = aiRouter;
  if (!resolvedAiRouter && typeof aiRouterFactory === 'function') {
    try {
      resolvedAiRouter = await aiRouterFactory();
    } catch (error) {
      return deterministicFallback(event, 'AI interpreter unavailable', error?.message);
    }
  }

  if (!resolvedAiRouter?.processSignal) {
    return deterministicFallback(event, 'AI interpreter unavailable');
  }

  let ai;
  try {
    ai = await resolvedAiRouter.processSignal(String(event.text ?? ''), systemPrompt, {
      timeoutMs,
      purpose: 'ambiguity_ai',
    });
  } catch (error) {
    return deterministicFallback(event, 'AI interpretation failed', error?.message);
  }

  if (!ai?.success) {
    return deterministicFallback(event, 'AI interpretation failed', ai?.error, ai);
  }

  try {
    const payload = parseJson(ai.text);
    if (payload.event_type !== 'NEW_SIGNAL') {
      return deterministicFallback(event, 'unsupported AI event type', null, ai);
    }
    const intent = normalizeAiSignal(payload);
    const validation = validateCanonicalSignalIntent(intent, { rawText: event.text });
    if (!validation.ok) {
      return deterministicFallback(event, 'AI hard validation conflict', validation.reason, ai);
    }
    return {
      status: 'READY',
      source: 'ai',
      intent,
      validationWarnings: validation.warnings || [],
      ai: aiContext(ai),
    };
  } catch (error) {
    return deterministicFallback(event, 'invalid AI output', error?.message || 'invalid AI output', ai);
  }
}
