const DEFAULT_TIMEOUT_MS = 500;
const ALLOWED_FIELDS = new Set(['sideSymbol', 'entry', 'stopLoss', 'takeProfits']);

function valueOfEntry(entry) {
  if (entry == null) return null;
  if (typeof entry === 'number' || typeof entry === 'string') return entry;
  if (entry && typeof entry === 'object') {
    if (entry.value != null) return entry.value;
    if (entry.price != null) return entry.price;
    if (Array.isArray(entry.range) && entry.range.length === 2) return entry.range.join(' - ');
    if (entry.min != null && entry.max != null) return `${entry.min} - ${entry.max}`;
  }
  return null;
}

function canonicalProjection(canonicalEvent = {}) {
  const intent = canonicalEvent.intent || {};
  return {
    side: String(intent.side ?? '').toUpperCase() || null,
    symbol: String(intent.symbol?.canonical ?? intent.symbol ?? '').toUpperCase() || null,
    entry: valueOfEntry(intent.entry),
    stopLoss: intent.stopLoss ?? intent.stop_loss ?? null,
    takeProfits: Array.isArray(intent.takeProfits)
      ? [...intent.takeProfits]
      : Array.isArray(intent.take_profits) ? [...intent.take_profits] : [],
  };
}

function sameScalar(a, b) {
  if (a == null || b == null) return a == null && b == null;
  const na = Number(a);
  const nb = Number(b);
  if (Number.isFinite(na) && Number.isFinite(nb)) return na === nb;
  return String(a).trim().toUpperCase() === String(b).trim().toUpperCase();
}

function sameCanonical(expected, echo) {
  if (!echo || typeof echo !== 'object' || Array.isArray(echo)) return false;
  if (!sameScalar(expected.side, echo.side)) return false;
  if (!sameScalar(expected.symbol, echo.symbol)) return false;
  if (!sameScalar(expected.entry, echo.entry)) return false;
  if (!sameScalar(expected.stopLoss, echo.stopLoss)) return false;
  const actualTps = Array.isArray(echo.takeProfits) ? echo.takeProfits : [];
  if (actualTps.length !== expected.takeProfits.length) return false;
  return expected.takeProfits.every((tp, index) => sameScalar(tp, actualTps[index]));
}

function managementText(canonicalEvent = {}) {
  const type = String(canonicalEvent.management?.type ?? '').toUpperCase();
  const labels = {
    MOVE_SL_TO_BE: 'MOVE SL TO BREAK-EVEN',
    CLOSE_PARTIAL: 'CLOSE PARTIAL POSITION',
    CLOSE_ALL: 'CLOSE ALL POSITIONS',
    CLOSE: 'CLOSE POSITION',
    CANCEL_PENDING: 'CANCEL PENDING ORDER',
  };
  return labels[type] || type.replaceAll('_', ' ') || 'TRADE UPDATE';
}

function renderDeterministic(canonicalEvent = {}, presentation = {}) {
  const prefix = String(presentation.prefix ?? presentation.brandName ?? '').trim();
  const suffix = String(presentation.suffix ?? '').trim();
  const labels = presentation.labels && typeof presentation.labels === 'object' ? presentation.labels : {};

  if (canonicalEvent.status === 'MANAGEMENT' || canonicalEvent.management) {
    return [prefix, managementText(canonicalEvent), suffix].filter(Boolean).join('\n');
  }

  const projected = canonicalProjection(canonicalEvent);
  const sideSymbol = [projected.side, projected.symbol].filter(Boolean).join(' ');
  const fields = {
    sideSymbol,
    entry: projected.entry == null ? '' : `${labels.entry || 'ENTRY'}: ${projected.entry}`,
    stopLoss: projected.stopLoss == null ? '' : `${labels.stopLoss || 'SL'}: ${projected.stopLoss}`,
    takeProfits: projected.takeProfits.map((tp, index) => `${labels.takeProfit || 'TP'} ${index + 1}: ${tp}`).join('\n'),
  };

  const configuredOrder = Array.isArray(presentation.fieldOrder)
    ? presentation.fieldOrder.filter((field) => ALLOWED_FIELDS.has(field))
    : [];
  const order = configuredOrder.length ? configuredOrder : ['sideSymbol', 'entry', 'stopLoss', 'takeProfits'];
  const body = order.map((field) => fields[field]).filter(Boolean).join('\n');
  return [prefix, body, suffix].filter(Boolean).join('\n');
}

function boundedTimeout(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_TIMEOUT_MS;
  return Math.max(1, Math.min(parsed, 5000));
}

async function runAiFormatter(aiFormatter, input, timeoutMs) {
  let timer;
  try {
    return await Promise.race([
      Promise.resolve().then(() => aiFormatter(input)),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(Object.assign(new Error('AI_TIMEOUT'), { code: 'AI_TIMEOUT' })), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function breakerKey(workspaceId, aiProviderId) {
  const workspace = String(workspaceId ?? '').trim();
  const provider = String(aiProviderId ?? '').trim();
  if (!workspace || !provider) return null;
  return { purpose: 'destination_ai', provider, workspaceId: workspace };
}

function canAttempt(circuitBreaker, key) {
  if (!key || typeof circuitBreaker?.canAttempt !== 'function') return true;
  try {
    return circuitBreaker.canAttempt(key)?.allowed !== false;
  } catch {
    return true;
  }
}

function recordFailure(circuitBreaker, key) {
  if (!key || typeof circuitBreaker?.recordFailure !== 'function') return;
  try { circuitBreaker.recordFailure(key); } catch {}
}

function recordSuccess(circuitBreaker, key) {
  if (!key || typeof circuitBreaker?.recordSuccess !== 'function') return;
  try { circuitBreaker.recordSuccess(key); } catch {}
}

export async function renderTelegramDestination({
  canonicalEvent,
  destination = {},
  aiFormatter,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  workspaceId,
  aiProviderId,
  circuitBreaker,
} = {}) {
  if (!canonicalEvent || typeof canonicalEvent !== 'object') {
    throw new TypeError('canonicalEvent is required');
  }

  const presentation = destination?.presentation && typeof destination.presentation === 'object'
    ? destination.presentation
    : {};
  const deterministicText = renderDeterministic(canonicalEvent, presentation);
  const useAi = presentation.useAi === true;

  if (!useAi) {
    return { text: deterministicText, mode: 'DETERMINISTIC', fallbackReason: null };
  }
  if (typeof aiFormatter !== 'function') {
    return { text: deterministicText, mode: 'DETERMINISTIC', fallbackReason: 'AI_UNAVAILABLE' };
  }

  const circuitKey = breakerKey(workspaceId, aiProviderId);
  if (!canAttempt(circuitBreaker, circuitKey)) {
    return { text: deterministicText, mode: 'DETERMINISTIC', fallbackReason: 'AI_CIRCUIT_OPEN' };
  }

  const canonical = canonicalProjection(canonicalEvent);
  try {
    const result = await runAiFormatter(aiFormatter, {
      deterministicText,
      brandName: presentation.brandName ?? null,
      presentation: { ...presentation },
      canonical: {
        side: canonical.side,
        symbol: canonical.symbol,
        entry: canonical.entry,
        stopLoss: canonical.stopLoss,
        takeProfits: [...canonical.takeProfits],
      },
    }, boundedTimeout(timeoutMs));

    if (!result?.success) {
      recordFailure(circuitBreaker, circuitKey);
      return { text: deterministicText, mode: 'DETERMINISTIC', fallbackReason: 'AI_FAILED' };
    }
    recordSuccess(circuitBreaker, circuitKey);

    if (typeof result.text !== 'string' || !result.text.trim() || !result.canonicalEcho) {
      return { text: deterministicText, mode: 'DETERMINISTIC', fallbackReason: 'AI_INVALID_OUTPUT' };
    }
    if (!sameCanonical(canonical, result.canonicalEcho)) {
      return { text: deterministicText, mode: 'DETERMINISTIC', fallbackReason: 'AI_CANONICAL_MISMATCH' };
    }

    return { text: result.text.trim(), mode: 'AI', fallbackReason: null };
  } catch (error) {
    recordFailure(circuitBreaker, circuitKey);
    return {
      text: deterministicText,
      mode: 'DETERMINISTIC',
      fallbackReason: error?.code === 'AI_TIMEOUT' || error?.message === 'AI_TIMEOUT' ? 'AI_TIMEOUT' : 'AI_FAILED',
    };
  }
}
