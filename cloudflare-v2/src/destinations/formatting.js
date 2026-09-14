function asText(value) {
  return value == null ? '' : String(value);
}

function normalizeComparable(value) {
  if (Array.isArray(value)) return value.map(normalizeComparable);
  if (value && typeof value === 'object') {
    if (value.canonical) return String(value.canonical).toUpperCase();
    const out = {};
    for (const [key, item] of Object.entries(value)) out[key] = normalizeComparable(item);
    return out;
  }
  if (typeof value === 'number') return Number(value);
  return value == null ? null : String(value).toUpperCase();
}

function numbersEqual(left, right) {
  if (left == null && right == null) return true;
  const a = Number(left);
  const b = Number(right);
  return Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) < 1e-9;
}

function symbolOf(intent = {}) {
  return String(intent.symbol?.canonical ?? intent.symbol ?? '').trim().toUpperCase();
}

function entryOf(intent = {}) {
  const entry = intent.entry || {};
  if (entry.kind === 'PRICE') return { kind: 'PRICE', value: Number(entry.value) };
  if (entry.kind === 'RANGE') return { kind: 'RANGE', min: Number(entry.min), max: Number(entry.max) };
  if (entry.kind === 'MARKET') return { kind: 'MARKET' };
  return normalizeComparable(entry);
}

export function assertSemanticsPreserved(before = {}, after = {}) {
  if (symbolOf(before) !== symbolOf(after)) return { ok: false, reason: 'SYMBOL_CHANGED' };
  if (String(before.side ?? '').toUpperCase() !== String(after.side ?? '').toUpperCase()) return { ok: false, reason: 'SIDE_CHANGED' };
  if (String(before.orderType ?? before.order_type ?? '').toUpperCase() !== String(after.orderType ?? after.order_type ?? '').toUpperCase()) return { ok: false, reason: 'ORDER_TYPE_CHANGED' };

  const beforeEntry = entryOf(before);
  const afterEntry = entryOf(after);
  if (JSON.stringify(beforeEntry) !== JSON.stringify(afterEntry)) return { ok: false, reason: 'ENTRY_CHANGED' };
  if (!numbersEqual(before.stopLoss ?? before.stop_loss, after.stopLoss ?? after.stop_loss)) return { ok: false, reason: 'STOP_LOSS_CHANGED' };

  const beforeTargets = Array.isArray(before.takeProfits ?? before.take_profits) ? before.takeProfits ?? before.take_profits : [];
  const afterTargets = Array.isArray(after.takeProfits ?? after.take_profits) ? after.takeProfits ?? after.take_profits : [];
  if (beforeTargets.length !== afterTargets.length) return { ok: false, reason: 'TAKE_PROFITS_CHANGED' };
  for (let i = 0; i < beforeTargets.length; i += 1) {
    if (!numbersEqual(beforeTargets[i], afterTargets[i])) return { ok: false, reason: 'TAKE_PROFITS_CHANGED' };
  }

  return { ok: true };
}

function cleanRawText(rawText, cleanupRules = {}) {
  let lines = asText(rawText).split(/\r?\n/);
  const blocked = Array.isArray(cleanupRules.removeLinesContaining) ? cleanupRules.removeLinesContaining.map(asText).filter(Boolean) : [];
  if (blocked.length) {
    lines = lines.filter((line) => !blocked.some((needle) => line.includes(needle)));
  }
  let text = lines.join('\n').trim();
  if (cleanupRules.removeLinks === true) {
    text = text.replace(/https?:\/\/\S+/gi, '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  }
  return text;
}

function htmlEscape(value) {
  return asText(value).replace(/[&<>]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[char]));
}

function renderEntry(entry = {}) {
  if (entry.kind === 'PRICE') return String(entry.value);
  if (entry.kind === 'RANGE') return `${entry.min} - ${entry.max}`;
  return 'Market';
}

function renderTemplate({ interpretation = {} }, template = {}) {
  const intent = interpretation.intent || {};
  const brand = asText(template.brandName ?? template.brand_name).trim();
  const header = asText(template.header).trim();
  const footer = asText(template.footer ?? template.disclaimer).trim();
  const targets = Array.isArray(intent.takeProfits) ? intent.takeProfits : [];
  const lines = [];
  if (brand) lines.push(`<b>${htmlEscape(brand)}</b>`);
  if (header) lines.push(htmlEscape(header));
  lines.push(`Pair: <b>${htmlEscape(symbolOf(intent))}</b>`);
  lines.push(`Action: <b>${htmlEscape(intent.side)}</b>`);
  lines.push(`Order: ${htmlEscape(intent.orderType || 'MARKET')}`);
  lines.push(`Entry: ${htmlEscape(renderEntry(intent.entry || { kind: 'MARKET' }))}`);
  if (intent.stopLoss != null) lines.push(`SL: ${htmlEscape(intent.stopLoss)}`);
  targets.forEach((target, index) => lines.push(`TP${index + 1}: ${htmlEscape(target)}`));
  if (footer) lines.push('', htmlEscape(footer));
  return lines.join('\n');
}

export function formatTelegramDestinationMessage(input = {}, template = {}) {
  const mode = String(input.mode ?? template.formattingMode ?? template.formatting_mode ?? 'template').trim() || 'template';
  const parseMode = String(template.parseMode ?? template.parse_mode ?? (mode === 'none' || mode === 'clean' ? 'plain' : 'HTML'));

  if (mode === 'none') {
    return { ok: true, text: asText(input.rawText), parseMode: 'plain' };
  }

  if (mode === 'clean') {
    return { ok: true, text: cleanRawText(input.rawText, template.cleanupRules ?? template.cleanup_rules ?? {}), parseMode: 'plain' };
  }

  if (mode === 'template' || mode === 'ai_then_fallback') {
    if (!input.interpretation?.intent) return { ok: false, reason: 'CANONICAL_INTENT_REQUIRED' };
    return { ok: true, text: renderTemplate(input, template), parseMode };
  }

  return { ok: false, reason: 'FORMAT_MODE_UNSUPPORTED' };
}
